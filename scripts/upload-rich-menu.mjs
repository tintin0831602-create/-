import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

if (!token) {
  throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN");
}

const imagePath = path.join(root, "public", "assets", "hermes-rich-menu.jpg");

const richMenu = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: "Hermes nutrition main menu",
  chatBarText: "選單",
  areas: [
    textArea(0, 198, 833, 744, "新手教學"),
    textArea(833, 198, 834, 744, "學員區"),
    textArea(1667, 198, 833, 744, "教練區"),
    textArea(0, 942, 833, 744, "管理員區"),
    textArea(833, 942, 834, 744, "付款區"),
    textArea(1667, 942, 833, 744, "今日"),
  ],
};

const createResponse = await lineFetch("https://api.line.me/v2/bot/richmenu", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(richMenu),
});
const { richMenuId } = await createResponse.json();

await lineFetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
  method: "POST",
  headers: { "content-type": "image/jpeg" },
  body: fs.readFileSync(imagePath),
});

await lineFetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
  method: "POST",
});

console.log(`Default rich menu set: ${richMenuId}`);

function textArea(x, y, width, height, text) {
  return {
    bounds: { x, y, width, height },
    action: { type: "message", text },
  };
}

async function lineFetch(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE API error ${response.status}: ${body}`);
  }
  return response;
}
