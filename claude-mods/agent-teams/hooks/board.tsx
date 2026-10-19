import type { EngineInterface as Engine } from 'claude-code'

import type { TeamBoard, TeamStatus } from '../types'
import { PALETTE_KEYS, SPRITES } from './mascots'
import type { Face, Skin } from './mascots'
import { currentStage, reruns } from './team'

// The pane: a leader card, a segmented progress bar, a member timeline with a
// pixel mascot each, and the task dependency tree. It draws a View, which a
// planned team (team_plan) or the subagents and tasks seen without one map to.

export type MemberStatus = 'pending' | 'running' | 'waiting' | 'idle' | 'completed' | 'failed' | 'killed'
export type ViewMember = { key: string; name: string; role: string; model?: string; status: MemberStatus }
export type ViewTask = {
  id: string
  subject: string
  status: TeamStatus
  /** The key of the member doing it. */
  owner?: string
  blockedBy: string[]
  output?: string
}
export type View = {
  title: string
  members: ViewMember[]
  tasks: ViewTask[]
  /** A planned team's stage and reruns; absent for subagents seen without one. */
  stage?: { index: number; total: number }
  reruns?: number
}

// Text, dim text and lines take the theme's own colors, so the pane reads in
// light and dark themes alike. The rest sit on xterm-256 cells, so Terminal.app
// (no 24-bit color) shows what a truecolor terminal does, in mid-tones that
// read on both.
const C = {
  text: 'text',
  dim: 'inactive',
  green: '#4caf4c',
  blue: '#4c7fff',
  orange: '#d77f00',
  red: '#ff4c4c',
  gray: '#767676',
  track: 'subtle',
  chipText: '#121212',
  chipBg: '#3a3a3a',
  chipLabel: '#bcbcbc',
}

const MEMBER_LABEL: Record<MemberStatus, { text: string; color: string }> = {
  pending: { text: '準備中', color: C.gray },
  running: { text: '執行中', color: C.blue },
  waiting: { text: '等待中', color: C.orange },
  idle: { text: '待命', color: C.gray },
  completed: { text: '已交付', color: C.green },
  failed: { text: '失敗', color: C.red },
  killed: { text: '已停止', color: C.red },
}

export const isDone = (s: MemberStatus) => s === 'completed' || s === 'failed' || s === 'killed'

export type TaskState = 'done' | 'active' | 'blocked' | 'todo' | 'failed' | 'cancelled'

export function taskState(task: ViewTask, all: ViewTask[]): TaskState {
  if (task.status === 'completed') return 'done'
  if (task.status === 'in_progress') return 'active'
  if (task.status === 'failed') return 'failed'
  if (task.status === 'cancelled') return 'cancelled'
  const open = task.blockedBy.some(id => all.find(t => t.id === id)?.status !== 'completed')
  return open ? 'blocked' : 'todo'
}

const TASK_COLOR: Record<TaskState, string> = {
  done: C.green,
  active: C.blue,
  blocked: C.orange,
  todo: C.gray,
  failed: C.red,
  cancelled: C.gray,
}
const TASK_LABEL: Record<TaskState, string> = {
  done: '已完成',
  active: '進行中',
  blocked: '等待依賴',
  todo: '未開始',
  failed: '失敗',
  cancelled: '已取消',
}

// A task's column in the dependency tree: 0 with no blockers, else one past
// its deepest blocker. A cycle or a missing blocker counts as column 0.
export function taskDepths(all: ViewTask[]): Map<string, number> {
  const depth = new Map<string, number>()
  const visit = (id: string, seen: Set<string>): number => {
    const known = depth.get(id)
    if (known !== undefined) return known
    const task = all.find(t => t.id === id)
    if (!task || seen.has(id)) return 0
    seen.add(id)
    const d = task.blockedBy.filter(b => all.some(t => t.id === b)).reduce((max, b) => Math.max(max, visit(b, seen) + 1), 0)
    seen.delete(id)
    depth.set(id, d)
    return d
  }
  for (const t of all) visit(t.id, new Set())
  return depth
}

// Terminal cells a string takes: CJK and full-width forms take two.
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/
export const cells = (text: string) => [...text].reduce((n, ch) => n + (WIDE.test(ch) ? 2 : 1), 0)

