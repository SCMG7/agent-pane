import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement } from 'claude-code'

import type { AgentRow, History, Limit, Meter, Panel, Phase, Place, Pulse, SectionId, ToolRow, Turn, Usage } from '../types'
import type { FeedProps, FeedRow, FeedSeg } from './feed'
import { fmtAge, fmtClock, fmtDur, fmtK, fmtSecs, fmtUsd, median, modelName, oneLine, pace, plural, spark } from './format'
import { banner, clawd, crab } from './pixel'
import type { Eyes } from './pixel'
import { DARK, LIGHT, mix, NERD, PLAIN, shades, typeColor, typeWord } from './theme'
import type { Glyphs, Palette } from './theme'
import { activity, describeTool, feedText, KINDS, kindOf, label, tag, TAG_WIDTH } from './tools'

// ---------------------------------------------------------------------------
// Names and state
// ---------------------------------------------------------------------------

const PANE = 'agent-pane'
const COMMAND = 'agent-pane'
const TITLE = 'Agent'
const STORE_PANEL = 'panel'
const KEEP_TOOLS = 40
const SHOW_TOOLS = 12
const KEEP_DURATIONS = 20
const KEEP_TRAIL = 12
const KEEP_AGENTS = 30
const SHOW_AGENTS = 4
/** Idle, the pane redraws every this many seconds (countdowns, session age). */
const IDLE_BEAT = 5
/** The prompt cache a response writes stays warm this long. */
const CACHE_TTL_MS = 60 * 60_000
const CACHE_WARN_MS = 20 * 60_000
const CACHE_ALERT_MS = 10 * 60_000

const SECTIONS: readonly SectionId[] = ['task', 'turn', 'context', 'usage', 'limits', 'agents', 'activity']
const isSection = (v: unknown): v is SectionId => typeof v === 'string' && (SECTIONS as readonly string[]).includes(v)

const ZERO: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

const IDLE: Turn = {
  turnId: null,
  task: '',
  startedAt: null,
  endedAt: null,
  phase: 'idle',
  detail: 'waiting for your prompt',
  steps: 0,
  toolCalls: 0,
  usage: ZERO,
  model: null,
  speed: null,
  costAtStart: null,
}

const NO_HISTORY: History = { turns: 0, usage: ZERO, durations: [], contextTrail: [] }
const NO_METER: Meter = {
  tokens: null,
  window: null,
  percent: null,
  threshold: null,
  isAutoCompact: null,
  usd: null,
  startedAt: null,
  limits: [],
  compactions: 0,
  lastCompactAt: null,
  cacheExpiresAt: null,
}
const DEFAULT_PANEL: Panel = { isCompact: false, collapsed: [], doneFolded: false, isLight: false }

const turn = atom({ plugin: 'agent-pane', key: 'turn' } as const, IDLE)
const history = atom({ plugin: 'agent-pane', key: 'history' } as const, NO_HISTORY)
const tools = atom({ plugin: 'agent-pane', key: 'tools' } as const, [] as ToolRow[])
const agents = atom({ plugin: 'agent-pane', key: 'agents' } as const, [] as AgentRow[])
const pulse = atom({ plugin: 'agent-pane', key: 'pulse' } as const, { now: 0, tick: 0 } as Pulse)
const meter = atom({ plugin: 'agent-pane', key: 'meter' } as const, NO_METER)
const panel = atom({ plugin: 'agent-pane', key: 'panel' } as const, DEFAULT_PANEL)
const place = atom({ plugin: 'agent-pane', key: 'place' } as const, { cwd: '' } as Place)

// Module scope: set again by register() and session.start on every (re)load.
let glyphs: Glyphs = PLAIN
let glyphSetting = 'auto'
let avatarOn = true
let openAtStart = true
/** The feed's surface module failed on this surface: draw plain rows instead. */
let feedBroken = false
let beat = 0

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type ModelUsageLike = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

const fromModel = (u: ModelUsageLike): Usage => ({
  input: u.input_tokens,
  output: u.output_tokens,
  cacheRead: u.cache_read_input_tokens,
  cacheWrite: u.cache_creation_input_tokens,
})

const add = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})

const total = (u: Usage): number => u.input + u.output + u.cacheRead + u.cacheWrite

const sumModel = (u: ModelUsageLike): number => total(fromModel(u))

/** A state write that never fails the hook it runs in. */
const quiet = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined)

/** The last segment of a path: the project's name as its folder spells it. */
const baseName = (path: string): string => {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || path || 'project'
}

const LIMIT_NAMES: Record<string, string> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

// USD per million tokens: input, output, cache read, cache write; the first row
// matching a model id wins. The engine reports tokens, not money, so an agent's
// cost is an estimate at list prices (as of 2026-10-10), cache writes at the
// 1-hour rate Claude Code writes on a subscription.
type Price = [input: number, output: number, cacheRead: number, cacheWrite: number]

const PRICES: [RegExp, Price][] = [
  [/(fable|mythos)-5-1/, [10, 50, 0.25, 20]],
  [/fable|mythos/, [10, 50, 1, 20]],
  [/opus-5-5/, [4, 20, 0.2, 8]],
  [/opus/, [5, 25, 0.5, 10]],
  [/sonnet-5-5/, [2, 10, 0.1, 4]],
  [/sonnet-5/, [2, 10, 0.2, 4]],
  [/sonnet/, [3, 15, 0.3, 6]],
  [/haiku-5-5/, [0.1, 0.5, 0.01, 0.2]],
  [/haiku/, [1, 5, 0.1, 2]],
]
/** Haiku 5.5 charges more for a request whose prompt is over this many tokens. */
const HAIKU_LONG_PROMPT = 100_000
const HAIKU_LONG: Price = [0.5, 2.5, 0.05, 1]

const priceOf = (model: string, prompt: number): Price => {
  const id = model.toLowerCase()
  if (prompt > HAIKU_LONG_PROMPT && /haiku-5-5/.test(id)) return HAIKU_LONG
  return PRICES.find(([re]) => re.test(id))?.[1] ?? [4, 20, 0.2, 8]
}

