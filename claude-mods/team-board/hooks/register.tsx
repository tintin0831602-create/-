import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Member, MemberStatus, Task } from '../types'
import { PALETTE_KEYS, SPRITES } from './sprites'
import type { Face, Skin } from './sprites'

const PANE = 'team-board'
const title = atom({ plugin: 'team-board', key: 'title' } as const, '')
const members = atom({ plugin: 'team-board', key: 'members' } as const, [] as Member[])
const tasks = atom({ plugin: 'team-board', key: 'tasks' } as const, [] as Task[])
const tick = atom({ plugin: 'team-board', key: 'tick' } as const, 0)

// Each color sits on one of the xterm-256 cells, so Terminal.app (no 24-bit
// color) shows what a truecolor terminal does.
const C = {
  panel: '#262626',
  green: '#4caf4c',
  blue: '#4c7fff',
  orange: '#ffaf4c',
  red: '#ff4c4c',
  gray: '#767676',
  track: '#444444',
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

const isDone = (s: MemberStatus) => s === 'completed' || s === 'failed' || s === 'killed'

export function taskState(task: Task, all: Task[]): 'done' | 'active' | 'blocked' | 'todo' {
  if (task.status === 'completed') return 'done'
  if (task.status === 'in_progress') return 'active'
  const open = task.blockedBy.some(id => all.find(t => t.id === id)?.status !== 'completed')
  return open ? 'blocked' : 'todo'
}

const TASK_COLOR = { done: C.green, active: C.blue, blocked: C.orange, todo: C.gray }

export function faceFor(status: MemberStatus, frame: number): Face {
  if (status === 'completed') return 'happy'
  if (status === 'failed' || status === 'killed') return 'dead'
  if (status === 'running') return frame % 2 === 0 ? 'work' : 'think'
  return 'idle'
}

// Two pixel rows per terminal row: the upper half block takes the top pixel as
// its color and the bottom pixel as its background.
export function spriteLines(skin: Skin, face: Face) {
  const { palette, frames } = SPRITES[skin]
  const px = (row: string | undefined, x: number) => {
    const ch = row?.[x]
    return ch === undefined || ch === '.' ? undefined : palette[PALETTE_KEYS.indexOf(ch)]
  }
  const rows = frames[face]
  const lines: { ch: string; fg?: string; bg?: string }[][] = []
  for (let y = 0; y < rows.length; y += 2) {
    const runs: { ch: string; fg?: string; bg?: string }[] = []
    for (let x = 0; x < (rows[y]?.length ?? 0); x++) {
      const top = px(rows[y], x)
      const bottom = px(rows[y + 1], x)
      const cell = top
        ? { ch: '▀', fg: top, bg: bottom }
        : bottom
          ? { ch: '▄', fg: bottom }
          : { ch: ' ' }
      const last = runs[runs.length - 1]
      if (last && last.fg === cell.fg && last.bg === cell.bg && last.ch[0] === cell.ch) last.ch += cell.ch
      else runs.push({ ...cell })
    }
    lines.push(runs)
  }
  return lines
}

const skinOf = (index: number): Skin => (index % 2 === 0 ? 'sprout' : 'pencil')

const ownsTask = (m: Member, t: Task) => t.owner !== undefined && (t.owner === m.name || t.owner === m.id)

// `/team demo` fills the board with these, to preview it without a real team.
const DEMO_MEMBERS: Member[] = [
  { id: 'd1', name: '模型追蹤員', role: '搜尋最近發布的 AI 模型與產品', model: 'haiku', status: 'completed' },
  { id: 'd2', name: '產業記者', role: '搜尋 AI 公司動態、融資、政策法規新聞', model: 'haiku', status: 'running' },
  { id: 'd3', name: '研究調查員', role: '搜尋 AI 研究突破與重要論文', model: 'haiku', status: 'running' },
  { id: 'd4', name: '總編輯', role: '整合、查證並總結所有新聞', model: 'sonnet', status: 'pending' },
]
const DEMO_TASKS: Task[] = [
  { id: '1', subject: '蒐集模型與產品發布', status: 'completed', owner: 'd1', blockedBy: [] },
  { id: '2', subject: '蒐集產業與政策新聞', status: 'in_progress', owner: 'd2', blockedBy: [] },
  { id: '3', subject: '蒐集研究突破', status: 'in_progress', owner: 'd3', blockedBy: [] },
  { id: '4', subject: '整合三方資料並寫總結', status: 'pending', owner: 'd4', blockedBy: ['1', '2', '3'] },
  { id: '5', subject: '查證引用來源', status: 'pending', owner: 'd4', blockedBy: ['4'] },
]

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, Math.max(1, max - 1)) + '…' : text)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'team', description: '打開團隊協作面板（加 demo 看示範，加 clear 清空）' })

    // Keeps member statuses current and animates the ones at work.
    $.clock.every(1000, async () => {
      const list = await read($, members)
      if (!list.some(m => !isDone(m.status))) return
      const agents = await $.agent.list()
      await update($, members, ms =>
        ms.map(m => {
          const a = agents.find(one => one.id === m.id)
          return a ? { ...m, status: a.status, name: a.name ?? m.name } : m
        }),
      )
      await update($, tick, n => n + 1)
    })

    return next(e)
  })

  on('command.run', { command: 'team' }, async ($, e) => {
    if (e.args.trim() === 'demo') {
      await update($, title, () => '查詢最近的 AI 新聞並總結（示範）')
      await update($, members, () => DEMO_MEMBERS)
      await update($, tasks, () => DEMO_TASKS)
    } else if (e.args.trim() === 'clear') {
      await update($, title, () => '')
      await update($, members, () => [])
      await update($, tasks, () => [])
    }
    await $.ui.open({ id: PANE, title: '團隊協作' })
    return { text: '已打開團隊協作面板。' }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.isMeta && !e.command && e.text.trim() && (await read($, title)) === '') {
      await update($, title, () => e.text.trim().split('\n')[0])
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const out = await next(e)
    if (out.deny === undefined && out.agentId) {
      const member: Member = {
        id: out.agentId,
        name: out.teammateId?.split('@')[0] ?? e.subagentType,
        role: e.description,
        model: out.model,
        status: 'running',
      }
      await update($, members, ms => [...ms, member])
      void $.ui.open({ id: PANE, title: '團隊協作' }).catch(() => undefined)
    }
    return out
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const task = (ran.result as { task?: { id: string; subject: string } } | undefined)?.task
    if (!ran.isError && task) {
      await update($, tasks, ts => [...ts, { id: task.id, subject: task.subject, status: 'pending' as const, blockedBy: [] }])
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.isError || e.tool !== 'TaskUpdate') return ran
    const a = e
    const status = a.status
    await update($, tasks, ts =>
      status === 'deleted'
        ? ts.filter(t => t.id !== a.taskId)
        : ts.map(t =>
            t.id !== a.taskId
              ? t
              : {
                  ...t,
                  subject: a.subject ?? t.subject,
                  status: status ?? t.status,
                  owner: a.owner ?? t.owner,
                  blockedBy: [...t.blockedBy, ...(a.addBlockedBy ?? [])],
                },
          ),
    )
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const ms = await read($, members)
    const ts = await read($, tasks)
    const frame = await read($, tick)
    const name = (await read($, title)) || '團隊協作'
    const width = Math.max(30, e.props.bodyColumns)

    const Sprite = ({ skin, face }: { skin: Skin; face: Face }) => (
      <Box flexDirection="column" width={16} flexShrink={0}>
        {spriteLines(skin, face).map(runs => (
          <Text>
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
    const counts = {
      active: ts.filter(t => taskState(t, ts) === 'active').length,
      blocked: ts.filter(t => taskState(t, ts) === 'blocked').length,
      done: ts.filter(t => t.status === 'completed').length,
    }
    const doneUnits = units.filter(c => c === C.green).length
    const allDone = units.length > 0 && doneUnits === units.length
    const finished = ms.length > 0 && ms.every(m => isDone(m.status))
    const barWidth = width - 1
    const gap = units.length > 1 && barWidth / units.length >= 3 ? 1 : 0
    const seg = units.length ? Math.max(1, Math.floor((barWidth - gap * (units.length - 1)) / units.length)) : 0

    const leaderFace: Face = allDone ? 'happy' : ms.some(m => m.status === 'running') ? faceFor('running', frame) : 'idle'
    const infoWidth = Math.max(10, width - 16 - 4)

    return (
      <Box flexDirection="column" width={width} backgroundColor={C.panel}>
        <Box justifyContent="space-between">
          <Text bold wrap="truncate-end">
            {clip(name, Math.max(8, width - 26))}
          </Text>
          <Box gap={1} flexShrink={0}>
            <Chip text={finished ? '已結束' : ms.length ? '進行中' : '待命'} bg={finished ? C.chipBg : C.blue} color={finished ? undefined : C.chipText} />
            <Text dimColor>{ms.length} 名成員</Text>
            {ts.length > 0 && <Text dimColor>{counts.done}/{ts.length} 完成</Text>}
          </Box>
        </Box>

        <Box borderStyle="round" borderColor={C.track} marginTop={1}>
          <Sprite skin="crown" face={leaderFace} />
          <Box flexDirection="column" marginLeft={2} flexGrow={1} justifyContent="center">
            <Text>
              <Text bold>隊長</Text>
              <Text dimColor> 拆解 · 派發 · 匯總</Text>
            </Text>
            <Text wrap="truncate-end">
              {ms.length === 0
                ? '還沒有成員。派出子代理或建立任務後，這裡會自動更新。'
                : `已派發 ${ts.length || ms.length} 項任務給 ${ms.length} 名成員`}
            </Text>
            {finished && <Text color={C.green}>已收齊</Text>}
          </Box>
        </Box>

        {units.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>總進度</Text>
            <Text>
              {units.map((color, i) => (
                <Text color={color}>{'━'.repeat(seg) + (gap && i < units.length - 1 ? ' ' : '')}</Text>
              ))}
            </Text>
            {ts.length > 0 && (
              <Text>
                <Text color={C.blue}>■ 進行中 {counts.active}</Text>
                <Text>{'  '}</Text>
                <Text color={C.orange}>■ 等待依賴 {counts.blocked}</Text>
                <Text>{'  '}</Text>
                <Text color={C.green}>■ 已交付 {counts.done}</Text>
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
            <Text bold>▾ {ms.length} 名成員</Text>
            {ms.map((m, i) => {
              const own = ts.filter(t => ownsTask(m, t))
              const label = MEMBER_LABEL[m.status]
              const isLast = i === ms.length - 1
              return (
                <Box marginTop={1}>
                  <Box flexDirection="column" width={2} flexShrink={0}>
                    {Array.from({ length: 8 }, (_, row) => (
                      <Text color={row === 3 ? label.color : C.track}>{row === 3 ? '●' : isLast && row > 3 ? ' ' : '│'}</Text>
                    ))}
                  </Box>
                  <Sprite skin={skinOf(i)} face={faceFor(m.status, frame + i)} />
                  <Box flexDirection="column" marginLeft={2} width={infoWidth}>
                    <Box justifyContent="space-between">
                      <Text bold wrap="truncate-end">
                        {clip(m.name, infoWidth - 10)}
                      </Text>
                      <Text color={label.color}>{label.text}</Text>
                    </Box>
                    <Text dimColor wrap="truncate-end">
                      {clip(m.role, infoWidth)}
                    </Text>
                    <Box justifyContent="space-between">
                      <Chip text={m.model} bg={C.chipBg} color={C.chipLabel} />
                      {own.length > 0 && (
                        <Text dimColor>
                          {own.filter(t => t.status === 'completed').length}/{own.length}
                        </Text>
                      )}
                    </Box>
                    {own.length > 0 && (
                      <Box flexWrap="wrap" columnGap={1}>
                        <Text dimColor>隊長派發</Text>
                        {own.map(t => (
                          <Chip text={`t${t.id}`} bg={TASK_COLOR[taskState(t, ts)]} />
                        ))}
                      </Box>
                    )}
                  </Box>
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    )
  })
}
