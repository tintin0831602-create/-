import crypto from "node:crypto";
import { config } from "./config.js";
import type { LineReplyMessage } from "./types.js";

type BotInfo = {
  userId?: string;
  basicId?: string;
  displayName?: string;
};

let cachedBotInfo: BotInfo | undefined;

export function verifyLineSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) {
    return false;
  }

  const expected = crypto
    .createHmac("sha256", config.lineChannelSecret)
    .update(rawBody)
    .digest("base64");

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function replyText(replyToken: string, text: string): Promise<void> {
  await replyMessages(replyToken, [{ type: "text", text: text.slice(0, 4900) }]);
}

export async function replyMessages(replyToken: string, messages: LineReplyMessage[]): Promise<void> {
  await lineFetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      replyToken,
      messages,
    }),
  });
}

export async function showLoading(userId: string, seconds = 20): Promise<void> {
  try {
    await lineFetch("https://api.line.me/v2/bot/chat/loading/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ chatId: userId, loadingSeconds: seconds }),
    });
  } catch {
    // Loading animation is nice to have; reply should still continue if it fails.
  }
}

export async function getMessageContent(messageId: string): Promise<{
  data: Buffer;
  contentType: string;
}> {
  const response = await lineFetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    method: "GET",
  });

  return {
    data: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "image/jpeg",
  };
}

export async function getBotInfo(): Promise<BotInfo> {
  if (cachedBotInfo) {
    return cachedBotInfo;
  }

  const response = await lineFetch("https://api.line.me/v2/bot/info", {
    method: "GET",
  });
  cachedBotInfo = (await response.json()) as BotInfo;
  return cachedBotInfo;
}

async function lineFetch(url: string, init: RequestInit): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${config.lineChannelAccessToken}`,
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE API error ${response.status}: ${body}`);
  }

  return response;
}
