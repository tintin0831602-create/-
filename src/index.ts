import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import {
  authorizeCheckoutSession,
  clearExpiredImageRecordingIntents,
  consumeImageRecordingIntent,
  claimCoachAccess,
  createCheckoutSession,
  createCoachAccess,
  createPaymentRecord,
  findCoachAccessByName,
  findUserByDisplayName,
  getCoachAccessByPin,
  getCheckoutSession,
  getCheckoutSessionByState,
  grantAccess,
  getDailyTotals,
  getEntriesInDateRange,
  getUser,
  listUsersForCoachKeys,
  countStudentsForCoachKey,
  coachKeyForPin,
  listUsers,
  markCheckoutSessionPaid,
  updateUserBodyStats,
  updateUserGoals,
  upsertUser,
} from "./db.js";
import { handleTextMessage, saveAnalysis } from "./commands.js";
import { analyzeFoodImage } from "./gemini.js";
import {
  getBotInfo,
  getMessageContent,
  replyMessages,
  replyText,
  showLoading,
  verifyLineSignature,
} from "./line.js";
import { groupIntroMessage, introMessage, registrationMessage } from "./messages.js";
import { todayInTimezone } from "./time.js";
import type { CheckoutPlanId, CheckoutSession, LineEvent, LineWebhookBody } from "./types.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "line-hermes-nutrition-bot" });
});

app.use(express.static(publicDir));
app.use("/admin", express.static(path.join(publicDir, "admin")));
app.use("/checkout", express.static(path.join(publicDir, "checkout")));
app.use("/api", express.json());

const checkoutPlans: Record<
  CheckoutPlanId,
  {
    id: CheckoutPlanId;
    role: "student" | "coach";
    label: string;
    amountTwd: number;
    days: number;
    studentQuota?: number;
    description: string;
  }
> = {
  student_month: {
    id: "student_month",
    role: "student",
    label: "個人月費會員",
    amountTwd: 60,
    days: 30,
    description: "開通 30 天 AI 營養分析權限",
  },
  student_year: {
    id: "student_year",
    role: "student",
    label: "個人一年會員",
    amountTwd: 600,
    days: 365,
    description: "開通一年 AI 營養分析權限",
  },
  coach_month: {
    id: "coach_month",
    role: "coach",
    label: "教練月費方案",
    amountTwd: 990,
    days: 30,
    studentQuota: 10,
    description: "產生或續約教練 PIN，含 10 位學員名額",
  },
  coach_year: {
    id: "coach_year",
    role: "coach",
    label: "教練一年方案",
    amountTwd: 9900,
    days: 365,
    studentQuota: 10,
    description: "產生或續約教練 PIN 一年，含 10 位學員名額",
  },
};

app.get("/api/checkout/config", (_req, res) => {
  res.json({
    lineLoginEnabled: Boolean(config.lineLoginChannelId && config.lineLoginChannelSecret),
    paymentTestMode: config.paymentTestMode,
    plans: Object.values(checkoutPlans),
  });
});

app.get("/api/checkout/session/:id", (req, res) => {
  const session = getCheckoutSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Checkout session not found" });
    return;
  }
  res.json({
    session: publicCheckoutSession(session),
    plan: checkoutPlans[session.plan_id],
  });
});

