# LINE Hermes 營養聊天室

這是一個可連接 LINE Messaging API 的雙人成員營養追蹤 bot。成員可以各自設定每日熱量與三大營養素目標，透過文字或餐點照片紀錄飲食，bot 會回覆今日累計與剩餘額度。

## 功能

- 依 LINE 使用者分開追蹤每日熱量、蛋白質、脂肪、碳水
- 餐點照片分析，估算熱量與三大營養素
- 文字紀錄與手動數字紀錄
- 今日飲食分析、剩餘熱量提醒
- Hermes 指令別名，例如 `Hermes 今日`、`Hermes 剩餘`

## 安裝

```bash
npm install
cp .env.example .env
```

填入 `.env`：

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `GEMINI_API_KEY`
- `BASE_URL`，正式部署時填公開網址

## 啟動

```bash
npm run dev
```

本機預設 webhook 端點：

```text
POST http://localhost:3000/webhook
```

部署到公開網址後，在 LINE Developers Console 的 Messaging API 設定：

```text
https://你的網域/webhook
```

並啟用 webhook。

## 部署到 Render

專案已包含 `render.yaml`，可直接連接 GitHub 後部署到 Render。

正式環境請在 Render Environment Variables 填入：

```text
BASE_URL=https://你的-render服務網址.onrender.com
LINE_CHANNEL_SECRET=你的 LINE Channel secret
LINE_CHANNEL_ACCESS_TOKEN=你的 LINE Channel access token
GEMINI_API_KEY=你的 Gemini API key
ADMIN_PIN=你的後台登入 PIN
```

Render 會使用：

```text
Build Command: npm install && npm run build
Start Command: npm start
Health Check: /health
Database: /tmp/hermes.sqlite for free testing, /var/data/hermes.sqlite with paid persistent disk
```

詳細步驟見 `docs/RENDER_DEPLOY.md`。

## LINE 使用方式

第一次使用，可先用對話式身份設定：

```text
我是學員 Amy
設定目標 2000 120 60 250
```

教練拿到 PIN 後可傳：

```text
我是教練 Coach PIN
```

也可以一次完成設定，兩位成員各自在 LINE 傳：

```text
設定 Jasper 2200 150 70 250
```

格式是：

```text
設定 姓名 每日熱量 蛋白質g 脂肪g 碳水g
```

常用指令：

```text
今日
剩餘
分析今日飲食
Hermes 今日
Hermes 剩餘
我的設定
身體資料 男 30 175 70
BMR 男 30 175 70
紀錄 雞胸飯 650 45 15 80
紀錄文字 一碗牛肉麵加滷蛋
刪除最後一筆
刪除上一張照片
重設設定
權限狀態
幫助
```

也可以用自然語言問飲食問題：

```text
我早餐吃了兩顆蛋、一杯豆漿和一顆饅頭，這樣夠營養嗎？
這碗牛肉麵可以算一餐嗎？
```

如果份量不清楚，bot 會先追問，例如「大碗還是小碗？」。

私聊可以直接傳餐點照片，bot 會估算並存入今天的紀錄。群組裡為了避免誤記，請先提及 bot：

```text
@營養分析機器人 紀錄下一張照片
```

接著 5 分鐘內傳下一張餐點照片，才會被記錄。

刪除錯誤紀錄：

```text
刪除最後一筆
刪除上一張照片
```

## 教練功能

教練功能不會出現在一般 `幫助` 裡。需要查看時可傳：

```text
教練幫助
```

成員先完成一般設定後，第一位傳以下指令的人會成為教練：

```text
設為教練
```

教練可用：

```text
教練成員
教練查看 Jasper
教練設定 Jasper 2200 150 70 250
教練重設 Jasper
```

最高權限帳號預設名稱是 `Jasper`。Jasper 可以用：

```text
最高權限幫助
設為最高權限 管理PIN
權限成員
產生教練PIN Coach 30天 20人
授權 學員 Amy 7天
授權 學員 Amy 30天
授權 學員 Amy 一年
授權 教練 Coach 30天 20人
授權 教練 Coach 一年 50人
授權 永久 Amy
停用 Amy
```

同一位教練再次使用 `產生教練PIN Coach 30天 20人` 時，會沿用原本 PIN 並延長期限，不會換一組新代碼。

教練拿到權限後，可以在自己的名額內授權學員：

```text
教練授權 Amy 7天
教練授權 Amy 30天
教練授權 Amy 一年
```

永久權限只有 Jasper 最高權限可以給予；教練不能給學員永久權限。

管理介面：

```text
https://你的網域/admin
```

管理 PIN 在 `.env` 的 `ADMIN_PIN`。

## BMR

使用 Mifflin-St Jeor 公式估算：

```text
身體資料 男/女 年齡 身高cm 體重kg
BMR 男/女 年齡 身高cm 體重kg
```

例：

```text
身體資料 男 30 175 70
```

## 開發工具：AI 額度監控（coding-usage-bar）

開發時可用 [coding-usage-bar](https://github.com/hanzhangzzz/coding-usage-bar) 在 macOS 選單列監控 Claude Code、Codex、GLM、DeepSeek、MiniMax、Kimi 的用量與剩餘額度。

這只是本機開發工具，不會加入 `dependencies` / `devDependencies`，也不影響 Render 部署（套件限定 macOS，放進依賴會讓 Linux 上的 `npm install` 失敗）。

需求：macOS、Node.js 20 以上、Homebrew（安裝時會自動裝 SwiftBar）。

```bash
npm run usage:install   # 安裝選單列外掛、launchd 排程與 CLI（~/.local/bin/coding-usage-bar）
npm run usage:doctor    # 檢查資料來源與選單列狀態
npm run usage:status    # 重新收集並顯示目前用量
```

- Claude Code 用量需透過 status line 取得，安裝時會詢問是否包裝既有的 status line。
- GLM / DeepSeek / MiniMax / Kimi 的 API key 設定在 `~/.coding-usage-bar/config.json`，不要放進本專案的 `.env`。
- 本專案使用的 Gemini API 不在它支援的範圍內。
- 移除：`coding-usage-bar uninstall`。

## 注意

圖片和文字分析是營養估算，不應取代醫師、營養師或醫療建議。若是特殊疾病、孕期、競賽備賽或嚴格飲食控制，請讓專業人員確認目標與紀錄方式。
