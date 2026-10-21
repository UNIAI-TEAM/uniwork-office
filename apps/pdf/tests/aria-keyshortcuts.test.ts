// @vitest-environment node
/**
 * UNI-2060: a PDF toolbar button's accessible name is the plain command name; the chord goes into
 * aria-keyshortcuts (from the same @genoffice/shortcuts row) and stays in the visible tooltip.
 * App.tsx is too big to render in jsdom, so the wiring is checked on its syntax tree.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

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