/** `isRequest`: the usage is one model request, so a prompt-length price applies. */
const costOf = (model: string, u: ModelUsageLike, isRequest: boolean): number => {
  const prompt = isRequest ? u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0
  const [i, o, r, w] = priceOf(model, prompt)
  return (u.input_tokens * i + u.output_tokens * o + u.cache_read_input_tokens * r + u.cache_creation_input_tokens * w) / 1e6
}

/** Haiku 4.5 and the Claude 3 models have a 200K window; the rest 1M. */
const windowOf = (model: string): number => (/haiku-4|claude-3/i.test(model) ? 200_000 : 1_000_000)

/** Reads the status line's figures, with the compaction threshold, into the meter. */
async function refreshMeter($: EngineInterface): Promise<void> {
  try {
    const u = await $.session.usage({ breakdown: 'summary' }).catch(() => $.session.usage())
    const b = u.context.breakdown
    const limits: Limit[] = u.rateLimits.map(r => {
      const at = r.resetsAt === undefined ? NaN : Date.parse(r.resetsAt)
      return { kind: r.kind, percentUsed: r.percentUsed, resetsAt: Number.isFinite(at) ? at : null }
    })
    await update($, meter, m => ({
      ...m,
      tokens: u.context.tokens ?? null,
      window: u.context.window,
      percent: u.context.percent ?? null,
      threshold: b?.isAutoCompactEnabled === false ? null : (b?.autoCompactThreshold ?? null),
      isAutoCompact: b?.isAutoCompactEnabled ?? null,
      usd: u.cost?.usd ?? null,
      startedAt: u.startedAt,
      limits,
    }))
  } catch {
    // keep the last reading
  }
}

/** Advances the pulse: each second while something runs or a countdown is close, every IDLE_BEAT seconds otherwise. */
async function tick($: EngineInterface): Promise<void> {
  beat += 1
  const [t, m, list] = await Promise.all([read($, turn), read($, meter), read($, agents)])
  const now = await $.clock.now()
  const isRunning = (t.startedAt !== null && t.endedAt === null) || list.some(a => a.state === 'running')
  const cacheLeft = m.cacheExpiresAt === null ? Infinity : m.cacheExpiresAt - now
  const isClose = cacheLeft > 0 && cacheLeft <= CACHE_ALERT_MS
  if (!isRunning && !isClose && beat % IDLE_BEAT !== 0) return
  await update($, pulse, p => ({ now, tick: p.tick + 1 }))
}

/** Opens the pane, or seats it if it waits undrawn; never throws. */
async function showPane($: EngineInterface): Promise<boolean> {
  try {
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    return opened.isPlaced
  } catch {
    return false
  }
}

async function readTheme($: EngineInterface): Promise<void> {
  try {
    const row = (await $.config.list()).find(r => r.key === 'theme')
    const isLight = typeof row?.value === 'string' && row.value.startsWith('light')
    await update($, panel, p => (p.isLight === isLight ? p : { ...p, isLight }))
  } catch {
    // no config to read (a headless host, a test): stay dark
  }
}

async function loadPanel($: EngineInterface): Promise<void> {
  try {
    const saved = await $.store.get(STORE_PANEL)
    if (saved === null || typeof saved !== 'object') return
    const s = saved as { isCompact?: unknown; collapsed?: unknown; doneFolded?: unknown }
    await update($, panel, p => ({
      ...p,
      isCompact: s.isCompact === true,
      doneFolded: s.doneFolded === true,
      collapsed: Array.isArray(s.collapsed) ? s.collapsed.filter(isSection) : p.collapsed,
    }))
  } catch {
    // the defaults then
  }
}

async function savePanel($: EngineInterface, p: Panel): Promise<void> {
  try {
    await $.store.set(STORE_PANEL, { isCompact: p.isCompact, collapsed: p.collapsed, doneFolded: p.doneFolded })
  } catch {
    // kept for the session alone
  }
}

async function toggleSection($: EngineInterface, id: SectionId): Promise<void> {
  const next = await update($, panel, p => ({
    ...p,
    // Opening a section from a compact pane expands the pane around it.
    isCompact: false,
    collapsed: p.isCompact ? SECTIONS.filter(s => s !== id) : p.collapsed.includes(id) ? p.collapsed.filter(s => s !== id) : [...p.collapsed, id],
  }))
  await savePanel($, next)
}

async function setCompact($: EngineInterface, isCompact: boolean): Promise<void> {
  const next = await update($, panel, p => ({ ...p, isCompact, collapsed: isCompact ? p.collapsed : [] }))
  await savePanel($, next)
}

async function toggleDone($: EngineInterface): Promise<void> {
  const next = await update($, panel, p => ({ ...p, doneFolded: !p.doneFolded }))
  await savePanel($, next)
}

