/**
 * UNI-2060: a Sheets ribbon / toolbar button's accessible name is the plain command name; the chord
 * goes into aria-keyshortcuts (from the same @genoffice/shortcuts row) and stays in the visible
 * tooltip. ExcelShell.tsx needs Univer to mount, so the wiring is checked on its syntax tree.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { LANGS } from '@genoffice/i18n'
import {
  accessibleShortcutProblems,
  findDisplayChord,
  type ShortcutPlatform,
  type ShortcutSurface,
} from '@genoffice/shortcuts'
import { describe, expect, it } from 'vitest'
import { clipboardAria, clipboardHint, sheetsAria } from '../src/renderer/sheets-keymap'
import { sheetsShortcut } from '../src/shared/sheets-shortcuts'
import { tFor, type StringKey } from '../src/renderer/i18n/locale'

const here = dirname(fileURLToPath(import.meta.url))
const SHELL = join(here, '../src/renderer/ExcelShell.tsx')
const source = ts.createSourceFile(
  SHELL,
  readFileSync(SHELL, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)

/** a chord helper or a value built from one (`saveTitle` = withKeyHint(t(..), sheetsHint(..))) */
const CHORD = /\b(?:sheetsHint|clipboardHint|withKeyHint|saveTitle|saveAsTitle|saveAsKeys)\b/

interface Tag {
  readonly line: number
  readonly name: string
  readonly attrs: ReadonlyMap<string, string>
}

const tags: Tag[] = []
/** expressions rendered as the text of an element, with the element chain that contains them */
const textExpressions: Array<{ line: number; text: string; hidden: boolean }> = []

function lineOf(node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
}

function hasJsx(node: ts.Node): boolean {
  let found = false
  const walk = (n: ts.Node): void => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) found = true
    else ts.forEachChild(n, walk)
  }
  walk(node)
  return found
}

function attrsOf(node: ts.JsxOpeningLikeElement): Map<string, string> {
  const attrs = new Map<string, string>()
  for (const prop of node.attributes.properties) {
    if (ts.isJsxAttribute(prop))
      attrs.set(prop.name.getText(source), prop.initializer?.getText(source) ?? 'true')
  }
  return attrs
}

function visit(node: ts.Node, hidden: boolean): void {
  let nextHidden = hidden
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const attrs = attrsOf(node)
    tags.push({ line: lineOf(node), name: node.tagName.getText(source), attrs })
    if (ts.isJsxOpeningElement(node) && attrs.has('aria-hidden')) nextHidden = true
  }
  if (ts.isJsxElement(node)) {
    const attrs = attrsOf(node.openingElement)
    const childHidden = hidden || attrs.has('aria-hidden')
    tags.push({ line: lineOf(node), name: node.openingElement.tagName.getText(source), attrs })
    for (const child of node.children) {
      if (
        ts.isJsxExpression(child) &&
        child.expression &&
        !hasJsx(child.expression) &&
        CHORD.test(child.expression.getText(source))
      ) {
        textExpressions.push({
          line: lineOf(child),
          text: child.expression.getText(source),
          hidden: childHidden,
        })
      }
      visit(child, childHidden)
    }
    // the opening tag's attributes are visited below through the generic walk
    ts.forEachChild(node.openingElement, (c) => visit(c, hidden))
    return
  }
  ts.forEachChild(node, (c) => visit(c, nextHidden))
}
visit(source, false)

const bound = tags.filter((tag) =>
  [...tag.attrs.entries()].some(([name, value]) => name === 'data-tip-kbd' || CHORD.test(value)),
)

describe('Sheets ribbon buttons keep the chord out of their accessible name', () => {
  it('finds the chord-bearing controls', () => {
    expect(bound.length).toBeGreaterThanOrEqual(10)
  })

  it('no aria-label is built from a chord helper', () => {
    const bad = tags.filter((tag) => CHORD.test(tag.attrs.get('aria-label') ?? ''))
    expect(bad.map((tag) => `ExcelShell.tsx:${tag.line} ${tag.attrs.get('aria-label')}`)).toEqual(
      [],
    )
  })

  it('no chord is rendered as the text of a control unless it is aria-hidden', () => {
    const bad = textExpressions.filter((e) => !e.hidden)
    expect(bad.map((e) => `ExcelShell.tsx:${e.line} ${e.text}`)).toEqual([])
  })

  it('every chord-bearing control also carries aria-keyshortcuts (or a `keys` prop)', () => {
    const bad = bound.filter(
      (tag) =>
        !tag.attrs.has('aria-keyshortcuts') &&
        !(tag.name === 'RibbonButton' && tag.attrs.has('keys')),
    )
    expect(bad.map((tag) => `ExcelShell.tsx:${tag.line} <${tag.name}>`)).toEqual([])
  })
})

/** the command names the ribbon buttons use as their accessible name (aria-label or text) */
const NAME_KEYS: readonly StringKey[] = [
  'appSaveTitle',
  'appSaveAs',
  'appCutTitle',
  'appCopyTitle',
  'appPaste',
  'appOpenWorkbookTitle',
  'appFormatCells',
  'appInsertCells',
  'appDeleteCells',
  'appFind',
  'appGoTo',
  'appFilter',
]

describe('Sheets command names are plain in every locale', () => {
  it.each(LANGS)('%s', (lang) => {
    for (const key of NAME_KEYS) {
      expect(findDisplayChord(tFor(lang, key)), `${lang}.${key}`).toBeNull()
    }
  })
})

const TARGETS: ReadonlyArray<{ platform: ShortcutPlatform; surface: ShortcutSurface }> = [
  { platform: 'win', surface: 'desktop' },
  { platform: 'win', surface: 'web' },
  { platform: 'mac', surface: 'desktop' },
  { platform: 'mac', surface: 'web' },
]
const ROWS = [
  'sheets-02',
  'sheets-03',
  'sheets-04',
  'sheets-19',
  'sheets-20',
  'sheets-42',
  'sheets-43',
  'sheets-61',
  'sheets-81',
]

describe.each(TARGETS)('Sheets aria-keyshortcuts ($platform, $surface)', (target) => {
  it.each(ROWS)('%s: the ARIA chord of the same row as the hint', (id) => {
    expect(
      accessibleShortcutProblems(
        { name: 'Command', keyshortcuts: sheetsAria(id, target) || undefined },
        sheetsShortcut(id),
        target.platform,
        target.surface,
      ),
    ).toEqual([])
  })

  it('Cut / Copy / Paste each advertise their own letter', () => {
    const meta = target.platform === 'mac' ? 'Meta' : 'Control'
    expect(clipboardAria('X', target)).toBe(`${meta}+X`)
    expect(clipboardAria('C', target)).toBe(`${meta}+C`)
    expect(clipboardAria('V', target)).toBe(`${meta}+V`)
    // the visible tooltip hint is unchanged
    expect(clipboardHint('C', target)).toBe(target.platform === 'mac' ? '⌘C' : 'Ctrl+C')
  })
})
