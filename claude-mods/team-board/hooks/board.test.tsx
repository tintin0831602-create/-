import { expect, test } from 'claude-code/testing'

import { cells, faceFor, spriteLines, taskDepths, taskState, wrapCells } from './register'

const PANE = { component: 'Pane', props: { title: '團隊協作', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { bodyRows: 60, first: 0 }, view: {} } } as const

test('sprites draw as 12 columns by 6 rows with no gaps', () => {
  for (const skin of ['pencil', 'sprout', 'crown'] as const) {
    const lines = spriteLines(skin, 'idle')
    expect(lines.length).toBe(6)
    for (const runs of lines) expect(runs.map(r => r.ch).join('').length).toBe(12)
    expect(lines.flat().every(r => !r.fg || r.fg.startsWith('#'))).toBe(true)
  }
})

test('faces follow the member status', () => {
  expect(faceFor('completed', 0)).toBe('happy')
  expect(faceFor('failed', 0)).toBe('dead')
  expect(faceFor('running', 0)).not.toBe(faceFor('running', 1))
  expect(faceFor('pending', 0)).toBe('idle')
})

test('a pending task waits on its unfinished blockers', () => {
  const all = [
    { id: '1', subject: 'a', status: 'in_progress' as const, blockedBy: [] },
    { id: '2', subject: 'b', status: 'pending' as const, blockedBy: ['1'] },
    { id: '3', subject: 'c', status: 'completed' as const, blockedBy: [] },
  ]
  expect(all.map(t => taskState(t, all))).toEqual(['active', 'blocked', 'done'])
})

test('tasks sit one column past their deepest blocker, cycles included', () => {
  const t = (id: string, blockedBy: string[] = []) => ({ id, subject: id, status: 'pending' as const, blockedBy })
  const depth = taskDepths([t('1'), t('2'), t('3', ['1', '2']), t('4', ['3']), t('5', ['1', '4']), t('6', ['7']), t('7', ['6'])])
  expect(['1', '2', '3', '4', '5'].map(id => depth.get(id))).toEqual([0, 0, 1, 2, 3])
  expect(depth.has('6') && depth.has('7')).toBe(true)
})

test('wrapping counts a CJK character as two cells', () => {
  expect(cells('t1 搜尋')).toBe(7)
  const lines = wrapCells('整合三方資料、去重並寫成繁中總結', 10, 2)
  expect(lines.length).toBe(2)
  expect(lines.every(l => cells(l) <= 10)).toBe(true)
  expect(lines[1]?.endsWith('…')).toBe(true)
  expect(wrapCells('短', 10, 2)).toEqual(['短'])
})

test('the pane shows the leader, the progress and every member with its tasks', async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  let n = 0
  on('agent.spawn', () => ({ model: 'haiku', agentId: `a${++n}` }))
  let id = 0
  on('tool.call', { tool: 'TaskCreate' }, (_, e) => ({ result: { task: { id: String(++id), subject: e.tool === 'TaskCreate' ? e.subject : '' } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_, e) => ({ result: { success: true, taskId: e.tool === 'TaskUpdate' ? e.taskId : '', updatedFields: [] } }))

  await $.prompt.submit({ text: '查詢最近的 AI 新聞並總結' } as never)
  for (const description of ['搜尋最近發布的 AI 模型與產品', '搜尋 AI 公司動態、融資、政策法規新聞']) {
    await $.agent.spawn({ prompt: 'go', description, subagentType: 'general-purpose' } as never)
  }
  for (const subject of ['模型', '產業', '整合']) {
    await $.tool.call({ tool: 'TaskCreate', subject, description: subject } as never)
  }
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', owner: 'a1', status: 'completed' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', owner: 'a2', status: 'in_progress' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '3', addBlockedBy: ['1', '2'] } as never)

  const ui = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', ...PANE, requestId: 'team-board' } as never)
  const has = async (text: RegExp) => expect(await ui.find({ type: 'Text', text })).toBeDefined()
  await has(/查詢最近的 AI 新聞並總結/)
  await has(/已派發 3 項任務給 2 名成員/)
  await has(/1\/3 完成/)
  await has(/等待依賴 1/)
  await has(/搜尋最近發布的 AI 模型與產品/)
  await has(/ t1 /)
  await has(/ t2 /)
  await has(/執行中/)
  await has(/任務依賴/)
  await has(/等待 t1、t2 完成|完成後解鎖 t3/)
  await ui.unmount()
})
