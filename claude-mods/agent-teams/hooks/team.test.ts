import { expect, test } from 'claude-code/testing'

import { addTask, applyUpdate, blockedTasks, createBoard, currentStage, readyTasks, reruns, setModel, stagesOf, treeRows } from './team'
import { badgeFor, iconCells } from './sprite'
import { SMALL_SPRITES, SPRITES } from './sprites'
import { bandBlocks, memberState, paneBlocks, type Block } from './view'

const ROOMY = { columns: 120 }
const CRAMPED = { columns: 40 }
import type { TeamBoard } from '../types'

const plan = {
  goal: 'ship',
  members: [
    { name: 'dev', role: 'implementer', model: 'sonnet' },
    { name: 'qa', role: 'reviewer', model: 'opus' },
  ],
  tasks: [
    { id: 't1', subject: 'build', assignee: 'dev' },
    { id: 't2', subject: 'review', assignee: 'qa', deps: ['t1'] },
  ],
}

function made(): TeamBoard {
  const out = createBoard(plan)
  if ('error' in out) throw new Error(out.error)
  return out.board
}

function step(board: TeamBoard, id: string, status: string, output?: string): TeamBoard {
  const out = applyUpdate(board, id, status, output)
  if ('error' in out) throw new Error(out.error)
  return out.board
}

test('only dependency-free tasks are ready at first', () => {
  expect(readyTasks(made()).map(t => t.id)).toEqual(['t1'])
})

test('a task cannot start before its dependency completes', () => {
  expect('error' in applyUpdate(made(), 't2', 'in_progress', undefined)).toBe(true)
})

test('completing t1 makes t2 ready without mutating the old board', () => {
  const start = made()
  const finished = step(step(start, 't1', 'in_progress'), 't1', 'completed', 'built')

  expect(readyTasks(finished).map(t => t.id)).toEqual(['t2'])
  expect(start.tasks[0]?.status).toBe('pending')
})

test('a failed task blocks dependants, and a rerun is counted', () => {
  const failed = step(step(made(), 't1', 'in_progress'), 't1', 'failed', 'broke')
  expect(blockedTasks(failed).map(t => t.id)).toEqual(['t2'])
  expect(reruns(failed)).toBe(0)

  const again = step(step(failed, 't1', 'pending'), 't1', 'in_progress')
  expect(reruns(again)).toBe(1)
  expect(again.tasks[0]?.attempts).toBe(2)
})

test('only a failed task can be re-queued', () => {
  expect('error' in applyUpdate(made(), 't1', 'pending', undefined)).toBe(true)
})

test('steps can be added and models changed on a live team', () => {
  const added = addTask(made(), { id: 't3', subject: 'docs', assignee: 'dev', deps: ['t2'] })
  if ('error' in added) throw new Error(added.error)
  expect(added.board.tasks).toHaveLength(3)

  const swapped = setModel(added.board, 'dev', 'haiku')
  if ('error' in swapped) throw new Error(swapped.error)
  expect(swapped.board.members[0]?.model).toBe('haiku')
  expect('error' in setModel(added.board, 'dev', 'gpt')).toBe(true)
})

test('cycles, unknown deps, unknown assignees and bad models are rejected', () => {
  const bad = (tasks: object[], members = plan.members) => 'error' in createBoard({ ...plan, members, tasks })

  expect(bad([{ id: 'a', subject: 'x', deps: ['b'] }, { id: 'b', subject: 'y', deps: ['a'] }])).toBe(true)
  expect(bad([{ id: 'a', subject: 'x', deps: ['zzz'] }])).toBe(true)
  expect(bad([{ id: 'a', subject: 'x', assignee: 'ghost' }])).toBe(true)
  expect(bad([{ id: 'a', subject: 'x' }], [{ name: 'dev', role: 'r', model: 'gpt' }])).toBe(true)
})

const review = (): TeamBoard => {
  const out = createBoard({
    goal: 'review',
    members: [
      { name: 'perf', role: 'p', model: 'sonnet' },
      { name: 'sec', role: 's', model: 'opus' },
      { name: 'lead', role: 'l', model: 'haiku' },
    ],
    tasks: [
      { id: 't1', subject: 'perf', assignee: 'perf' },
      { id: 't2', subject: 'sec', assignee: 'sec' },
      { id: 't3', subject: 'merge', assignee: 'lead', deps: ['t1', 't2'] },
    ],
  })
  if ('error' in out) throw new Error(out.error)
  return out.board
}
const text = (blocks: Block[]) => blocks.flatMap(b => b.rows).map(r => r.segs.map(s => s.text).join('')).join('\n')

test('tasks group into stages and the current stage advances', () => {
  const start = review()
  expect(stagesOf(start).map(s => s.map(t => t.id))).toEqual([['t1', 't2'], ['t3']])
  expect(currentStage(start)).toEqual({ index: 1, total: 2 })

  const halfway = step(step(step(step(start, 't1', 'in_progress'), 't1', 'completed'), 't2', 'in_progress'), 't2', 'completed')
  expect(currentStage(halfway)).toEqual({ index: 2, total: 2 })
})

