import { expect, test } from 'claude-code/testing'

import { banner, bannerWidth, clawd, crab, sprite, toBase64 } from '../hooks/pixel'

/** The base64 back to little-endian u32 words. */
function words(b64: string): number[] {
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const bytes: number[] = []
  for (let i = 0; i < b64.length; i += 4) {
    const n = [0, 1, 2, 3].map(k => B64.indexOf(b64.charAt(i + k)))
    const a = n[0] ?? 0
    const b = n[1] ?? 0
    const c = n[2] ?? 0
    const d = n[3] ?? 0
    bytes.push((a << 2) | (b >> 4))
    if (c >= 0) bytes.push(((b & 15) << 4) | (c >> 2))
    if (d >= 0) bytes.push(((c & 3) << 6) | d)
  }
  const out: number[] = []
  for (let i = 0; i + 3 < bytes.length; i += 4) {
    out.push(((bytes[i] ?? 0) | ((bytes[i + 1] ?? 0) << 8) | ((bytes[i + 2] ?? 0) << 16) | ((bytes[i + 3] ?? 0) << 24)) >>> 0)
  }
  return out
}

test('base64 is the standard padded kind', () => {
  expect(toBase64([77, 97, 110])).toBe('TWFu')
  expect(toBase64([77, 97])).toBe('TWE=')
  expect(toBase64([77])).toBe('TQ==')
})

test('a sprite packs two pixel rows into one cell row of half blocks', () => {
  const s = sprite([
    ['#ff8800', null],
    [null, '#0000ff'],
  ])
  expect(s.columns).toBe(2)
  expect(s.rows).toBe(1)
  const w = words(s.cells)
  // An orange upper half over the terminal's background, then a blue lower half.
  expect(w.slice(0, 3)).toEqual([0x2580, 0xff8800, 0x01000000])
  expect(w.slice(3, 6)).toEqual([0x2584, 0x0000ff, 0x01000000])
})

test('a cell with both pixels set is an upper half over the lower colour', () => {
  const s = sprite([['#d97757'], ['#1f1e1d']])
  expect(words(s.cells)).toEqual([0x2580, 0xd97757, 0x1f1e1d])
})

test('the crabs are the size their rows promise', () => {
  const small = crab({ hat: '#1D9E75', frame: 0, dim: false, isLight: false })
  expect(small.columns).toBe(9)
  expect(small.rows).toBe(4)
  expect(words(small.cells).length).toBe(9 * 4 * 3)
  const big = clawd({ hat: '#98c379', eyes: 'open', frame: 0 })
  expect(big.columns).toBe(16)
  expect(big.rows).toBe(5)
  // The legs step: the two frames differ, and only there.
  expect(crab({ hat: '#1D9E75', frame: 1, dim: false, isLight: false }).cells).not.toBe(small.cells)
  // A finished crab is faded, never the brand clay itself.
  expect(words(crab({ hat: '#1D9E75', frame: 0, dim: true, isLight: false }).cells)).not.toContain(0xd97757)
  expect(words(small.cells)).toContain(0xd97757)
})

test('the banner spells the name five pixels high in the given colour and cuts to fit', () => {
  // W is five wide, O, R and K three: 14 columns of glyph and three blank ones between.
  expect(bannerWidth('work')).toBe(17)
  const big = banner({ text: 'work', color: '#d97757', maxColumns: 40 })
  expect(big.rows).toBe(3)
  expect(big.columns).toBe(17)
  expect(words(big.cells)).toContain(0xd97757)
  expect(words(big.cells)).not.toContain(0x1f1e1d)
  // Lower case draws as upper, so the width is the same.
  expect(banner({ text: 'WORK', color: '#d97757', maxColumns: 40 }).cells).toBe(big.cells)
  // Too long for the room: cut, with an ellipsis at the end, never wider than the room.
  const cut = banner({ text: 'agent-pane-mod', color: '#d97757', maxColumns: 20 })
  expect(cut.columns).toBeLessThanOrEqual(20)
  expect(cut.columns).toBeGreaterThan(5)
  // A character the font lacks draws as a question mark rather than nothing.
  expect(bannerWidth('@')).toBe(bannerWidth('?'))
})
