// What a tool call is: its kind (for colour and glyph), its short name, and one line about it.

import { oneLine, str, tail } from './format'

export type ToolKind = 'shell' | 'read' | 'write' | 'search' | 'agent' | 'skill' | 'web' | 'ask' | 'plan' | 'other'

export const KINDS: readonly ToolKind[] = ['shell', 'read', 'write', 'search', 'agent', 'skill', 'web', 'ask', 'plan', 'other']

const KIND_OF: Record<string, ToolKind> = {
  Bash: 'shell',
  Read: 'read',
  NotebookRead: 'read',
  Edit: 'write',
  MultiEdit: 'write',
  Write: 'write',
  NotebookEdit: 'write',
  Grep: 'search',
  Glob: 'search',
  Agent: 'agent',
  Skill: 'skill',
  WebSearch: 'web',
  WebFetch: 'web',
  AskUserQuestion: 'ask',
  TodoWrite: 'plan',
  TaskCreate: 'plan',
  TaskUpdate: 'plan',
  EnterPlanMode: 'plan',
  ExitPlanMode: 'plan',
}

export const kindOf = (tool: string): ToolKind => KIND_OF[tool] ?? 'other'

/** The tool's short name: `Bash`, or `server:tool` for an MCP tool. */
export const label = (tool: string): string => {
  if (!tool.startsWith('mcp__')) return tool
  const [, server = '', ...rest] = tool.split('__')
  return `${server}:${rest.join('__')}`
}

const VERBS: Record<string, string> = {
  Bash: 'running',
  Read: 'reading',
  NotebookRead: 'reading',
  Edit: 'editing',
  MultiEdit: 'editing',
  Write: 'writing',
  NotebookEdit: 'editing',
  Grep: 'searching',
  Glob: 'finding',
  Agent: 'delegating:',
  Skill: 'loading skill',
  WebSearch: 'searching the web for',
  WebFetch: 'fetching',
  AskUserQuestion: 'asking you',
  TodoWrite: 'updating',
  TaskCreate: 'planning',
  TaskUpdate: 'updating task',
}

const RESERVED = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta'])

/** One line of what a tool call is about: the command, the file, the pattern. */
export function describeTool(tool: string, e: Record<string, unknown>): string {
  switch (tool) {
    case 'Bash':
      return str(e.description) || str(e.command)
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
    case 'NotebookRead':
      return typeof e.file_path === 'string' ? tail(e.file_path) : typeof e.notebook_path === 'string' ? tail(e.notebook_path) : ''
    case 'Grep':
      return `${str(e.pattern, 30)}${typeof e.path === 'string' ? ' in ' + tail(e.path) : ''}`
    case 'Glob':
      return str(e.pattern)
    case 'Agent':
      return str(e.description)
    case 'Skill':
      return str(e.skill)
    case 'WebSearch':
      return str(e.query)
    case 'WebFetch':
      return str(e.url)
    case 'AskUserQuestion':
      return 'a question'
    case 'TodoWrite':
      return 'the todo list'
    case 'TaskCreate':
    case 'TaskUpdate':
      return str(e.subject) || str(e.content)
    default: {
      for (const [key, value] of Object.entries(e)) {
        if (RESERVED.has(key)) continue
        if (typeof value === 'string' && value.trim().length > 0) return oneLine(value, 60)
      }
      return ''
    }
  }
}

/** `running List files`, `reading hooks/register.tsx`: the NOW line while a tool runs. */
export const activity = (tool: string, detail: string): string => {
  const verb = VERBS[tool] ?? `using ${label(tool)}`
  return detail ? `${verb} ${detail}` : verb
}

/** The feed's word for each tool: Claude Code's own name for it, as the transcript shows it. */
const TAGS: Record<string, string> = {
  Bash: 'Bash',
  Read: 'Read',
  NotebookRead: 'Read',
  Edit: 'Edit',
  MultiEdit: 'Edit',
  Write: 'Write',
  NotebookEdit: 'Edit',
  Grep: 'Grep',
  Glob: 'Glob',
  Agent: 'Agent',
  Skill: 'Skill',
  WebSearch: 'Web',
  WebFetch: 'Fetch',
  AskUserQuestion: 'Ask',
  TodoWrite: 'Todo',
  TaskCreate: 'Task',
  TaskUpdate: 'Task',
  EnterPlanMode: 'Plan',
  ExitPlanMode: 'Plan',
}

/** The widest tag, so the details line up beneath each other. */
export const TAG_WIDTH = 5

/** `Bash`, `Read`, `Edit`...; `MCP` for a server's tool and `Tool` for any other, whose full name goes into the text. */
export const tag = (tool: string): string => TAGS[tool] ?? (tool.startsWith('mcp__') ? 'MCP' : 'Tool')

/** The feed row's text: the detail, led by the tool's full name where the tag alone does not say which tool it was. */
export const feedText = (tool: string, detail: string): string => {
  if (tool in TAGS) return detail
  const name = label(tool)
  return detail ? `${name}  ${detail}` : name
}
