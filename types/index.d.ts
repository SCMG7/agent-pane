/** Token counts in one shape, for a turn or summed over the session. */
export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }

/** What the agent is doing right now; the avatar's face and colour follow it. */
export type Phase = 'idle' | 'thinking' | 'writing' | 'tool' | 'done' | 'error' | 'aborted'

/** The main loop's current (or last) turn. */
export type Turn = {
  turnId: string | null
  /** The prompt's first line, as the task being worked on. */
  task: string
  startedAt: number | null
  endedAt: number | null
  phase: Phase
  /** One line saying what exactly is happening (`running ls -la`, `reading DOCUMENTS.md`). */
  detail: string
  /** Model requests made in this turn so far. */
  steps: number
  /** Tool calls made in this turn so far. */
  toolCalls: number
  usage: Usage
  /** The model the last request named, as the API spells it. */
  model: string | null
  /** Output tokens per second of the last timed response; null before one. */
  speed: number | null
  /** The session's cost in USD when the turn began, for this turn's own cost; null when unknown. */
  costAtStart: number | null
}

/** Everything finished so far this session. */
export type History = {
  turns: number
  usage: Usage
  /** Lengths of the last answered turns, in milliseconds, for the time estimate. */
  durations: number[]
  /** Context tokens after each of the last turns, for the pace toward compaction. */
  contextTrail: number[]
}

export type RunState = 'running' | 'done' | 'failed'

/** One recent tool call, for the activity feed. */
export type ToolRow = {
  id: string
  tool: string
  detail: string
  state: RunState
  startedAt: number
  endedAt: number | null
}

/** One subagent this session started, for the agents list. */
export type AgentRow = {
  id: string
  description: string
  type: string
  model: string
  state: RunState
  startedAt: number
  endedAt: number | null
  /** Tokens its requests used so far, every kind summed. */
  tokens: number
  /** Model requests it has made. */
  steps: number
  /** What its last request carried: prompt and reply, for its context fill. */
  contextTokens: number
  /** Its cost so far, estimated from its tokens at list prices. */
  costUsd: number
  /** The reasoning effort its requests ran at, once one was seen. */
  effort?: string
}

/** The clock the pane redraws on: each second while something runs, every few seconds idle. */
export type Pulse = { now: number; tick: number }

/** One rate-limit window as the last API response reported it. */
export type Limit = { kind: string; percentUsed: number; resetsAt: number | null }

/** The context window, the compaction threshold, cost, limits and the prompt cache, as the status line has them. */
export type Meter = {
  /** Input tokens the last response was answered over. */
  tokens: number | null
  /** The model's context window, in tokens. */
  window: number | null
  percent: number | null
  /** The token count at which auto-compaction runs; null when unknown or off. */
  threshold: number | null
  isAutoCompact: boolean | null
  usd: number | null
  /** When the session began, in clock milliseconds. */
  startedAt: number | null
  limits: Limit[]
  /** Compactions seen this session, and when the last one ran. */
  compactions: number
  lastCompactAt: number | null
  /** When the prompt cache the last response wrote goes cold; null before a response. */
  cacheExpiresAt: number | null
}

export type SectionId = 'task' | 'turn' | 'context' | 'usage' | 'limits' | 'agents' | 'activity'

/** How the person has arranged the pane; kept across sessions in the store. */
export type Panel = {
  /** Compact: no avatar, every section folded to its header line. */
  isCompact: boolean
  collapsed: SectionId[]
  /** The finished agents are folded under their header. */
  doneFolded: boolean
  /** The person's /config theme is a light one: the pane draws its light palette. */
  isLight: boolean
}

/** Where the session works: the directory whose name heads the pane. */
export type Place = {
  /** The session's directory, absolute; empty before session.start. */
  cwd: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-pane': {
      turn: Turn
      history: History
      tools: ToolRow[]
      agents: AgentRow[]
      pulse: Pulse
      meter: Meter
      panel: Panel
      place: Place
    }
  }
}
