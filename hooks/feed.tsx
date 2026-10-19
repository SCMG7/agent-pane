import type { ClientModule } from 'claude-code'

// The activity feed's surface module: it animates on the drawing thread, so a
// braille spinner turns and the running row's text shimmers at 10 fps without
// a round trip to the hooks module for each frame. The hooks module hands it
// plain rows of segments and the colours; it never posts anything back.

export type FeedSeg = {
  t: string
  /** Colour; absent for the theme's text colour. */
  c?: string
  dim?: boolean
  b?: boolean
  /** The tone (a key of `tones`) the segment shimmers in while its row runs. */
  sh?: string
  /** The spinner stands here, in `c` or the feed's spinner colour; `t` is ignored. */
  spin?: boolean
}
export type FeedRow = { id: string; running: boolean; left: FeedSeg[]; right: FeedSeg[] }
export type FeedProps = {
  rows: FeedRow[]
  /** Four shades per tone, dark to bright. */
  tones: Record<string, string[]>
  spinner: string[]
  spinnerColor: string
  hoverBg: string
  /** The line drawn with no rows. */
  empty: string
}

type Local = { phase: number; hover: number; ref: { stop?: () => void } }

const TICK_MS = 100

function shimmer(i: number, phase: number, len: number, palette: string[]): string {
  const band = ((phase * 1.6) % (len + 8)) - 4
  const d = Math.abs(i - band)
  return palette[d < 0.8 ? 3 : d < 1.8 ? 2 : d < 2.8 ? 1 : 0] ?? palette[0] ?? '#d97757'
}

const Feed: ClientModule<FeedProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  let state = surface.state
  if (state === undefined) {
    state = { phase: 0, hover: -1, ref: {} }
    surface.setState(state)
  }
  const st: Local = state
  const live = props.rows.some(r => r.running)
  if (live && !st.ref.stop) {
    st.ref.stop = surface.every(TICK_MS, () => {
      const cur = surface.state
      if (cur) surface.setState({ ...cur, phase: cur.phase + 1 })
    })
  } else if (!live && st.ref.stop) {
    st.ref.stop()
    st.ref.stop = undefined
  }
  const rows = props.rows
  surface.onPointer(e => {
    const cur = surface.state ?? st
    const over = e.type === 'leave' || e.y < 0 || e.y >= rows.length ? -1 : e.y
    if (over !== cur.hover) surface.setState({ ...cur, hover: over })
  })
  if (rows.length === 0) return <Text dimColor>{props.empty}</Text>

  const frame = props.spinner[st.phase % Math.max(1, props.spinner.length)] ?? '●'
  const draw = (s: FeedSeg, running: boolean) => {
    if (s.spin) return <Text color={s.c ?? props.spinnerColor}>{frame}</Text>
    const palette = running && s.sh ? props.tones[s.sh] : undefined
    if (!palette) {
      return (
        <Text color={s.c} dimColor={s.dim} bold={s.b}>
          {s.t}
        </Text>
      )
    }
    const chars = [...s.t]
    return (
      <Text bold={s.b}>
        {chars.map((ch, i) => (
          <Text color={shimmer(i, st.phase, chars.length, palette)}>{ch}</Text>
        ))}
      </Text>
    )
  }
  return (
    <Box flexDirection="column">
      {rows.map((r, i) => (
        <Box flexDirection="row" height={1} overflow="hidden" backgroundColor={i === st.hover ? props.hoverBg : undefined}>
          <Box flexShrink={1} overflow="hidden">
            {r.left.map(s => draw(s, r.running))}
          </Box>
          <Box flexGrow={1} />
          {r.right.map(s => draw(s, r.running))}
        </Box>
      ))}
    </Box>
  )
}

export default Feed
