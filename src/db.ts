import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { AccessRole, FoodEntry, MacroTotals, UserProfile } from "./types.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    line_user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    goal_calories REAL NOT NULL,
    goal_protein_g REAL NOT NULL,
    goal_fat_g REAL NOT NULL,
    goal_carbs_g REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS food_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    line_user_id TEXT NOT NULL,
    consumed_date TEXT NOT NULL,
    source TEXT NOT NULL,
    food_name TEXT NOT NULL,
    meal_type TEXT NOT NULL,
    calories REAL NOT NULL,
    protein_g REAL NOT NULL,
    fat_g REAL NOT NULL,
    carbs_g REAL NOT NULL,
    confidence REAL NOT NULL,
    notes TEXT NOT NULL,
    image_message_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (line_user_id) REFERENCES users(line_user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_food_entries_user_date
    ON food_entries(line_user_id, consumed_date);

  CREATE TABLE IF NOT EXISTS image_recording_intents (
    line_user_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS coach_access (
    pin TEXT PRIMARY KEY,
    coach_name TEXT NOT NULL,
    expires_at INTEGER,
    permanent_access INTEGER NOT NULL DEFAULT 0,
    student_quota INTEGER NOT NULL DEFAULT 0,
    claimed_line_user_id TEXT,
    created_by_line_user_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

ensureUserColumn("sex", "TEXT");
ensureUserColumn("age", "INTEGER");
ensureUserColumn("height_cm", "REAL");
ensureUserColumn("weight_kg", "REAL");
ensureUserColumn("is_coach", "INTEGER NOT NULL DEFAULT 0");
ensureUserColumn("role", "TEXT NOT NULL DEFAULT 'student'");
ensureUserColumn("access_expires_at", "INTEGER");
ensureUserColumn("permanent_access", "INTEGER NOT NULL DEFAULT 0");
ensureUserColumn("student_quota", "INTEGER");
ensureUserColumn("coach_owner_id", "TEXT");
promoteConfiguredOwnerIfNeeded();

function ensureUserColumn(name: string, definition: string): void {
  const columns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE users ADD COLUMN ${name} ${definition}`);
  }
}

function promoteConfiguredOwnerIfNeeded(): void {
  const ownerCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'owner'").get() as {
    count: number;
  };
  if (ownerCount.count > 0) {
    return;
  }

  db.prepare(`
    UPDATE users SET
      role = 'owner',
      permanent_access = 1,
      is_coach = 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE line_user_id = (
      SELECT line_user_id FROM users
      WHERE display_name = ? COLLATE NOCASE
      ORDER BY created_at ASC
      LIMIT 1
    )
  `).run(config.ownerDisplayName);
}

export function upsertUser(user: UserProfile): void {
  db.prepare(`
    INSERT INTO users (
      line_user_id, display_name, goal_calories, goal_protein_g, goal_fat_g, goal_carbs_g,
      role, access_expires_at, permanent_access, is_coach
    ) VALUES (
      @line_user_id, @display_name, @goal_calories, @goal_protein_g, @goal_fat_g, @goal_carbs_g,
      COALESCE(@role, 'student'), @access_expires_at, COALESCE(@permanent_access, 0),
      CASE WHEN @role IN ('owner', 'coach') THEN 1 ELSE COALESCE(@is_coach, 0) END
    )
    ON CONFLICT(line_user_id) DO UPDATE SET
      display_name = excluded.display_name,
      goal_calories = excluded.goal_calories,
      goal_protein_g = excluded.goal_protein_g,
      goal_fat_g = excluded.goal_fat_g,
      goal_carbs_g = excluded.goal_carbs_g,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    ...user,
    role: user.role || "student",
    access_expires_at: user.access_expires_at ?? null,
    permanent_access: user.permanent_access ?? 0,
    is_coach: user.is_coach ?? 0,
  });
}

export function getUser(lineUserId: string): UserProfile | undefined {
  return db
    .prepare("SELECT * FROM users WHERE line_user_id = ?")
    .get(lineUserId) as UserProfile | undefined;
}

export function listUsers(): UserProfile[] {
  return db.prepare("SELECT * FROM users ORDER BY created_at ASC").all() as UserProfile[];
}

export function countOwners(): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'owner'").get() as {
    count: number;
  };
  return row.count;
}

export function findUserByDisplayName(displayName: string): UserProfile | undefined {
  return db
    .prepare("SELECT * FROM users WHERE display_name = ? COLLATE NOCASE")
    .get(displayName) as UserProfile | undefined;
}

