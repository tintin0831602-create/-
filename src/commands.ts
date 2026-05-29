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
  createLineLoginUserIfMissing,
  deleteLatestEntry,
  findCoachAccessByClaimedLineUserId,
  findCoachAccessByName,
  findUserByDisplayName,
  grantAccess,
  getDailyEntries,
  getDailyTotals,
  getUser,
  listUsers,
  resetUser,
  setCoach,
  setOwner,
  syncClaimedCoachAccess,
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
import type { BotResponse, FoodAnalysis, FoodEntry, LineReplyMessage, UserProfile } from "./types.js";

export async function handleTextMessage(
  lineUserId: string,
  text: string,
  sourceId: string,
): Promise<BotResponse> {
  const normalized = normalizeCommand(text);
  const parts = normalized.split(/\s+/).filter(Boolean);
  const command = parts[0]?.toLowerCase();
  const user = getUser(lineUserId);

  if (command === "設定最高權限" || command === "設為最高權限") {
    return handleSetOwnerByPin(lineUserId, user, parts);
  }

  if (!command || ["help", "幫助", "功能", "指令", "選單", "主選單", "開始"].includes(command)) {
    return lineMainMenuMessage();
  }

  if (["新手教學", "下一步"].includes(command)) {
    return onboardingMenuMessage();
  }

  if (command === "學員區") {
    return studentZoneMessage(user);
  }

  if (command === "學員身份") {
    return studentIdentityPrompt();
  }

  if (command === "目標設定") {
    return goalSetupPrompt();
  }

  if (command === "身體資料教學") {
    return bodyStatsPrompt();
  }

  if (command === "開始記錄") {
    return recordingPrompt();
  }

  if (command === "文字記錄教學") {
    return "請輸入：\n紀錄文字 你的餐點內容\n\n例：紀錄文字 早餐吃兩顆蛋、一杯豆漿和一顆饅頭";
  }

  if (command === "手動數字教學") {
    return "請輸入：\n紀錄 食物 熱量 蛋白 脂肪 碳水\n\n例：紀錄 雞胸飯 650 45 15 80";
  }

  if (command === "付款區" || command === "付款" || command === "訂閱") {
    return paymentZoneMessage();
  }

  if (command === "管理員區") {
    return adminZoneMessage();
  }

  if (command === "最高權限設定教學") {
    return "請在私訊中輸入：\n設定最高權限 你的管理PIN\n\n這是最高優先級指令，不需要先設定熱量與三大營養素。成功後可使用：管理員區、產生教練 PIN、權限成員。";
  }

  if (command === "產生教練pin教學") {
    return "請輸入：\n產生教練PIN 教練名稱 30天 20人\n\n例：教練名稱請換成真實教練名稱；同一位教練再次產生會沿用原 PIN 並延長期限。";
  }

  if (command === "教練授權教學") {
    return "請輸入：\n教練授權 學員姓名 30天\n\n提醒：學員要先在 LINE 傳「我是學員 姓名」建立資料，教練才找得到。";
  }

  if (command === "教練設定教學") {
    return "請輸入：\n教練設定 學員姓名 熱量 蛋白 脂肪 碳水\n\n例：教練設定 Amy 2000 120 60 250";
  }

  if (command === "付款說明") {
    return [
      "付款流程目前可測試：",
      "1. 點付款區選方案",
      "2. 用 LINE Login 授權身份",
      "3. 填付款人資訊",
      "4. 按測試付款並開通",
      "",
      "完成後：學員可直接回 LINE 記錄飲食；教練會取得 PIN 與管理台連結。",
      "正式收款下一步會接 LINE Pay 商家金流。",
    ].join("\n");
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

  if (command === "教練區") {
    if (parts.length >= 3) {
      return handleCoachZoneLogin(lineUserId, user, parts);
    }
    if (user?.is_coach && hasActiveAccess(user)) {
      const access = findCoachAccessByClaimedLineUserId(lineUserId);
      if (access) {
        return coachDashboardLinkMessage(access.coach_name, access.pin, access.student_quota);
      }
      return coachHelpMessage();
    }
    return coachZoneMessage();
  }

  if (!user) {
    if (command === "我是學員") {
      return handleStudentIntro(lineUserId, parts);
    }
    if (command === "我是教練") {
      return handleCoachIntro(lineUserId, parts);
    }
    return registrationMessage();
  }

  if (command === "我是學員") {
    if (parts.length === 1) {
      return [
        `你目前已建立為：${user.display_name}`,
        "下一步可以設定每日目標：",
        "設定目標 熱量 蛋白 脂肪 碳水",
        "例：設定目標 2000 120 60 250",
      ].join("\n");
    }
    return [
      `你目前已建立為：${user.display_name}`,
      "如果要更改名稱與目標，請用完整設定格式：",
      "設定 姓名 熱量 蛋白 脂肪 碳水",
    ].join("\n");
  }

  if (command === "權限狀態") {
    return accessStatusMessage(user);
  }

  if (command === "教練登入") {
    return handleCoachLogin(user, parts);
  }

  if (command === "我是教練") {
    return handleCoachIntro(lineUserId, parts);
  }

  if (
    command === "權限成員" ||
    command === "授權" ||
    command === "停用" ||
    command === "產生教練pin" ||
    command === "產生測試帳號" ||
    command === "生成測試帳號" ||
    command === "建立測試帳號"
  ) {
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

  if (command === "設定目標") {
    return handleSetGoals(user, parts);
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

  if (["本週", "本週回顧", "週回顧", "這週"].includes(command)) {
    return buildWeeklyLineReport(user);
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

  const testAccountsMatch = text.match(/^(?:產生|生成|建立)測試帳號(?:\s+([\p{L}\p{N}_-]+))?$/u);
  if (testAccountsMatch) {
    return createTestAccountsForOwner(user, testAccountsMatch[1]);
  }

  const coachPinMatch = text.match(/^產生教練PIN\s+(.+?)\s+(7天|30天|一年|1年|365天)\s+(\d+)人$/iu);
  if (coachPinMatch) {
    const [, coachName, duration, quotaText] = coachPinMatch;
    const existingAccess = findCoachAccessByName(coachName.trim());
    const pin = existingAccess?.pin || generatePin();
    const days = subscriptionDays(duration) || 7;
    const extensionBase =
      existingAccess?.expires_at && existingAccess.expires_at > Date.now()
        ? existingAccess.expires_at
        : Date.now();
    const access = createCoachAccess({
      pin,
      coachName: coachName.trim(),
      expiresAt: extensionBase + days * 24 * 60 * 60 * 1000,
      permanentAccess: false,
      studentQuota: Number(quotaText),
      createdByLineUserId: user.line_user_id,
    });
    syncClaimedCoachAccess(access);
    return [
      existingAccess ? "已續約教練 PIN" : "已產生教練 PIN",
      `教練：${access.coach_name}`,
      `PIN：${access.pin}`,
      `期限：${duration}`,
      `到期：${formatDate(access.expires_at)}`,
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

function createTestAccountsForOwner(owner: UserProfile, suffixInput?: string): string {
  const suffix =
    suffixInput?.trim().replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 24) ||
    new Date().toISOString().replace(/[-:.TZ]/g, "").slice(4, 14);
  const studentActiveId = `TEST_STUDENT_ACTIVE_${suffix}`;
  const studentInactiveId = `TEST_STUDENT_INACTIVE_${suffix}`;
  const coachId = `TEST_COACH_ACTIVE_${suffix}`;
  const activeStudentName = `測試開通學員-${suffix}`;
  const inactiveStudentName = `測試未開通學員-${suffix}`;
  const coachName = `測試開通教練-${suffix}`;

  createLineLoginUserIfMissing({ lineUserId: studentActiveId, displayName: activeStudentName });
  const activeStudent = grantAccess(studentActiveId, "student", { days: 30 });

  createLineLoginUserIfMissing({ lineUserId: studentInactiveId, displayName: inactiveStudentName });
  const inactiveStudent = grantAccess(studentInactiveId, "student", { days: 0 });

  createLineLoginUserIfMissing({ lineUserId: coachId, displayName: coachName });
  const existingAccess = findCoachAccessByName(coachName);
  const pin = existingAccess?.pin || generatePin();
  const access = createCoachAccess({
    pin,
    coachName,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    permanentAccess: false,
    studentQuota: 10,
    createdByLineUserId: owner.line_user_id,
  });
  claimCoachAccess(pin, coachId);

  return [
    "已產生測試帳號",
    "",
    `開通學員：${activeStudent.display_name}`,
    "狀態：開通 30 天，可在管理台查看與修改數值",
    "",
    `未開通學員：${inactiveStudent.display_name}`,
    "狀態：未開通，可用教練 PIN 進管理台授權",
    "",
    `開通教練：${coachName}`,
    `教練 PIN：${access.pin}`,
    `學員名額：${access.student_quota} 人`,
    `教練管理台：${adminUrl(access.pin, "coach")}`,
    "",
    "建議測試：",
    `1. 用教練 PIN 進管理台`,
    `2. 授權 ${inactiveStudent.display_name} 7 天或 30 天`,
    "3. 修改學員熱量、三大營養素、身體資料",
    "",
    "提醒：這些是系統內測試資料，不是真實 LINE 帳號；不能直接在 LINE 裡傳訊息。",
  ].join("\n");
}

function handleSetOwnerByPin(
  lineUserId: string,
  user: UserProfile | undefined,
  parts: string[],
): string {
  const providedPin = parts[1]?.trim();
  if (!config.adminPin) {
    return "尚未設定管理 PIN，請先在 Render 環境變數設定 ADMIN_PIN。";
  }
  if (!providedPin) {
    return "請輸入：設定最高權限 管理PIN";
  }
  if (providedPin !== config.adminPin) {
    return "管理 PIN 不正確，請確認後再試一次。";
  }

  if (!user) {
    createStarterUser(lineUserId, config.ownerDisplayName, "owner");
  }
  const owner = setOwner(lineUserId);
  return [
    `${owner.display_name} 已設為最高權限`,
    "你現在可以使用：管理員區、最高權限幫助、權限成員、產生教練 PIN。",
  ].join("\n");
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
    `管理台：${adminUrl(pin, "coach")}`,
    "可用：教練成員、教練授權 學員名 30天、教練設定 學員名 熱量 蛋白 脂肪 碳水",
  ].join("\n");
}

function handleCoachZoneLogin(
  lineUserId: string,
  user: UserProfile | undefined,
  parts: string[],
): BotResponse {
  const pin = parts.at(-1)?.trim();
  const displayName = parts.slice(1, -1).join(" ").trim();
  if (!displayName || !pin) {
    return coachZoneMessage();
  }

  const coachUser = user || createStarterUser(lineUserId, displayName, "student");
  const access = claimCoachAccess(pin, coachUser.line_user_id);
  if (!access) {
    return "找不到這組教練 PIN，請確認是否輸入正確。";
  }
  if (!access.permanent_access && access.expires_at && access.expires_at <= Date.now()) {
    return "這組教練 PIN 已到期，請聯絡 Jasper。";
  }

  return coachDashboardLinkMessage(access.coach_name, pin, access.student_quota);
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

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "永久";
  return new Date(timestamp).toLocaleDateString("zh-TW", { timeZone: config.timezone });
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
      "教練區",
      "我是學員",
      "我是教練",
      "付款說明",
      "學員身份",
      "目標設定",
      "身體資料教學",
      "開始記錄",
      "最高權限設定教學",
      "產生教練pin教學",
      "教練授權教學",
      "教練設定教學",
      "文字記錄教學",
      "手動數字教學",
      "設定最高權限",
      "設為最高權限",
      "最高權限幫助",
      "權限狀態",
      "我的設定",
      "設定查詢",
      "身體資料",
      "身體數據",
      "bmr",
      "設定目標",
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

function buildWeeklyLineReport(user: UserProfile): string {
  const today = todayInTimezone(config.timezone);
  const dates = lastSevenDates(today);
  const lines = dates.map((date) => {
    const entries = getDailyEntries(user.line_user_id, date);
    const totals = sumEntries(entries);
    const surplus = Math.round(totals.calories - user.goal_calories);
    const surplusText = surplus >= 0 ? `+${surplus}` : `${surplus}`;
    return `${date.slice(5)}｜${Math.round(totals.calories)} kcal｜P${Math.round(totals.protein_g)} F${Math.round(totals.fat_g)} C${Math.round(totals.carbs_g)}｜${surplusText}`;
  });
  const weekEntries = dates.flatMap((date) => getDailyEntries(user.line_user_id, date));
  const weekTotals = sumEntries(weekEntries);
  const weekSurplus = Math.round(weekTotals.calories - user.goal_calories * dates.length);
  return [
    `${user.display_name} 本週回顧`,
    `區間：${dates[0]} - ${dates[dates.length - 1]}`,
    `總熱量：${Math.round(weekTotals.calories)} kcal`,
    `本週盈虧：${weekSurplus >= 0 ? `盈餘 ${weekSurplus}` : `赤字 ${Math.abs(weekSurplus)}`} kcal`,
    `三大營養素：P${Math.round(weekTotals.protein_g)} F${Math.round(weekTotals.fat_g)} C${Math.round(weekTotals.carbs_g)}`,
    "",
    ...lines,
    "",
    "要看圖表可進入管理台：",
    adminUrl(undefined, "student"),
  ].join("\n");
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

function handleStudentIntro(lineUserId: string, parts: string[]): string {
  const displayName = parts.slice(1).join(" ").trim();
  if (!displayName) {
    return studentIdentityPrompt();
  }
  const user = createStarterUser(lineUserId, displayName, "student");
  return [
    `你好，${user.display_name}，已先建立學員身份。`,
    "下一步請設定你的每日目標：",
    "設定目標 熱量 蛋白 脂肪 碳水",
    "例：設定目標 2000 120 60 250",
    "",
    "如果你是教練的學員，請請教練用：教練授權 你的名稱 7天/30天/一年",
  ].join("\n");
}

function handleCoachIntro(lineUserId: string, parts: string[]): BotResponse {
  const pin = parts.at(-1)?.trim();
  const displayName = parts.slice(1, -1).join(" ").trim();
  if (!displayName || !pin) {
    return coachLoginPrompt();
  }
  return handleCoachZoneLogin(lineUserId, getUser(lineUserId), ["教練區", displayName, pin]);
}

function lineMainMenuMessage(): LineReplyMessage {
  return flexMenu("Hermes 主選單", "你現在要做什麼？", "在 LINE 裡就能選分區、看下一步、付款或進管理台。", [
    messageButton("新手教學", "新手教學"),
    messageButton("學員區", "學員區"),
    messageButton("教練區", "教練區"),
    messageButton("管理員區", "管理員區"),
    uriButton("付款區", checkoutUrl()),
  ]);
}

function onboardingMenuMessage(): LineReplyMessage {
  return flexMenu("新手教學", "照這個順序走", "先確認身份，再設定目標，最後開始記錄飲食。", [
    messageButton("我是學員", "學員身份"),
    messageButton("我是教練", "教練區"),
    messageButton("設定目標", "目標設定"),
    messageButton("身體資料", "身體資料教學"),
    messageButton("開始記錄", "開始記錄"),
  ]);
}

function studentZoneMessage(user?: UserProfile): LineReplyMessage {
  if (user && hasActiveAccess(user)) {
    return flexMenu("學員區", `你好，${user.display_name}`, "你已經完成 LINE 身份綁定，可以直接開始記錄或查看進度。", [
      messageButton("開始記錄", "開始記錄"),
      messageButton("今日進度", "今日"),
      messageButton("剩餘熱量", "剩餘"),
      messageButton("本週回顧", "本週回顧"),
      messageButton("我的設定", "我的設定"),
      messageButton("刪除上一筆", "刪除最後一筆"),
    ]);
  }

  return flexMenu("學員區", "先完成身份與權限", "如果你剛付款，請回到付款頁完成 LINE 授權與測試付款；如果是教練學員，請先告訴教練你的姓名。", [
    messageButton("設定身份", "學員身份"),
    uriButton("付款開通", checkoutUrl("student_month")),
    messageButton("設定目標", "目標設定"),
    messageButton("身體資料", "身體資料教學"),
    messageButton("權限狀態", "權限狀態"),
  ]);
}

function coachZoneMessage(): LineReplyMessage {
  return flexMenu("教練區", "輸入姓名與 PIN", "拿到 Jasper 給你的 PIN 後，傳「教練區 教練名稱 PIN」，成功後會跳出管理台連結。", [
    messageButton("登入教學", "教練區"),
    messageButton("查看學員", "教練成員"),
    messageButton("授權學員", "教練授權教學"),
    messageButton("調整目標", "教練設定教學"),
    uriButton("教練管理台", adminUrl(undefined, "coach")),
  ]);
}

function adminZoneMessage(): LineReplyMessage {
  return flexMenu("管理員區", "Jasper 最高權限", "產生教練 PIN、查看權限成員、進入管理台。", [
    messageButton("最高權限設定", "最高權限設定教學"),
    messageButton("產生教練 PIN", "產生教練PIN教學"),
    messageButton("查看成員", "權限成員"),
    uriButton("管理台", adminUrl(undefined, "admin")),
  ]);
}

function paymentZoneMessage(): LineReplyMessage {
  return flexMenu("付款區", "選擇方案", "先用 LINE 授權確認身份，再進入付款頁。測試付款完成後會自動開通學員或產生教練 PIN。", [
    uriButton("個人月費", checkoutUrl("student_month")),
    uriButton("個人一年", checkoutUrl("student_year")),
    uriButton("教練月費", checkoutUrl("coach_month")),
    uriButton("教練一年", checkoutUrl("coach_year")),
    messageButton("付款說明", "付款說明"),
  ]);
}

function coachDashboardLinkMessage(coachName: string, pin: string, quota: number): LineReplyMessage[] {
  return [
    {
      type: "text",
      text: [`${coachName} 教練登入成功`, `學員名額：${quota} 人`, "請點下方按鈕進入教練管理台。"].join("\n"),
    },
    flexMenu("教練管理台", `你好！${coachName} 教練`, "已自動帶入 PIN，進去後可查看學員、授權與調整數值。", [
      uriButton("進入教練管理台", adminUrl(pin, "coach")),
      messageButton("查看學員", "教練成員"),
      messageButton("授權學員", "教練授權教學"),
    ]),
  ];
}

function studentIdentityPrompt(): string {
  return [
    "請輸入你的學員姓名：",
    "我是學員 你的名字",
    "",
    "例：我是學員 小御",
    "建立完成後，我會引導你設定每日熱量與三大營養素。",
  ].join("\n");
}

function coachLoginPrompt(): string {
  return [
    "請輸入教練名稱與 PIN：",
    "教練區 教練名稱 PIN",
    "",
    "例：教練區 jasper教練 A1B2C3",
    "登入成功後，我會給你可點擊的教練管理台連結。",
  ].join("\n");
}

function goalSetupPrompt(): string {
  return [
    "請輸入每日目標：",
    "設定目標 熱量 蛋白 脂肪 碳水",
    "",
    "例：設定目標 2000 120 60 250",
    "如果不知道怎麼抓，可以先填大概值，之後教練可幫你調整。",
  ].join("\n");
}

function bodyStatsPrompt(): string {
  return [
    "請輸入身體資料，讓我估算 BMR：",
    "身體資料 男/女 年齡 身高cm 體重kg",
    "",
    "例：身體資料 男 30 175 70",
  ].join("\n");
}

function recordingPrompt(): LineReplyMessage {
  return flexMenu("開始記錄", "你想怎麼記錄這一餐？", "照片最直覺；文字適合早餐、外食或沒有拍照的情境。", [
    messageButton("記錄照片", "紀錄下一張照片"),
    messageButton("文字記錄教學", "文字記錄教學"),
    messageButton("手動數字教學", "手動數字教學"),
    messageButton("看今日", "今日"),
  ]);
}

function flexMenu(
  altText: string,
  title: string,
  description: string,
  buttons: Array<{ type: "button"; style?: string; action: Record<string, string> }>,
): LineReplyMessage {
  return {
    type: "flex",
    altText,
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "Hermes Nutrition", size: "sm", color: "#0c5c46", weight: "bold" },
          { type: "text", text: title, size: "xl", weight: "bold", wrap: true, color: "#1d252b" },
          { type: "text", text: description, size: "sm", wrap: true, color: "#66727d" },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: buttons,
      },
    },
  };
}

function messageButton(label: string, text: string) {
  return {
    type: "button" as const,
    style: "primary",
    color: "#06a66a",
    action: { type: "message", label, text },
  };
}

function uriButton(label: string, uri: string) {
  return {
    type: "button" as const,
    style: "secondary",
    action: { type: "uri", label, uri },
  };
}

function adminUrl(pin?: string, tab?: "student" | "coach" | "admin" | "billing"): string {
  const base = (config.baseUrl || "https://nutritionay1.onrender.com").replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (pin) params.set("pin", pin);
  if (tab) params.set("tab", tab);
  const query = params.toString();
  return `${base}/admin/${query ? `?${query}` : ""}`;
}

function checkoutUrl(plan?: "student_month" | "student_year" | "coach_month" | "coach_year"): string {
  const base = (config.baseUrl || "https://nutritionay1.onrender.com").replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (plan) params.set("plan", plan);
  const query = params.toString();
  return `${base}/checkout/${query ? `?${query}` : ""}`;
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

function sumEntries(entries: FoodEntry[]) {
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

function createStarterUser(
  lineUserId: string,
  displayName: string,
  role: "student" | "owner",
): UserProfile {
  const shouldBecomeOwner =
    role === "owner" ||
    (countOwners() === 0 && displayName.toLowerCase() === config.ownerDisplayName.toLowerCase());
  const user: UserProfile = {
    line_user_id: lineUserId,
    display_name: displayName,
    goal_calories: 2000,
    goal_protein_g: 120,
    goal_fat_g: 60,
    goal_carbs_g: 250,
    role: shouldBecomeOwner ? "owner" : "student",
    access_expires_at: shouldBecomeOwner ? null : Date.now() + 7 * 24 * 60 * 60 * 1000,
    permanent_access: shouldBecomeOwner ? 1 : 0,
    is_coach: shouldBecomeOwner ? 1 : 0,
  };
  upsertUser(user);
  return getUser(lineUserId) as UserProfile;
}

function handleSetGoals(user: UserProfile, parts: string[]): string {
  if (parts.length !== 5) {
    return "格式：設定目標 熱量 蛋白 脂肪 碳水\n例：設定目標 2000 120 60 250";
  }
  const [, calories, protein, fat, carbs] = parts;
  const numbers = [calories, protein, fat, carbs].map(Number);
  if (numbers.some((value) => !Number.isFinite(value) || value <= 0)) {
    return "熱量與三大營養素都要是大於 0 的數字。";
  }
  const updated = updateUserGoals(user.line_user_id, {
    goal_calories: numbers[0],
    goal_protein_g: numbers[1],
    goal_fat_g: numbers[2],
    goal_carbs_g: numbers[3],
  });
  return registeredMessage(updated);
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
