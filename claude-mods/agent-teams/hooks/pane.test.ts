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

const PANE_PROPS = { title: '團隊協作', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { bodyRows: 80, first: 0 }, view: {} }
const mountPane = ($: Parameters<Parameters<typeof test>[1]>[0], surface: 'terminal' | 'desktop' | 'mobile' | 'vscode' = 'terminal') =>
  $.ui.mount({ plugin: 'agent-teams', surface, component: 'Pane', requestId: 'agent-team', props: PANE_PROPS } as never)

test('a planned team draws in the mascot pane: stage, members, statuses and the dependency tree', async ($, on) => {
  on('session.id', () => ({ value: 'session-1' }))
  await $.tool.call(PLAN as never)
  await $.tool.call({ tool: 'mcp__agent-teams__team_update', id: 't1', status: 'in_progress' } as never)

  const ui = await mountPane($)
  const has = async (text: RegExp) => expect(await ui.find({ type: 'Text', text })).toBeDefined()
  await has(/審查專案/)
  await has(/第 1\/2 階段/)
  await has(/重跑 0 次/)
  await has(/已派發 2 項任務給 2 名成員/)
  await has(/找瓶頸/)
  await has(/執行中/)
  await has(/任務依賴/)
  await has(/完成後解鎖 t2/)
  await ui.unmount()
})

test('/agent-team demo fills the pane on every surface, and clear empties it', async $ => {
  await $.command.run({ command: 'agent-team', args: 'demo' } as never).catch(() => undefined)
  for (const surface of ['terminal', 'desktop', 'mobile', 'vscode'] as const) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Text', text: /總編輯/ })).toBeDefined()
    await ui.unmount()
  }
  await $.command.run({ command: 'agent-team', args: 'clear' } as never).catch(() => undefined)
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: /還沒有團隊/ })).toBeDefined()
  await ui.unmount()
})

test('without a planned team, the pane follows the subagents Claude starts', async ($, on) => {
  let n = 0
  on('agent.spawn', () => ({ model: 'haiku', agentId: `a${++n}` }))
  await $.agent.spawn({ prompt: 'go', description: '搜尋最近發布的 AI 模型', subagentType: 'general-purpose' } as never)

  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: /搜尋最近發布的 AI 模型/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 名成員/ })).toBeDefined()
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

test('a planned member can name an OMC agent: the captain reads it and the pane shows it', async ($, on) => {
  on('session.id', () => ({ value: 'session-1' }))
  const plan = {
    ...PLAN,
    members: [
      { name: '效能', role: '找瓶頸', model: 'sonnet', agent: 'oh-my-claudecode:executor' },
      { name: '安全', role: '找漏洞', model: 'opus', agent: 'oh-my-claudecode:verifier' },
    ],
  }
  const planned = (await $.tool.call(plan as never)) as { result?: string }
  expect(String(planned.result)).toContain('t1(效能/sonnet/oh-my-claudecode:executor)')

  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: / executor / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: / verifier / })).toBeDefined()
  await ui.unmount()
})

test('an oh-my-claudecode /team run shows in the pane: workers, owned tasks and its phase', async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1', teammateId: 'worker-1@session' }))
  on('tool.call', { tool: 'TaskCreate' }, () => ({ result: { task: { id: '1', subject: '修好型別錯誤' } } }))
  on('tool.call', { tool: 'TaskUpdate' }, (_, e) => ({ result: { success: true, taskId: e.tool === 'TaskUpdate' ? e.taskId : '', updatedFields: [] } }))
  on('tool.call', { tool: 'mcp__plugin_oh-my-claudecode_t__state_write' }, () => ({ result: 'ok' }) as never)

  await $.prompt.submit({ text: '/team 1:executor "fix all TypeScript errors"', command: { name: 'team' } } as never)
  await $.tool.call({ tool: 'mcp__plugin_oh-my-claudecode_t__state_write', mode: 'team', current_phase: 'team-exec' } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: '修好型別錯誤', description: 'x' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', owner: 'worker-1', status: 'in_progress' } as never)
  await $.agent.spawn({ prompt: 'go', description: '修好 src/auth 的型別錯誤', subagentType: 'oh-my-claudecode:executor' } as never)

  const ui = await mountPane($)
  const has = async (text: RegExp) => expect(await ui.find({ type: 'Text', text })).toBeDefined()
  await has(/fix all TypeScript errors/)
  await has(/OMC 階段 team-exec/)
  await has(/worker-1/)
  await has(/ sonnet /)
  await has(/ executor /)
  await has(/ t1 /)
  await ui.unmount()
})

test('a TodoWrite list stands for the tasks when none came through TaskCreate', async ($, on) => {
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }) as never)
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: '規劃', status: 'completed', activeForm: '規劃中' },
      { content: '實作', status: 'in_progress', activeForm: '實作中' },
    ],
  } as never)
  const ui = await mountPane($)
  expect(await ui.find({ type: 'Text', text: /1\/2 完成/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /d2/ })).toBeDefined()
  await ui.unmount()
})
