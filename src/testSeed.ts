import crypto from "node:crypto";
import {
  claimCoachAccess,
  createCoachAccess,
  createLineLoginUserIfMissing,
  findCoachAccessByName,
  grantAccess,
} from "./db.js";

export type LoadTestCoach = {
  index: number;
  name: string;
  lineUserId: string;
  pin: string;
  studentQuota: number;
  expiresAt: number | null;
  studentCount: number;
  firstStudentName?: string;
  lastStudentName?: string;
};

export type LoadTestStudent = {
  index: number;
  name: string;
  lineUserId: string;
  coachName: string;
  coachPin: string;
  accessStatus: "unpaid";
};

export type LoadTestDataset = {
  suffix: string;
  coachCount: number;
  studentCount: number;
  studentsPerCoach: number;
  coaches: LoadTestCoach[];
  students: LoadTestStudent[];
};

export function createLoadTestDataset(input: {
  suffix?: string;
  coachCount?: number;
  studentCount?: number;
  createdByLineUserId: string;
}): LoadTestDataset {
  const coachCount = boundedInteger(input.coachCount ?? 5, 1, 20);
  const studentCount = boundedInteger(input.studentCount ?? 50, 1, 500);
  const studentsPerCoach = Math.ceil(studentCount / coachCount);
  const suffix = normalizeLoadTestSuffix(input.suffix);
  const now = Date.now();
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000;

  const coaches: LoadTestCoach[] = [];
  for (let index = 1; index <= coachCount; index += 1) {
    const padded = String(index).padStart(2, "0");
    const name = `壓測已付教練-${suffix}-${padded}`;
    const lineUserId = `LOAD_COACH_${suffix}_${padded}`;
    createLineLoginUserIfMissing({ lineUserId, displayName: name });

    const existingAccess = findCoachAccessByName(name);
    const pin = existingAccess?.pin || generatePin();
    const access = createCoachAccess({
      pin,
      coachName: name,
      expiresAt,
      permanentAccess: false,
      studentQuota: studentsPerCoach,
      createdByLineUserId: input.createdByLineUserId,
    });
    claimCoachAccess(pin, lineUserId);

    coaches.push({
      index,
      name,
      lineUserId,
      pin: access.pin,
      studentQuota: access.student_quota,
      expiresAt: access.expires_at,
      studentCount: 0,
    });
  }

  const students: LoadTestStudent[] = [];
  for (let index = 1; index <= studentCount; index += 1) {
    const padded = String(index).padStart(3, "0");
    const coach = coaches[Math.min(coaches.length - 1, Math.floor((index - 1) / studentsPerCoach))];
    const name = `壓測未付學員-${suffix}-${padded}`;
    const lineUserId = `LOAD_STUDENT_${suffix}_${padded}`;
    createLineLoginUserIfMissing({ lineUserId, displayName: name });
    grantAccess(lineUserId, "student", { days: 0, coachOwnerId: coach.lineUserId });

    coach.studentCount += 1;
    coach.firstStudentName ||= name;
    coach.lastStudentName = name;
    students.push({
      index,
      name,
      lineUserId,
      coachName: coach.name,
      coachPin: coach.pin,
      accessStatus: "unpaid",
    });
  }

  return {
    suffix,
    coachCount,
    studentCount,
    studentsPerCoach,
    coaches,
    students,
  };
}

export function formatLoadTestDatasetText(
  dataset: LoadTestDataset,
  options: { adminUrlForPin?: (pin: string) => string } = {},
): string {
  const coachLines = dataset.coaches.flatMap((coach) => [
    `${coach.index}. ${coach.name}`,
    `PIN：${coach.pin} / 名額：${coach.studentQuota} / 已配：${coach.studentCount}`,
    coach.firstStudentName && coach.lastStudentName
      ? `學員：${coach.firstStudentName} ～ ${coach.lastStudentName}`
      : "學員：尚未配給",
    options.adminUrlForPin ? `管理台：${options.adminUrlForPin(coach.pin)}` : "",
    "",
  ]);

  return [
    "已產生壓力測試資料",
    `批次代號：${dataset.suffix}`,
    `教練：${dataset.coachCount} 位，狀態為已付費/開通 30 天`,
    `學員：${dataset.studentCount} 位，狀態為未付款/未開通`,
    "分配：每位教練最多 10 位，這批資料不會自動刪除",
    "",
    ...coachLines.filter(Boolean),
    "建議測試：",
    "1. 用任一教練 PIN 進管理台",
    "2. 確認名下有 10 位未付學員",
    "3. 授權其中一位學員 7 天或 30 天",
    "4. 修改該學員熱量、三大營養素、身體資料",
    "",
    "提醒：這些是系統內測試資料，不是真實 LINE 帳號；可測管理台與授權流程，不能代表真人傳訊息。",
  ].join("\n");
}

function boundedInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function normalizeLoadTestSuffix(suffixInput?: string): string {
  return (
    suffixInput?.trim().replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 24) ||
    new Date().toISOString().replace(/[-:.TZ]/g, "").slice(4, 14)
  );
}

function generatePin(): string {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}
