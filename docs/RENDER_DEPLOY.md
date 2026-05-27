# Render 部署教學

這份專案可以放到 GitHub，再由 Render 自動部署。之後你在本地改完功能，只要推到 GitHub，Render 會自動更新雲端版本。

## 1. GitHub

先建立一個空的 GitHub repo，例如：

```text
nutrition-analysis
```

這個專案已經排除 `.env`、資料庫、log、暫存檔和大型 PNG 原始圖，不會把金鑰或本機資料推上去。

## 2. Render 建立 Web Service

到 Render 建立服務：

1. New → Web Service
2. Connect GitHub repository
3. 選這個專案
4. Render 會讀取 `render.yaml`
5. 第一次部署前，請填入下面的環境變數

## 3. Render 環境變數

請在 Render 的 Environment 設定：

```text
BASE_URL=https://你的-render服務網址.onrender.com
LINE_CHANNEL_SECRET=你的 LINE Channel secret
LINE_CHANNEL_ACCESS_TOKEN=你的 LINE Channel access token
GEMINI_API_KEY=你的 Gemini API key
ADMIN_PIN=你的後台登入 PIN
```

其他已在 `render.yaml` 預設：

```text
NODE_ENV=production
TIMEZONE=Asia/Taipei
DATABASE_PATH=/var/data/hermes.sqlite
OWNER_DISPLAY_NAME=Jasper
GEMINI_MODEL=gemini-3.5-flash
```

## 4. Persistent Disk

`render.yaml` 已經設定：

```text
mountPath=/var/data
sizeGB=1
```

這會讓 SQLite 資料庫保留在雲端，不會每次部署就消失。

## 5. LINE Webhook

部署成功後，把 LINE Developers 的 Webhook URL 改成：

```text
https://你的-render服務網址.onrender.com/webhook
```

並確認：

```text
Use webhook = Enabled
```

## 6. 本地修改後更新雲端

日後流程會是：

```bash
git add .
git commit -m "更新營養機器人"
git push
```

Render 看到 GitHub 更新後，會自動重新部署。