export function updateUserGoals(
  lineUserId: string,
  goals: Pick<
    UserProfile,
    "goal_calories" | "goal_protein_g" | "goal_fat_g" | "goal_carbs_g"
  >,
): UserProfile {
  db.prepare(`
    UPDATE users SET
      goal_calories = @goal_calories,
      goal_protein_g = @goal_protein_g,
      goal_fat_g = @goal_fat_g,
      goal_carbs_g = @goal_carbs_g,
      updated_at = CURRENT_TIMESTAMP
    WHERE line_user_id = @line_user_id
  `).run({ line_user_id: lineUserId, ...goals });

  return getUser(lineUserId) as UserProfile;
}

export function updateUserBodyStats(
  lineUserId: string,
  stats: Pick<UserProfile, "sex" | "age" | "height_cm" | "weight_kg">,
): UserProfile {
  db.prepare(`
    UPDATE users SET
      sex = @sex,
      age = @age,
      height_cm = @height_cm,
      weight_kg = @weight_kg,
      updated_at = CURRENT_TIMESTAMP
    WHERE line_user_id = @line_user_id
  `).run({ line_user_id: lineUserId, ...stats });

  return getUser(lineUserId) as UserProfile;
}

export function countCoaches(): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM users WHERE is_coach = 1").get() as {
    count: number;
  };
  return row.count;
}

export function setCoach(lineUserId: string): UserProfile {
  db.prepare(
    "UPDATE users SET role = 'coach', permanent_access = 1, is_coach = 1, updated_at = CURRENT_TIMESTAMP WHERE line_user_id = ?",
  ).run(lineUserId);
  return getUser(lineUserId) as UserProfile;
}

export function setOwner(lineUserId: string): UserProfile {
  db.prepare(`
    UPDATE users SET
      role = 'owner',
      permanent_access = 1,
      is_coach = 1,
      updated_at = CURRENT_TIMESTAMP
    WHERE line_user_id = ?
  `).run(lineUserId);
  return getUser(lineUserId) as UserProfile;
}

export function grantAccess(
  lineUserId: string,
  role: AccessRole,
  options: { days?: number; permanent?: boolean; studentQuota?: number | null; coachOwnerId?: string | null },
): UserProfile {
  const expiresAt =
    options.permanent || options.days === undefined
      ? null
      : Date.now() + options.days * 24 * 60 * 60 * 1000;
  db.prepare(`
    UPDATE users SET
      role = @role,
      permanent_access = @permanent_access,
      access_expires_at = @access_expires_at,
      student_quota = CASE WHEN @role = 'coach' THEN @student_quota ELSE student_quota END,
      coach_owner_id = COALESCE(@coach_owner_id, coach_owner_id),
      is_coach = CASE WHEN @role IN ('owner', 'coach') THEN 1 ELSE 0 END,
      updated_at = CURRENT_TIMESTAMP
    WHERE line_user_id = @line_user_id
  `).run({
    line_user_id: lineUserId,
    role,
    permanent_access: options.permanent ? 1 : 0,
    access_expires_at: expiresAt,
    student_quota: options.studentQuota ?? null,
    coach_owner_id: options.coachOwnerId ?? null,
  });
  return getUser(lineUserId) as UserProfile;
}

export function countStudentsForCoach(coachLineUserId: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'student' AND coach_owner_id = ?")
    .get(coachLineUserId) as { count: number };
  return row.count;
}

export type CoachAccess = {
  pin: string;
  coach_name: string;
  expires_at: number | null;
  permanent_access: number;
  student_quota: number;
  claimed_line_user_id: string | null;
  created_by_line_user_id: string;
  created_at: string;
};

export function createCoachAccess(input: {
  pin: string;
  coachName: string;
  expiresAt: number | null;
  permanentAccess: boolean;
  studentQuota: number;
  createdByLineUserId: string;
}): CoachAccess {
  db.prepare(`
    INSERT INTO coach_access (
      pin, coach_name, expires_at, permanent_access, student_quota, created_by_line_user_id
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(pin) DO UPDATE SET
      coach_name = excluded.coach_name,
      expires_at = excluded.expires_at,
      permanent_access = excluded.permanent_access,
      student_quota = excluded.student_quota
  `).run(
    input.pin,
    input.coachName,
    input.expiresAt,
    input.permanentAccess ? 1 : 0,
    input.studentQuota,
    input.createdByLineUserId,
  );
  return getCoachAccessByPin(input.pin) as CoachAccess;
}

export function getCoachAccessByPin(pin: string): CoachAccess | undefined {
  return db.prepare("SELECT * FROM coach_access WHERE pin = ?").get(pin) as CoachAccess | undefined;
}