test('the dependency tree puts the final task at the root', () => {
  const rows = treeRows(review())
  expect(rows.map(r => `${r.prefix}${r.task.id}`)).toEqual(['t3', '├─ t1', '└─ t2'])
})

test('every member card carries the mascot of its model, and a running member hops', () => {
  const running = step(review(), 't1', 'in_progress')
  const cards = paneBlocks(running, 0, ROOMY).filter(b => b.icon)

  expect(cards.map(b => b.icon?.model)).toEqual(['sonnet', 'opus', 'haiku'])
  expect(cards.map(b => b.icon?.state)).toEqual(['workA', 'idle', 'idle'])
  expect(paneBlocks(running, 1, ROOMY).filter(b => b.icon)[0]?.icon?.state).toBe('workB')
})

test('a member shows done after finishing and fail after a failure', () => {
  const finished = step(step(review(), 't1', 'in_progress'), 't1', 'completed')
  const failed = step(step(review(), 't2', 'in_progress'), 't2', 'failed')
  const member = (b: TeamBoard, name: string) => b.members.find(m => m.name === name)!

  expect(memberState(finished, member(finished, 'perf'), 0)).toBe('done')
  expect(memberState(failed, member(failed, 'sec'), 0)).toBe('fail')
  expect(memberState(failed, member(failed, 'perf'), 0)).toBe('idle')
})

test('the pane shows stage, reruns, the running member and the tree', () => {
  const pane = text(paneBlocks(step(review(), 't1', 'in_progress'), 4, ROOMY))

  expect(pane).toContain('第 1/2 階段')
  expect(pane).toContain('重跑 0 次')
  expect(pane).toContain('✻ 正在做 t1')
  expect(pane).toContain('└─ ')
})

test('the band shows stage, reruns and the running task', () => {
  const band = text(bandBlocks(step(review(), 't2', 'in_progress'), 0))

  expect(band).toContain('第 1/2 階段')
  expect(band).toContain('重跑 0 次')
  expect(band).toContain('◆ sec t2')
})

test('icons pack into a Raster: two pixel rows become one row of half blocks', () => {
  const cells = iconCells({ model: 'opus', state: 'idle', size: 'large' })
  const bytes = atob(cells.cells).length

  expect(cells.columns).toBe(SPRITES.opus.frames.idle[0]?.length)
  expect(cells.rows).toBe(Math.ceil(SPRITES.opus.frames.idle.length / 2))
  expect(bytes).toBe(cells.columns * cells.rows * 12)
  expect(iconCells({ state: 'idle', size: 'large' }).cells).not.toBe(iconCells({ model: 'sonnet', state: 'idle', size: 'large' }).cells) // grey, not orange
})

test('every sprite has all five states on one canvas size', () => {
  for (const sprite of [...Object.values(SPRITES), ...Object.values(SMALL_SPRITES)]) {
    const sizes = new Set(Object.values(sprite.frames).map(f => `${f.length}x${f[0]?.length}`))
    expect(sizes.size).toBe(1)
  }
})

test('full-size mascots when the pane is wide enough, half-size ones when it is narrow', () => {
  const sizes = (space: { columns: number; rows?: number }) => paneBlocks(review(), 0, space).flatMap(b => (b.icon ? [b.icon.size] : []))

  expect(sizes(ROOMY)).toEqual(['large', 'large', 'large'])
  expect(sizes(CRAMPED)).toEqual(['small', 'small', 'small'])
})

test('badges follow the role, security winning over review', () => {
  expect(badgeFor('安全審查員', '找出漏洞')).toBe('security')
  expect(badgeFor('效能審查員', '找瓶頸')).toBe('research')
  expect(badgeFor('整合員', '整合報告')).toBe('integrate')
  expect(badgeFor('小明', '雜事')).toBeUndefined()
})

test('progress comes first and the members are stacked below it, one per row, in plan order', () => {
  const four = createBoard({
    goal: 'news',
    members: ['a', 'b', 'c', 'd'].map(name => ({ name, role: '搜尋 AI 公司動態、融資、政策法規新聞', model: 'haiku' })),
    tasks: [
      { id: 't1', subject: 'x', assignee: 'a' },
      { id: 't2', subject: 'y', assignee: 'b' },
      { id: 't3', subject: 'z', assignee: 'c' },
      { id: 't4', subject: 'sum', assignee: 'd', deps: ['t1', 't2', 't3'] },
    ],
  })
  if ('error' in four) throw new Error(four.error)
  const blocks = paneBlocks(four.board, 0, { columns: 90 })
  const keys = blocks.map(b => b.key)

  expect(blocks.filter(b => b.icon).map(b => b.key)).toEqual(['m-a', 'm-b', 'm-c', 'm-d'])
  expect(blocks.filter(b => b.icon).map(b => b.icon?.size)).toEqual(['large', 'large', 'large', 'large'])
  expect(keys.indexOf('tree')).toBeLessThan(keys.indexOf('m-a'))
})
