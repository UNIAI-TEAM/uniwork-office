import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MEETING_TINT,
  MODULE_TONES,
  signalStyle,
  tintStyle,
} from '../src/renderer/src/module-tones'

const tokens = readFileSync(join(__dirname, '..', '..', '..', 'packages/ui/src/tokens.css'), 'utf8')
const blocks = tokens.split(/\n(?=\[data-theme='dark'\]|@media \(prefers-color-scheme: dark\))/)

describe('module tones', () => {
  it('follows the spec table (6.1)', () => {
    expect(MODULE_TONES).toEqual({
      desk: 'gray',
      tasks: 'green',
      calendar: 'yellow',
      personal: 'pink',
      forms: 'teal',
      notes: 'gray',
      knowledge: 'blue',
      materials: 'blue',
      skills: 'blue',
      compose: 'blue',
    })
    expect(MEETING_TINT).toBe('violet')
  })

  it('every tint it uses has a fill and a glyph token in all three theme blocks', () => {
    expect(blocks).toHaveLength(3)
    for (const tint of new Set([...Object.values(MODULE_TONES), MEETING_TINT])) {
      for (const block of blocks) {
        expect(block).toMatch(new RegExp(`--tint-${tint}:\\s*#`))
        expect(block).toMatch(new RegExp(`--tint-${tint}-fg:\\s*#`))
      }
    }
  })

  it('tintStyle paints the fill with its readable glyph color', () => {
    expect(tintStyle('green')).toEqual({
      background: 'var(--tint-green)',
      color: 'var(--tint-green-fg)',
    })
  })

  it('signalStyle paints a status tile from the signal tokens (info has no -text twin)', () => {
    expect(signalStyle('danger')).toEqual({
      background: 'var(--danger-bg)',
      color: 'var(--danger-text)',
    })
    expect(signalStyle('warning')).toEqual({
      background: 'var(--warning-bg)',
      color: 'var(--warning-text)',
    })
    expect(signalStyle('info')).toEqual({ background: 'var(--info-bg)', color: 'var(--info)' })
  })
})
