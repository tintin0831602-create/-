import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { TeamBoard, TeamStatus } from '../types'
import { addTask, applyUpdate, createBoard, MODELS, setModel, summarize, type Outcome, type PlanInput, type TaskInput } from './team'
import { badgeCells, iconCells } from './sprite'
import { bandBlocks, paneBlocks, type Block, type Row } from './view'

const PANE = 'agent-team'
const PLAN = 'mcp__agent-teams__team_plan'
const UPDATE = 'mcp__agent-teams__team_update'
const ADD_TASK = 'mcp__agent-teams__team_add_task'
const SET_MODEL = 'mcp__agent-teams__team_set_model'
const STATUS = 'mcp__agent-teams__team_status'
const FRAME_MS = 300
const board = atom({ plugin: 'agent-teams', key: 'board' } as const, null)
// Boards are also kept in $.store per session id, so --continue/--resume brings the team back.
const STORE_PREFIX = 'board:'
const KEPT_BOARDS = 20
const frame = atom({ plugin: 'agent-teams', key: 'frame' } as const, 0)

const PROTOCOL = `你是一個 agent 團隊的隊長。使用者的目標：

{GOAL}

流程（全程用繁體中文回覆）：
1. 呼叫 ${PLAN}：2-6 位成員（name、role、model）和任務（id、subject、assignee、deps）。互相獨立的任務不要設相依，才能並行。
   模型選擇：${MODELS.join(' / ')}。簡單查找用 haiku、一般實作用 sonnet、架構與審查用 opus、最難的推理用 fable。
2. 用繁體中文向使用者列出成員（含模型）、任務與相依，然後用 AskUserQuestion 問：「開始執行」「調整模型」「增加步驟」。
   調整模型就呼叫 ${SET_MODEL}，增加步驟就呼叫 ${ADD_TASK}，改完再問一次，直到使用者選「開始執行」。
3. 每個可開始的任務：先呼叫 ${UPDATE} 設為 in_progress，再用 Agent 工具執行（每個任務一個子 agent，多個任務在同一則訊息中並行；model 參數用該成員的模型），並把任務內容、成員角色、相依任務的輸出交給它。
4. 子 agent 回來後，呼叫 ${UPDATE} 設為 completed 並附上簡短 output；失敗就設為 failed。失敗的任務可以用 status "pending" 重跑（會累計重跑次數）。
5. 呼叫 ${STATUS} 看哪些任務變成可開始，重複步驟 3-4 直到全部結束。
6. 最後用繁體中文給出整合報告。不要自己替成員做事。`

const text = (result: string) => ({ result })
const NO_TEAM = { deny: '還沒有團隊：請先呼叫 team_plan。' }

type Elements = ReturnType<Engine['ui']['resolve']>
type TextElement = Elements['Text']
type BoxElement = Elements['Box']
type RasterElement = Extract<Elements, { Raster: unknown }>['Raster']

/** One view row as nested Text: the row is a line, each segment a styled run. */
const lineOf = (Text: TextElement, row: Row, isTruncated = false) => (
  <Text key={row.key} wrap={isTruncated ? 'truncate-end' : undefined}>
    {row.segs.map((seg, i) => (
      <Text key={String(i)} color={seg.color} dimColor={seg.dim} bold={seg.bold}>
        {seg.text}
      </Text>
    ))}
  </Text>
)

/** A block of rows; with an icon it sits beside its mascot, where the surface can draw one. */
const blockOf = (Box: BoxElement, Text: TextElement, Raster: RasterElement | undefined, block: Block) => {
  // A card's text is cut to its width, so a long role cannot make the card taller than counted.
  const lines = block.rows.map(row => lineOf(Text, row, block.icon !== undefined))
  if (!block.icon || !Raster) return <Box key={block.key} flexDirection="column">{lines}</Box>

  const icon = iconCells(block.icon)
  const badge = block.badge ? badgeCells(block.badge) : undefined

  return (
    <Box key={block.key} flexDirection="row" alignItems="center" columnGap={1}>
      <Raster key={`icon-${block.key}`} columns={icon.columns} rows={icon.rows} cells={icon.cells} />
      <Box flexDirection="column">
        {badge && <Raster key={`badge-${block.key}`} columns={badge.columns} rows={badge.rows} cells={badge.cells} />}
        {lines}
      </Box>
    </Box>
  )
}

/** Writes the board to session state, then keeps a copy in the store (best effort: the team works without it). */
async function save($: Engine, team: TeamBoard) {
  await update($, board, () => team)
  try {
    const key = `${STORE_PREFIX}${await $.session.id()}`
    await $.store.delete(key) // re-inserted last, so insertion order is recency
    await $.store.set(key, team)
    const stored = (await $.store.keys()).filter(k => k.startsWith(STORE_PREFIX))
    await Promise.all(stored.slice(0, -KEPT_BOARDS).map(k => $.store.delete(k)))
  } catch {
    $.ui.toast('團隊進度未能保存：接續對話後可能看不到這個團隊。')
  }
}

