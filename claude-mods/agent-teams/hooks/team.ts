import type { TeamBoard, TeamMember, TeamStatus, TeamTask } from '../types'

export const MODELS = ['haiku', 'sonnet', 'opus', 'fable'] as const
const TERMINAL: readonly TeamStatus[] = ['completed', 'failed', 'cancelled']
// 'pending' is only accepted from 'failed': it re-queues the task for a rerun.
const SETTABLE: readonly TeamStatus[] = ['pending', 'in_progress', 'completed', 'failed', 'cancelled']

export type PlanInput = { goal?: unknown; members?: unknown; tasks?: unknown }
export type TaskInput = { id?: unknown; subject?: unknown; assignee?: unknown; deps?: unknown }
export type Outcome = { board: TeamBoard } | { error: string }

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const isModel = (v: unknown): v is string => typeof v === 'string' && (MODELS as readonly string[]).includes(v)

function hasCycle(tasks: readonly TeamTask[]): boolean {
  const byId = new Map(tasks.map(t => [t.id, t]))
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (id: string): boolean => {
    if (state.get(id) === 'done') return false
    if (state.get(id) === 'visiting') return true
    state.set(id, 'visiting')
    const cyclic = (byId.get(id)?.deps ?? []).some(visit)
    state.set(id, 'done')
    return cyclic
  }
  return tasks.some(t => visit(t.id))
}

/** Validates one task: `taken` are ids already used, `known` every id a dependency may name. */
function buildTask(input: TaskInput, members: readonly TeamMember[], taken: readonly string[], known: readonly string[]): TeamTask | string {
  if (!isText(input?.id) || !isText(input?.subject)) return '每個任務都需要 id 和 subject'
  if (taken.includes(input.id)) return `任務 id 重複：${input.id}`
  const assignee = isText(input.assignee) ? input.assignee : undefined
  if (assignee && !members.some(m => m.name === assignee)) return `任務 ${input.id}：找不到成員 ${assignee}`
  const deps = Array.isArray(input.deps) ? (input.deps as unknown[]).filter(isText) : []
  const missing = deps.find(d => !known.includes(d))
  if (missing) return `任務 ${input.id}：找不到相依任務 ${missing}`
  return { id: input.id, subject: input.subject, assignee, deps, status: 'pending', attempts: 0 }
}

/** Validates a captain's plan at the tool boundary and builds a fresh board. */
export function createBoard(input: PlanInput): Outcome {
  if (!isText(input.goal)) return { error: 'goal 必須是非空字串' }
  if (!Array.isArray(input.members) || input.members.length === 0) return { error: 'members 必須是非空陣列 {name, role, model?}' }
  if (!Array.isArray(input.tasks) || input.tasks.length === 0) return { error: 'tasks 必須是非空陣列' }

  const members: TeamMember[] = []
  for (const m of input.members as Partial<TeamMember>[]) {
    if (!isText(m?.name) || !isText(m?.role)) return { error: '每個成員都需要 name 和 role' }
    if (members.some(x => x.name === m.name)) return { error: `成員名稱重複：${m.name}` }
    if (m.model !== undefined && !isModel(m.model)) return { error: `成員 ${m.name}：model 必須是 ${MODELS.join('/')}` }
    members.push({ name: m.name, role: m.role, model: m.model })
  }

  // Tasks may reference later tasks, so deps are checked against every planned id.
  const known = (input.tasks as TaskInput[]).map(t => t?.id).filter(isText)
  const tasks: TeamTask[] = []
  for (const t of input.tasks as TaskInput[]) {
    const built = buildTask(t, members, tasks.map(x => x.id), known)
    if (typeof built === 'string') return { error: built }
    tasks.push(built)
  }
  if (hasCycle(tasks)) return { error: '任務相依關係有循環' }

  return { board: { goal: input.goal, members, tasks } }
}

/** Adds one step to a running team (the "add a step" action). */
export function addTask(board: TeamBoard, input: TaskInput): Outcome {
  const ids = board.tasks.map(t => t.id)
  const built = buildTask(input, board.members, ids, ids)
  if (typeof built === 'string') return { error: built }
  return { board: { ...board, tasks: [...board.tasks, built] } }
}

/** Changes one member's model, taking effect for tasks started afterwards. */
export function setModel(board: TeamBoard, name: unknown, model: unknown): Outcome {
  if (!board.members.some(m => m.name === name)) return { error: `找不到成員 ${String(name)}` }
  if (!isModel(model)) return { error: `model 必須是 ${MODELS.join('/')}` }
  return { board: { ...board, members: board.members.map(m => (m.name === name ? { ...m, model } : m)) } }
}

const isDone = (board: TeamBoard, id: string) => board.tasks.find(t => t.id === id)?.status === 'completed'

/** Pending tasks whose dependencies have all completed. */
export const readyTasks = (board: TeamBoard): TeamTask[] =>
  board.tasks.filter(t => t.status === 'pending' && t.deps.every(d => isDone(board, d)))

/** Pending tasks that can never run because a dependency failed or was cancelled. */
export const blockedTasks = (board: TeamBoard): TeamTask[] =>
  board.tasks.filter(
    t =>
      t.status === 'pending' &&
      t.deps.some(d => {
        const s = board.tasks.find(x => x.id === d)?.status
        return s === 'failed' || s === 'cancelled'
      }),
  )

