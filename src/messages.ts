import type { FoodAnalysis, FoodEntry, MacroTotals, UserProfile } from "./types.js";

export function helpMessage(): string {
  return [
    "Hermes 營養聊天室使用說明",
    "",
    "你下一步該做什麼？",
    "1. 第一次使用，先告訴我你的身份",
    "學員：我是學員 你的名字",
    "教練：教練區 教練名稱 PIN",
    "",
    "2. 設定每日目標",
    "設定目標 熱量 蛋白 脂肪 碳水",
    "例：設定目標 2000 120 60 250",
    "也可一次完成：設定 Amy 2000 120 60 250",
    "",
    "3. 補身體資料，讓我估算 BMR",
    "身體資料 男 30 175 70",
    "格式：身體資料 男/女 年齡 身高cm 體重kg",
    "",
    "4. 開始記錄飲食",
    "私聊：直接傳餐點照片",
    "群組：先 @我 說「紀錄下一張照片」，再傳照片",
    "手動：紀錄 雞胸飯 650 45 15 80",
    "文字：紀錄文字 一碗牛肉麵加滷蛋",
    "也可以直接問：我早餐吃了兩顆蛋、一杯豆漿和一顆饅頭，這樣夠營養嗎？",
    "如果份量不清楚，我會先追問，例如：這碗麵是大碗還是小碗？",
    "",
    "4. 查看今天狀態",
    "今日：看今天吃了什麼",
    "剩餘：看剩餘熱量和三大營養素",
    "我的設定：看目前目標和 BMR",
    "",
    "常用修正",
    "刪除最後一筆：刪掉最近一筆紀錄",
    "刪除上一張照片：刪掉最近一筆照片紀錄",
    "重設設定：清除自己的設定和紀錄，會要求二次確認",
    "權限狀態：查看試用或訂閱是否有效",
    "",
    "群組使用提醒",
    "請用 Hermes 開頭或 @我，我才會回應。",
    "例：Hermes 今日",
    "例：@營養分析機器人 紀錄下一張照片",
  ].join("\n");
}

export function coachHelpMessage(): string {
  return [
    "教練功能",
    "教練登入 PIN",
    "教練成員",
    "教練查看 Jasper",
    "教練設定 Jasper 2200 150 70 250",
    "教練身體資料 Jasper 男 30 175 70",
    "教練授權 Jasper 30天",
    "教練重設 Jasper",
    "",
    "教練只能管理自己名下的學員。Jasper 最高權限可以管理全部成員。",
  ].join("\n");
}

export function ownerHelpMessage(): string {
  return [
    "最高權限功能",
    "設定最高權限 管理PIN",
    "這個指令可直接使用，不需要先設定熱量和三大營養素",
    "權限成員",
    "產生測試帳號",
    "產生教練PIN Coach 30天 20人",
    "同一位教練再次使用產生教練PIN，會沿用原 PIN 並延長期限",
    "產生教練PIN Coach 一年 50人",
    "教練設定 Amy 2200 150 70 250",
    "教練身體資料 Amy 女 28 165 58",
    "授權 學員 Amy 7天",
    "授權 學員 Amy 30天",
    "授權 學員 Amy 一年",
    "授權 教練 Coach 30天 20人",
    "授權 教練 Coach 一年 20人",
    "授權 永久 Amy",
    "停用 Amy",
  ].join("\n");
}

export function introMessage(): string {
  return [
    "我是 Hermes 營養聊天室，可以幫你記錄餐點照片、熱量和三大營養素。",
    "",
    "第一次我會先確認身份：",
    "學員請傳：我是學員 你的名字",
    "教練請傳：教練區 教練名稱 PIN",
    "",
    "接著再傳：設定目標 熱量 蛋白 脂肪 碳水",
    "需要完整指令請傳：幫助",
  ].join("\n");
}

