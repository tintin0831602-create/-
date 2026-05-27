import { analyzeFoodText, answerNutritionQuestion } from "./gemini.js";
import {
  addFoodEntry,
  countCoaches,
  coachKeyForPin,
  countStudentsForCoach,
  countOwners,
  claimCoachAccess,
  createImageRecordingIntent,
  createCoachAccess,
  deleteLatestEntry,
  findUserByDisplayName,
  grantAccess,
  getDailyEntries,
  getDailyTotals,
  getUser,
  listUsers,
  resetUser,
  setCoach,
  setOwner,
  updateUserBodyStats,
  updateUserGoals,
  upsertUser,
} from "./db.js";
import crypto from "node:crypto";
import {
  dailyReport,
  deletedEntryMessage,
  helpMessage,
  manualEntrySavedMessage,
  registeredMessage,
  registrationMessage,
  remainingReport,
  entrySavedMessage,
  imageIntentMessage,
  bmrMessage,
  coachHelpMessage,
  ownerHelpMessage,
  accessStatusMessage,
  userSettingsMessage,
} from "./messages.js";
import { config } from "./config.js";
import { todayInTimezone } from "./time.js";
import type { FoodAnalysis, UserProfile } from "./types.js";

export async function handleTextMessage(
  lineUserId: string,
  text: string,
  sourceId: string,
): Promise<string> {
  const normalized = normalizeCommand(text);
  const parts = normalized.split(/\s+/).filter(Boolean);
  const command = parts[0]?.toLowerCase();

  if (!command || ["help", "幫助", "功能", "指令"].includes(command)) {
    return helpMessage();
  }

  if (command === "教練幫助") {
    return coachHelpMessage();
  }

  if (command === "最高權限幫助") {
    return ownerHelpMessage();
  }

  if (command === "設定") {
    return handleSetUser(lineUserId, parts);
  }

  const user = getUser(lineUserId);
  if (!user) {
    return registrationMessage();
  }

  if (command === "權限狀態") {
    return accessStatusMessage(user);
  }

  if (command === "設為最高權限") {
    if (countOwners() > 0) {
      return "目前已經有最高權限帳號。";
    }
    if (user.display_name.toLowerCase() !== config.ownerDisplayName.toLowerCase()) {
      return `只有名稱為 ${config.ownerDisplayName} 的主帳號可以初始化最高權限。`;
    }
    const owner = setOwner(lineUserId);
    return `${owner.display_name} 已設為最高權限，可以使用：最高權限幫助`;
  }

  if (command === "教練登入") {
    return handleCoachLogin(user, parts);
  }

  if (command === "權限成員" || command === "授權" || command === "停用" || command === "產生教練pin") {
    return handleOwnerCommand(user, normalized);
  }

  if (!hasActiveAccess(user) && !isPublicCommand(command, normalized)) {
    return [
      "你的使用權限尚未開通或已到期。",
      "請聯絡教練或主帳號 Jasper 開通 7 天試用、30 天訂閱或永久權限。",
      "可傳：權限狀態",
    ].join("\n");
  }

  if (command === "設為教練") {
    if (user.is_coach) {
      return "你已經是教練。";
    }
    if (countCoaches() > 0) {
      return "目前已經有教練帳號。若要更換教練，建議先由現有教練協助處理。";
    }
    const coach = setCoach(lineUserId);
    return `${coach.display_name} 已設為教練，可以使用：教練成員、教練查看 姓名、教練設定 姓名 熱量 蛋白 脂肪 碳水`;
  }

  if (command?.startsWith("教練")) {
    return handleCoachCommand(user, normalized, parts);
  }

  if (command === "我的設定" || command === "設定查詢") {
    return userSettingsMessage(user);
  }

  if (command === "身體資料" || command === "身體數據" || command === "bmr") {
    return handleBodyStats(user, parts);
  }

  if (command === "重設設定") {
    return [
      "這會清除你的個人設定、身體資料和所有飲食紀錄。",
      "如果確定，請再傳：確認重設設定",
    ].join("\n");
  }

  if (command === "確認重設設定") {
    resetUser(lineUserId);
    return "已重設你的設定與飲食紀錄。需要重新開始時請傳：設定 姓名 熱量 蛋白 脂肪 碳水";
  }

  if (["今日", "狀態", "分析今日飲食"].includes(command)) {
    return buildDailyReport(user);
  }

  if (["剩餘", "剩餘熱量", "提醒"].includes(command)) {
    return buildRemainingReport(user);
  }

  if (
    ["紀錄下一張照片", "記錄下一張照片", "照片", "紀錄照片", "記錄照片"].includes(command) ||
    /^(紀錄|記錄)\s*下一張照片$/u.test(normalized)
  ) {
    createImageRecordingIntent(lineUserId, sourceId, Date.now() + 5 * 60 * 1000);
    return imageIntentMessage();
  }

  if (command === "紀錄") {
    return handleManualEntry(user, normalized);
  }

  if (command === "紀錄文字" || command === "分析") {
    const description = normalized.replace(/^(紀錄文字|分析)\s*/u, "").trim();
    if (!description) {
      return "請在後面加上飲食描述，例如：紀錄文字 一碗牛肉麵加滷蛋";
    }
    const analysis = await analyzeFoodText(description);
    return saveAnalysis(user, analysis, "text", null);
  }

  if (command === "刪除最後一筆" || command === "刪除上一筆" || normalized === "刪除") {
    const deleted = deleteLatestEntry(lineUserId);
    return deleted ? deletedEntryMessage(deleted) : "目前沒有可以刪除的紀錄。";
  }

  if (command === "刪除上一張照片" || command === "刪除照片" || command === "刪除上一張") {
    const deleted = deleteLatestEntry(lineUserId, "image");
    return deleted ? deletedEntryMessage(deleted) : "目前沒有可以刪除的照片紀錄。";
  }

  if (command === "成員") {
    const users = listUsers();
    return users.length
      ? users.map((item) => formatMemberLine(item)).join("\n")
      : "目前還沒有成員。";
  }

  return [
    await handleNaturalNutritionQuestion(user, normalized),
    "",
    "如果要存成紀錄，請傳：紀錄文字 你的餐點內容",
  ].join("\n");
}

