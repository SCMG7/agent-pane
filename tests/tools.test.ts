import { expect, test } from 'claude-code/testing'

import { NERD, PLAIN } from '../hooks/theme'
import { feedText, tag, TAG_WIDTH } from '../hooks/tools'

test('every feed row has a word for its tool, no wider than the tag column', () => {
  expect(tag('Bash')).toBe('Bash')
  expect(tag('NotebookEdit')).toBe('Edit')
  expect(tag('WebSearch')).toBe('Web')
  expect(tag('WebFetch')).toBe('Fetch')
  expect(tag('mcp__github__list_issues')).toBe('MCP')
  expect(tag('SomethingNew')).toBe('Tool')
  for (const t of ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob', 'Agent', 'Skill', 'WebSearch', 'WebFetch', 'AskUserQuestion', 'TodoWrite', 'TaskCreate', 'EnterPlanMode', 'mcp__x__y', 'Other']) {
    expect(tag(t).length).toBeLessThanOrEqual(TAG_WIDTH)
  }
})

test('the row text names the tool in full where the tag does not', () => {
  expect(feedText('Bash', 'List files')).toBe('List files')
  expect(feedText('mcp__github__list_issues', 'open bugs')).toBe('github:list_issues  open bugs')
  expect(feedText('mcp__github__list_issues', '')).toBe('github:list_issues')
  expect(feedText('SomethingNew', 'x')).toBe('SomethingNew  x')
})

test('the Nerd Font glyphs stay in the Font Awesome range every Nerd Font build carries', () => {
  const cps = [NERD.pane, NERD.compact, NERD.expand, NERD.refresh, NERD.clock, NERD.open, NERD.closed, NERD.done, NERD.failed, ...Object.values(NERD.kinds)]
    .map(s => s.codePointAt(0) ?? 0)
  for (const cp of cps) {
    expect(cp).toBeGreaterThanOrEqual(0xf000)
    expect(cp).toBeLessThanOrEqual(0xf2e0)
  }
  expect(NERD.icons).toBe(true)
  // The plain set draws no pictogram before the word: its marks are too terse to read.
  expect(PLAIN.icons).toBe(false)
})