/** Total reruns across the team: every start after a task's first. */
export const reruns = (board: TeamBoard): number => board.tasks.reduce((n, t) => n + Math.max(0, t.attempts - 1), 0)

export const modelOf = (board: TeamBoard, task: TeamTask): string | undefined =>
  board.members.find(m => m.name === task.assignee)?.model

/** Tasks grouped into stages: a task sits one stage after its deepest dependency. */
export function stagesOf(board: TeamBoard): TeamTask[][] {
  const byId = new Map(board.tasks.map(t => [t.id, t]))
  const level = new Map<string, number>()
  const depth = (t: TeamTask): number => {
    const known = level.get(t.id)
    if (known !== undefined) return known
    const d = t.deps.reduce((deepest, id) => {
      const dep = byId.get(id)
      return dep ? Math.max(deepest, depth(dep) + 1) : deepest
    }, 0)
    level.set(t.id, d)
    return d
  }
  const stages: TeamTask[][] = []
  for (const t of board.tasks) (stages[depth(t)] ??= []).push(t)
  return stages
}

/** 1-based stage the team is in: the first stage with an unfinished task, or the last one when all is done. */
export function currentStage(board: TeamBoard): { index: number; total: number } {
  const stages = stagesOf(board)
  const open = stages.findIndex(stage => stage.some(t => !TERMINAL.includes(t.status)))
  return { index: open === -1 ? stages.length : open + 1, total: stages.length }
}

export type TreeRow = { prefix: string; task: TeamTask; isRepeat: boolean }

/** Dependency tree: the final tasks are the roots, their dependencies hang below. */
export function treeRows(board: TeamBoard): TreeRow[] {
  const byId = new Map(board.tasks.map(t => [t.id, t]))
  const needed = new Set(board.tasks.flatMap(t => t.deps))
  const seen = new Set<string>()
  const rows: TreeRow[] = []

  const walk = (task: TeamTask, lead: string, branch: string): void => {
    const isRepeat = seen.has(task.id)
    rows.push({ prefix: lead + branch, task, isRepeat })
    if (isRepeat) return
    seen.add(task.id)

    const below = lead + (branch === '' ? '' : branch === '└─ ' ? '   ' : '│  ')
    const deps = task.deps.flatMap(id => byId.get(id) ?? [])
    deps.forEach((dep, i) => walk(dep, below, i === deps.length - 1 ? '└─ ' : '├─ '))
  }
  board.tasks.filter(t => !needed.has(t.id)).forEach(root => walk(root, '', ''))

  return rows
}

/** Applies one status change without mutating the board; dependencies gate in_progress. */
export function applyUpdate(board: TeamBoard, id: unknown, status: unknown, output: unknown): Outcome {
  const task = board.tasks.find(t => t.id === id)
  if (!task) return { error: `找不到任務 ${String(id)}` }
  if (!SETTABLE.includes(status as TeamStatus)) return { error: `status 必須是 ${SETTABLE.join('/')}` }
  const next = status as TeamStatus

  if (next === 'pending' && task.status !== 'failed') return { error: `任務 ${task.id} 只有失敗時才能重跑（目前 ${task.status}）` }
  if (next !== 'pending' && TERMINAL.includes(task.status)) return { error: `任務 ${task.id} 已經是 ${task.status}` }
  if (next === 'in_progress' && !readyTasks(board).some(t => t.id === task.id))
    return { error: `任務 ${task.id} 還不能開始：請先完成相依任務（${task.deps.join(', ')}）` }
  if ((next === 'completed' || next === 'failed') && task.status !== 'in_progress')
    return { error: `任務 ${task.id} 必須先是 in_progress 才能改成 ${next}` }

  const updated: TeamTask = {
    ...task,
    status: next,
    attempts: next === 'in_progress' ? task.attempts + 1 : task.attempts,
    output: typeof output === 'string' ? output : task.output,
  }
  return { board: { ...board, tasks: board.tasks.map(t => (t.id === task.id ? updated : t)) } }
}

/** The text a team tool returns to the captain. */
export function summarize(board: TeamBoard): string {
  const count = (s: TeamStatus) => board.tasks.filter(t => t.status === s).length
  const label = (t: TeamTask) => `${t.id}${t.assignee ? `(${t.assignee}/${modelOf(board, t) ?? '預設模型'})` : ''}`
  const names = (ts: TeamTask[]) => (ts.length ? ts.map(label).join('、') : '無')
  const ready = readyTasks(board)
  const open = board.tasks.some(t => !TERMINAL.includes(t.status))
  return [
    `目標：${board.goal}`,
    `進度：${count('completed')}/${board.tasks.length} 完成，${count('in_progress')} 進行中，${count('failed')} 失敗，${count('cancelled')} 取消，重跑 ${reruns(board)} 次`,
    `現在可開始：${names(ready)}`,
    `被失敗/取消的相依卡住：${names(blockedTasks(board))}`,
    open
      ? ready.length
        ? '請同時啟動所有可開始的任務；Agent 工具的 model 參數用括號內的模型。'
        : '請等進行中的任務完成後再呼叫 team_status。'
      : '所有任務都結束了：請用繁體中文寫出整合報告。',
  ].join('\n')
}
