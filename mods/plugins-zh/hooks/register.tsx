import type { Register } from 'claude-code'

const PANE = 'plugins-zh'
const TITLE = '外掛中文說明'

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: '連接器（連到外部服務）',
    items: [
      ['Canva', '做海報、社群圖、簡報設計'],
      ['Figma', '設計網頁或 App 畫面'],
      ['Google Drive', '讀取、建立、分享雲端硬碟檔案'],
      ['Google Sheets', '讀寫 Google 試算表'],
      ['GitHub', '管理程式碼、PR、議題'],
      ['Claude Docs', '建立可以一起編輯的文件'],
      ['Cloudflare', '管理網站主機、資料庫、儲存空間'],
      ['SlickTrip', '查機票、飯店價格，設定降價通知'],
      ['PubMed', '搜尋醫學研究論文'],
      ['Clinical Trials', '查詢臨床試驗資料'],
      ['NPI Registry', '查詢美國醫療人員登記資料'],
      ['Economic Index', 'Anthropic 的 AI 使用統計資料'],
    ],
  },
  {
    title: '外掛（技能包）',
    items: [
      ['coach', '健身教練：排課表、記錄訓練、營養建議'],
      ['fitness-video', '健身影片相關工具'],
      ['sales', '業務：客戶研究、寫開發信、管理商機'],
      ['marketing', '行銷：寫文案、規劃活動、SEO 檢查'],
      ['product-management', '產品管理：寫規格、排時程、整理回饋'],
      ['engineering', '工程：檢查程式、除錯、寫技術文件'],
      ['design', '設計：設計評論、使用者研究、介面文字'],
      ['data', '資料：分析數據、做圖表、寫查詢'],
      ['finance', '財務：記帳分錄、對帳、財報'],
      ['legal', '法務：審合約、保密協議、合規檢查'],
      ['operations', '營運：流程文件、風險評估、狀態報告'],
      ['frontend-design', '做漂亮的網頁畫面'],
      ['figma', '把 Figma 設計轉成程式'],
      ['postiz', '排程發社群貼文'],
      ['youtube-transcriber', '把 YouTube 影片轉成文字稿'],
      ['tubealfred-youtube', 'YouTube 頻道、影片、留言分析'],
      ['pdf-viewer', '開啟 PDF、標註、填表單、簽名'],
      ['anthropic-skills', '做 Word、Excel、PPT、PDF 檔案'],
      ['cowork-plugin-management', '建立或修改自己的外掛'],
    ],
  },
  {
    title: '常見英文字',
    items: [
      ['Install / Uninstall', '安裝 / 移除'],
      ['Enable / Disable', '開啟 / 關閉'],
      ['Connect / Disconnect', '連接 / 中斷連接'],
      ['Marketplace', '外掛商店'],
      ['Connector', '連接器'],
      ['Skill', '技能'],
      ['Authenticate / Sign in', '授權 / 登入'],
      ['Failed to connect', '連線失敗'],
    ],
  },
]

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'plugins-zh', description: '開啟外掛中文說明面板' })
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'plugins-zh' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: '已開啟外掛中文說明。' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {GROUPS.map(group => (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold>{group.title}</Text>
            {group.items.map(([name, desc]) => (
              <Text>
                <Text color="cyan">{name}</Text> → {desc}
              </Text>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
