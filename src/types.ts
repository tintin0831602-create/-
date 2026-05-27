export type MacroTotals = {
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
};

export type UserProfile = {
  line_user_id: string;
  display_name: string;
  goal_calories: number;
  goal_protein_g: number;
  goal_fat_g: number;
  goal_carbs_g: number;
  sex?: "男" | "女" | null;
  age?: number | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  is_coach?: number;
  role?: "owner" | "coach" | "student" | null;
  access_expires_at?: number | null;
  permanent_access?: number;
  student_quota?: number | null;
  coach_owner_id?: string | null;
};

export type AccessRole = "owner" | "coach" | "student";

export type FoodEntry = {
  id: number;
  line_user_id: string;
  consumed_date: string;
  source: "image" | "manual" | "text";
  food_name: string;
  meal_type: string;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  confidence: number;
  notes: string;
  image_message_id: string | null;
  created_at: string;
};

export type FoodAnalysis = {
  food_name: string;
  meal_type: "breakfast" | "lunch" | "dinner" | "snack" | "unknown";
  items: Array<{
    name: string;
    quantity: string;
    calories: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
    confidence: number;
  }>;
  totals: MacroTotals;
  notes: string;
  confidence: number;
};

export type LineWebhookBody = {
  destination: string;
  events: LineEvent[];
};

export type LineEvent = {
  type: string;
  replyToken?: string;
  source?: {
    type: string;
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  message?: {
    id: string;
    type: string;
    text?: string;
    mention?: {
      mentionees: Array<{
        index: number;
        length: number;
        type: string;
        userId?: string;
      }>;
    };
    contentProvider?: {
      type: string;
    };
  };
};
