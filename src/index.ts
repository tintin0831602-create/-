import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import {
  clearExpiredImageRecordingIntents,
  consumeImageRecordingIntent,
  findUserByDisplayName,
  getCoachAccessByPin,
  grantAccess,
  getDailyTotals,
  getEntriesInDateRange,
  getUser,
  listUsersForCoachKeys,
  countStudentsForCoachKey,
  coachKeyForPin,
  listUsers,
  updateUserBodyStats,
  updateUserGoals,
} from "./db.js";
import { handleTextMessage, saveAnalysis } from "./commands.js";
import { analyzeFoodImage } from "./gemini.js";
import {
  getBotInfo,
  getMessageContent,
  replyText,
  showLoading,
  verifyLineSignature,
} from "./line.js";
import { groupIntroMessage, introMessage, registrationMessage } from "./messages.js";
import { todayInTimezone } from "./time.js";
import type { LineEvent, LineWebhookBody } from "./types.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "line-hermes-nutrition-bot" });
});

app.use(express.static(publicDir));
app.use("/admin", express.static(path.join(publicDir, "admin")));
app.use("/api", express.json());

app.get("/api/admin/summary", (req, res) => {
  const admin = getAdminContext(req);
  if (!admin) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const today = todayInTimezone(config.timezone);

  const visibleUsers =
    admin.kind === "owner"
      ? listUsers()
      : listUsersForCoachKeys(admin.coachKeys);

  const users = visibleUsers.map((user) => ({
    line_user_id: user.line_user_id,
    display_name: user.display_name,
    role: user.role || (user.is_coach ? "coach" : "student"),
    goal_calories: user.goal_calories,
    goal_protein_g: user.goal_protein_g,
    goal_fat_g: user.goal_fat_g,
    goal_carbs_g: user.goal_carbs_g,
    permanent_access: Boolean(user.permanent_access),
    access_expires_at: user.access_expires_at,
    student_quota: user.student_quota,
    coach_owner_id: user.coach_owner_id,
    today_totals: getDailyTotals(user.line_user_id, today),
  }));

  res.json({
    mode: admin.kind,
    coach:
      admin.kind === "coach"
        ? {
            name: admin.coachName,
            student_quota: admin.studentQuota,
            expires_at: admin.expiresAt,
            permanent_access: admin.permanentAccess,
            max_grant_days: maxGrantDays(admin),
          }
        : undefined,
    today,
    totals: {
      users: users.length,
      coaches: users.filter((user) => user.role === "coach").length,
      active: users.filter(
        (user) =>
          user.role === "owner" ||
          user.role === "coach" ||
          user.permanent_access ||
          (user.access_expires_at && user.access_expires_at > Date.now()),
      ).length,
    },
    users,
  });
});

app.post("/api/admin/grant", (req, res) => {
  const admin = getAdminContext(req);
  if (!admin) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { name, role, duration, studentQuota } = req.body as {
    name?: string;
    role?: "student" | "coach";
    duration?: "7" | "30" | "365" | "permanent" | "disabled";
    studentQuota?: number;
  };
  if (!name || !role || !duration) {
    res.status(400).json({ error: "Missing name, role, or duration" });
    return;
  }

  const user = findUserByDisplayName(name.trim());
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (admin.kind === "coach") {
    if (role !== "student" || duration === "permanent") {
      res.status(403).json({ error: "Coach can only grant student subscriptions" });
      return;
    }
    const requestedDays = durationToDays(duration);
    if (!requestedDays || !canCoachGrantDays(admin, requestedDays)) {
      res.status(403).json({ error: "Student subscription cannot exceed coach access period" });
      return;
    }
    const coachKey = admin.coachKeys[0];
    const alreadyOwned = user.coach_owner_id === coachKey;
    const used = countStudentsForCoachKey(coachKey);
    if (!alreadyOwned && used >= admin.studentQuota) {
      res.status(403).json({ error: `Student quota is full: ${used}/${admin.studentQuota}` });
      return;
    }
    const updated = grantAccess(user.line_user_id, "student", {
      days: requestedDays,
      coachOwnerId: coachKey,
    });
    res.json({ ok: true, user: updated });
    return;
  }

  const updated = grantAccess(user.line_user_id, role, {
    days:
      duration === "7"
        ? 7
        : duration === "30"
          ? 30
          : duration === "365"
            ? 365
            : duration === "disabled"
              ? 0
              : undefined,
    permanent: duration === "permanent",
    studentQuota: role === "coach" ? Number(studentQuota || 10) : undefined,
  });
  res.json({ ok: true, user: updated });
});