/** Whether a Nerd Font is installed here: the usual font folders on macOS and Linux. */
async function hasNerdFont($: EngineInterface): Promise<boolean> {
  let home = ''
  try {
    home = (await $.env.get('HOME')) ?? ''
  } catch {
    return false
  }
  if (!home) return false
  for (const dir of [`${home}/Library/Fonts`, '/Library/Fonts', `${home}/.local/share/fonts`, `${home}/.fonts`]) {
    try {
      if ((await $.fs.list(dir)).some(f => /nerd/i.test(f.name))) return true
    } catch {
      // not there
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// The avatar
// ---------------------------------------------------------------------------

type Face = { eyes: string; mouth: string; word: string; look: Eyes }

const FACES: Record<Phase, Face> = {
  idle: { eyes: 'o   o', mouth: '  _  ', word: 'idle', look: 'open' },
  thinking: { eyes: 'o   o', mouth: '  ~  ', word: 'thinking', look: 'open' },
  writing: { eyes: '-   -', mouth: '  =  ', word: 'writing', look: 'low' },
  tool: { eyes: '@   @', mouth: '  o  ', word: 'working', look: 'open' },
  done: { eyes: '^   ^', mouth: ' \\_/ ', word: 'done', look: 'high' },
  error: { eyes: 'x   x', mouth: '  ^  ', word: 'error', look: 'open' },
  aborted: { eyes: '-   -', mouth: '  .  ', word: 'stopped', look: 'low' },
}

const ANTENNA = ['|', '/', '-', '\\']

/** The text face, drawn where the surface has no Raster. */
function avatar(phase: Phase, tick: number, isRunning: boolean): string[] {
  const face = FACES[phase]
  // Idle, a slow blink every few beats keeps the face alive without noise.
  const blink = isRunning ? tick % 6 === 0 : tick % 7 === 0
  const eyes = blink ? '-   -' : face.eyes
  const antenna = isRunning ? (ANTENNA[tick % ANTENNA.length] ?? '|') : phase === 'done' ? '*' : 'o'
  return [`     (${antenna})`, ' ╭───────╮', ` │ ${eyes} │`, ` │ ${face.mouth} │`, ' ╰───────╯']
}

const faceColor = (p: Palette, phase: Phase): string =>
  ({ idle: p.muted, thinking: p.accent, writing: p.accent, tool: p.kinds.shell, done: p.ok, error: p.bad, aborted: p.warn })[phase]

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export const register: Register = (on, options) => {
  glyphSetting = typeof options?.glyphs === 'string' ? options.glyphs : 'auto'
  avatarOn = options?.avatar !== 'off'
  openAtStart = options?.start !== 'off'
  glyphs = glyphSetting === 'nerd' ? NERD : PLAIN

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show the agent pane; args: compact | expand | close | reset',
    })

    // A turn, tool or agent left running by a reload mid-way is over by now.
    const now = await $.clock.now()
    await update($, turn, (t): Turn =>
      t.startedAt !== null && t.endedAt === null ? { ...t, endedAt: now, phase: 'idle', detail: IDLE.detail } : t,
    )
    await update($, tools, list => list.map((r): ToolRow => (r.state === 'running' ? { ...r, state: 'failed', endedAt: now } : r)))
    await update($, agents, list => list.map((a): AgentRow => (a.state === 'running' ? { ...a, state: 'failed', endedAt: now } : a)))
    await update($, pulse, p => ({ now, tick: p.tick + 1 }))
    await update($, place, (): Place => ({ cwd: e.cwd }))
    await loadPanel($)
    await readTheme($)
    await refreshMeter($)
    feedBroken = false

    if (glyphSetting === 'auto') glyphs = (await hasNerdFont($)) ? NERD : PLAIN

    if (openAtStart) {
      const isPlaced = await showPane($)
      if (!isPlaced) {
        $.ui.toast(`Agent pane is waiting for room. It seats itself at your first prompt, or type /${COMMAND}.`, {
          timeoutMs: 8000,
        })
      }
    }

    $.clock.every(1000, () => {
      void tick($)
    })

    return next(e)
  })

  on('config.set', { key: 'theme' }, async ($, e, next) => {
    const result = await next(e)
    await readTheme($)
    return result
  })

  // /cd, a worktree move or the host's directory change: the banner follows.
  on('classic.CwdChanged', async ($, e, next) => {
    await quiet(update($, place, (): Place => ({ cwd: e.new_cwd })))
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'compact' || arg === 'expand') {
      await setCompact($, arg === 'compact')
      await showPane($)
      return { text: arg === 'compact' ? 'Agent pane is compact.' : 'Agent pane is expanded.' }
    }
    if (arg === 'close') {
      await $.ui.close({ id: PANE }).catch(() => undefined)
      return { text: 'Agent pane closed.' }
    }
    if (arg === 'reset') {
      await update($, history, () => NO_HISTORY)
      await update($, tools, () => [])
      await update($, agents, () => [])
      await update($, meter, m => ({ ...m, compactions: 0, lastCompactAt: null }))
      return { text: 'Agent pane history cleared.' }
    }
    const isPlaced = await showPane($)
    await refreshMeter($)
    return { text: isPlaced ? 'Agent pane is open.' : 'Agent pane is open but waits for a wider terminal.' }
  })

  // The person's prompt is behind this open, so a pane that waited undrawn on
  // a narrow terminal is seated here, at any width.
  on('prompt.submit', async ($, e, next) => {
    if (openAtStart) {
      try {
        const mine = (await $.ui.panes()).find(pane => pane.id === PANE)
        if (mine === undefined || !mine.isPlaced) await showPane($)
      } catch {
        // the pane is a courtesy, never a gate on the prompt
      }
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const now = await $.clock.now()
    const task = oneLine(e.text, 200)
    const [m, before] = await Promise.all([read($, meter), read($, turn)])
    await update($, turn, (t): Turn => ({
      ...IDLE,
      turnId: e.turnId,
      task: task || t.task,
      model: t.model,
      speed: before.speed,
      costAtStart: m.usd,
      startedAt: now,
      phase: 'thinking',
      detail: 'reading your prompt',
    }))
    await update($, pulse, p => ({ now, tick: p.tick + 1 }))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      // A subagent's request: its tokens, context, cost and effort on its row.
      const result = yield* next(e)
      const u = result.usage
      if (u) {
        const agentId = e.agentId
        const model = u.model || e.model
        const effort = typeof e.effort === 'string' ? e.effort : typeof e.effort === 'number' ? String(e.effort) : undefined
        await quiet(
          update($, agents, list =>
            list.map((a): AgentRow =>
              a.id === agentId
                ? {
                    ...a,
                    model,
                    steps: a.steps + 1,
                    tokens: a.tokens + sumModel(u),
                    contextTokens: sumModel(u),
                    costUsd: a.costUsd + costOf(model, u, true),
                    ...(effort !== undefined ? { effort } : {}),
                  }
                : a,
            ),
          ),
        )
      }
      return result
    }

    await update($, turn, (t): Turn => ({
      ...t,
      steps: e.index + 1,
      model: e.model,
      phase: 'thinking',
      detail: 'waiting for the model',
    }))

    const stream = next(e)
    let seen: string | null = null
    // Timed from the first item of the response, so time-to-first-token is left out.
    let startedAt: number | null = null
    for await (const chunk of stream) {
      if (startedAt === null) startedAt = await $.clock.now()
      if (chunk.kind === 'thinking' || chunk.kind === 'text' || chunk.kind === 'tool') {
        const mark = chunk.kind === 'tool' ? `tool:${chunk.id}` : chunk.kind
        if (mark !== seen) {
          seen = mark
          const phase: Phase = chunk.kind === 'text' ? 'writing' : chunk.kind === 'tool' ? 'tool' : 'thinking'
          const detail =
            chunk.kind === 'text' ? 'writing the answer' : chunk.kind === 'tool' ? `preparing ${label(chunk.name)}` : 'thinking'
          await update($, turn, (t): Turn => ({ ...t, phase, detail }))
        }
      } else if (chunk.kind === 'stop' && chunk.usage !== null) {
        const got = fromModel(chunk.usage)
        const seconds = ((await $.clock.now()) - startedAt) / 1000
        // Short responses are mostly tool-call stubs and one-burst replies cannot be timed.
        const rate = got.output / seconds
        const speed = got.output >= 20 && seconds >= 0.5 && rate <= 1000 ? Math.round(rate) : null
        await update($, turn, (t): Turn => ({
          ...t,
          usage: add(t.usage, got),
          model: chunk.usage?.model ?? t.model,
          speed: speed ?? t.speed,
        }))
      }
      yield chunk
    }
    await refreshMeter($)
    return await stream.result
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    const tool = String(e.tool)
    const detail = describeTool(tool, e as unknown as Record<string, unknown>)
    const startedAt = await $.clock.now()
    const row: ToolRow = { id: e.tool_use_id, tool, detail, state: 'running', startedAt, endedAt: null }
    await quiet(update($, tools, list => [...list, row].slice(-KEEP_TOOLS)))
    await quiet(update($, turn, (t): Turn => ({ ...t, toolCalls: t.toolCalls + 1, phase: 'tool', detail: activity(tool, detail) })))

    let isError = true
    try {
      const ran = await next(e)
      isError = ran.deny !== undefined || ran.isError === true
      return ran
    } finally {
      const endedAt = await $.clock.now()
      const list = await quiet(
        update($, tools, list => list.map((one): ToolRow => (one.id === row.id ? { ...one, state: isError ? 'failed' : 'done', endedAt } : one))),
      )
      const stillRunning = list?.some(one => one.state === 'running') ?? false
      if (!stillRunning) {
        await quiet(
          update($, turn, (t): Turn =>
            t.phase === 'tool' ? { ...t, phase: 'thinking', detail: `reading the ${label(tool)} result` } : t,
          ),
        )
      }
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started
    const now = await $.clock.now()
    const row: AgentRow = {
      id: started.agentId ?? e.tool_use_id,
      description: oneLine(e.description, 80),
      type: e.subagentType,
      model: started.model,
      state: 'running',
      startedAt: now,
      endedAt: null,
      tokens: 0,
      steps: 0,
      contextTokens: 0,
      costUsd: 0,
    }
    await quiet(update($, agents, list => [...list.filter(a => a.id !== row.id), row].slice(-KEEP_AGENTS)))
    await quiet(update($, pulse, p => ({ now, tick: p.tick + 1 })))
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    if (e.agentId !== undefined) {
      const agentId = e.agentId
      await quiet(
        update($, agents, list =>
          list.map((a): AgentRow => {
            if (a.id !== agentId) return a
            // A run whose steps went unseen still gets the turn's own sum.
            const unseen = a.steps === 0 && e.usage ? e.usage : null
            const model = e.usage?.model || a.model
            return {
              ...a,
              state: e.reason === 'answer' ? 'done' : 'failed',
              endedAt: now,
              model,
              tokens: unseen ? sumModel(unseen) : a.tokens,
              costUsd: unseen ? costOf(model, unseen, false) : a.costUsd,
            }
          }),
        ),
      )
      return next(e)
    }

    const phase: Phase = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'aborted' : 'error'
    const detail =
      e.reason === 'answer'
        ? `answered in ${fmtDur(e.durationMs)}`
        : e.reason === 'aborted'
          ? 'interrupted'
          : e.reason === 'refusal'
            ? 'the model refused'
            : 'ended on an API error'
    const reported = e.usage ? fromModel(e.usage) : null

    const before = await read($, turn)
    const spent = reported ?? before.usage
    await update($, turn, (t): Turn => ({
      ...t,
      // The engine's own duration wins over our clock, so the pane and the
      // transcript's "Baked for 42s" line agree.
      startedAt: now - e.durationMs,
      endedAt: now,
      phase,
      detail,
      usage: spent,
      model: e.usage?.model ?? t.model,
    }))
    await refreshMeter($)
    const m = await read($, meter)
    await update($, history, hist => ({
      turns: hist.turns + 1,
      usage: add(hist.usage, spent),
      durations: e.reason === 'answer' ? [...hist.durations, e.durationMs].slice(-KEEP_DURATIONS) : hist.durations,
      contextTrail: m.tokens === null ? hist.contextTrail : [...hist.contextTrail, m.tokens].slice(-KEEP_TRAIL),
    }))
    // The last response wrote the prompt cache: it stays warm for the TTL.
    await update($, meter, cur => ({ ...cur, cacheExpiresAt: now + CACHE_TTL_MS }))
    await update($, pulse, p => ({ now, tick: p.tick + 1 }))
    return next(e)
  })

  // Count the compactions of the main conversation; the pace toward the next
  // one starts over after each.
  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && !('skip' in compacted)) {
      const now = await $.clock.now()
      await quiet(update($, meter, m => ({ ...m, compactions: m.compactions + 1, lastCompactAt: now })))
      await quiet(update($, history, hist => ({ ...hist, contextTrail: [] })))
    }
    return compacted
  })

  // The feed's surface module failed: the pane draws its rows itself from now on.
  on('ui.fault', async ($, e, next) => {
    feedBroken = true
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // -------------------------------------------------------------------------
  // The drawing
  // -------------------------------------------------------------------------

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Client = 'Client' in ui && !feedBroken ? ui.Client : null
    const Raster = 'Raster' in ui ? ui.Raster : null
    const [t, hist, list, agentList, p, m, pn, pl] = await Promise.all([
      read($, turn),
      read($, history),
      read($, tools),
      read($, agents),
      read($, pulse),
      read($, meter),
      read($, panel),
      read($, place),
    ])

    const pal = pn.isLight ? LIGHT : DARK
    const g = glyphs
    const now = p.now
    const width = Math.max(24, e.props.bodyColumns)
    const bodyRows = Math.max(8, e.props.scroll.bodyRows)
    const inline = e.props.placement === 'inline'
    const isRunning = t.startedAt !== null && t.endedAt === null
    const elapsed = t.startedAt === null ? 0 : Math.max(0, (t.endedAt ?? now) - t.startedAt)
    const face = FACES[t.phase]
    const tone = faceColor(pal, t.phase)
    const isOpen = (id: SectionId) => !pn.isCompact && !pn.collapsed.includes(id)
    const runningTools = list.filter(r => r.state === 'running').length
    const runningAgents = agentList.filter(a => a.state === 'running').length
    const typical = median(hist.durations)
    const sessionAge = m.startedAt !== null ? fmtAge(Math.max(0, now - m.startedAt)) : null
    const barW = Math.max(8, Math.min(26, width - 20))
    const spin = g.spinner[p.tick % g.spinner.length] ?? g.running
    const heat = (ratio: number) => (ratio >= 0.9 ? pal.bad : ratio >= 0.75 ? pal.warn : pal.ok)

    // The agents: running first, then the latest finished, folded or not.
    const running = agentList.filter(a => a.state === 'running').reverse()
    const finished = agentList.filter(a => a.state !== 'running').reverse()
    const shownRunning = running.slice(0, SHOW_AGENTS)
    const shownFinished = pn.doneFolded ? [] : finished.slice(0, Math.max(1, SHOW_AGENTS - shownRunning.length))
    const hasCards = width >= 38
    const agentRows =
      (hasCards ? 4 : 1) + (running.length > 0 ? 1 + shownRunning.length * 5 : 0) + (finished.length > 0 ? 1 + shownFinished.length * 5 : 0)

    // The project's name heads the pane: big pixel letters where a Raster draws and there is room, bold text otherwise.
    const project = baseName(pl.cwd)
    const bigName = Raster !== null && !pn.isCompact && !inline && bodyRows >= 20

    // Room: the activity feed takes what the fixed parts leave; the avatar goes first when short.
    const showAvatar = avatarOn && !pn.isCompact && !inline && bodyRows >= 30
    const shown = SECTIONS.filter(id => id !== 'agents' || agentList.length > 0)
    const bodyOf: Record<SectionId, number> = {
      task: 2,
      turn: 2,
      context: 2,
      usage: 5,
      limits: Math.max(1, m.limits.length),
      agents: agentRows,
      activity: 0,
    }
    const fixed =
      (bigName ? 3 : 1) +
      2 +
      (showAvatar ? 5 : 2) +
      shown.reduce((n, id) => n + 1 + (isOpen(id) ? bodyOf[id] : 0), 0) +
      (e.props.isFocused ? 2 : 0)
    const room = Math.max(2, Math.min(SHOW_TOOLS, bodyRows - fixed))

    // -- pieces ------------------------------------------------------------

    const bar = (ratio: number, color: string, w = barW) => {
      const n = Math.round(Math.min(1, Math.max(0, ratio)) * w)
      return (
        <Text>
          {n > 0 && <Text color={color}>{g.fill.repeat(n)}</Text>}
          {w - n > 0 && <Text color={pal.faint}>{g.track.repeat(w - n)}</Text>}
        </Text>
      )
    }

    const dim = (text: string) => (
      <Text color={pal.muted} wrap="truncate-end">
        {text}
      </Text>
    )

    const rule = (w: number) => <Text color={pal.faint}>{g.rule.repeat(Math.max(1, w))}</Text>

    const section = (id: SectionId, title: string, right: RenderElement | string | null, body: () => RenderElement[]): RenderElement[] => {
      const open = isOpen(id)
      const head = (
        <Box key={`row-${id}`} flexDirection="row" height={1} overflow="hidden" hover={{ backgroundColor: pal.hoverBg }}>
          <Button key={`sec-${id}`} plain onPress={() => void toggleSection($, id)}>
            {`${open ? g.open : g.closed} `}
            <Text bold color={pal.accent}>
              {title}
            </Text>
          </Button>
          <Box flexGrow={1} />
          {typeof right === 'string' ? dim(right) : right}
          <Text> </Text>
        </Box>
      )
      if (!open) return [head]
      return [
        head,
        <Box flexDirection="column" paddingLeft={2} paddingRight={1}>
          {body()}
        </Box>,
      ]
    }

    // -- the head: Clawd, name, state, the NOW line ------------------------

    const model = t.model !== null ? modelName(t.model) : null
    const dots = isRunning ? '.'.repeat((p.tick % 3) + 1) : ''
    const stats = isRunning
      ? `step ${t.steps} · ${plural(t.toolCalls, 'tool call')}${runningAgents > 0 ? ` · ${plural(runningAgents, 'agent')}` : ''}`
      : hist.turns > 0
        ? `${plural(hist.turns, 'turn')} this session`
        : 'no turn yet'
    const turnCost = t.costAtStart !== null && m.usd !== null ? Math.max(0, m.usd - t.costAtStart) : null
    const costLine =
      m.usd === null ? 'no cost reading yet' : `${turnCost !== null ? `${fmtUsd(turnCost)} this turn · ` : ''}${fmtUsd(m.usd)} total`
    const nowLine = (
      <Text wrap="truncate-end">
        <Text color={tone}>{`${isRunning ? spin : g.running} `}</Text>
        {t.detail}
      </Text>
    )
    // Clawd's hat takes the phase's colour; a clay hat on a clay body is lifted a shade.
    const hat = tone === pal.accent ? mix(pal.accent, '#ffffff', 0.4) : tone
    const blink = isRunning ? p.tick % 6 === 0 : p.tick % 7 === 0
    const eyes: Eyes = blink && face.look === 'open' ? 'low' : face.look
    const clawdSprite = clawd({ hat, eyes, frame: isRunning ? p.tick : 1, ...(t.phase === 'error' ? { eyeColor: pal.bad } : {}) })
    const portrait =
      Raster !== null ? (
        <Box width={16} flexShrink={0}>
          <Raster key="clawd" columns={clawdSprite.columns} rows={clawdSprite.rows} cells={clawdSprite.cells} />
        </Box>
      ) : (
        <Box flexDirection="column" width={11} flexShrink={0}>
          {avatar(t.phase, p.tick, isRunning).map(line => (
            <Text color={tone}>{line}</Text>
          ))}
        </Box>
      )
    const head = showAvatar ? (
      <Box flexDirection="row" gap={1}>
        {portrait}
        <Box flexDirection="column" flexGrow={1}>
          <Text wrap="truncate-end">
            <Text bold>Claude</Text>
            {model !== null && <Text color={pal.muted}>{`  ${model}`}</Text>}
          </Text>
          <Text color={tone}>
            {face.word}
            {dots}
          </Text>
          {dim(stats)}
          {nowLine}
          {dim(costLine)}
        </Box>
      </Box>
    ) : (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text bold>Claude</Text>
          <Text color={tone}>{`  ${face.word}${dots}`}</Text>
          <Text color={pal.muted}>{`  ${model !== null ? model + ' · ' : ''}${stats}`}</Text>
        </Text>
        {nowLine}
      </Box>
    )

    // -- TURN: elapsed against the median of this session's answered turns -

    const turnRight =
      t.startedAt === null ? 'no turn yet' : isRunning ? `${fmtDur(elapsed)}${typical !== null ? ` / ~${fmtDur(typical)}` : ''}` : `last ${fmtDur(elapsed)}`
    const turnBody = (): RenderElement[] => {
      const line1 =
        t.startedAt === null ? (
          dim('a turn starts with your prompt')
        ) : !isRunning ? (
          dim(`answered in ${fmtDur(elapsed)}${typical !== null ? ` · typical ${fmtDur(typical)}` : ''}`)
        ) : typical === null ? (
          dim('first turn · no estimate yet')
        ) : (
          <Text wrap="truncate-end">
            {bar(elapsed / typical, elapsed > typical ? pal.warn : pal.accent)}
            <Text color={pal.muted}>{elapsed <= typical ? ` ~${fmtDur(typical - elapsed)} left` : ` +${fmtDur(elapsed - typical)} over`}</Text>
          </Text>
        )
      const bits: string[] = []
      if (t.speed !== null) bits.push(`${t.speed} tok/s`)
      if (turnCost !== null && isRunning) bits.push(`${fmtUsd(turnCost)} so far`)
      if (hist.durations.length > 0) bits.push(`estimate from ${plural(hist.durations.length, 'past turn')}`)
      return [line1, dim(bits.length > 0 ? bits.join(' · ') : 'speed and cost show after the first reply')]
    }

    // -- CONTEXT: how full the window is and how far the next compaction is -

    const cap = m.threshold ?? m.window
    const hasContext = m.tokens !== null && m.window !== null
    const pct = hasContext ? (m.percent ?? Math.round(((m.tokens ?? 0) / (m.window ?? 1)) * 100)) : null
    const ratio = hasContext && cap !== null ? (m.tokens ?? 0) / cap : 0
    const contextRight =
      hasContext && pct !== null ? (
        <Text wrap="truncate-end">
          <Text color={pal.muted}>{`${fmtK(m.tokens ?? 0)} / ${fmtK(m.window ?? 0)} · `}</Text>
          <Text color={heat(ratio)}>{`${pct}%`}</Text>
        </Text>
      ) : (
        'no reading yet'
      )
    const contextBody = (): RenderElement[] => {
      if (!hasContext) return [dim('the window is read after the first reply'), dim('')]
      const left = cap === null ? null : Math.max(0, cap - (m.tokens ?? 0))
      const what =
        left === null ? '' : m.isAutoCompact === false ? ` ${fmtK(left)} free · auto-compact off` : ` compact in ~${fmtK(left)}`
      const perTurn = pace(hist.contextTrail)
      const bits: string[] = []
      const trail = spark(hist.contextTrail, 8)
      if (trail) bits.push(trail)
      if (perTurn !== null) bits.push(`+${fmtK(Math.round(perTurn))}/turn`)
      if (perTurn !== null && left !== null && left > 0 && m.isAutoCompact !== false) {
        bits.push(`~${plural(Math.max(1, Math.round(left / perTurn)), 'turn')} left`)
      }
      if (m.compactions > 0) {
        const ago = m.lastCompactAt !== null ? ` (${fmtAge(Math.max(0, now - m.lastCompactAt))} ago)` : ''
        bits.push(`compacted ${m.compactions}×${ago}`)
      }
      return [
        <Text wrap="truncate-end">
          {bar(ratio, heat(ratio))}
          <Text color={pal.muted}>{what}</Text>
        </Text>,
        dim(bits.length > 0 ? bits.join(' · ') : 'the pace shows after a few turns'),
      ]
    }

    // -- USAGE: two columns, this turn and the whole session ----------------

    const col1 = 8
    const col2 = Math.max(7, Math.min(10, Math.floor((width - 4 - col1) / 2)))
    const rowOf = (name: string, a: number, b: number) => `${name.padEnd(col1)}${fmtK(a).padStart(col2)}${fmtK(b).padStart(col2)}`
    const usageRight = `${'turn'.padStart(col2)}${'session'.padStart(col2)}`
    const usageBody = (): RenderElement[] => [
      dim(rowOf('output', t.usage.output, hist.usage.output)),
      dim(rowOf('input', t.usage.input, hist.usage.input)),
      dim(rowOf('cached', t.usage.cacheRead + t.usage.cacheWrite, hist.usage.cacheRead + hist.usage.cacheWrite)),
      <Text bold wrap="truncate-end">
        {rowOf('total', total(t.usage), total(hist.usage))}
      </Text>,
      dim(m.usd !== null ? `${fmtUsd(m.usd)} spent this session` : 'no cost reading yet'),
    ]

    // -- LIMITS: each window's fill, and the prompt cache's countdown --------

    const cacheLeft = m.cacheExpiresAt === null ? null : m.cacheExpiresAt - now
    const cacheText = isRunning
      ? 'cache warm'
      : cacheLeft === null
        ? 'cache —'
        : cacheLeft <= 0
          ? 'cache cold'
          : cacheLeft <= CACHE_ALERT_MS
            ? `cache ${fmtClock(cacheLeft)}`
            : `cache ${fmtAge(cacheLeft)}`
    const cacheColor =
      cacheLeft === null || isRunning
        ? pal.muted
        : cacheLeft <= CACHE_ALERT_MS
          ? pal.bad
          : cacheLeft <= CACHE_WARN_MS
            ? pal.warn
            : pal.kinds.agent
    const limitsRight = (
      <Text color={cacheColor} wrap="truncate-end">
        {`${g.clock} ${cacheText}`}
      </Text>
    )
    const limitsBody = (): RenderElement[] => {
      if (m.limits.length === 0) return [dim('no reading yet')]
      const w = Math.max(6, Math.min(16, width - 30))
      return m.limits.map(l => {
        const r = l.percentUsed / 100
        const reset = l.resetsAt !== null ? ` · resets ${fmtAge(Math.max(0, l.resetsAt - now))}` : ''
        return (
          <Text wrap="truncate-end">
            <Text color={pal.muted}>{(LIMIT_NAMES[l.kind] ?? l.kind).padEnd(6)}</Text>
            {bar(r, heat(r), w)}
            <Text color={heat(r)}>{`${Math.round(l.percentUsed)}%`.padStart(5)}</Text>
            <Text color={pal.muted}>{reset}</Text>
          </Text>
        )
      })
    }

    // -- AGENTS: the cards, then a crab card per run -------------------------

    const agentsRight = runningAgents > 0 ? `${runningAgents} running` : `${plural(agentList.length, 'run')}`
    const agentsBody = (): RenderElement[] => {
      const innerW = width - 4
      const textW = Math.max(10, innerW - 10)
      const cost = agentList.reduce((s, a) => s + a.costUsd, 0)
      const tokens = agentList.reduce((s, a) => s + a.tokens, 0)
      const first = Math.min(...agentList.map(a => a.startedAt))
      const last = Math.max(...agentList.map(a => a.endedAt ?? Math.max(now, a.startedAt)))
      const span = agentList.length > 0 ? Math.max(0, last - first) : 0

      const card = (name: string, value: string) => (
        <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={pal.faint} paddingX={1}>
          <Text color={pal.muted}>{name}</Text>
          <Text bold wrap="truncate-end">
            {value}
          </Text>
        </Box>
      )
      const cards = hasCards ? (
        <Box flexDirection="row" gap={1}>
          {card('Cost', `≈${fmtUsd(cost)}`)}
          {card('Tokens', fmtK(tokens))}
          {card('Time', fmtDur(span))}
        </Box>
      ) : (
        dim(`≈${fmtUsd(cost)} · ${fmtK(tokens)} tokens · ${fmtDur(span)}`)
      )

      const row = (a: AgentRow): RenderElement[] => {
        const color = typeColor(a.type)
        const isLive = a.state === 'running'
        const ctx = Math.min(1, a.contextTokens / windowOf(a.model))
        const mark = isLive ? g.running : a.state === 'done' ? g.done : g.failed
        const markColor = isLive ? color : a.state === 'done' ? pal.ok : pal.bad
        const meta = `${modelName(a.model)}${a.effort ? ` · ${a.effort}` : ''}${a.state === 'failed' ? ' · failed' : ''}`
        const stats = `ctx ${Math.round(ctx * 100)}% · ${fmtK(a.contextTokens)}  ≈${fmtUsd(a.costUsd)}  ${fmtDur((a.endedAt ?? now) - a.startedAt)}`
        const look = crab({ hat: color, frame: isLive ? p.tick : 1, dim: !isLive, isLight: pn.isLight })
        const icon =
          Raster !== null ? (
            <Box width={9} flexShrink={0}>
              <Raster key={`crab-${a.id}`} columns={look.columns} rows={look.rows} cells={look.cells} />
            </Box>
          ) : (
            <Box width={9} flexShrink={0}>
              <Text color={color}>{` ${g.kinds.agent}`}</Text>
            </Box>
          )
        return [
          <Box flexDirection="row" gap={1}>
            {icon}
            <Box flexDirection="column" flexGrow={1}>
              <Box flexDirection="row" height={1} overflow="hidden">
                <Box flexShrink={1} overflow="hidden">
                  <Text bold={isLive} wrap="truncate-end">
                    {a.description || a.type}
                  </Text>
                </Box>
                <Box flexGrow={1} />
                <Text color={markColor}>{` ${mark}`}</Text>
              </Box>
              <Text wrap="truncate-end">
                <Text color={color}>{typeWord(a.type)}</Text>
                <Text color={pal.muted}>{`  ${meta}`}</Text>
              </Text>
              <Box flexDirection="row" height={1} overflow="hidden">
                <Box flexGrow={1} />
                <Text color={pal.muted} wrap="truncate-start">
                  {stats}
                </Text>
              </Box>
              {isLive ? bar(ctx, pal.muted, textW) : bar(1, a.state === 'done' ? color : pal.bad, textW)}
            </Box>
          </Box>,
          rule(innerW),
        ]
      }

      const out: RenderElement[] = [cards]
      if (running.length > 0) {
        out.push(dim(`Running · ${running.length}`))
        for (const a of shownRunning) out.push(...row(a))
      }
      if (finished.length > 0) {
        out.push(
          <Button key="agents-done" plain onPress={() => void toggleDone($)}>
            {`${pn.doneFolded ? g.closed : g.open} `}
            <Text color={pal.muted}>{`Finished · ${finished.length}`}</Text>
          </Button>,
        )
        for (const a of shownFinished) out.push(...row(a))
      }
      return out
    }

    // -- ACTIVITY: the recent tool calls, the running ones alive ------------

    const recent = list.slice(-room)
    const tones = Object.fromEntries(KINDS.map(k => [k, shades(pal.kinds[k], pn.isLight)]))
    const feedRows: FeedRow[] = recent.map(row => {
      const kind = kindOf(row.tool)
      const color = pal.kinds[kind]
      const isLive = row.state === 'running'
      // Status first, then the tool's word in its kind's colour (and its pictogram where the font has real ones), then the detail.
      const mark: FeedSeg = isLive ? { t: '', c: color, spin: true } : row.state === 'done' ? { t: g.done, c: pal.ok } : { t: g.failed, c: pal.bad }
      const word = tag(row.tool).padEnd(TAG_WIDTH)
      const what = feedText(row.tool, row.detail)
      const left: FeedSeg[] = [
        mark,
        { t: ' ' },
        ...(g.icons ? [{ t: `${g.kinds[kind]} `, c: color }] : []),
        { t: word, c: color, b: isLive },
        { t: ' ' },
        isLive ? { t: what, sh: kind, b: true } : { t: what, dim: true, ...(row.state === 'failed' ? { c: pal.bad } : {}) },
      ]
      const right: FeedSeg[] = [{ t: ` ${fmtSecs((row.endedAt ?? now) - row.startedAt)}`, c: pal.muted }]
      return { id: row.id, running: isLive, left, right }
    })
    const activityRight = runningTools > 0 ? `${runningTools} running` : `${plural(t.toolCalls, 'call')} this turn`
    const feedProps: FeedProps = {
      rows: feedRows,
      tones,
      spinner: g.spinner,
      spinnerColor: pal.accent,
      hoverBg: pal.hoverBg,
      empty: 'no tool calls yet',
    }
    const activityBody = (): RenderElement[] => {
      if (Client !== null) return [<Client key="feed" module="./feed.tsx" props={JSON.parse(JSON.stringify(feedProps)) as unknown} />]
      if (feedRows.length === 0) return [dim('no tool calls yet')]
      // Plain rows, where the surface module is not drawn.
      return feedRows.map(r => (
        <Box flexDirection="row" height={1} overflow="hidden">
          <Box flexShrink={1} overflow="hidden">
            <Text wrap="truncate-end">
              {r.left.map(s => (
                <Text color={s.spin ? (s.c ?? pal.accent) : s.c} dimColor={s.dim} bold={s.b}>
                  {s.spin ? spin : s.t}
                </Text>
              ))}
            </Text>
          </Box>
          <Box flexGrow={1} />
          {r.right.map(s => (
            <Text color={s.c}>{s.t}</Text>
          ))}
        </Box>
      ))
    }

    // -- the pane ----------------------------------------------------------

    const titleRight = `${sessionAge !== null ? `${sessionAge} · ` : ''}${plural(hist.turns + (isRunning ? 1 : 0), 'turn')}`
    const nameSprite = banner({ text: project, color: pal.accent, maxColumns: width - 2 })

    return (
      <Box flexDirection="column" paddingX={1} minHeight={Math.max(1, e.props.scroll.bodyRows)}>
        {bigName && Raster !== null ? (
          <Box height={3} overflow="hidden">
            <Raster key="project" columns={nameSprite.columns} rows={nameSprite.rows} cells={nameSprite.cells} />
          </Box>
        ) : (
          <Text bold color={pal.accent} wrap="truncate-end">
            {project.toUpperCase()}
          </Text>
        )}
        <Box flexDirection="row" height={1} overflow="hidden">
          <Text bold color={pal.accent}>{`${g.pane} ${TITLE}`}</Text>
          <Box flexGrow={1} />
          {dim(titleRight)}
          <Text> </Text>
          <Button key="compact" plain dimColor label={pn.isCompact ? g.expand : g.compact} onPress={() => void setCompact($, !pn.isCompact)} />
          <Text> </Text>
          <Button key="refresh" plain dimColor label={g.refresh} onPress={() => void refreshMeter($)} />
        </Box>
        {rule(width - 2)}

        {head}

        {section('task', 'TASK', isOpen('task') ? null : t.task || 'nothing yet', () => [
          <Box height={2} overflow="hidden">
            <Text wrap="wrap">{t.task || 'nothing yet: type a prompt'}</Text>
          </Box>,
        ])}
        {section('turn', 'TURN', turnRight, turnBody)}
        {section('context', 'CONTEXT', contextRight, contextBody)}
        {section('usage', 'USAGE', isOpen('usage') ? usageRight : m.usd !== null ? fmtUsd(m.usd) : 'no reading', usageBody)}
        {section('limits', 'LIMITS', limitsRight, limitsBody)}
        {agentList.length > 0 && section('agents', 'AGENTS', agentsRight, agentsBody)}
        {section('activity', 'ACTIVITY', activityRight, activityBody)}

        {e.props.isFocused && (
          <Box flexDirection="row" gap={2} marginTop={1}>
            <Button key="k-compact" plain dimColor hotkey="c" label={pn.isCompact ? 'expand' : 'compact'} onPress={() => void setCompact($, !pn.isCompact)} />
            <Button key="k-refresh" plain dimColor hotkey="r" label="refresh" onPress={() => void refreshMeter($)} />
            <Button key="k-clear" plain dimColor hotkey="x" label="clear feed" onPress={() => void update($, tools, () => [])} />
          </Box>
        )}
      </Box>
    )
  })
}
