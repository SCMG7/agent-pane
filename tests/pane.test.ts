import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE_PROPS = {
  title: 'Agent',
  isFocused: false,
  bodyColumns: 48,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
}

const MOUNT = {
  plugin: 'agent-pane',
  surface: 'terminal' as const,
  component: 'Pane' as const,
  requestId: 'agent-pane',
  props: PANE_PROPS,
}

const USAGE = {
  input_tokens: 1200,
  output_tokens: 800,
  cache_read_input_tokens: 50_000,
  cache_creation_input_tokens: 2000,
  model: 'claude-fable-5-1',
}

const START = 1_000_000
/** The one message a compaction leaves behind. */
const SUMMARY = [{ role: 'user' as const, text: 'summary of the conversation so far', toolUses: [] }]
/** The five-hour window resets 2h 10m after the clock has moved 5 s past START. */
const RESETS_AT = new Date(START + 5_000 + 2 * 3_600_000 + 10 * 60_000).toISOString()

/** The world beneath the plugin: what the engine would answer. */
function world(on: On, context = { tokens: 76_000, threshold: 180_000 }) {
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.compact', () => ({ messages: SUMMARY }))
  on('command.register', () => ({ value: { command: 'agent-pane' } }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', () => ({ value: [] }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  on('session.usage', (_$, e) => ({
    value: {
      startedAt: START - 72 * 60_000,
      context: {
        tokens: context.tokens,
        window: 200_000,
        percent: Math.round((context.tokens / 200_000) * 100),
        breakdown:
          e.breakdown === undefined
            ? undefined
            : {
                categories: [],
                totalTokens: context.tokens,
                maxTokens: 200_000,
                rawMaxTokens: 200_000,
                autocompactSource: 'model-default' as const,
                percentage: Math.round((context.tokens / 200_000) * 100),
                gridRows: [],
                model: 'claude-fable-5-1',
                memoryFiles: [],
                mcpTools: [],
                agents: [],
                autoCompactThreshold: context.threshold,
                isAutoCompactEnabled: true,
                apiUsage: null,
              },
      },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 34, resetsAt: RESETS_AT },
        { kind: 'seven_day', percentUsed: 12 },
      ],
      cost: { usd: 1.23 },
    },
  }))
}

/** Every text of the tree and of the feed's own drawing, for a regex. */
async function texts(ui: { drawn: (scope?: { in?: string }) => Promise<unknown> }): Promise<string> {
  const tree = JSON.stringify(await ui.drawn())
  const feed = JSON.stringify(await ui.drawn({ in: 'feed' }).catch(() => null))
  return tree + feed
}

test('idle from the start: session age, context, limits and the cache with no turn yet', async ($, on) => {
  mock.clock(on, { now: START })
  world(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(MOUNT)
  expect(await ui.find({ type: 'Text', text: /^idle$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /waiting for your prompt/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1h 12m · 0 turns/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /76k \/ 200k · / })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^38%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /compact in ~104k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /resets 2h 10m/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\s+34%$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /cache —/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$1\.23 spent this session/ })).toBeDefined()
  expect(await ui.find({ key: 'sec-agents' })).toBeUndefined()
  expect(await texts(ui)).toContain('no tool calls yet')
  await ui.unmount()
})

test('a turn shows its task, then its time, speed estimate and tokens when it ends', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  world(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  await $.turn.start({ text: 'create a mod for the CLI\nwith an avatar', turnId: 't1' })
  const ui = await $.ui.mount(MOUNT)
  expect(await ui.find({ type: 'Text', text: /create a mod for the CLI/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^thinking/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /first turn · no estimate yet/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /cache warm/ })).toBeDefined()

  // The ticker from session.start moves the clock the pane draws.
  await clock.advance(5_000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^0:05$/ })).toBeDefined()

  await $.turn.complete({
    turnId: 't1',
    answer: 'all done',
    durationMs: 42_000,
    isAborted: false,
    reason: 'answer',
    usage: USAGE,
  })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^done$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^last 0:42$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /answered in 0:42/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /output\s+800\s+800/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /cached\s+52k\s+52k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /total\s+54k\s+54k/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Fable 5\.1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /cache 1h 00m/ })).toBeDefined()

  // A second turn is estimated from the first.
  await $.turn.start({ text: 'next task', turnId: 't2' })
  await clock.advance(10_000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^0:10 \/ ~0:42$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /~0:32 left/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /estimate from 1 past turn/ })).toBeDefined()
  await ui.unmount()
})

test('idle, the pane keeps ticking so the session age and the countdowns move', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  world(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(MOUNT)
  expect(await ui.find({ type: 'Text', text: /1h 12m · 0 turns/ })).toBeDefined()
  await clock.advance(3 * 60_000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /1h 15m · 0 turns/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /resets 2h 07m/ })).toBeDefined()
  await ui.unmount()
})

test('the cache countdown turns to minutes and seconds near its end', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  world(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: 'hello', durationMs: 1_000, isAborted: false, reason: 'answer', usage: USAGE })
  const ui = await $.ui.mount(MOUNT)
  await clock.advance(51 * 60_000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /cache 09:00/ })).toBeDefined()
  await clock.advance(10 * 60_000)
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /cache cold/ })).toBeDefined()
  await ui.unmount()
})