// Breaks `text` into at most `lines` lines of `width` cells, the last cut with an ellipsis.
export function wrapCells(text: string, width: number, lines: number): string[] {
  const out: string[] = []
  let line = ''
  for (const ch of text) {
    if (cells(line + ch) > width) {
      out.push(line)
      line = ''
      if (out.length === lines) break
    }
    line += ch
  }
  if (out.length < lines && line) out.push(line)
  if (cells(out.join('')) < cells(text)) {
    let last = out[lines - 1] ?? ''
    while (last && cells(last + '…') > width) last = [...last].slice(0, -1).join('')
    out[lines - 1] = last + '…'
  }
  return out
}

const clip = (text: string, max: number) => wrapCells(text, Math.max(2, max), 1)[0] ?? ''

export function faceFor(status: MemberStatus, frame: number): Face {
  if (status === 'completed') return 'happy'
  if (status === 'failed' || status === 'killed') return 'dead'
  if (status === 'running') return frame % 2 === 0 ? 'work' : 'think'
  return 'idle'
}

// Two pixel rows per terminal row. Terminal.app leaves a gap above and below
// each row that a glyph never paints and a cell's background does, so the
// background picks what each gap shows. A gap inside the sprite takes the
// lighter of the pixels on its two sides, never a dark line through the body;
// a gap at the sprite's edge takes the edge pixel, so the outline stays solid.
// A cell of one color paints it as a full block over a background of its
// neighbor's color when that hides the gaps better (an eye in the body); a
// lone half block, gaps left clear, only where one pixel is empty.
export function spriteLines(skin: Skin, face: Face) {
  const { palette, frames } = SPRITES[skin]
  const rows = frames[face]
  const px = (y: number, x: number) => {
    const ch = rows[y]?.[x]
    return ch === undefined || ch === '.' ? undefined : palette[PALETTE_KEYS.indexOf(ch)]
  }
  const luma = (hex: string) => {
    const n = parseInt(hex.slice(1), 16)
    return 0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)
  }
  // What a gap colored `fill` costs, between this cell's pixel `near` and the
  // pixel `across` the gap: nothing when it matches both, a little when it
  // matches one, more when that one is the outline beside a lighter pixel or,
  // at the edge, a color other than the edge pixel, most a color of neither
  // side inside the sprite.
  const gap = (fill: string, near: string, across: string | undefined) => {
    if (across === undefined) return fill === near ? 0 : 4
    if (fill === near && fill === across) return 0
    if (fill !== near && fill !== across) return 6
    // Matching one side costs little, unless the fill is outline-dark: then it
    // is a dark line along a lighter pixel.
    const other = fill === near ? across : near
    return luma(fill) < 40 && luma(other) >= 40 ? 3 : 1
  }
  type Run = { ch: string; fg?: string; bg?: string }
  const lines: Run[][] = []
  for (let y = 0; y < rows.length; y += 2) {
    const runs: Run[] = []
    for (let x = 0; x < (rows[y]?.length ?? 0); x++) {
      const top = px(y, x)
      const bottom = px(y + 1, x)
      let cell: Run
      if (top && bottom) {
        const above = px(y - 1, x)
        const below = px(y + 2, x)
        const cost = (fill: string) => gap(fill, top, above) + gap(fill, bottom, below)
        const best = (options: string[]) => options.reduce((a, b) => (cost(b) < cost(a) ? b : a))
        if (top === bottom) {
          const fill = best([top, ...(above ? [above] : []), ...(below ? [below] : [])])
          cell = fill === top ? { ch: ' ', bg: top } : { ch: '█', fg: top, bg: fill }
        } else {
          const fill = best([top, bottom])
          cell = fill === bottom ? { ch: '▀', fg: top, bg: bottom } : { ch: '▄', fg: bottom, bg: top }
        }
      } else if (top) cell = { ch: '▀', fg: top }
      else if (bottom) cell = { ch: '▄', fg: bottom }
      else cell = { ch: ' ' }
      const last = runs[runs.length - 1]
      if (last && last.fg === cell.fg && last.bg === cell.bg && last.ch[0] === cell.ch) last.ch += cell.ch
      else runs.push(cell)
    }
    lines.push(runs)
  }
  return lines
}