function handleOwnerCommand(user: UserProfile, text: string): string {
  if (user.role !== "owner") {
    return "這是最高權限功能。";
  }

  if (text === "權限成員") {
    const users = listUsers();
    return users.length
      ? ["權限成員", ...users.map((item) => formatAccessLine(item))].join("\n")
      : "目前還沒有成員。";
  }

  const coachPinMatch = text.match(/^產生教練PIN\s+(.+?)\s+(7天|30天|一年|1年|365天)\s+(\d+)人$/iu);
  if (coachPinMatch) {
    const [, coachName, duration, quotaText] = coachPinMatch;
    const pin = generatePin();
    const days = subscriptionDays(duration) || 7;
    const access = createCoachAccess({
      pin,
      coachName: coachName.trim(),
      expiresAt: Date.now() + days * 24 * 60 * 60 * 1000,
      permanentAccess: false,
      studentQuota: Number(quotaText),
      createdByLineUserId: user.line_user_id,
    });
    return [
      "已產生教練 PIN",
      `教練：${access.coach_name}`,
      `PIN：${access.pin}`,
      `期限：${duration}`,
      `學員名額：${access.student_quota} 人`,
      "",
      "教練可用這組 PIN 登入管理台，也可以在 LINE 傳：",
      `教練登入 ${access.pin}`,
    ].join("\n");
  }

  const permanentMatch = text.match(/^授權\s+永久\s+(.+)$/u);
  if (permanentMatch) {
    const target = findUserByDisplayName(permanentMatch[1].trim());
    if (!target) return `找不到成員：${permanentMatch[1].trim()}`;
    const updated = grantAccess(target.line_user_id, "student", { permanent: true });
    return `已授權永久使用\n${formatAccessLine(updated)}`;
  }

  const grantMatch = text.match(/^授權\s+(學員|教練)\s+(.+?)\s+(7天|30天|一年|1年|365天|永久)(?:\s+(\d+)人)?$/u);
  if (grantMatch) {
    const [, roleText, name, duration, quotaText] = grantMatch;
    const target = findUserByDisplayName(name.trim());
    if (!target) return `找不到成員：${name.trim()}`;
    const role = roleText === "教練" ? "coach" : "student";
    const updated = grantAccess(target.line_user_id, role, {
      days: subscriptionDays(duration),
      permanent: duration === "永久",
      studentQuota: role === "coach" ? Number(quotaText || 10) : undefined,
      coachOwnerId: user.line_user_id,
    });
    return `已授權\n${formatAccessLine(updated)}`;
  }

  const disableMatch = text.match(/^停用\s+(.+)$/u);
  if (disableMatch) {
    const target = findUserByDisplayName(disableMatch[1].trim());
    if (!target) return `找不到成員：${disableMatch[1].trim()}`;
    const updated = grantAccess(target.line_user_id, "student", { days: 0 });
    return `已停用\n${formatAccessLine(updated)}`;
  }

  return ownerHelpMessage();
}