export function claimCoachAccess(pin: string, lineUserId: string): CoachAccess | undefined {
  const access = getCoachAccessByPin(pin);
  if (!access) {
    return undefined;
  }
  db.prepare("UPDATE coach_access SET claimed_line_user_id = ? WHERE pin = ?").run(lineUserId, pin);
  db.prepare("UPDATE users SET coach_owner_id = ? WHERE coach_owner_id = ?").run(
    lineUserId,
    coachKeyForPin(pin),
  );
  db.prepare(`
    UPDATE users SET
      role = 'coach',
      is_coach = 1,
      permanent_access = @permanent_access,
      access_expires_at = @access_expires_at,
      student_quota = @student_quota,
      updated_at = CURRENT_TIMESTAMP
    WHERE line_user_id = @line_user_id
  `).run({
    line_user_id: lineUserId,
    permanent_access: access.permanent_access,
    access_expires_at: access.expires_at,
    student_quota: access.student_quota,
  });
  return getCoachAccessByPin(pin);
}

export function coachKeyForPin(pin: string): string {
  return `pin:${pin}`;
}

export function countStudentsForCoachKey(coachKey: string): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'student' AND coach_owner_id = ?")
    .get(coachKey) as { count: number };
  return row.count;
}

export function listUsersForCoachKeys(coachKeys: string[]): UserProfile[] {
  if (!coachKeys.length) {
    return [];
  }
  const placeholders = coachKeys.map(() => "?").join(",");
  return db
    .prepare(`SELECT * FROM users WHERE coach_owner_id IN (${placeholders}) ORDER BY created_at ASC`)
    .all(...coachKeys) as UserProfile[];
}

export function resetUser(lineUserId: string): void {
  db.prepare("DELETE FROM food_entries WHERE line_user_id = ?").run(lineUserId);
  db.prepare("DELETE FROM image_recording_intents WHERE line_user_id = ?").run(lineUserId);
  db.prepare("DELETE FROM users WHERE line_user_id = ?").run(lineUserId);
}

export function addFoodEntry(entry: Omit<FoodEntry, "id" | "created_at">): FoodEntry {
  const result = db
    .prepare(`
      INSERT INTO food_entries (
        line_user_id, consumed_date, source, food_name, meal_type, calories,
        protein_g, fat_g, carbs_g, confidence, notes, image_message_id
      ) VALUES (
        @line_user_id, @consumed_date, @source, @food_name, @meal_type, @calories,
        @protein_g, @fat_g, @carbs_g, @confidence, @notes, @image_message_id
      )
    `)
    .run(entry);

  return db
    .prepare("SELECT * FROM food_entries WHERE id = ?")
    .get(result.lastInsertRowid) as FoodEntry;
}

export function getDailyEntries(lineUserId: string, consumedDate: string): FoodEntry[] {
  return db
    .prepare(
      `SELECT * FROM food_entries
       WHERE line_user_id = ? AND consumed_date = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(lineUserId, consumedDate) as FoodEntry[];
}

export function getDailyTotals(lineUserId: string, consumedDate: string): MacroTotals {
  const row = db
    .prepare(
      `SELECT
        COALESCE(SUM(calories), 0) AS calories,
        COALESCE(SUM(protein_g), 0) AS protein_g,
        COALESCE(SUM(fat_g), 0) AS fat_g,
        COALESCE(SUM(carbs_g), 0) AS carbs_g
       FROM food_entries
       WHERE line_user_id = ? AND consumed_date = ?`,
    )
    .get(lineUserId, consumedDate) as MacroTotals;

  return row;
}

export function deleteLatestEntry(
  lineUserId: string,
  source?: FoodEntry["source"],
): FoodEntry | undefined {
  const params: string[] = source ? [lineUserId, source] : [lineUserId];
  const sourceFilter = source ? "AND source = ?" : "";
  const latest = db
    .prepare(
      `SELECT * FROM food_entries
       WHERE line_user_id = ? ${sourceFilter}
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .get(...params) as FoodEntry | undefined;

  if (!latest) {
    return undefined;
  }

  db.prepare("DELETE FROM food_entries WHERE id = ?").run(latest.id);
  return latest;
}

export function createImageRecordingIntent(
  lineUserId: string,
  sourceId: string,
  expiresAt: number,
): void {
  db.prepare(`
    INSERT INTO image_recording_intents (line_user_id, source_id, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(line_user_id) DO UPDATE SET
      source_id = excluded.source_id,
      expires_at = excluded.expires_at,
      created_at = CURRENT_TIMESTAMP
  `).run(lineUserId, sourceId, expiresAt);
}

export function consumeImageRecordingIntent(
  lineUserId: string,
  sourceId: string,
  now: number,
): boolean {
  const intent = db
    .prepare(
      `SELECT line_user_id FROM image_recording_intents
       WHERE line_user_id = ? AND source_id = ? AND expires_at >= ?`,
    )
    .get(lineUserId, sourceId, now) as { line_user_id: string } | undefined;

  db.prepare("DELETE FROM image_recording_intents WHERE line_user_id = ?").run(lineUserId);
  return Boolean(intent);
}

export function clearExpiredImageRecordingIntents(now: number): void {
  db.prepare("DELETE FROM image_recording_intents WHERE expires_at < ?").run(now);
}
