import { test, expect } from 'claude-code/testing'

test('面板用中文說明外掛', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'plugins-zh',
      surface,
      component: 'Pane',
      requestId: 'plugins-zh',
      props: {},
    } as never)
    expect(await ui.find({ type: 'Text', text: /外掛商店/ })).toBeDefined()
    await ui.unmount()
  }
})
