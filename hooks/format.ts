// Pure formatting helpers: numbers, durations, ages, the sparkline.

export const pad2 = (n: number): string => String(n).padStart(2, '0')

/** `m:ss` or `h:mm:ss`, for a turn's length. */
export const fmtDur = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h > 0 ? `${h}:${pad2(m)}:${pad2(r)}` : `${m}:${pad2(r)}`
}

/** `45s`, `12m`, `1h 12m`, `3d 4h`, for ages and countdowns. */
export const fmtAge = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${pad2(m % 60)}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

/** `mm:ss`, for a countdown under an hour. */
export const fmtClock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`
}

/** `0.3s`, `12s`, `1:02`, for a tool call's or an agent's length. */
export const fmtSecs = (ms: number): string => {
  const s = Math.max(0, ms) / 1000
  if (s < 10) return `${s.toFixed(1)}s`
  if (s < 60) return `${Math.round(s)}s`
  return fmtDur(ms)
}

export const fmtK = (n: number): string => {
  if (n < 1000) return String(n)
  if (n < 10_000) return (n / 1000).toFixed(1) + 'k'
  if (n < 1_000_000) return Math.round(n / 1000) + 'k'
  return (n / 1_000_000).toFixed(2) + 'M'
}

export const fmtUsd = (n: number): string => `$${n < 10 ? n.toFixed(2) : n.toFixed(1)}`

export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export const median = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  const lo = s[mid - 1]
  const hi = s[mid]
  if (hi === undefined) return null
  return s.length % 2 === 1 || lo === undefined ? hi : (lo + hi) / 2
}

/** The average growth between consecutive readings, counting growth alone. */
export const pace = (trail: readonly number[]): number | null => {
  const steps: number[] = []
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1]
    const b = trail[i]
    if (a !== undefined && b !== undefined && b > a) steps.push(b - a)
  }
  if (steps.length === 0) return null
  return steps.reduce((sum, x) => sum + x, 0) / steps.length
}

export const oneLine = (s: string, max: number): string => {
  const line = s.trim().split('\n').find(l => l.trim().length > 0) ?? ''
  return line.length > max ? line.slice(0, max - 1) + '…' : line
}

export const str = (v: unknown, max = 60): string => (typeof v === 'string' ? oneLine(v, max) : '')

export const tail = (path: string, parts = 2): string => path.split('/').filter(Boolean).slice(-parts).join('/')

export const shortModel = (model: string | null): string | null => (model === null ? null : model.replace(/^claude-/, ''))

const SPARK = '▁▂▃▄▅▆▇█'

/** The last `width` readings as a row of bars, scaled between their lowest and highest. */
export const spark = (xs: readonly number[], width: number): string => {
  const vals = xs.slice(-Math.max(2, width))
  if (vals.length < 2) return ''
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  return vals
    .map(v => {
      const r = hi === lo ? 0.5 : (v - lo) / (hi - lo)
      return SPARK[Math.min(7, Math.floor(r * 8))] ?? '▁'
    })
    .join('')
}

/** `Opus 5.5`, `Fable 5.1`: a model id as people say it. */
export const modelName = (id: string): string => {
  const m = /(fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/i.exec(id)
  const [, family = '', major = '', minor] = m ?? []
  if (!family) return id.replace(/^claude-/, '').replace(/\[.*\]$/, '') || '—'
  return `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}${minor ? '.' + minor : ''}`
}