function handleCoachLogin(user: UserProfile, parts: string[]): string {
  const pin = parts[1]?.trim();
  if (!pin) {
    return "格式：教練登入 PIN";
  }

  const access = claimCoachAccess(pin, user.line_user_id);
  if (!access) {
    return "找不到這組教練 PIN，請確認是否輸入正確。";
  }
  if (!access.permanent_access && access.expires_at && access.expires_at <= Date.now()) {
    return "這組教練 PIN 已到期，請聯絡 Jasper。";
  }

  return [
    `${user.display_name} 已綁定教練權限`,
    `教練名稱：${access.coach_name}`,
    `學員名額：${access.student_quota} 人`,
    "可用：教練成員、教練授權 學員名 30天、教練設定 學員名 熱量 蛋白 脂肪 碳水",
  ].join("\n");
}

function handleCoachCommand(user: UserProfile, text: string, parts: string[]): string {
  if (!user.is_coach) {
    return "這是教練功能。請先由教練帳號使用，或在尚未有教練時傳：設為教練";
  }

  const command = parts[0];
  if (command === "教練成員") {
    const users =
      user.role === "owner"
        ? listUsers()
        : listUsers().filter((item) => item.coach_owner_id === user.line_user_id);
    return users.length
      ? ["成員設定", ...users.map((item) => formatMemberLine(item))].join("\n")
      : "目前還沒有成員。";
  }

  const grantStudentMatch = text.match(/^教練授權\s+(.+?)\s+(7天|30天|一年|1年|365天)$/u);
  if (grantStudentMatch) {
    const [, name, duration] = grantStudentMatch;
    const target = findUserByDisplayName(name.trim());
    if (!target) return `找不到成員：${name.trim()}`;
    const used = countStudentsForCoach(user.line_user_id);
    const quota = user.student_quota ?? 0;
    const alreadyOwned = target.coach_owner_id === user.line_user_id;
    if (!alreadyOwned && quota > 0 && used >= quota) {
      return `你的學員名額已滿：${used}/${quota}。請聯絡 Jasper 增加名額。`;
    }
    const days = subscriptionDays(duration);
    if (!days || !canCoachGrantDays(user, days)) {
      return "學員訂閱天數不能超過你的教練身份有效期限。7 天教練只能先給 7 天試用；要開 30 天或一年，請聯絡 Jasper 升級教練權限。";
    }
    const updated = grantAccess(target.line_user_id, "student", {
      days,
      coachOwnerId: user.line_user_id,
    });
    return `已授權學員\n${formatAccessLine(updated)}`;
  }

  const viewMatch = text.match(/^教練查看\s+(.+)$/u);
  if (viewMatch) {
    const target = findUserByDisplayName(viewMatch[1].trim());
    if (!target) {
      return `找不到成員：${viewMatch[1].trim()}`;
    }
    const permissionError = coachPermissionError(user, target);
    if (permissionError) {
      return permissionError;
    }
    return userSettingsMessage(target);
  }

  const setMatch = text.match(
    /^教練設定\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/u,
  );
  if (setMatch) {
    const [, name, calories, protein, fat, carbs] = setMatch;
    const target = findUserByDisplayName(name.trim());
    if (!target) {
      return `找不到成員：${name.trim()}`;
    }
    const permissionError = coachPermissionError(user, target);
    if (permissionError) {
      return permissionError;
    }
    const updated = updateUserGoals(target.line_user_id, {
      goal_calories: Number(calories),
      goal_protein_g: Number(protein),
      goal_fat_g: Number(fat),
      goal_carbs_g: Number(carbs),
    });
    return ["已更新成員目標", userSettingsMessage(updated)].join("\n");
  }

  const bodyMatch = text.match(/^教練身體資料\s+(.+?)\s+(男|女)\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/u);
  if (bodyMatch) {
    const [, name, sex, age, height, weight] = bodyMatch;
    const target = findUserByDisplayName(name.trim());
    if (!target) {
      return `找不到成員：${name.trim()}`;
    }
    const permissionError = coachPermissionError(user, target);
    if (permissionError) {
      return permissionError;
    }
    const updated = updateUserBodyStats(target.line_user_id, {
      sex: sex as "男" | "女",
      age: Number(age),
      height_cm: Number(height),
      weight_kg: Number(weight),
    });
    return ["已更新成員身體資料", userSettingsMessage(updated)].join("\n");
  }

  const resetMatch = text.match(/^教練重設\s+(.+)$/u);
  if (resetMatch) {
    const target = findUserByDisplayName(resetMatch[1].trim());
    if (!target) {
      return `找不到成員：${resetMatch[1].trim()}`;
    }
    const permissionError = coachPermissionError(user, target);
    if (permissionError) {
      return permissionError;
    }
    resetUser(target.line_user_id);
    return `已重設 ${target.display_name} 的設定與飲食紀錄。`;
  }

  return "教練指令：教練成員、教練查看 姓名、教練設定 姓名 熱量 蛋白 脂肪 碳水、教練身體資料 姓名 男/女 年齡 身高 體重、教練重設 姓名";
}

