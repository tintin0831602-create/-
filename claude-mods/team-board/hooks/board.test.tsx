import { expect, test } from 'claude-code/testing'

import { faceFor, spriteLines, taskState } from './register'

const PANE = { component: 'Pane', props: { title: '團隊協作', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { bodyRows: 60, first: 0 }, view: {} } } as const

test('sprites draw as 16 columns by 8 rows with no gaps', () => {
  for (const skin of ['pencil', 'sprout', 'crown'] as const) {
    const lines = spriteLines(skin, 'idle')
    expect(lines.length).toBe(8)
    for (const runs of lines) expect(runs.map(r => r.ch).join('').length).toBe(16)
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
  await ui.unmount()
})