const SPRITE_W = 12
const SPRITE_ROWS = 6

/** A member's mascot: sonnet the pencil, opus and fable the crown, the rest the sprout. */
export const skinOf = (model: string | undefined): Skin =>
  model === 'sonnet' ? 'pencil' : model === 'opus' || model === 'fable' ? 'crown' : 'sprout'

/** What a planned member is doing, from the tasks assigned to it. */
function memberStatusOf(board: TeamBoard, name: string): MemberStatus {
  const mine = board.tasks.filter(t => t.assignee === name)
  if (mine.some(t => t.status === 'in_progress')) return 'running'
  if (mine.some(t => t.status === 'failed')) return 'failed'
  if (mine.length > 0 && mine.every(t => t.status === 'completed' || t.status === 'cancelled')) return 'completed'
  return mine.length > 0 ? 'pending' : 'idle'
}

/** The view of a planned team. */
export function viewOfBoard(board: TeamBoard): View {
  return {
    title: board.goal,
    members: board.members.map(m => ({
      key: m.name,
      name: m.name,
      role: m.role,
      model: m.model,
      status: memberStatusOf(board, m.name),
    })),
    tasks: board.tasks.map(t => ({
      id: t.id,
      subject: t.subject,
      status: t.status,
      owner: t.assignee,
      blockedBy: t.deps,
      output: t.output,
    })),
    stage: currentStage(board),
    reruns: reruns(board),
  }
}

type Elements = ReturnType<Engine['ui']['resolve']>