export function groupIntroMessage(): string {
  return [
    "Hermes 已加入群組。",
    "",
    "群組裡請先叫我，我才會處理訊息：",
    "Hermes 今日",
    "@營養分析機器人 今日",
    "",
    "要記錄照片請先傳：",
    "@營養分析機器人 紀錄下一張照片",
    "接著 5 分鐘內傳餐點照片。",
  ].join("\n");
}

export function registrationMessage(): string {
  return [
    "我還不知道你是誰。",
    "請先選身份：",
    "學員：我是學員 你的名字",
    "教練：教練區 教練名稱 PIN",
    "",
    "如果你想一次設定完成，也可以傳：",
    "設定 Amy 2000 120 60 250",
  ].join("\n");
}

export function registeredMessage(user: UserProfile): string {
  return [
    `已設定 ${user.display_name}`,
    `每日：${round(user.goal_calories)} kcal`,
    `蛋白質 ${round(user.goal_protein_g)}g / 脂肪 ${round(user.goal_fat_g)}g / 碳水 ${round(user.goal_carbs_g)}g`,
    "",
    "也可以補身體資料估算 BMR：",
    "身體資料 男/女 年齡 身高cm 體重kg",
    "例：身體資料 男 30 175 70",
  ].join("\n");
}

export function userSettingsMessage(user: UserProfile): string {
  const bmr = calculateBmr(user);
  return [
    `${user.display_name} 設定`,
    `熱量 ${round(user.goal_calories)} kcal`,
    `蛋白質 ${round(user.goal_protein_g)}g / 脂肪 ${round(user.goal_fat_g)}g / 碳水 ${round(user.goal_carbs_g)}g`,
    user.sex && user.age && user.height_cm && user.weight_kg
      ? `身體資料：${user.sex} / ${user.age}歲 / ${round(user.height_cm)}cm / ${round(user.weight_kg)}kg`
      : "身體資料：未填",
    bmr ? `BMR 估算：約 ${round(bmr)} kcal/天` : "可輸入：身體資料 男/女 年齡 身高cm 體重kg",
  ].join("\n");
}

export function accessStatusMessage(user: UserProfile): string {
  return [
    `${user.display_name} 權限`,
    `角色：${roleLabel(user)}`,
    `狀態：${accessLabel(user)}`,
  ].join("\n");
}

export function bmrMessage(user: UserProfile): string {
  const bmr = calculateBmr(user);
  if (!bmr) {
    return "格式：BMR 男/女 年齡 身高cm 體重kg\n例：BMR 男 30 175 70";
  }

  return [
    `${user.display_name} BMR 估算`,
    `BMR：約 ${round(bmr)} kcal/天`,
    `輕量活動：約 ${round(bmr * 1.375)} kcal/天`,
    `中等活動：約 ${round(bmr * 1.55)} kcal/天`,
    "公式：Mifflin-St Jeor，結果是估算值，實際目標仍建議由教練依訓練量調整。",
  ].join("\n");
}

export function entrySavedMessage(
  user: UserProfile,
  analysis: FoodAnalysis,
  totals: MacroTotals,
  date: string,
): string {
  return [
    `日期：${formatDate(date)}`,
    `已紀錄：${analysis.food_name}`,
    `本餐：約 ${round(analysis.totals.calories)} kcal`,
    `P ${round(analysis.totals.protein_g)}g / F ${round(analysis.totals.fat_g)}g / C ${round(analysis.totals.carbs_g)}g`,
    analysis.notes ? `備註：${analysis.notes}` : "",
    "",
    dailySummary(user, totals),
  ]
    .filter(Boolean)
    .join("\n");
}

export function manualEntrySavedMessage(
  user: UserProfile,
  entry: FoodEntry,
  totals: MacroTotals,
  date: string,
): string {
  return [
    `日期：${formatDate(date)}`,
    `已紀錄：${entry.food_name}`,
    `本餐：${round(entry.calories)} kcal`,
    `P ${round(entry.protein_g)}g / F ${round(entry.fat_g)}g / C ${round(entry.carbs_g)}g`,
    "",
    dailySummary(user, totals),
  ].join("\n");
}

