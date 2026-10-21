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
  /** the `t('key')` that names the control: its aria-label, its `label` prop, or its first text child */
  readonly nameKey: string | null
}

const T_CALL = /^t\('(\w+)'\)$/

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

function nameKeyOf(
  opening: ts.JsxOpeningLikeElement,
  children: readonly ts.JsxChild[],
): string | null {
  const attrs = attrsOf(opening)
  for (const name of ['aria-label', 'label']) {
    const key = T_CALL.exec((attrs.get(name) ?? '').replace(/^\{|\}$/g, ''))?.[1]
    if (key) return key
  }
  for (const child of children) {
    if (!ts.isJsxExpression(child) || !child.expression) continue
    const key = T_CALL.exec(child.expression.getText(source))?.[1]
    if (key) return key
  }
  return null
}

function visit(node: ts.Node, hidden: boolean): void {
  let nextHidden = hidden
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
    const attrs = attrsOf(node)
    tags.push({
      line: lineOf(node),
      name: node.tagName.getText(source),
      attrs,
      nameKey: nameKeyOf(node, []),
    })
    if (ts.isJsxOpeningElement(node) && attrs.has('aria-hidden')) nextHidden = true
  }
  if (ts.isJsxElement(node)) {
    const attrs = attrsOf(node.openingElement)
    const childHidden = hidden || attrs.has('aria-hidden')
    tags.push({
      line: lineOf(node),
      name: node.openingElement.tagName.getText(source),
      attrs,
      nameKey: nameKeyOf(node.openingElement, node.children),
    })
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
/** The control each row is wired to, found by what it does or is called, never by its row. */
const CONTROLS: ReadonlyArray<{
  readonly row: string
  readonly what: string
  readonly find: (tag: Tag) => boolean
  readonly count: number
}> = [
  { row: 'sheets-02', what: 'Open workbook notice', find: onClick('onOpenWorkbook'), count: 1 },
  { row: 'sheets-03', what: 'Save', find: labelled("t('appSaveTitle')"), count: 1 },
  { row: 'sheets-04', what: 'Save As', find: labelled("t('appSaveAs')"), count: 1 },
  { row: 'sheets-19', what: 'Insert cells', find: onCommand('insert-cells'), count: 1 },
  { row: 'sheets-20', what: 'Delete cells', find: onCommand('delete-cells'), count: 1 },
  { row: 'sheets-42', what: 'Go To', find: onCommand('goto-open'), count: 1 },
  { row: 'sheets-43', what: 'Find', find: onCommand('find'), count: 2 },
  { row: 'sheets-61', what: 'Format Cells', find: onCommand('format-cells'), count: 1 },
  { row: 'sheets-81', what: 'Filter', find: onCommand('filter-toggle'), count: 1 },
]

function onClick(handler: string): (tag: Tag) => boolean {
  return (tag) => (tag.attrs.get('onClick') ?? '').includes(handler)
}
function onCommand(command: string): (tag: Tag) => boolean {
  return onClick(`onCommand('${command}')`)
}
function labelled(call: string): (tag: Tag) => boolean {
  return (tag) => tag.attrs.get('aria-label') === `{${call}}`
}

/** the row a tag announces, read from its attribute's source: `sheetsAria('sheets-03', ...)` */
function wiredRow(tag: Tag): string | null {
  const value = tag.attrs.get('aria-keyshortcuts') ?? tag.attrs.get('keys') ?? ''
  return /sheetsAria\('(sheets-\d+)'/.exec(value)?.[1] ?? null
}

describe('Sheets ribbon buttons are wired to their own row', () => {
  it.each(CONTROLS)('$what announces $row', ({ row, find, count }) => {
    const found = tags.filter(find)
    expect(found).toHaveLength(count)
    expect(found.map((tag) => `ExcelShell.tsx:${tag.line} ${wiredRow(tag)}`)).toEqual(
      found.map((tag) => `ExcelShell.tsx:${tag.line} ${row}`),
    )
  })

  it('the Go To box in the formula bar announces its row too', () => {
    expect(readFileSync(SHELL, 'utf8')).toContain(
      "gotoKeysRef.current = sheetsAria('sheets-42', SHORTCUT_TARGET)",
    )
  })
})

describe.each(TARGETS)('Sheets aria-keyshortcuts ($platform, $surface)', (target) => {
  it.each(CONTROLS)('$what: its real name and the ARIA chord of its row', ({ row, find }) => {
    for (const tag of tags.filter(find)) {
      // the name the button really has (its aria-label or text) and the row it is really wired to
      expect(tag.nameKey, `ExcelShell.tsx:${tag.line}`).not.toBeNull()
      const wired = wiredRow(tag)
      expect(wired, `ExcelShell.tsx:${tag.line}`).not.toBeNull()
      expect(
        accessibleShortcutProblems(
          {
            name: tFor('en', tag.nameKey as StringKey),
            keyshortcuts: sheetsAria(wired as string, target) || undefined,
          },
          sheetsShortcut(row),
          target.platform,
          target.surface,
        ),
      ).toEqual([])
    }
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
