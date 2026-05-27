import dotenv from "dotenv";

dotenv.config();

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const baseUrl = process.env.BASE_URL;

if (!token) {
  throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN");
}
if (!baseUrl) {
  throw new Error("Missing BASE_URL");
}

const endpoint = `${baseUrl.replace(/\/$/, "")}/webhook`;

await lineFetch("https://api.line.me/v2/bot/channel/webhook/endpoint", {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ endpoint }),
});

const response = await lineFetch("https://api.line.me/v2/bot/channel/webhook/endpoint", {
  method: "GET",
});
const result = await response.json();

console.log(`Webhook endpoint: ${result.endpoint}`);
console.log(`Active: ${result.active}`);

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