export function dailyReport(
  user: UserProfile,
  entries: FoodEntry[],
  totals: MacroTotals,
  date: string,
): string {
  const lines = entries.length
    ? entries.map(
        (entry, index) =>
          `${index + 1}. ${entry.food_name} ${round(entry.calories)} kcal / P${round(entry.protein_g)} F${round(entry.fat_g)} C${round(entry.carbs_g)}`,
      )
    : ["今天還沒有紀錄。"];

  return [`${user.display_name} 今日飲食`, `日期：${formatDate(date)}`, ...lines, "", dailySummary(user, totals)].join("\n");
}

export function remainingReport(user: UserProfile, totals: MacroTotals, date: string): string {
  const remaining = remainingTotals(user, totals);
  return [
    `${user.display_name} 今天剩餘`,
    `日期：${formatDate(date)}`,
    `熱量 ${round(remaining.calories)} kcal`,
    `蛋白質 ${round(remaining.protein_g)}g`,
    `脂肪 ${round(remaining.fat_g)}g`,
    `碳水 ${round(remaining.carbs_g)}g`,
  ].join("\n");
}

export function deletedEntryMessage(entry: FoodEntry): string {
  const sourceName = entry.source === "image" ? "照片紀錄" : "紀錄";
  return [
    `已刪除上一筆${sourceName}：${entry.food_name}`,
    `${round(entry.calories)} kcal / P${round(entry.protein_g)} F${round(entry.fat_g)} C${round(entry.carbs_g)}`,
  ].join("\n");
}

export function imageIntentMessage(): string {
  return "收到，接下來 5 分鐘內你傳的下一張照片會被記錄。";
}

export function groupImageIgnoredMessage(): string {
  return "群組裡我不會自動記錄照片。請先 @我 說「紀錄下一張照片」，再傳餐點照片。";
}

export function dailySummary(user: UserProfile, totals: MacroTotals): string {
  const remaining = remainingTotals(user, totals);
  return [
    "今日累計 / 目標",
    `熱量 ${round(totals.calories)} / ${round(user.goal_calories)} kcal，剩 ${round(remaining.calories)}`,
    `蛋白質 ${round(totals.protein_g)} / ${round(user.goal_protein_g)}g，剩 ${round(remaining.protein_g)}`,
    `脂肪 ${round(totals.fat_g)} / ${round(user.goal_fat_g)}g，剩 ${round(remaining.fat_g)}`,
    `碳水 ${round(totals.carbs_g)} / ${round(user.goal_carbs_g)}g，剩 ${round(remaining.carbs_g)}`,
  ].join("\n");
}

function remainingTotals(user: UserProfile, totals: MacroTotals): MacroTotals {
  return {
    calories: user.goal_calories - totals.calories,
    protein_g: user.goal_protein_g - totals.protein_g,
    fat_g: user.goal_fat_g - totals.fat_g,
    carbs_g: user.goal_carbs_g - totals.carbs_g,
  };
}

function round(value: number): number {
  return Math.round(value);
}

function formatDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${year}/${month}/${day}`;
}

function roleLabel(user: UserProfile): string {
  if (user.role === "owner") return "最高權限";
  if (user.role === "coach") return "教練";
  return "學員";
}

function accessLabel(user: UserProfile): string {
  if (user.role === "owner" || user.permanent_access) {
    return "永久使用";
  }
  if (!user.access_expires_at) {
    return "尚未授權";
  }
  const days = Math.ceil((user.access_expires_at - Date.now()) / (24 * 60 * 60 * 1000));
  return days > 0 ? `剩約 ${days} 天` : "已到期";
}

function calculateBmr(user: UserProfile): number | undefined {
  if (!user.sex || !user.age || !user.height_cm || !user.weight_kg) {
    return undefined;
  }

  const base = 10 * user.weight_kg + 6.25 * user.height_cm - 5 * user.age;
  return user.sex === "男" ? base + 5 : base - 161;
}
