import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "assets");
const tmpDir = path.join(root, "tmp", "rich-menu");
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(tmpDir, { recursive: true });

const htmlPath = path.join(tmpDir, "rich-menu.html");
const pngPath = path.join(outDir, "hermes-rich-menu.png");
const jpgPath = path.join(outDir, "hermes-rich-menu.jpg");

const asset = (name) => path.join(root, "public", "assets", name);

const items = [
  {
    title: "新手教學",
    subtitle: "一步一步知道下一步",
    image: asset("feature-coach-dashboard.jpg"),
    color: "#0b7a53",
  },
  {
    title: "學員區",
    subtitle: "記錄、今日、本週回顧",
    image: asset("feature-food-photo.jpg"),
    color: "#0aa567",
  },
  {
    title: "教練區",
    subtitle: "登入後進管理台",
    image: asset("feature-food-photo.jpg"),
    color: "#285c7f",
  },
  {
    title: "管理員區",
    subtitle: "產生 PIN 與權限管理",
    image: asset("landing-hero-coach.jpg"),
    color: "#684cb1",
  },
  {
    title: "付款區",
    subtitle: "訂閱與方案入口",
    image: asset("feature-coach-dashboard.jpg"),
    color: "#e0644b",
  },
  {
    title: "今日進度",
    subtitle: "查看今日與剩餘",
    image: asset("landing-hero-coach.jpg"),
    color: "#1f4d3b",
  },
];

const cards = items
  .map(
    (item) => `
      <section class="card" style="--photo:url('file://${item.image}'); --color:${item.color}">
        <div class="photo"></div>
        <div class="shade"></div>
        <div class="text">
          <h2>${item.title}</h2>
          <p>${item.subtitle}</p>
        </div>
      </section>
    `,
  )
  .join("");

fs.writeFileSync(
  htmlPath,
  `<!doctype html>
  <html lang="zh-Hant">
    <head>
      <meta charset="utf-8" />
      <style>
        * { box-sizing: border-box; }
        html, body {
          width: 2500px;
          height: 1686px;
          margin: 0;
          overflow: hidden;
          background: #f4f8f1;
          font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif;
        }
        .wrap {
          width: 2500px;
          height: 1686px;
          display: grid;
          grid-template-rows: 198px 1fr;
          background: #f4f8f1;
        }
        header {
          display: grid;
          place-items: center;
          background: linear-gradient(135deg, #06b765, #0a7a55);
          color: white;
          border-bottom: 12px solid rgba(255,255,255,.95);
        }
        header h1 {
          margin: 0;
          font-size: 76px;
          letter-spacing: 0;
          font-weight: 900;
        }
        header p {
          margin: 12px 0 0;
          font-size: 34px;
          font-weight: 750;
          opacity: .92;
        }
        main {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          grid-template-rows: repeat(2, 1fr);
          gap: 18px;
          padding: 18px;
        }
        .card {
          position: relative;
          overflow: hidden;
          border-radius: 34px;
          background: #fff;
          box-shadow: inset 0 0 0 3px rgba(10, 75, 52, .08);
        }
        .photo,
        .shade {
          position: absolute;
          inset: 0;
        }
        .photo {
          background-image: var(--photo);
          background-size: cover;
          background-position: center;
          filter: saturate(1.04) contrast(1.02);
        }
        .shade {
          background:
            linear-gradient(180deg, rgba(15, 26, 31, .05), rgba(15, 26, 31, .64)),
            linear-gradient(135deg, color-mix(in srgb, var(--color) 78%, transparent), transparent 58%);
        }
        .text {
          position: absolute;
          left: 46px;
          right: 46px;
          bottom: 44px;
          color: white;
          text-shadow: 0 3px 14px rgba(0,0,0,.36);
        }
        h2 {
          margin: 0 0 14px;
          font-size: 82px;
          line-height: 1;
          letter-spacing: 0;
          font-weight: 1000;
        }
        p {
          margin: 0;
          font-size: 35px;
          line-height: 1.2;
          font-weight: 800;
        }
      </style>
    </head>
    <body>
      <div class="wrap">
        <header>
          <div>
            <h1>Hermes 營養選單</h1>
            <p>分區入口、教學、付款與今日進度</p>
          </div>
        </header>
        <main>${cards}</main>
      </div>
    </body>
  </html>`,
);

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
execFileSync(chrome, [
  "--headless",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  "--force-device-scale-factor=1",
  "--window-size=2500,1686",
  `--screenshot=${pngPath}`,
  `file://${htmlPath}`,
]);

execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "88", pngPath, "--out", jpgPath]);

const jpgStats = fs.statSync(jpgPath);
console.log(`Rich menu image: ${jpgPath} (${Math.round(jpgStats.size / 1024)} KB)`);