app.post("/api/checkout/test-complete", (req, res) => {
  if (!config.paymentTestMode) {
    res.status(403).json({ error: "Test payment mode is disabled" });
    return;
  }

  const { sessionId, payerName, payerPhone, payerEmail, coachName } = req.body as {
    sessionId?: string;
    payerName?: string;
    payerPhone?: string;
    payerEmail?: string;
    coachName?: string;
  };
  if (!sessionId || !payerName || !payerPhone || !payerEmail) {
    res.status(400).json({ error: "Missing payer information" });
    return;
  }

  const session = getCheckoutSession(sessionId);
  if (!session || session.expires_at <= Date.now()) {
    res.status(404).json({ error: "Checkout session expired or not found" });
    return;
  }
  if (!session.line_user_id || !session.display_name) {
    res.status(400).json({ error: "Please authorize with LINE first" });
    return;
  }

  const plan = checkoutPlans[session.plan_id];
  if (!plan) {
    res.status(400).json({ error: "Unknown checkout plan" });
    return;
  }

  let pin: string | null = null;
  if (plan.role === "coach") {
    const normalizedCoachName = (coachName || session.coach_name || payerName).trim();
    const existingAccess = findCoachAccessByName(normalizedCoachName);
    pin = existingAccess?.pin || generatePin();
    const extensionBase =
      existingAccess?.expires_at && existingAccess.expires_at > Date.now()
        ? existingAccess.expires_at
        : Date.now();
    createCoachAccess({
      pin,
      coachName: normalizedCoachName,
      expiresAt: extensionBase + plan.days * 24 * 60 * 60 * 1000,
      permanentAccess: false,
      studentQuota: plan.studentQuota || 10,
      createdByLineUserId: session.line_user_id,
    });
    claimCoachAccess(pin, session.line_user_id);
  } else {
    grantAccess(session.line_user_id, "student", { days: plan.days });
  }

  const payment = createPaymentRecord({
    id: crypto.randomUUID(),
    checkoutSessionId: session.id,
    lineUserId: session.line_user_id,
    planId: plan.id,
    role: plan.role,
    amountTwd: plan.amountTwd,
    status: "test_paid",
    provider: "test",
    providerTransactionId: `test_${Date.now()}`,
    payerName,
    payerPhone,
    payerEmail,
    resultPin: pin,
  });
  markCheckoutSessionPaid(session.id);

  res.json({
    ok: true,
    payment,
    plan,
    result: {
      role: plan.role,
      pin,
      admin_url: pin ? adminUrl(pin, "coach") : adminUrl(undefined, "student"),
      days: plan.days,
      student_quota: plan.studentQuota || null,
    },
  });
});

app.get("/auth/line/start", (req, res) => {
  const planId = normalizePlanId(String(req.query.plan || "student_month"));
  if (!planId) {
    res.redirect("/checkout/?error=unknown_plan");
    return;
  }
  if (!config.lineLoginChannelId || !config.lineLoginChannelSecret) {
    res.redirect("/checkout/?error=line_login_not_configured");
    return;
  }

  const state = crypto.randomBytes(18).toString("hex");
  const session = createCheckoutSession({
    id: crypto.randomUUID(),
    state,
    planId,
    role: checkoutPlans[planId].role,
    coachName: typeof req.query.coachName === "string" ? req.query.coachName.trim() : null,
    expiresAt: Date.now() + 30 * 60 * 1000,
  });
  const callbackUrl = lineLoginCallbackUrl();
  const authUrl = new URL("https://access.line.me/oauth2/v2.1/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", config.lineLoginChannelId);
  authUrl.searchParams.set("redirect_uri", callbackUrl);
  authUrl.searchParams.set("state", session.state);
  authUrl.searchParams.set("scope", "profile openid");
  authUrl.searchParams.set("nonce", crypto.randomBytes(12).toString("hex"));
  res.redirect(authUrl.toString());
});

