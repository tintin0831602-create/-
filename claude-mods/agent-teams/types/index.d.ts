export type TeamStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
export type TeamMember = { name: string; role: string; model?: string }
export type TeamTask = {
  id: string
  subject: string
  assignee?: string
  deps: string[]
  status: TeamStatus
  /** How many times the task was started; reruns are attempts - 1. */
  attempts: number
  output?: string
}
export type TeamBoard = { goal: string; members: TeamMember[]; tasks: TeamTask[] }

declare module 'claude-code' {
  interface PluginState {
    'agent-teams': { board: TeamBoard | null; frame: number }
  }
}