app.post("/api/admin/update-user", (req, res) => {
  const admin = getAdminContext(req);
  if (!admin) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { name, calories, protein, fat, carbs, sex, age, height, weight } = req.body as {
    name?: string;
    calories?: number;
    protein?: number;
    fat?: number;
    carbs?: number;
    sex?: "男" | "女" | "";
    age?: number;
    height?: number;
    weight?: number;
  };

  if (!name) {
    res.status(400).json({ error: "Missing name" });
    return;
  }

  const user = findUserByDisplayName(name.trim());
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (admin.kind === "coach" && !admin.coachKeys.includes(user.coach_owner_id || "")) {
    res.status(403).json({ error: "Coach can only update owned students" });
    return;
  }

  const macroValues = [calories, protein, fat, carbs];
  if (macroValues.every((value) => value !== undefined)) {
    if (macroValues.some((value) => !isPositiveNumber(value))) {
      res.status(400).json({ error: "Macro values must be positive numbers" });
      return;
    }
    updateUserGoals(user.line_user_id, {
      goal_calories: Number(calories),
      goal_protein_g: Number(protein),
      goal_fat_g: Number(fat),
      goal_carbs_g: Number(carbs),
    });
  }

  const bodyValues = [sex, age, height, weight];
  if (bodyValues.every((value) => value !== undefined && value !== "")) {
    if ((sex !== "男" && sex !== "女") || [age, height, weight].some((value) => !isPositiveNumber(value))) {
      res.status(400).json({ error: "Body stats are invalid" });
      return;
    }
    updateUserBodyStats(user.line_user_id, {
      sex,
      age: Number(age),
      height_cm: Number(height),
      weight_kg: Number(weight),
    });
  }

  res.json({ ok: true, user: getUser(user.line_user_id) });
});

app.get("/api/admin/weekly", (req, res) => {
  const admin = getAdminContext(req);
  if (!admin) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const name = String(req.query.name || "").trim();
  if (!name) {
    res.status(400).json({ error: "Missing name" });
    return;
  }

  const user = findUserByDisplayName(name);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (admin.kind === "coach" && !admin.coachKeys.includes(user.coach_owner_id || "")) {
    res.status(403).json({ error: "Coach can only view owned students" });
    return;
  }

  const today = todayInTimezone(config.timezone);
  const dates = lastSevenDates(today);
  const entries = getEntriesInDateRange(user.line_user_id, dates[0], dates[dates.length - 1]);
  const days = dates.map((date) => {
    const dayEntries = entries.filter((entry) => entry.consumed_date === date);
    const totals = sumEntries(dayEntries);
    return {
      date,
      totals,
      surplus_calories: Math.round(totals.calories - user.goal_calories),
      entries: dayEntries,
    };
  });
  const weekTotals = days.reduce<{
    calories: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
    surplus_calories: number;
  }>(
    (total, day) => ({
      calories: total.calories + day.totals.calories,
      protein_g: total.protein_g + day.totals.protein_g,
      fat_g: total.fat_g + day.totals.fat_g,
      carbs_g: total.carbs_g + day.totals.carbs_g,
      surplus_calories: total.surplus_calories + day.surplus_calories,
    }),
    { calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0, surplus_calories: 0 },
  );

  res.json({
    user: {
      display_name: user.display_name,
      goal_calories: user.goal_calories,
      goal_protein_g: user.goal_protein_g,
      goal_fat_g: user.goal_fat_g,
      goal_carbs_g: user.goal_carbs_g,
    },
    start_date: dates[0],
    end_date: dates[dates.length - 1],
    week_totals: weekTotals,
    days,
  });
});

app.post("/webhook", express.raw({ type: "*/*" }), async (req, res) => {
  const signature = req.header("x-line-signature");
  const rawBody = req.body as Buffer;

  if (!verifyLineSignature(rawBody, signature)) {
    res.status(401).send("Invalid signature");
    return;
  }

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody.toString("utf8")) as LineWebhookBody;
  } catch {
    res.status(400).send("Invalid JSON");
    return;
  }

  res.status(200).send("OK");

  await Promise.all(body.events.map((event) => handleEventSafely(event)));
});

async function handleEventSafely(event: LineEvent): Promise<void> {
  try {
    await handleEvent(event);
  } catch (error) {
    console.error("Failed to handle LINE event", error);
    if (event.replyToken) {
      try {
        await replyText(event.replyToken, "剛剛分析時出了點問題，請稍後再傳一次。");
      } catch (replyError) {
        console.error("Failed to send error reply", replyError);
      }
    }
  }
}