/** On a resumed session the state is empty: bring back the board this session id saved. */
async function restore($: Engine) {
  try {
    if ((await read($, board)) !== null) return
    const saved = await $.store.get(`${STORE_PREFIX}${await $.session.id()}`)
    if (saved) await update($, board, () => saved as TeamBoard)
  } catch {
    // Nothing to bring back: the session starts with no team, as it would without the store.
  }
}

/** Shared body of the tools that change a live team: read, transform, write, report. */
async function mutate($: Engine, run: (team: TeamBoard) => Outcome) {
  const team = await read($, board)
  if (team === null) return NO_TEAM

  const changed = run(team)
  if ('error' in changed) return { deny: changed.error }

  await save($, changed.board)

  return text(summarize(changed.board))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const task = {
      type: 'object',
      required: ['id', 'subject'],
      properties: {
        id: { type: 'string' },
        subject: { type: 'string' },
        assignee: { type: 'string', description: '成員名稱' },
        deps: { type: 'array', items: { type: 'string' }, description: '必須先完成的任務 id' },
      },
    }
    await $.tool.register({
      name: 'team_plan',
      description: '為目前的目標建立 agent 團隊：成員（含模型）與有相依關係的任務。會取代舊團隊。',
      inputSchema: {
        type: 'object',
        required: ['goal', 'members', 'tasks'],
        properties: {
          goal: { type: 'string' },
          members: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'role'],
              properties: { name: { type: 'string' }, role: { type: 'string' }, model: { type: 'string', enum: [...MODELS] } },
            },
          },
          tasks: { type: 'array', items: task },
        },
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'team_update',
      description: '更新任務：in_progress（相依都完成才行）→ completed/failed（附 output）；failed 可用 pending 重跑；cancelled 放棄。',
      inputSchema: {
        type: 'object',
        required: ['id', 'status'],
        properties: {
          id: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed', 'cancelled'] },
          output: { type: 'string' },
        },
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'team_add_task',
      description: '在現有團隊中增加一個步驟（任務）。',
      inputSchema: task,
      isDeferred: false,
    })
    await $.tool.register({
      name: 'team_set_model',
      description: '更換某位成員使用的模型，之後開始的任務會用新模型。',
      inputSchema: {
        type: 'object',
        required: ['member', 'model'],
        properties: { member: { type: 'string' }, model: { type: 'string', enum: [...MODELS] } },
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'team_status',
      description: '顯示團隊進度與現在可以開始的任務。',
      inputSchema: { type: 'object', properties: {} },
      isDeferred: false,
    })
    await $.command.register({
      name: 'agent-teams',
      description: '用 agent 團隊完成目標（/agent-teams <目標>），不帶目標則開啟團隊面板',
      argumentHint: '<目標>',
    })

    await restore($)

    // Spinner: only redraws while a task runs, so an idle team costs nothing.
    $.clock.every(FRAME_MS, async () => {
      const team = await read($, board)
      if (team?.tasks.some(t => t.status === 'in_progress')) await update($, frame, n => (n ?? 0) + 1)
    })

    return next(e)
  })

  on('command.run', { command: 'agent-teams' }, async ($, e) => {
    const goal = String(e.args ?? '').trim()
    await $.ui.open({ id: PANE, title: '團隊進度' })
    if (goal === '') return { text: '已開啟團隊面板。用 /agent-teams <目標> 開始。' }

    void $.prompt.submit({ text: PROTOCOL.replace('{GOAL}', goal) })

    return { text: `開始規劃團隊：${goal}` }
  })

  on('tool.call', { tool: PLAN }, async ($, e) => {
    const planned = createBoard(e as unknown as PlanInput)
    if ('error' in planned) return { deny: planned.error }

    await save($, planned.board)
    await update($, frame, () => 0)
    // Best effort: the board is saved either way and /agent-teams opens the pane again.
    void $.ui.open({ id: PANE, title: '團隊進度' }).catch(() => undefined)

    return text(summarize(planned.board))
  })

  on('tool.call', { tool: UPDATE }, ($, e) => mutate($, team => applyUpdate(team, e.id, e.status, e.output)))
  on('tool.call', { tool: ADD_TASK }, ($, e) => mutate($, team => addTask(team, e as unknown as TaskInput)))
  on('tool.call', { tool: SET_MODEL }, ($, e) => mutate($, team => setModel(team, e.member, e.model)))

  on('tool.call', { tool: STATUS }, async $ => {
    const team = await read($, board)

    return team === null ? NO_TEAM : text(summarize(team))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const team = await read($, board)
    if (team === null || e.props.hasSurvey) return next(e)

    const els = $.ui.resolve(e)
    const tick = await read($, frame)

    return (
      <els.Box flexDirection="column">
        {bandBlocks(team, tick).map(block => blockOf(els.Box, els.Text, undefined, block))}
      </els.Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const team = await read($, board)

    if (team === null) return <els.Text dimColor>還沒有團隊。輸入 /agent-teams {'<目標>'} 開始。</els.Text>

    const tick = await read($, frame)
    const space = { columns: e.props.bodyColumns ?? 40 }
    const Raster = 'Raster' in els ? els.Raster : undefined

    return (
      <els.Box flexDirection="column">
        {paneBlocks(team, tick, space).map(block => blockOf(els.Box, els.Text, Raster, block))}
      </els.Box>
    )
  })
}