app.get("/auth/line/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const session = state ? getCheckoutSessionByState(state) : undefined;
  if (!code || !session || session.expires_at <= Date.now()) {
    res.redirect("/checkout/?error=line_auth_expired");
    return;
  }

  try {
    const profile = await exchangeLineLoginProfile(code);
    upsertUser({
      line_user_id: profile.userId,
      display_name: profile.displayName,
      goal_calories: 2000,
      goal_protein_g: 120,
      goal_fat_g: 60,
      goal_carbs_g: 250,
      role: "student",
      permanent_access: 0,
      is_coach: 0,
    });
    const authorized = authorizeCheckoutSession(session.id, {
      lineUserId: profile.userId,
      displayName: profile.displayName,
    });
    res.redirect(`/checkout/?session=${encodeURIComponent(authorized?.id || session.id)}`);
  } catch (error) {
    console.error("LINE Login callback failed", error);
    res.redirect("/checkout/?error=line_auth_failed");
  }
});

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
    if (typeof response === "string") {
      await replyText(event.replyToken, response);
    } else {
      await replyMessages(event.replyToken, Array.isArray(response) ? response : [response]);
    }
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

  if (isSafeMenuCommand(text)) {
    return true;
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

function isSafeMenuCommand(text: string): boolean {
  const command = text.split(/\s+/).filter(Boolean)[0]?.toLowerCase();
  return [
    "help",
    "幫助",
    "功能",
    "指令",
    "選單",
    "主選單",
    "開始",
    "新手教學",
    "下一步",
    "學員區",
    "教練區",
    "管理員區",
    "付款區",
    "付款",
    "訂閱",
    "學員身份",
    "目標設定",
    "身體資料教學",
    "開始記錄",
    "文字記錄教學",
    "手動數字教學",
    "付款說明",
    "教練授權教學",
    "教練設定教學",
    "最高權限設定教學",
    "產生教練pin教學",
  ].includes(command || "");
}

function normalizePlanId(value: string): CheckoutPlanId | undefined {
  return Object.prototype.hasOwnProperty.call(checkoutPlans, value)
    ? (value as CheckoutPlanId)
    : undefined;
}

function lineLoginCallbackUrl(): string {
  if (config.lineLoginCallbackUrl) {
    return config.lineLoginCallbackUrl;
  }
  return `${baseUrl()}/auth/line/callback`;
}

function baseUrl(): string {
  return (config.baseUrl || "https://nutritionay1.onrender.com").replace(/\/+$/, "");
}

function adminUrl(pin?: string, tab?: "student" | "coach" | "admin" | "billing"): string {
  const params = new URLSearchParams();
  if (pin) params.set("pin", pin);
  if (tab) params.set("tab", tab);
  const query = params.toString();
  return `${baseUrl()}/admin/${query ? `?${query}` : ""}`;
}

function publicCheckoutSession(session: CheckoutSession) {
  return {
    id: session.id,
    plan_id: session.plan_id,
    role: session.role,
    coach_name: session.coach_name,
    display_name: session.display_name,
    status: session.status,
    expires_at: session.expires_at,
  };
}

async function exchangeLineLoginProfile(code: string): Promise<{ userId: string; displayName: string }> {
  const tokenResponse = await fetch("https://api.line.me/oauth2/v2.1/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: lineLoginCallbackUrl(),
      client_id: config.lineLoginChannelId,
      client_secret: config.lineLoginChannelSecret,
    }),
  });
  if (!tokenResponse.ok) {
    throw new Error(`LINE token exchange failed: ${tokenResponse.status}`);
  }
  const token = (await tokenResponse.json()) as { access_token?: string; id_token?: string };
  if (!token.access_token || !token.id_token) {
    throw new Error("LINE token response missing access_token or id_token");
  }

  const verifyResponse = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      id_token: token.id_token,
      client_id: config.lineLoginChannelId,
    }),
  });
  if (!verifyResponse.ok) {
    throw new Error(`LINE id_token verify failed: ${verifyResponse.status}`);
  }
  const verified = (await verifyResponse.json()) as { sub?: string; name?: string };

  const profileResponse = await fetch("https://api.line.me/v2/profile", {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  const profile = profileResponse.ok
    ? ((await profileResponse.json()) as { userId?: string; displayName?: string })
    : {};

  const userId = profile.userId || verified.sub;
  if (!userId) {
    throw new Error("LINE profile missing user id");
  }
  return {
    userId,
    displayName: profile.displayName || verified.name || "LINE 使用者",
  };
}

function generatePin(): string {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
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
