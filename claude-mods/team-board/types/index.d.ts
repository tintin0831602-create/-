export type MemberStatus =
  | 'pending' | 'running' | 'waiting' | 'idle'
  | 'completed' | 'failed' | 'killed'

export type Member = {
  id: string
  name: string
  role: string
  model: string
  status: MemberStatus
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type Task = {
  id: string
  subject: string
  status: TaskStatus
  owner?: string
  blockedBy: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'team-board': {
      title: string
      members: Member[]
      tasks: Task[]
      tick: number
    }
  }
}
