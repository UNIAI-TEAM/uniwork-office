// @vitest-environment node
/**
 * UNI-2060: a PDF toolbar button's accessible name is the plain command name; the chord goes into
 * aria-keyshortcuts (from the same @genoffice/shortcuts row) and stays in the visible tooltip.
 * App.tsx is too big to render in jsdom, so the wiring is checked on its syntax tree.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import {
  accessibleShortcutProblems,
  findDisplayChord,
  findShortcut,
  type ShortcutPlatform,
  type ShortcutSurface,
} from '@genoffice/shortcuts'
import { describe, expect, it } from 'vitest'
import { pdfPrevMatchProps, pdfTipProps } from '../src/renderer/shortcuts'

const APP = fileURLToPath(new URL('../src/renderer/App.tsx', import.meta.url))
const source = ts.createSourceFile(
  APP,
  readFileSync(APP, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)

/** every JSX element's opening tag with the text of each attribute */
function openingTags(): Array<{ line: number; attrs: Map<string, string>; spreads: string[] }> {
  const out: Array<{ line: number; attrs: Map<string, string>; spreads: string[] }> = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attrs = new Map<string, string>()
      const spreads: string[] = []
      for (const prop of node.attributes.properties) {
        if (ts.isJsxSpreadAttribute(prop)) spreads.push(prop.expression.getText(source))
        else attrs.set(prop.name.getText(source), prop.initializer?.getText(source) ?? 'true')
      }
      out.push({
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        attrs,
        spreads,
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return out
}

const CHORD_HELPERS = /\bpdf(?:Tip|PrevMatchTip|Hint|TipProps|PrevMatchProps)\b/

describe('PDF toolbar buttons keep the chord out of their accessible name', () => {
  const tags = openingTags()

  it('finds the chord-bearing buttons', () => {
    const bound = tags.filter((tag) =>
      [...tag.attrs.values(), ...tag.spreads].some((v) => CHORD_HELPERS.test(v)),
    )
    expect(bound.length).toBeGreaterThanOrEqual(12)
  })

  it('no aria-label is built from a chord helper', () => {
    const bad = tags.filter((tag) => CHORD_HELPERS.test(tag.attrs.get('aria-label') ?? ''))
    expect(bad.map((tag) => `App.tsx:${tag.line} ${tag.attrs.get('aria-label')}`)).toEqual([])
  })

  it('every chord-bearing button also carries aria-keyshortcuts', () => {
    const bad = tags.filter((tag) => {
      const bound = [...tag.attrs.values(), ...tag.spreads].some((v) => CHORD_HELPERS.test(v))
      return (
        bound && !tag.attrs.has('aria-keyshortcuts') && !tag.spreads.some((v) => /Props\(/.test(v))
      )
    })
    expect(bad.map((tag) => `App.tsx:${tag.line}`)).toEqual([])
  })
})

const PLATFORMS: ShortcutPlatform[] = ['win', 'mac']
const SURFACES: ShortcutSurface[] = ['desktop', 'web']
const ROWS = [
  ...new Set(
    [...readFileSync(APP, 'utf8').matchAll(/pdfTipProps\(t\('\w+'\), '(pdf-\d+)'\)/g)].map(
      (m) => m[1]!,
    ),
  ),
].filter((id) => id !== 'pdf-06')

describe.each(PLATFORMS)('PDF toolbar props (%s)', (platform) => {
  describe.each(SURFACES)('%s', (surface) => {
    it.each(ROWS)('%s: plain name, platform aria-keyshortcuts, chord kept in the tooltip', (id) => {
      const props = pdfTipProps('Command', id, platform, surface)
      expect(
        accessibleShortcutProblems(
          { name: 'Command', keyshortcuts: props['aria-keyshortcuts'] },
          findShortcut('pdf', id)!,
          platform,
          surface,
        ),
      ).toEqual([])
      // the tooltip is the label plus the row's primary chord, as before
      expect(props['data-tip']).toMatch(/^Command( \(.+\))?$/)
    })

    it('Next and Previous match each advertise only their own chords', () => {
      const next = pdfTipProps('Next', 'pdf-06', platform, surface)
      const prev = pdfPrevMatchProps('Previous', platform, surface)
      const meta = platform === 'mac' ? 'Meta' : 'Control'
      expect(next['aria-keyshortcuts']).toBe(`${meta}+G F3`)
      expect(prev['aria-keyshortcuts']).toBe(
        platform === 'mac' ? 'Shift+Meta+G Shift+F3' : 'Control+Shift+G Shift+F3',
      )
      expect(findDisplayChord('Next')).toBeNull()
      expect(next['data-tip']).toBe(platform === 'mac' ? 'Next (⌘G)' : 'Next (Ctrl+G)')
      expect(prev['data-tip']).toBe(
        platform === 'mac' ? 'Previous (⇧⌘G)' : 'Previous (Ctrl+Shift+G)',
      )
    })
  })
})
