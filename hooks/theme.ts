// Colours and glyphs: a dark and a light palette, and a plain-Unicode and a Nerd Font glyph set.

import type { ToolKind } from './tools'

export type Palette = {
  /** The pane's own accent: Claude's clay. */
  accent: string
  muted: string
  /** Bar tracks and rules. */
  faint: string
  hoverBg: string
  ok: string
  warn: string
  bad: string
  /** One colour per tool kind: reads purple, writes orange, shell blue, agents teal. */
  kinds: Record<ToolKind, string>
}

export const DARK: Palette = {
  accent: '#d97757',
  muted: '#7f848e',
  faint: '#3e4451',
  hoverBg: '#2c313a',
  ok: '#98c379',
  warn: '#e5c07b',
  bad: '#e06c75',
  kinds: {
    shell: '#61afef',
    read: '#c678dd',
    write: '#e8a35a',
    search: '#c678dd',
    agent: '#56b6c2',
    skill: '#98c379',
    web: '#61afef',
    ask: '#e5c07b',
    plan: '#abb2bf',
    other: '#abb2bf',
  },
}

/** Every colour at AAA contrast on a white background. */
export const LIGHT: Palette = {
  accent: '#b4532f',
  muted: '#5b6472',
  faint: '#d1d5db',
  hoverBg: '#f0f2f5',
  ok: '#14532d',
  warn: '#78350f',
  bad: '#7f1d1d',
  kinds: {
    shell: '#1e3a8a',
    read: '#6b21a8',
    write: '#9a3412',
    search: '#6b21a8',
    agent: '#0f766e',
    skill: '#14532d',
    web: '#1e3a8a',
    ask: '#78350f',
    plan: '#374151',
    other: '#374151',
  },
}

/** `a` moved toward `b` by `t` (0..1), both hex colours. */
export const mix = (a: string, b: string, t: number): string => {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (shift: number) => {
    const x = (pa >> shift) & 255
    const y = (pb >> shift) & 255
    return Math.round(x + (y - x) * t)
  }
  return '#' + [16, 8, 0].map(s => ch(s).toString(16).padStart(2, '0')).join('')
}

/** Four shades of a colour for the shimmer band, from its rest shade to its highlight. */
export const shades = (hex: string, isLight: boolean): string[] =>
  isLight
    ? [mix(hex, '#ffffff', 0.45), mix(hex, '#ffffff', 0.25), hex, mix(hex, '#000000', 0.3)]
    : [mix(hex, '#000000', 0.45), mix(hex, '#000000', 0.2), hex, mix(hex, '#ffffff', 0.35)]

export type Glyphs = {
  pane: string
  compact: string
  expand: string
  refresh: string
  clock: string
  open: string
  closed: string
  done: string
  failed: string
  running: string
  rule: string
  fill: string
  track: string
  kinds: Record<ToolKind, string>
  /** The kinds are pictograms worth drawing before a feed row's word; false where they are mere marks. */
  icons: boolean
  spinner: string[]
}

export const PLAIN: Glyphs = {
  icons: false,
  pane: '◉',
  compact: '⊟',
  expand: '⊞',
  refresh: '↻',
  clock: '⧗',
  open: '▾',
  closed: '▸',
  done: '✓',
  failed: '✗',
  running: '●',
  rule: '─',
  fill: '━',
  track: '─',
  kinds: { shell: '$', read: '≡', write: '✎', search: '⌕', agent: '⇄', skill: '◆', web: '⊕', ask: '?', plan: '☰', other: '·' },
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
}

const cp = (n: number) => String.fromCodePoint(n)

/**
 * Nerd Font glyphs, all from the Font Awesome 4 range (U+F000–U+F2E0): every
 * Nerd Font build carries it, the 2020 MesloLGS NF of Powerlevel10k included,
 * where the newer Material Design range (U+F0001 up) draws as blank boxes.
 */
export const NERD: Glyphs = {
  ...PLAIN,
  icons: true,
  pane: cp(0xf069), // asterisk
  compact: cp(0xf066), // compress
  expand: cp(0xf065), // expand
  refresh: cp(0xf021), // refresh
  clock: cp(0xf017), // clock-o
  open: cp(0xf0d7), // caret-down
  closed: cp(0xf0da), // caret-right
  done: cp(0xf00c), // check
  failed: cp(0xf00d), // times
  kinds: {
    shell: cp(0xf120), // terminal
    read: cp(0xf0f6), // file-text-o
    write: cp(0xf040), // pencil
    search: cp(0xf002), // search
    agent: cp(0xf17b), // android: a robot
    skill: cp(0xf12e), // puzzle-piece
    web: cp(0xf0ac), // globe
    ask: cp(0xf059), // question-circle
    plan: cp(0xf0ae), // tasks
    other: cp(0xf013), // cog
  },
}

/** The savvy-flow tiers' colours, so a savvy worker looks here as it does in its own panel. */
export const TIER_COLOR: Record<string, string> = {
  fable: '#7F77DD',
  heavy: '#D85A30',
  careful: '#BA7517',
  medium: '#378ADD',
  light: '#1D9E75',
}

const TYPE_COLOR: Record<string, string> = {
  Explore: '#1D9E75',
  Plan: '#378ADD',
  'general-purpose': '#7F77DD',
  claude: '#D97757',
  fork: '#888780',
}

const WHEEL = ['#1D9E75', '#378ADD', '#BA7517', '#7F77DD', '#D85A30', '#56b6c2']

/** One colour per agent type: a savvy tier's own, a known type's, else a steady pick from the wheel. */
export function typeColor(type: string): string {
  const bare = type.replace(/^[^:]*:/, '')
  const tier = bare.replace(/^savvy-/, '')
  if (bare.startsWith('savvy-') && TIER_COLOR[tier] !== undefined) return TIER_COLOR[tier] ?? WHEEL[0]!
  const known = TYPE_COLOR[bare]
  if (known !== undefined) return known
  let h = 0
  for (const ch of bare) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return WHEEL[h % WHEEL.length] ?? WHEEL[0]!
}

/** `savvy-careful` reads as `careful`; `oh-my-claudecode:executor` as `executor`. */
export const typeWord = (type: string): string => type.replace(/^[^:]*:/, '').replace(/^savvy-/, '')
