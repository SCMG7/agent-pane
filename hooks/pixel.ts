// Pixel art for the terminal: a Raster of half-block cells, two pixels to a cell.
// A sprite is rows of pixels, each a hex colour or null for the terminal's own
// background; `sprite()` packs them as RasterProps' `columns`, `rows` and `cells`.

import { mix } from './theme'

export type Pixel = string | null
export type Sprite = { columns: number; rows: number; cells: string }

/** Claude's clay and ink, as DockCrab's Clawd wears them. */
export const CLAY = '#D97757'
export const INK = '#1F1E1D'

const DEFAULT = 0x01000000
const UPPER = 0x2580
const LOWER = 0x2584
const SPACE = 0x20

const rgb = (hex: string): number => parseInt(hex.slice(1), 16) & 0xffffff

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64 of the bytes. */
export function toBase64(bytes: readonly number[]): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += B64.charAt((n >> 18) & 63) + B64.charAt((n >> 12) & 63)
    out += b === undefined ? '=' : B64.charAt((n >> 6) & 63)
    out += c === undefined ? '=' : B64.charAt(n & 63)
  }
  return out
}

/** Packs a pixel grid into a Raster: each cell is an upper half block over the pixel beneath it. */
export function sprite(pixels: readonly (readonly Pixel[])[]): Sprite {
  const rows = Math.max(1, Math.ceil(pixels.length / 2))
  const columns = Math.max(1, ...pixels.map(r => r.length))
  const bytes: number[] = []
  const push = (v: number) => bytes.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const top = pixels[2 * r]?.[c] ?? null
      const bottom = pixels[2 * r + 1]?.[c] ?? null
      if (top === null && bottom === null) {
        push(SPACE)
        push(DEFAULT)
        push(DEFAULT)
      } else if (bottom === null && top !== null) {
        push(UPPER)
        push(rgb(top))
        push(DEFAULT)
      } else if (top === null && bottom !== null) {
        push(LOWER)
        push(rgb(bottom))
        push(DEFAULT)
      } else if (top !== null && bottom !== null) {
        push(UPPER)
        push(rgb(top))
        push(rgb(bottom))
      }
    }
  }
  return { columns, rows, cells: toBase64(bytes) }
}

/** Rows of a picture: each character a key of `ink`, anything else transparent. */
export const stamp = (rows: readonly string[], ink: Readonly<Record<string, string>>): Pixel[][] =>
  rows.map(row => [...row].map(ch => ink[ch] ?? null))

// --- the crabs --------------------------------------------------------------

/** A 9×8 crab: hat, body, claws, and four legs that step while it walks. */
const SMALL = [
  '..hhhhh..',
  '.ccccccc.',
  '.cicccic.',
  'ccccccccc',
  '.ccccccc.',
  '.c.c.c.c.',
  '', // legs: frame
  '.........',
] as const
const SMALL_LEGS = ['c.c...c.c', '.c.c.c.c.'] as const

export type CrabLook = { hat: string; frame: number; dim: boolean; isLight: boolean }

/** The agents list's crab: 9 columns by 4 rows. */
export function crab(look: CrabLook): Sprite {
  const fade = (c: string) => (look.dim ? mix(c, look.isLight ? '#ffffff' : '#000000', 0.55) : c)
  const rows = SMALL.map((row, i) => (i === 6 ? (SMALL_LEGS[look.frame % 2] ?? SMALL_LEGS[0]) : row))
  return sprite(stamp(rows, { h: fade(look.hat), c: fade(CLAY), i: fade(INK) }))
}

/** A 16×10 Clawd for the head: hat in the phase's colour, eyes by mood, legs that walk. */
const BIG = [
  '.....hhhhhh.....',
  '...cccccccccc...',
  '..cccccccccccc..',
  '..cceecccceecc..',
  '..cceecccceecc..',
  'cccccccccccccccc',
  '..cccccccccccc..',
  '...cccccccccc...',
  '...c..c..c..c...',
  '', // legs: frame
] as const
const BIG_LEGS = ['..c..c....c..c..', '...c..c..c..c...'] as const

export type Eyes = 'open' | 'low' | 'high' | 'shut'
export type ClawdLook = { hat: string; eyes: Eyes; eyeColor?: string; frame: number }

/** The head's Clawd: 16 columns by 5 rows. */
export function clawd(look: ClawdLook): Sprite {
  const rows = BIG.map((row, i) => {
    if (i === 9) return BIG_LEGS[look.frame % 2] ?? BIG_LEGS[0]
    const hide = (i === 3 && (look.eyes === 'low' || look.eyes === 'shut')) || (i === 4 && (look.eyes === 'high' || look.eyes === 'shut'))
    return hide ? row.replace(/e/g, 'c') : row
  })
  return sprite(stamp(rows, { h: look.hat, c: CLAY, e: look.eyeColor ?? INK }))
}

// --- the banner -------------------------------------------------------------

/** A pixel font five high: most glyphs three wide, N four, M and W five. */
const FONT: Readonly<Record<string, readonly string[]>> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '.#.', '..#'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  '-': ['...', '...', '###', '...', '...'],
  '_': ['...', '...', '...', '...', '###'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '.': ['.', '.', '.', '.', '#'],
  ' ': ['..', '..', '..', '..', '..'],
  '…': ['.....', '.....', '.....', '.....', '#.#.#'],
  '?': ['###', '..#', '.#.', '...', '.#.'],
}
const UNKNOWN = FONT['?'] as readonly string[]

const glyphOf = (ch: string): readonly string[] => FONT[ch.toUpperCase()] ?? UNKNOWN

/** How many columns the text takes in the banner font, one blank column between glyphs. */
export const bannerWidth = (text: string): number =>
  [...text].reduce((w, ch, i) => w + (glyphOf(ch)[0]?.length ?? 0) + (i > 0 ? 1 : 0), 0)

export type BannerLook = { text: string; color: string; maxColumns: number }

/** The text in big pixel letters: three rows high; cut with an ellipsis where it would not fit. */
export function banner(look: BannerLook): Sprite {
  const chars = [...look.text.toUpperCase()]
  if (bannerWidth(chars.join('')) > look.maxColumns) {
    while (chars.length > 1 && bannerWidth(`${chars.join('')}…`) > look.maxColumns) chars.pop()
    chars.push('…')
  }
  const rows = Array.from({ length: 5 }, (_, r) => chars.map(ch => glyphOf(ch)[r] ?? '').join('.'))
  return sprite(stamp(rows, { '#': look.color }))
}
