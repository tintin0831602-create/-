import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  baseUrl: process.env.BASE_URL,
  lineChannelSecret: required("LINE_CHANNEL_SECRET"),
  lineChannelAccessToken: required("LINE_CHANNEL_ACCESS_TOKEN"),
  lineLoginChannelId: optional("LINE_LOGIN_CHANNEL_ID", ""),
  lineLoginChannelSecret: optional("LINE_LOGIN_CHANNEL_SECRET", ""),
  lineLoginCallbackUrl: optional("LINE_LOGIN_CALLBACK_URL", ""),
  geminiApiKey: required("GEMINI_API_KEY"),
  geminiModel: optional("GEMINI_MODEL", "gemini-3.5-flash"),
  databasePath: optional("DATABASE_PATH", "./data/hermes.sqlite"),
  timezone: optional("TIMEZONE", "Asia/Taipei"),
  ownerDisplayName: optional("OWNER_DISPLAY_NAME", "Jasper"),
  adminPin: optional("ADMIN_PIN", ""),
  paymentTestMode: optional("PAYMENT_TEST_MODE", "true") !== "false",
};
