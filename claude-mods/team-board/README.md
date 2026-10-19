# team-board：像素吉祥物團隊協作面板

這是一個 Claude Code 的 mod。Claude 派出子代理或建立任務時，它會在右側打開「團隊協作」面板，顯示：

- 標題列：任務名稱、狀態、成員數、完成數
- 隊長卡片：皇冠吉祥物，加上「已派發 N 項任務給 M 名成員」
- 總進度：每個任務一段進度條（綠＝已交付、藍＝進行中、橘＝等待依賴、灰＝未開始）
- 成員時間軸：每位成員有頭像、名稱、角色、模型，以及任務標籤（t1、t2…）
- 任務依賴樹：由左到右分層，前一層完成才會解鎖下一層，卡片框線顏色代表狀態；寬度不夠時會換到下一排接續
- 任務詳情：目前進行中的任務、負責人、還在等哪些任務、完成後會解鎖哪些

![預覽](preview.png)

吉祥物的表情會跟著狀態變：待命是 `• •`，工作中眼睛會左右看，完成是 `^ ^`，失敗是 `x x`。

## 安裝

**雲端和手機（自動）**：這個 repo 的 `.claude/settings.json` 已經設定好。只要在這個 repo 開 Claude Code 雲端工作階段（網頁或手機 App），外掛就會自動安裝並載入，不用做任何事。

**你的電腦**：在 Claude Code 的輸入框輸入：

```
/plugin install team-board --marketplace tintin0831602-create/-
```

出現 `Add marketplace?` 時按 `y`，再選安裝範圍（直接 Enter 就是「所有專案都能用」）。repo 是私人的，所以你的電腦要能用 git 讀取 GitHub（例如先執行過 `gh auth login` 和 `gh auth setup-git`）。

## 使用方式

- `/agent-team`：打開面板（沒有其他外掛佔用 `/team` 時，`/team` 也可以用；例如裝了 oh-my-claudecode 就只有 `/agent-team`）
- `/agent-team demo`：填入示範資料，不用真的派出成員就能先看效果
- `/agent-team clear`：清空面板

Claude 派出子代理或建立任務時，面板會自己打開並即時更新。面板會停靠在右側，需要終端機至少約 110 欄寬；窄一點的話，它會改顯示在輸入框上方。

**開發時**直接從資料夾載入：`claude --plugin-dir 你的路徑/claude-mods/team-board`

## 顏色與 Terminal.app

Mac 內建的「終端機」(Terminal.app) 只支援 256 色。一般顏色在那裡會偏掉，例如橘色變粉紅、黑框變深藍。這個 mod 的所有顏色都事先換成 256 色裡最接近的那一格，所以在 Terminal.app 和支援全彩的終端機（iTerm2、Ghostty、kitty）上看起來一樣。

## 修改角色圖

三隻吉祥物都用同一個 12×14 的身體模板（照橘色、拿筆那隻畫的），只差顏色和頭上的配件：筆、芽、皇冠。模板、配色、表情都寫在 `tools/make_sprites.py` 裡，用字母畫像素，直接改就好：

```sh
pip install pillow
python3 tools/make_sprites.py      # 產生 hooks/sprites.ts，以及預覽圖 tools/build/family.png
```

`tools/process.py` 和 `tools/gen_ts.py` 是第一版的工具，會從 `tools/source-art/` 的 Gemini 原圖自動去背縮圖。圖縮到 12 格時會糊掉，所以改成手繪模板，這兩個工具留著當參考。
預覽圖顯示的是角色在 256 色下的實際樣子。