test('a compaction is counted and the pace starts over', async ($, on) => {
  mock.clock(on, { now: START })
  world(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.session.compact({ trigger: 'auto', messages: SUMMARY })
  const ui = await $.ui.mount(MOUNT)
  expect(await ui.find({ type: 'Text', text: /compacted 1× \(0s ago\)/ })).toBeDefined()
  await ui.unmount()
})

test('a tool call is named while it runs and ticked off after', async ($, on) => {
  mock.clock(on, { now: START })
  world(on)
  let release: () => void = () => {}
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  on('tool.call', { tool: 'Bash' }, async () => {
    await held
    return { result: { stdout: 'ok', stderr: '', interrupted: false, isImage: false }, isError: undefined }
  })

  await $.turn.start({ text: 'list files', turnId: 't1' })
  const ui = await $.ui.mount(MOUNT)
  const call = $.tool.call({ tool: 'Bash', tool_use_id: 'u1', command: 'ls -la /work', description: 'List files' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /running List files/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 running/ })).toBeDefined()
  const live = JSON.stringify((await ui.drawn()) as unknown)
  expect(live).toContain('"running":true')
  expect(live).toContain('List files')
  // The row leads with the tool's word, padded to the tag column, in the shell colour.
  expect(live).toContain('"t":"Bash ","c":"#61afef"')

  release()
  await call
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /reading the Bash result/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 call this turn/ })).toBeDefined()
  const done = JSON.stringify((await ui.drawn()) as unknown)
  expect(done).toContain('"running":false')
  await ui.unmount()
})

test('a subagent gets a row while it runs and a tick when it answers', async ($, on) => {
  mock.clock(on, { now: START })
  world(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'find the mods', turnId: 't1' })
  await $.agent.spawn({
    tool_use_id: 'u9',
    prompt: 'search the mods folder',
    description: 'Search for mods',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-fable-5-1',
    background: false,
    fork: false,
  })
  const ui = await $.ui.mount(MOUNT)
  expect(await ui.find({ key: 'sec-agents' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Explore$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Search for mods/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1 running$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Running · 1$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Cost$/ })).toBeDefined()
  expect(await ui.find({ type: 'Raster', key: 'crab-a1' })).toBeDefined()
  expect(await ui.find({ type: 'Raster', key: 'clawd' })).toBeDefined()

  await $.turn.complete({ turnId: 'a1-t1', agentId: 'a1', answer: 'found', durationMs: 3_000, isAborted: false, reason: 'answer', usage: USAGE })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /^1 run$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^54k$/ })).toBeDefined()
  // The answer's usage names Fable 5.1, so the run is priced at Fable's list prices:
  // 1.2k in, 800 out, 50k cache reads, 2k cache writes come to ten cents.
  expect(await ui.find({ type: 'Text', text: /Fable 5\.1/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /≈\$0\.10/ })).toBeDefined()
  expect(await ui.find({ key: 'agents-done' })).toBeDefined()
  await ui.press({ key: 'agents-done' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /Fable 5\.1/ })).toBeUndefined()
  expect(await ui.find({ type: 'Raster', key: 'crab-a1' })).toBeUndefined()
  await ui.unmount()
})

test('sections fold from their header and the compact button folds them all', async ($, on) => {
  mock.clock(on, { now: START })
  world(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'create a mod for the CLI', turnId: 't1' })
  const ui = await $.ui.mount(MOUNT)
  expect(await ui.find({ type: 'Text', text: /create a mod for the CLI/ })).toBeDefined()

  await ui.press({ key: 'sec-task' })
  await ui.redraw()
  // Folded, the header's right side carries the task instead of the body.
  expect(await ui.find({ type: 'Text', text: /^create a mod for the CLI$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /output\s+/ })).toBeDefined()

  await ui.press({ key: 'compact' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /output\s+/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^38%$/ })).toBeDefined()
  expect(await ui.find({ key: 'sec-activity' })).toBeDefined()

  await ui.press({ key: 'compact' })
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /output\s+/ })).toBeDefined()
  await ui.unmount()
})

test('the project name heads the pane in big letters, as text where short, and follows a directory change', async ($, on) => {
  mock.clock(on, { now: START })
  world(on)
  on('classic.CwdChanged', () => ({}))
  await $.session.start({ cwd: '/Users/me/code/my-app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(MOUNT)
  // Tall enough: the name is a pixel banner, three rows high, no text copy of it.
  const big = await ui.find({ type: 'Raster', key: 'project' })
  expect(big).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^MY-APP$/ })).toBeUndefined()

  // Compact: a bold line of text takes the banner's place.
  await ui.press({ key: 'compact' })
  await ui.redraw()
  expect(await ui.find({ type: 'Raster', key: 'project' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^MY-APP$/ })).toBeDefined()
  await ui.press({ key: 'compact' })
  await ui.redraw()

  // The session moves: the banner is redrawn for the new directory.
  await $.classic.CwdChanged({ old_cwd: '/Users/me/code/my-app', new_cwd: '/Users/me/code/other' })
  await ui.redraw()
  const moved = await ui.find({ type: 'Raster', key: 'project' })
  expect(moved).toBeDefined()
  expect(JSON.stringify(moved)).not.toBe(JSON.stringify(big))
  await ui.unmount()
})

test('a short pane spells the project name as bold text instead of the banner', async ($, on) => {
  mock.clock(on, { now: START })
  world(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...MOUNT, props: { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 14 } } })
  expect(await ui.find({ type: 'Raster', key: 'project' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^WORK$/ })).toBeDefined()
  await ui.unmount()
})