async function handleEvent(event: LineEvent): Promise<void> {
  if (!event.replyToken) {
    return;
  }

  const lineUserId = event.source?.userId;
  if (!lineUserId) {
    await replyText(event.replyToken, "我需要使用者 ID 才能分開記錄兩位成員。請在一對一或群組中允許 LINE 提供 userId。");
    return;
  }

  if (event.type === "follow") {
    await replyText(event.replyToken, introMessage());
    return;
  }

  if (event.type === "join") {
    await replyText(event.replyToken, groupIntroMessage());
    return;
  }

  if (event.type !== "message" || !event.message) {
    return;
  }

  const sourceId = getSourceId(event);
  const isGroupLike = event.source?.type === "group" || event.source?.type === "room";

  if (event.message.type === "text") {
    if (isGroupLike && !(await isAddressedToBot(event))) {
      return;
    }

    await showLoading(lineUserId, 10);
    const text = event.message.text || "";
    const response = await handleTextMessage(lineUserId, text, sourceId);
    await replyText(event.replyToken, response);
    return;
  }

  if (event.message.type === "image") {
    if (isGroupLike) {
      clearExpiredImageRecordingIntents(Date.now());
      const hasIntent = consumeImageRecordingIntent(lineUserId, sourceId, Date.now());
      if (!hasIntent) {
        return;
      }
    }

    const user = getUser(lineUserId);
    if (!user) {
      await replyText(event.replyToken, registrationMessage());
      return;
    }

    await showLoading(lineUserId, 20);
    const content = await getMessageContent(event.message.id);
    const analysis = await analyzeFoodImage(content.data, content.contentType);
    const response = saveAnalysis(user, analysis, "image", event.message.id);
    await replyText(event.replyToken, response);
    return;
  }

  await replyText(event.replyToken, "目前我先支援文字和餐點照片。輸入「幫助」可以看指令。");
}

function getSourceId(event: LineEvent): string {
  return event.source?.groupId || event.source?.roomId || event.source?.userId || "unknown";
}

async function isAddressedToBot(event: LineEvent): Promise<boolean> {
  const text = event.message?.text?.trim() || "";
  if (!text) {
    return false;
  }

  if (/^(hermes|赫米斯)[，,\s:：]*/iu.test(text)) {
    return true;
  }

  const botInfo = await getBotInfo();
  const mentionees = event.message?.mention?.mentionees || [];
  if (botInfo.userId && mentionees.some((mention) => mention.userId === botInfo.userId)) {
    return true;
  }

  const names = [botInfo.displayName, botInfo.basicId].filter(Boolean);
  return names.some((name) => text.startsWith(`@${name}`));
}

app.listen(config.port, () => {
  console.log(`Hermes nutrition bot listening on port ${config.port}`);
});

type AdminContext =
  | { kind: "owner" }
  | {
      kind: "coach";
      coachKeys: string[];
      coachName: string;
      studentQuota: number;
      expiresAt: number | null;
      permanentAccess: boolean;
    };

function getAdminContext(req: express.Request): AdminContext | undefined {
  const pin = req.header("x-admin-pin") || String(req.query.pin || "") || req.body?.pin;
  if (config.adminPin && pin === config.adminPin) {
    return { kind: "owner" };
  }

  const coachAccess = pin ? getCoachAccessByPin(pin) : undefined;
  if (!coachAccess) {
    return undefined;
  }
  if (!coachAccess.permanent_access && coachAccess.expires_at && coachAccess.expires_at <= Date.now()) {
    return undefined;
  }

  return {
    kind: "coach",
    coachKeys: [coachAccess.claimed_line_user_id || coachKeyForPin(coachAccess.pin)],
    coachName: coachAccess.coach_name,
    studentQuota: coachAccess.student_quota,
    expiresAt: coachAccess.expires_at,
    permanentAccess: Boolean(coachAccess.permanent_access),
  };
}

function isPositiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function durationToDays(duration: "7" | "30" | "365" | "permanent" | "disabled"): number | undefined {
  if (duration === "7") return 7;
  if (duration === "30") return 30;
  if (duration === "365") return 365;
  if (duration === "disabled") return 0;
  return undefined;
}

function lastSevenDates(today: string): string[] {
  const dates: string[] = [];
  const [year, month, day] = today.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  for (let offset = 6; offset >= 0; offset -= 1) {
    const next = new Date(date);
    next.setUTCDate(date.getUTCDate() - offset);
    dates.push(next.toISOString().slice(0, 10));
  }
  return dates;
}

function sumEntries(entries: Array<{ calories: number; protein_g: number; fat_g: number; carbs_g: number }>) {
  return entries.reduce(
    (total, entry) => ({
      calories: total.calories + entry.calories,
      protein_g: total.protein_g + entry.protein_g,
      fat_g: total.fat_g + entry.fat_g,
      carbs_g: total.carbs_g + entry.carbs_g,
    }),
    { calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0 },
  );
}

function canCoachGrantDays(admin: Extract<AdminContext, { kind: "coach" }>, days: number): boolean {
  if (admin.permanentAccess) {
    return true;
  }
  if (!admin.expiresAt) {
    return false;
  }
  return days <= remainingWholeDays(admin.expiresAt);
}

function maxGrantDays(admin: Extract<AdminContext, { kind: "coach" }>): number | null {
  if (admin.permanentAccess) {
    return null;
  }
  if (!admin.expiresAt) {
    return 0;
  }
  return remainingWholeDays(admin.expiresAt);
}

function remainingWholeDays(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)));
}
