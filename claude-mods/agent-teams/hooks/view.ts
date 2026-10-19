import type { TeamBoard, TeamMember, TeamTask } from '../types'
import { badgeFor, iconColumns, type BadgeName, type IconSize, type IconSpec, type SpriteState } from './sprite'
import { GLYPH, modelColor, SPINNER, STATUS_COLOR } from './style'
import { currentStage, modelOf, readyTasks, reruns, stagesOf, treeRows } from './team'

export type Seg = { text: string; color?: string; dim?: boolean; bold?: boolean }
export type Row = { key: string; segs: Seg[] }
/** A group of rows; with an icon, the rows (under the badge, if any) are drawn beside that mascot. */
export type Block = { key: string; icon?: IconSpec; badge?: BadgeName; rows: Row[] }
/** The width the pane draws into, in terminal cells. */
export type Space = { columns: number }

const MEMBER_TEXT_COLUMNS = 26

const spin = (tick: number) => SPINNER[tick % SPINNER.length] ?? '·'
const taskGlyph = (t: TeamTask, tick: number) => (t.status === 'in_progress' ? spin(tick) : GLYPH[t.status])
const attemptNote = (t: TeamTask) => (t.attempts > 1 ? ` · 第 ${t.attempts} 次` : '')
const bar = (done: number, total: number, width: number) => {
  const filled = Math.round((done / Math.max(1, total)) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}
const count = (board: TeamBoard, status: TeamTask['status']) => board.tasks.filter(t => t.status === status).length
const plain = (key: string, ...segs: Seg[]): Block => ({ key, rows: [{ key, segs }] })
const heading = (key: string, text: string): Block => plain(key, { text: `── ${text} ──`, bold: true })

/** What a member's mascot is doing: hopping while it works, otherwise by how its tasks ended. */
export function memberState(board: TeamBoard, member: TeamMember, tick: number): SpriteState {
  const mine = board.tasks.filter(t => t.assignee === member.name)
  if (mine.some(t => t.status === 'in_progress')) return tick % 2 === 0 ? 'workA' : 'workB'
  if (mine.some(t => t.status === 'failed')) return 'fail'
  if (mine.length > 0 && mine.every(t => t.status === 'completed')) return 'done'
  return 'idle'
}

function taskSegs(board: TeamBoard, t: TeamTask, tick: number, bold = false): Seg[] {
  return [
    { text: `${taskGlyph(t, tick)} `, color: STATUS_COLOR[t.status] },
    { text: `${t.id} ${t.subject}`, bold, dim: t.status === 'pending' || t.status === 'cancelled' },
    ...(t.assignee ? [{ text: ` [${t.assignee}]`, color: modelColor(modelOf(board, t)) }] : []),
    { text: attemptNote(t), dim: true },
  ]
}

function headerBlocks(board: TeamBoard, width: number): Block[] {
  const done = count(board, 'completed')
  const stage = currentStage(board)
  return [
    plain('goal', { text: board.goal, bold: true }),
    plain(
      'bar',
      { text: bar(done, board.tasks.length, width), color: 'green' },
      { text: ` ${done}/${board.tasks.length} · 第 ${stage.index}/${stage.total} 階段 · 重跑 ${reruns(board)} 次`, dim: true },
    ),
  ]
}

/** One card per member, stacked top to bottom: the mascot of its model beside its name, model and what it is doing. */
function memberBlocks(board: TeamBoard, tick: number, size: IconSize): Block[] {
  return board.members.map(m => {
    const state = memberState(board, m, tick)
    const running = board.tasks.filter(t => t.assignee === m.name && t.status === 'in_progress')
    const status: Seg[] =
      running.length > 0
        ? [{ text: `${spin(tick)} 正在做 ${running.map(t => `${t.id}${attemptNote(t)}`).join('、')}`, color: 'yellow' }]
        : state === 'done'
          ? [{ text: '✔ 任務都完成了', color: 'green' }]
          : state === 'fail'
            ? [{ text: '✗ 有任務失敗', color: 'red' }]
            : [{ text: '待命', dim: true }]
    return {
      key: `m-${m.name}`,
      icon: { model: m.model, state, size },
      badge: badgeFor(m.name, m.role),
      rows: [
        { key: 'n', segs: [{ text: m.name, bold: true }, { text: ` · ${m.role}`, dim: true }] },
        { key: 'm', segs: [{ text: `◆ ${m.model ?? '預設模型'}`, color: modelColor(m.model) }] },
        { key: 's', segs: status },
      ],
    }
  })
}

/** Stages top to bottom; the arrow between two stages fills in as the work passes it. */
function flowBlock(board: TeamBoard, tick: number): Block {
  const stages = stagesOf(board)
  const current = currentStage(board).index
  const rows = stages.flatMap((stage, i): Row[] => {
    const n = i + 1
    const isPassed = n < current || (n === current && stage.every(t => t.status === 'completed'))
    const isCurrent = n === current && !isPassed
    const head: Row = {
      key: `s-${n}`,
      segs: [
        { text: isPassed ? '✔ ' : isCurrent ? `${spin(tick)} ` : '○ ', color: isPassed ? 'green' : isCurrent ? 'yellow' : undefined, dim: !isPassed && !isCurrent },
        { text: `階段 ${n}`, bold: isCurrent, dim: !isPassed && !isCurrent },
        { text: isCurrent ? '（目前）' : '', color: 'yellow' },
      ],
    }
    const tasks: Row[] = stage.map(t => ({ key: `t-${t.id}`, segs: [{ text: '  ' }, ...taskSegs(board, t, tick, isCurrent)] }))
    if (n === stages.length) return [head, ...tasks]

    // Passed: solid green arrow. Current: pulses. Ahead: hollow and dim.
    const arrow: Seg = isPassed
      ? { text: '  ▼', color: 'green' }
      : isCurrent
        ? { text: tick % 2 === 0 ? '  ▽' : '  ▼', color: 'yellow' }
        : { text: '  ▽', dim: true }
    return [head, ...tasks, { key: `a-${n}`, segs: [arrow] }]
  })
  return { key: 'flow', rows }
}

/** What is happening now, then the dependency tree. */
function progressBlocks(board: TeamBoard, tick: number): Block[] {
  const stage = currentStage(board)
  const running = board.tasks.filter(t => t.status === 'in_progress')
  const ready = readyTasks(board)
  const isOver = board.tasks.every(t => t.status === 'completed' || t.status === 'cancelled' || t.status === 'failed')
  const now: Row[] = running.length
    ? running.map(t => ({ key: `now-${t.id}`, segs: [{ text: '正在做 ', dim: true }, ...taskSegs(board, t, tick)] }))
    : [{ key: 'now', segs: [{ text: isOver ? '✔ 全部結束' : `等待下一步${ready.length ? `：可開始 ${ready.map(t => t.id).join(',')}` : ''}`, color: isOver ? 'green' : undefined, dim: !isOver }] }]
  const inStage = new Set((stagesOf(board)[stage.index - 1] ?? []).map(t => t.id))
  const tree: Row[] = treeRows(board).map((r, i) => ({
    key: `tree-${i}`,
    segs: [
      { text: r.prefix, dim: true },
      { text: `${taskGlyph(r.task, tick)} `, color: STATUS_COLOR[r.task.status] },
      { text: `${r.task.id} ${r.task.subject}`, bold: inStage.has(r.task.id) && !isOver },
      { text: r.isRepeat ? ' ↺' : '', dim: true },
    ],
  }))
  return [
    heading('h-now', `目前進度：第 ${stage.index}/${stage.total} 階段`),
    { key: 'now', rows: now },
    heading('h-tree', '依賴樹'),
    { key: 'tree', rows: tree },
  ]
}


/** Full-size mascots when the whole pane still fits; half-size ones otherwise. */
export function iconSize(space: Space): IconSize {
  return space.columns >= iconColumns('large') + 1 + MEMBER_TEXT_COLUMNS ? 'large' : 'small'
}

/**
 * The whole side pane, top to bottom: progress first, so it stays in view, then the members.
 * Full-size mascots whenever the pane is wide enough; a long team scrolls rather than shrinks.
 */
export function paneBlocks(board: TeamBoard, tick: number, space: Space): Block[] {
  const width = Math.max(10, space.columns - 34)
  return [
    ...headerBlocks(board, width),
    heading('h-flow', '流程'),
    flowBlock(board, tick),
    ...progressBlocks(board, tick),
    heading('h-members', '成員'),
    ...memberBlocks(board, tick, iconSize(space)),
  ]
}

/** The strip above the prompt: one summary line, then the running tasks. */
export function bandBlocks(board: TeamBoard, tick: number): Block[] {
  const running = board.tasks.filter(t => t.status === 'in_progress')
  const failed = count(board, 'failed')
  const done = count(board, 'completed')
  const stage = currentStage(board)
  const glyph = running.length ? spin(tick) : done + failed + count(board, 'cancelled') === board.tasks.length ? '✔' : '·'
  const summary = plain(
    'sum',
    { text: `${glyph} `, color: 'yellow' },
    { text: `團隊 ${bar(done, board.tasks.length, 12)} ${done}/${board.tasks.length} 完成` },
    { text: ` · 第 ${stage.index}/${stage.total} 階段 · 進行中 ${running.length} · 失敗 ${failed} · 重跑 ${reruns(board)} 次`, dim: true },
  )
  const lines = running.slice(0, 3).map(t =>
    plain(
      `run-${t.id}`,
      { text: '  ◆ ', color: modelColor(modelOf(board, t)) },
      { text: `${t.assignee ?? '未指派'} `, bold: true },
      { text: `${t.id} ${t.subject}${attemptNote(t)}`, dim: true },
    ),
  )
  return [summary, ...lines]
}
