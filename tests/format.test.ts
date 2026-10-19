import { expect, test } from 'claude-code/testing'

import { fmtAge, fmtClock, fmtDur, fmtK, fmtSecs, fmtUsd, median, pace, plural, spark } from '../hooks/format'
import { shades } from '../hooks/theme'
import { activity, describeTool, kindOf, label } from '../hooks/tools'

test('durations, ages and countdowns read as people say them', () => {
  expect(fmtDur(42_000)).toBe('0:42')
  expect(fmtDur(3_725_000)).toBe('1:02:05')
  expect(fmtAge(45_000)).toBe('45s')
  expect(fmtAge(72 * 60_000)).toBe('1h 12m')
  expect(fmtClock(9 * 60_000 + 7_000)).toBe('09:07')
  expect(fmtSecs(340)).toBe('0.3s')
  expect(fmtSecs(12_400)).toBe('12s')
  expect(fmtSecs(62_000)).toBe('1:02')
})

test('counts and money are short', () => {
  expect(fmtK(800)).toBe('800')
  expect(fmtK(1_234)).toBe('1.2k')
  expect(fmtK(52_000)).toBe('52k')
  expect(fmtK(1_300_000)).toBe('1.30M')
  expect(fmtUsd(1.234)).toBe('$1.23')
  expect(fmtUsd(12.34)).toBe('$12.3')
  expect(plural(1, 'turn')).toBe('1 turn')
  expect(plural(3, 'turn')).toBe('3 turns')
})

test('the estimate is the median and the pace counts growth alone', () => {
  expect(median([])).toBe(null)
  expect(median([5, 1, 3])).toBe(3)
  expect(median([1, 2, 3, 4])).toBe(2.5)
  expect(pace([10, 14, 12, 20])).toBe(6)
  expect(pace([5])).toBe(null)
})

test('a sparkline scales the last readings between low and high', () => {
  expect(spark([1], 8)).toBe('')
  expect(spark([0, 50, 100], 8)).toBe('▁▅█')
  expect(spark([3, 3, 3], 8)).toBe('▅▅▅')
})

test('shades run from a rest shade to a highlight', () => {
  const dark = shades('#d97757', false)
  expect(dark.length).toBe(4)
  expect(dark[2]).toBe('#d97757')
  expect(dark[0]).toBe('#774130')
  expect(shades('#b4532f', true)[2]).toBe('#b4532f')
})

test('tools are sorted into kinds and described in one line', () => {
  expect(kindOf('Bash')).toBe('shell')
  expect(kindOf('Grep')).toBe('search')
  expect(kindOf('mcp__github__list_issues')).toBe('other')
  expect(label('mcp__github__list_issues')).toBe('github:list_issues')
  expect(describeTool('Read', { file_path: '/a/b/c/d.ts' })).toBe('c/d.ts')
  expect(describeTool('Bash', { command: 'ls -la', description: 'List files' })).toBe('List files')
  expect(describeTool('Grep', { pattern: 'ui.open', path: '/x/types' })).toBe('ui.open in x/types')
  expect(activity('Bash', 'List files')).toBe('running List files')
  expect(activity('mcp__github__list_issues', '')).toBe('using github:list_issues')
})