function coachPermissionError(coach: UserProfile, target: UserProfile): string | undefined {
  if (coach.role === "owner") {
    return undefined;
  }
  if (target.coach_owner_id === coach.line_user_id) {
    return undefined;
  }
  return "你只能管理自己名下的學員。請先用：教練授權 學員名 30天";
}

function canCoachGrantDays(coach: UserProfile, days: number): boolean {
  if (coach.role === "owner" || coach.permanent_access) {
    return true;
  }
  if (!coach.access_expires_at) {
    return false;
  }
  return days <= Math.max(0, Math.ceil((coach.access_expires_at - Date.now()) / (24 * 60 * 60 * 1000)));
}

function handleBodyStats(user: UserProfile, parts: string[]): string {
  if (parts.length !== 5) {
    return "格式：身體資料 男/女 年齡 身高cm 體重kg\n例：身體資料 男 30 175 70";
  }

  const [, sex, age, height, weight] = parts;
  if (sex !== "男" && sex !== "女") {
    return "性別請填「男」或「女」。例：身體資料 男 30 175 70";
  }

  const numbers = [Number(age), Number(height), Number(weight)];
  if (numbers.some((value) => !Number.isFinite(value) || value <= 0)) {
    return "年齡、身高、體重都要是大於 0 的數字。";
  }

  const updated = updateUserBodyStats(user.line_user_id, {
    sex,
    age: numbers[0],
    height_cm: numbers[1],
    weight_kg: numbers[2],
  });

  return bmrMessage(updated);
}

function formatMemberLine(user: UserProfile): string {
  const coach = user.is_coach ? " 教練" : "";
  const quota = user.role === "coach" ? ` / 名額 ${user.student_quota ?? 0}人` : "";
  return `${user.display_name}${coach}: ${Math.round(user.goal_calories)} kcal / P${Math.round(user.goal_protein_g)} F${Math.round(user.goal_fat_g)} C${Math.round(user.goal_carbs_g)}${quota}`;
}

