// G6-12 (UNI-1366) review R1-2 (sheets-safety): collapsing the AI panel while ask_clarification
// waits hid the card and left the run looking hung. Like html (whose panel stays mounted while
// collapsed), the card stays reachable: the panel cannot be closed while a question waits, and
// a question that arrives into a closed panel opens it.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveCopilotOpen } from '../src/renderer/ai/copilot-open'

describe('resolveCopilotOpen', () => {
  it('refuses a close while a clarification waits (button, ribbon toggle, menu command)', () => {
    expect(resolveCopilotOpen(true, false, true)).toBe(true)
    expect(resolveCopilotOpen(true, (open) => !open, true)).toBe(true)
  })

  it('still opens while a clarification waits', () => {
    expect(resolveCopilotOpen(false, true, true)).toBe(true)
    expect(resolveCopilotOpen(false, (open) => !open, true)).toBe(true)
  })

  it('closes and toggles as before when nothing waits', () => {
    expect(resolveCopilotOpen(true, false, false)).toBe(false)
    expect(resolveCopilotOpen(true, (open) => !open, false)).toBe(false)
    expect(resolveCopilotOpen(false, (open) => !open, false)).toBe(true)
  })
})

describe('ExcelShell wiring', () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/ExcelShell.tsx'),
    'utf8',
  )

  it('routes every open/close through resolveCopilotOpen with the pending-question state', () => {
    expect(src).toMatch(/resolveCopilotOpen\(\s*prev,\s*next,\s*askingRef\.current\s*\)/)
  })

  it('opens a closed panel when a question arrives', () => {
    expect(src).toMatch(/if \(aiClarify && !isCopilotOpen\) setIsCopilotOpen\(true\)/)
  })
})
