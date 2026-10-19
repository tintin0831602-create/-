import { expect, test } from 'claude-code/testing'

const PLAN = {
  tool: 'mcp__agent-teams__team_plan',
  goal: '審查專案',
  members: [
    { name: '效能', role: '找瓶頸', model: 'sonnet' },
    { name: '安全', role: '找漏洞', model: 'opus' },
  ],
  tasks: [
    { id: 't1', subject: '效能審查', assignee: '效能' },
    { id: 't2', subject: '安全審查', assignee: '安全', deps: ['t1'] },
  ],
}

test('the pane is accepted by the engine and draws a mascot per member and the matching badge', async ($, on) => {
  on('session.id', () => ({ value: 'session-1' }))
  await $.tool.call(PLAN)
  await $.tool.call({ tool: 'mcp__agent-teams__team_update', id: 't1', status: 'in_progress' })

  const ui = await $.ui.mount({
    plugin: 'agent-teams',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'agent-team',
    props: { bodyColumns: 60 },
  })

  expect(await ui.find({ type: 'Raster', key: 'icon-m-效能' })).toBeDefined()
  expect(await ui.find({ type: 'Raster', key: 'icon-m-安全' })).toBeDefined()
  expect(await ui.find({ type: 'Raster', key: 'badge-m-安全' })).toBeDefined() // 找漏洞 -> shield
  expect(await ui.find({ type: 'Text', text: /正在做 t1/ })).toBeDefined()
  await ui.unmount()
})

test('a planned team is saved per session id, so a resumed session can bring it back', async ($, on) => {
  const store = new Map<string, unknown>()
  on('session.id', () => ({ value: 'session-1' }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => (store.set(e.key, e.value), { value: undefined }))
  on('store.delete', (_, e) => (store.delete(e.key), { value: undefined }))
  on('store.keys', () => ({ value: [...store.keys()] }))

  await $.tool.call(PLAN)
  await $.tool.call({ tool: 'mcp__agent-teams__team_update', id: 't1', status: 'in_progress' })

  const saved = store.get('board:session-1') as { goal: string; tasks: { id: string; status: string }[] }
  expect(saved.goal).toBe('審查專案')
  expect(saved.tasks.find(t => t.id === 't1')?.status).toBe('in_progress')
})