function generatePin(): string {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function subscriptionDays(duration: string): number | undefined {
  if (duration === "7天") return 7;
  if (duration === "30天") return 30;
  if (duration === "一年" || duration === "1年" || duration === "365天") return 365;
  return undefined;
}

function formatAccessLine(user: UserProfile): string {
  const role = user.role === "owner" ? "最高權限" : user.role === "coach" ? "教練" : "學員";
  const access =
    user.role === "owner" || user.permanent_access
      ? "永久"
      : user.access_expires_at && user.access_expires_at > Date.now()
        ? `到期 ${new Date(user.access_expires_at).toLocaleDateString("zh-TW", {
            timeZone: config.timezone,
          })}`
        : "未啟用/已到期";
  const quota = user.role === "coach" ? ` / 可授權 ${user.student_quota ?? 0} 位學員` : "";
  return `${user.display_name}: ${role} / ${access}${quota}`;
}

function hasActiveAccess(user: UserProfile): boolean {
  return (
    user.role === "owner" ||
    user.role === "coach" ||
    Boolean(user.permanent_access) ||
    Boolean(user.access_expires_at && user.access_expires_at > Date.now())
  );
}

function isPublicCommand(command: string | undefined, text: string): boolean {
  return (
    [
      "help",
      "幫助",
      "功能",
      "指令",
      "教練幫助",
      "教練登入",
      "最高權限幫助",
      "權限狀態",
      "我的設定",
      "設定查詢",
      "身體資料",
      "身體數據",
      "bmr",
      "重設設定",
      "確認重設設定",
    ].includes(command || "") || text.startsWith("設定 ")
  );
}

async function handleNaturalNutritionQuestion(user: UserProfile, text: string): Promise<string> {
  const date = todayInTimezone(config.timezone);
  const totals = getDailyTotals(user.line_user_id, date);
  const result = await answerNutritionQuestion({
    text,
    dailyGoal: {
      calories: user.goal_calories,
      protein_g: user.goal_protein_g,
      fat_g: user.goal_fat_g,
      carbs_g: user.goal_carbs_g,
    },
    todayTotals: totals,
  });

  if (result.needs_clarification) {
    return result.clarification_question;
  }

  return [
    result.short_answer,
    `估算：約 ${Math.round(result.nutrition_summary.calories)} kcal / P${Math.round(result.nutrition_summary.protein_g)} F${Math.round(result.nutrition_summary.fat_g)} C${Math.round(result.nutrition_summary.carbs_g)}`,
    result.recommendation,
  ].join("\n");
}

export function buildDailyReport(user: UserProfile): string {
  const date = todayInTimezone(config.timezone);
  const entries = getDailyEntries(user.line_user_id, date);
  const totals = getDailyTotals(user.line_user_id, date);
  return dailyReport(user, entries, totals, date);
}

export function buildRemainingReport(user: UserProfile): string {
  const date = todayInTimezone(config.timezone);
  const totals = getDailyTotals(user.line_user_id, date);
  return remainingReport(user, totals, date);
}

export function saveAnalysis(
  user: UserProfile,
  analysis: FoodAnalysis,
  source: "image" | "text",
  imageMessageId: string | null,
): string {
  const date = todayInTimezone(config.timezone);
  addFoodEntry({
    line_user_id: user.line_user_id,
    consumed_date: date,
    source,
    food_name: analysis.food_name,
    meal_type: analysis.meal_type,
    calories: analysis.totals.calories,
    protein_g: analysis.totals.protein_g,
    fat_g: analysis.totals.fat_g,
    carbs_g: analysis.totals.carbs_g,
    confidence: analysis.confidence,
    notes: analysis.notes,
    image_message_id: imageMessageId,
  });

  const totals = getDailyTotals(user.line_user_id, date);
  return entrySavedMessage(user, analysis, totals, date);
}

function handleSetUser(lineUserId: string, parts: string[]): string {
  if (parts.length !== 6) {
    return "設定格式：設定 姓名 熱量 蛋白 脂肪 碳水\n例：設定 Jasper 2200 150 70 250";
  }

  const [, displayName, calories, protein, fat, carbs] = parts;
  const numbers = [calories, protein, fat, carbs].map(Number);
  if (numbers.some((value) => !Number.isFinite(value) || value <= 0)) {
    return "熱量與三大營養素都要是大於 0 的數字。";
  }

  const existing = getUser(lineUserId);
  const shouldBecomeOwner =
    countOwners() === 0 && displayName.toLowerCase() === config.ownerDisplayName.toLowerCase();
  const user: UserProfile = {
    line_user_id: lineUserId,
    display_name: displayName,
    goal_calories: numbers[0],
    goal_protein_g: numbers[1],
    goal_fat_g: numbers[2],
    goal_carbs_g: numbers[3],
    role: shouldBecomeOwner ? "owner" : existing?.role || "student",
    access_expires_at: shouldBecomeOwner
      ? null
      : existing?.access_expires_at || Date.now() + 7 * 24 * 60 * 60 * 1000,
    permanent_access: shouldBecomeOwner ? 1 : existing?.permanent_access || 0,
    is_coach: shouldBecomeOwner ? 1 : existing?.is_coach || 0,
  };

  upsertUser(user);
  return registeredMessage(user);
}

function handleManualEntry(user: UserProfile, text: string): string {
  const match = text.match(/^紀錄\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/u);
  if (!match) {
    return "紀錄格式：紀錄 食物 熱量 蛋白 脂肪 碳水\n例：紀錄 雞胸飯 650 45 15 80";
  }

  const [, foodName, calories, protein, fat, carbs] = match;
  const date = todayInTimezone(config.timezone);
  const entry = addFoodEntry({
    line_user_id: user.line_user_id,
    consumed_date: date,
    source: "manual",
    food_name: foodName,
    meal_type: "unknown",
    calories: Number(calories),
    protein_g: Number(protein),
    fat_g: Number(fat),
    carbs_g: Number(carbs),
    confidence: 1,
    notes: "使用者手動輸入",
    image_message_id: null,
  });

  const totals = getDailyTotals(user.line_user_id, date);
  return manualEntrySavedMessage(user, entry, totals, date);
}

export function normalizeCommand(text: string): string {
  return stripBotMention(text)
    .trim()
    .replace(/^hermes[，,\s:：]*/iu, "")
    .replace(/^赫米斯[，,\s:：]*/u, "");
}

export function stripBotMention(text: string): string {
  return text.replace(/^@\S+\s*/u, "");
}
