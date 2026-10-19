import type { TeamStatus } from '../types'

// Claude's spinner glyphs, cycled while something is running.
export const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']

export const GLYPH: Record<TeamStatus, string> = { pending: '○', in_progress: '◐', completed: '●', failed: '✗', cancelled: '–' }
export const STATUS_COLOR: Record<TeamStatus, string | undefined> = {
  pending: undefined,
  in_progress: 'yellow',
  completed: 'green',
  failed: 'red',
  cancelled: undefined,
}

// The tint of each model: the mascot's body colour, reused for names and markers.
const MODEL_COLOR: Record<string, string> = {
  haiku: '#5BC0DE',
  sonnet: '#D97757',
  opus: '#B07CE8',
  fable: '#F2C14E',
}

export const modelColor = (model?: string): string => (model && MODEL_COLOR[model]) || 'gray'
