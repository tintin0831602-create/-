import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { config } from "./config.js";
import type { FoodAnalysis } from "./types.js";

const ai = new GoogleGenAI({
  apiKey: config.geminiApiKey,
});

const FoodItemSchema = z.object({
  name: z.string(),
  quantity: z.string(),
  calories: z.number(),
  protein_g: z.number(),
  fat_g: z.number(),
  carbs_g: z.number(),
  confidence: z.number(),
});

const FoodAnalysisSchema = z.object({
  food_name: z.string(),
  meal_type: z.enum(["breakfast", "lunch", "dinner", "snack", "unknown"]),
  items: z.array(FoodItemSchema),
  totals: z.object({
    calories: z.number(),
    protein_g: z.number(),
    fat_g: z.number(),
    carbs_g: z.number(),
  }),
  notes: z.string(),
  confidence: z.number(),
});

const ConversationSchema = z.object({
  needs_clarification: z.boolean(),
  clarification_question: z.string(),
  short_answer: z.string(),
  nutrition_summary: z.object({
    calories: z.number(),
    protein_g: z.number(),
    fat_g: z.number(),
    carbs_g: z.number(),
  }),
  recommendation: z.string(),
  should_log: z.boolean(),
});

const foodAnalysisJsonSchema = {
  type: "object",
  properties: {
    food_name: { type: "string", description: "餐點或食物的繁體中文名稱" },
    meal_type: {
      type: "string",
      enum: ["breakfast", "lunch", "dinner", "snack", "unknown"],
    },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          quantity: { type: "string" },
          calories: { type: "number" },
          protein_g: { type: "number" },
          fat_g: { type: "number" },
          carbs_g: { type: "number" },
          confidence: { type: "number" },
        },
        required: [
          "name",
          "quantity",
          "calories",
          "protein_g",
          "fat_g",
          "carbs_g",
          "confidence",
        ],
      },
    },
    totals: {
      type: "object",
      properties: {
        calories: { type: "number" },
        protein_g: { type: "number" },
        fat_g: { type: "number" },
        carbs_g: { type: "number" },
      },
      required: ["calories", "protein_g", "fat_g", "carbs_g"],
    },
    notes: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["food_name", "meal_type", "items", "totals", "notes", "confidence"],
};

const conversationJsonSchema = {
  type: "object",
  properties: {
    needs_clarification: { type: "boolean" },
    clarification_question: { type: "string" },
    short_answer: { type: "string" },
    nutrition_summary: {
      type: "object",
      properties: {
        calories: { type: "number" },
        protein_g: { type: "number" },
        fat_g: { type: "number" },
        carbs_g: { type: "number" },
      },
      required: ["calories", "protein_g", "fat_g", "carbs_g"],
    },
    recommendation: { type: "string" },
    should_log: { type: "boolean" },
  },
  required: [
    "needs_clarification",
    "clarification_question",
    "short_answer",
    "nutrition_summary",
    "recommendation",
    "should_log",
  ],
};

const nutritionInstructions = `
你是謹慎的台灣營養紀錄助理。請估算餐點的熱量與三大營養素。
規則：
- 只回傳結構化資料。
- 若份量不確定，使用合理區間的中間值，並在 notes 說明假設。
- 熱量 kcal、蛋白質/脂肪/碳水為公克。
- 不要提供醫療診斷。
- confidence 用 0 到 1 表示你對估算的信心。
`;

export async function analyzeFoodImage(image: Buffer, contentType: string): Promise<FoodAnalysis> {
  const response = await ai.models.generateContent({
    model: config.geminiModel,
    contents: [
      {
        inlineData: {
          mimeType: contentType,
          data: image.toString("base64"),
        },
      },
      {
        text: `${nutritionInstructions}

請分析這張餐點照片，估算食物名稱、份量、總熱量與三大營養素。請用繁體中文命名食物。`,
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: foodAnalysisJsonSchema,
    },
  });

  return parseGeminiJson(response.text);
}

export async function analyzeFoodText(text: string): Promise<FoodAnalysis> {
  const response = await ai.models.generateContent({
    model: config.geminiModel,
    contents: `${nutritionInstructions}

請根據這段飲食描述估算營養：${text}`,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: foodAnalysisJsonSchema,
    },
  });

  return parseGeminiJson(response.text);
}

export async function answerNutritionQuestion(input: {
  text: string;
  dailyGoal: {
    calories: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
  };
  todayTotals: {
    calories: number;
    protein_g: number;
    fat_g: number;
    carbs_g: number;
  };
}): Promise<z.infer<typeof ConversationSchema>> {
  const response = await ai.models.generateContent({
    model: config.geminiModel,
    contents: `
你是台灣健身教練可使用的營養 AI 助理。使用者可能在問飲食是否足夠、想記錄一餐、或需要建議。
請用繁體中文、自然、短而有幫助的方式回答。

若份量明顯不足以估算，例如「一碗麵」但沒有大小，needs_clarification=true，問一個最重要的追問。
若資訊足夠，給估算與建議。不要提供醫療診斷。

使用者今日目標：
熱量 ${input.dailyGoal.calories} kcal，蛋白質 ${input.dailyGoal.protein_g}g，脂肪 ${input.dailyGoal.fat_g}g，碳水 ${input.dailyGoal.carbs_g}g

今日目前累計：
熱量 ${input.todayTotals.calories} kcal，蛋白質 ${input.todayTotals.protein_g}g，脂肪 ${input.todayTotals.fat_g}g，碳水 ${input.todayTotals.carbs_g}g

使用者訊息：
${input.text}
`,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: conversationJsonSchema,
    },
  });

  return parseConversationJson(response.text);
}

function parseGeminiJson(text: string | undefined): FoodAnalysis {
  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  try {
    return requireParsedAnalysis(JSON.parse(text));
  } catch (error) {
    const cleaned = text
      .trim()
      .replace(/^```json\s*/u, "")
      .replace(/^```\s*/u, "")
      .replace(/\s*```$/u, "");

    try {
      return requireParsedAnalysis(JSON.parse(cleaned));
    } catch {
      throw error;
    }
  }
}

function parseConversationJson(text: string | undefined): z.infer<typeof ConversationSchema> {
  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  const cleaned = text
    .trim()
    .replace(/^```json\s*/u, "")
    .replace(/^```\s*/u, "")
    .replace(/\s*```$/u, "");
  const parsed = ConversationSchema.safeParse(JSON.parse(cleaned));
  if (!parsed.success) {
    throw new Error("Gemini conversation response did not match the expected schema");
  }

  return parsed.data;
}

function requireParsedAnalysis(value: unknown): FoodAnalysis {
  const parsed = FoodAnalysisSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Gemini response did not match the expected nutrition schema");
  }

  return parsed.data;
}
