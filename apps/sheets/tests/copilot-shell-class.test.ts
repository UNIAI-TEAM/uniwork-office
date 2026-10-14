// Review R1-2 (upstream port): with Settings > "show the AI sidebar" off and the panel closed, the
// panel renders nothing (no rail), so the grid must drop the dock column instead of keeping the
// 34px rail track that the workbook would then auto-place into.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { copilotShellClass } from '../src/renderer/ai/copilot-open'

const here = dirname(fileURLToPath(import.meta.url))

describe('copilotShellClass', () => {
  it('has no dock column without the ai capability', () => {
    expect(copilotShellClass(false, true, false)).toBe('no-copilot')
    expect(copilotShellClass(false, false, false)).toBe('no-copilot')
  })

  it('has no dock column when the sidebar switch is off and the panel is closed', () => {
    expect(copilotShellClass(true, false, false)).toBe('no-copilot')
  })

  it('keeps the rail column when the switch is on and the panel is closed', () => {
    expect(copilotShellClass(true, true, false)).toBe('copilot-collapsed')
  })

  it('takes the full dock column while the panel is open, switch on or off', () => {
    expect(copilotShellClass(true, true, true)).toBe('')
    expect(copilotShellClass(true, false, true)).toBe('')
  })
})

describe('one-column layout for both panel sides', () => {
  it('declares the no-copilot grid for the default and the right side', () => {
    const sheets = readFileSync(join(here, '../src/renderer/styles.css'), 'utf8')
    const prefs = readFileSync(join(here, '../../../packages/ui/src/ai-panel-prefs.css'), 'utf8')
    expect(sheets).toMatch(
      /\.app-shell\.no-copilot \.sheet-body\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/,
    )
    expect(prefs).toMatch(
      /html\[data-ai-panel-side='right'\] \.app-shell\.no-copilot \.sheet-body\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/,
    )
  })
})