/** Draws the pane for `view` into `width` columns; `frame` animates the mascots at work. */
export function teamPane(els: Elements, view: View, frame: number, width: number) {
  const { Box, Text } = els
  const ms = view.members
  const ts = view.tasks
  const memberOf = (t: ViewTask) => ms.find(m => m.key === t.owner)

  const Sprite = ({ skin, face }: { skin: Skin; face: Face }) => (
    <Box flexDirection="column" width={SPRITE_W} flexShrink={0}>
      {spriteLines(skin, face).map(runs => (
        <Text color={C.text}>
          {runs.map(r => (
            <Text color={r.fg} backgroundColor={r.bg}>
              {r.ch}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  )

  const Chip = ({ text, color, bg }: { text: string; color?: string; bg: string }) => (
    <Text color={color ?? C.chipText} backgroundColor={bg} bold>
      {` ${text} `}
    </Text>
  )

  // Progress: one segment per task, or per member while there are no tasks.
  const units = ts.length
    ? ts.map(t => TASK_COLOR[taskState(t, ts)])
    : ms.map(m => (m.status === 'completed' ? C.green : isDone(m.status) ? C.red : m.status === 'running' ? C.blue : C.gray))
  const states = ts.map(t => taskState(t, ts))
  const counts = {
    active: states.filter(s => s === 'active').length,
    blocked: states.filter(s => s === 'blocked').length,
    done: states.filter(s => s === 'done').length,
    failed: states.filter(s => s === 'failed').length,
  }
  const allDone = units.length > 0 && units.every(c => c === C.green)
  const finished = ts.length
    ? states.every(s => s === 'done' || s === 'failed' || s === 'cancelled')
    : ms.length > 0 && ms.every(m => isDone(m.status))
  const barWidth = width - 1
  const gap = units.length > 1 && barWidth / units.length >= 3 ? 1 : 0
  const seg = units.length ? Math.max(1, Math.floor((barWidth - gap * (units.length - 1)) / units.length)) : 0

  const leaderFace: Face = allDone ? 'happy' : ms.some(m => m.status === 'running') ? faceFor('running', frame) : 'idle'
  const infoWidth = Math.max(10, width - SPRITE_W - 4)
  const meta = [
    ...(view.stage ? [`第 ${view.stage.index}/${view.stage.total} 階段`] : []),
    ...(view.reruns !== undefined ? [`重跑 ${view.reruns} 次`] : []),
  ].join(' · ')

  // The dependency tree: one column per depth, left to right, a column
  // unlocking once those before it are done. Columns that do not fit the
  // pane's width continue in a band below.
  function TaskTree() {
    const depth = taskDepths(ts)
    const levels = Math.max(...ts.map(t => depth.get(t.id) ?? 0)) + 1
    const columns = Array.from({ length: levels }, (_, d) => ts.filter(t => (depth.get(t.id) ?? 0) === d))
    const link = 3
    const perBand = Math.max(1, Math.min(levels, Math.floor((width + link) / (22 + link))))
    const cardW = Math.min(34, Math.floor((width - link * (perBand - 1)) / perBand))
    const bands = Array.from({ length: Math.ceil(levels / perBand) }, (_, b) => columns.slice(b * perBand, (b + 1) * perBand))
    const blocks = (t: ViewTask) => ts.filter(o => o.blockedBy.includes(t.id))
    const focus =
      ts.find(t => taskState(t, ts) === 'active') ??
      ts.find(t => taskState(t, ts) === 'todo') ??
      ts.find(t => taskState(t, ts) === 'blocked') ??
      ts[ts.length - 1]

    const Card = ({ task }: { task: ViewTask }) => {
      const state = taskState(task, ts)
      const color = TASK_COLOR[state]
      const inner = cardW - 4
      const owner = memberOf(task)?.name ?? task.owner ?? '未指派'
      const subject = wrapCells(task.subject, inner, 2)
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={cardW} flexShrink={0}>
          <Box justifyContent="space-between">
            <Text color={color} bold>
              ● {task.id}
            </Text>
            <Text color={C.dim}>{clip(owner, inner - cells(`● ${task.id}`) - 1)}</Text>
          </Box>
          <Text color={C.text}>{subject[0] ?? ''}</Text>
          <Text color={C.text}>{subject[1] ?? ' '}</Text>
        </Box>
      )
    }

    const focusState = focus && taskState(focus, ts)
    const focusOwner = focus && memberOf(focus)
    const waitingOn = focus ? focus.blockedBy.filter(id => ts.find(t => t.id === id)?.status !== 'completed') : []
    const unlocks = focus ? blocks(focus) : []

    return (
      <Box flexDirection="column" marginTop={1}>
        <Box justifyContent="space-between">
          <Text color={C.text} bold>▾ 任務依賴</Text>
          <Text color={C.dim}>從左到右：前置完成後解鎖</Text>
        </Box>
        {bands.map((band, b) => (
          <Box flexDirection="column" marginTop={1}>
            {b > 0 && <Text color={C.dim}>↓ 接續第 {b * perBand + 1} 層</Text>}
            <Box>
              {band.map((column, i) => (
                <Box>
                  {i > 0 && (
                    <Box flexDirection="column" width={link} flexShrink={0}>
                      <Text color={C.text}> </Text>
                      <Text color={C.gray}>─▶ </Text>
                    </Box>
                  )}
                  <Box flexDirection="column">
                    {column.map(task => (
                      <Card task={task} />
                    ))}
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        ))}

        {focus && focusState && (
          <Box flexDirection="column" borderStyle="round" borderColor={C.track} paddingX={1} marginTop={1}>
            <Box gap={1}>
              <Text color={TASK_COLOR[focusState]} bold>
                {focus.id}
              </Text>
              <Text color={C.text} bold wrap="truncate-end">
                {clip(focus.subject, width - 18)}
              </Text>
              <Chip text={TASK_LABEL[focusState]} bg={TASK_COLOR[focusState]} />
            </Box>
            <Text color={C.dim}>
              {focusOwner ? `${focusOwner.name}${focusOwner.model ? ` · ${focusOwner.model}` : ''}` : `負責人：${focus.owner ?? '未指派'}`}
            </Text>
            {waitingOn.length > 0 && <Text color={C.orange}>等待 {waitingOn.join('、')} 完成</Text>}
            {focus.output && (
              <Text color={C.text} wrap="truncate-end">
                {clip(`輸出：${focus.output}`, width - 4)}
              </Text>
            )}
            <Text color={C.dim}>{unlocks.length ? `完成後解鎖 ${unlocks.map(t => t.id).join('、')}` : '完成後沒有待解鎖的任務'}</Text>
          </Box>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" width={width}>
      <Box justifyContent="space-between">
        <Text color={C.text} bold wrap="truncate-end">
          {clip(view.title || '團隊協作', Math.max(8, width - 26))}
        </Text>
        <Box gap={1} flexShrink={0}>
          <Chip text={finished ? '已結束' : ms.length ? '進行中' : '待命'} bg={finished ? C.chipBg : C.blue} color={finished ? C.chipLabel : C.chipText} />
          <Text color={C.dim}>{ms.length} 名成員</Text>
          {ts.length > 0 && (
            <Text color={C.dim}>
              {counts.done}/{ts.length} 完成
            </Text>
          )}
        </Box>
      </Box>
      {meta && <Text color={C.dim}>{meta}</Text>}

      <Box borderStyle="round" borderColor={C.track} marginTop={1}>
        <Sprite skin="crown" face={leaderFace} />
        <Box flexDirection="column" marginLeft={2} flexGrow={1} justifyContent="center">
          <Text color={C.text}>
            <Text color={C.text} bold>
              隊長
            </Text>
            <Text color={C.dim}> 拆解 · 派發 · 匯總</Text>
          </Text>
          <Text color={C.text} wrap="truncate-end">
            {ms.length === 0
              ? '還沒有團隊。輸入 /agent-teams <目標> 開始。'
              : `已派發 ${ts.length || ms.length} 項任務給 ${ms.length} 名成員`}
          </Text>
          {finished && <Text color={C.green}>已收齊</Text>}
        </Box>
      </Box>

      {units.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={C.text} bold>
            總進度
          </Text>
          <Text color={C.text}>
            {units.map((color, i) => (
              <Text color={color}>{'━'.repeat(seg) + (gap && i < units.length - 1 ? ' ' : '')}</Text>
            ))}
          </Text>
          {ts.length > 0 && (
            <Text color={C.text}>
              <Text color={C.blue}>■ 進行中 {counts.active}</Text>
              <Text color={C.text}>{'  '}</Text>
              <Text color={C.orange}>■ 等待依賴 {counts.blocked}</Text>
              <Text color={C.text}>{'  '}</Text>
              <Text color={C.green}>■ 已交付 {counts.done}</Text>
              {counts.failed > 0 && <Text color={C.red}>{`  ■ 失敗 ${counts.failed}`}</Text>}
            </Text>
          )}
          {allDone && (
            <Box marginTop={1}>
              <Text color={C.green} bold>
                {` ● 全部 ${units.length} 項${ts.length ? '任務' : '成員工作'}已交付 `}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {ms.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={C.text} bold>
            ▾ {ms.length} 名成員
          </Text>
          {ms.map((m, i) => {
            const own = ts.filter(t => t.owner === m.key)
            const label = MEMBER_LABEL[m.status]
            const isLast = i === ms.length - 1
            return (
              <Box marginTop={1}>
                <Box flexDirection="column" width={2} flexShrink={0}>
                  {Array.from({ length: SPRITE_ROWS }, (_, row) => (
                    <Text color={row === 3 ? label.color : C.track}>{row === 3 ? '●' : isLast && row > 3 ? ' ' : '│'}</Text>
                  ))}
                </Box>
                <Sprite skin={skinOf(m.model)} face={faceFor(m.status, frame + i)} />
                <Box flexDirection="column" marginLeft={2} width={infoWidth}>
                  <Box justifyContent="space-between">
                    <Text color={C.text} bold wrap="truncate-end">
                      {clip(m.name, infoWidth - 10)}
                    </Text>
                    <Text color={label.color}>{label.text}</Text>
                  </Box>
                  <Text color={C.dim} wrap="truncate-end">
                    {clip(m.role, infoWidth)}
                  </Text>
                  <Box justifyContent="space-between">
                    <Chip text={m.model ?? '預設模型'} bg={C.chipBg} color={C.chipLabel} />
                    {own.length > 0 && (
                      <Text color={C.dim}>
                        {own.filter(t => t.status === 'completed').length}/{own.length}
                      </Text>
                    )}
                  </Box>
                  {own.length > 0 && (
                    <Box flexWrap="wrap" columnGap={1}>
                      <Text color={C.dim}>隊長派發</Text>
                      {own.map(t => (
                        <Chip text={t.id} bg={TASK_COLOR[taskState(t, ts)]} />
                      ))}
                    </Box>
                  )}
                </Box>
              </Box>
            )
          })}
        </Box>
      )}

      {ts.length > 0 && <TaskTree />}
    </Box>
  )
}
