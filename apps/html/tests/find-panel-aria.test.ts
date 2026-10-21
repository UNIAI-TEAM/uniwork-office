/**
 * UNI-2060: the shared find panel's Previous / Next / Close buttons are named by the plain command
 * in every locale and announce their chord in aria-keyshortcuts; the tooltips keep the chord.
 * The strings are the ones App.tsx hands to <FindPanel> (read from its `findStrings` literal), so a
 * new locale or a renamed key is covered without editing this test.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n, LANGS } from '@genoffice/i18n'
import { findDisplayChord } from '@genoffice/shortcuts'
import { FindPanel, type FindPanelStrings, type FindTarget } from '@genoffice/ui'
import { strings } from '../src/renderer/i18n/strings'
import appSource from '../src/renderer/App.tsx?raw'

const translate = createI18n(strings)
type Key = keyof typeof strings.zh

/** property -> i18n key of the `const findStrings: FindPanelStrings = { ... }` literal in App.tsx */
function findStringKeys(): Record<string, string> {
  const source = ts.createSourceFile(
    'App.tsx',
    appSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const keys: Record<string, string> = {}
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === 'findStrings' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const prop of node.initializer.properties) {
        if (!ts.isPropertyAssignment(prop)) continue
        const call = prop.initializer
        if (ts.isCallExpression(call) && ts.isStringLiteralLike(call.arguments[0]!)) {
          keys[prop.name.getText(source)] = call.arguments[0]!.text
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return keys
}

const TARGET: FindTarget = {
  editable: true,
  search: () => 0,
  activate: () => {},
  replaceOne: () => {},
  replaceAll: () => {},
  clear: () => {},
  onDocChanged: () => () => {},
}

function stringsFor(lang: (typeof LANGS)[number]): FindPanelStrings {
  const keys = findStringKeys()
  return Object.fromEntries(
    Object.entries(keys).map(([prop, key]) => [prop, translate(lang, key as Key)]),
  ) as unknown as FindPanelStrings
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

describe('html find panel step buttons', () => {
  it('hands the panel a plain name for Previous, Next and Close', () => {
    const keys = findStringKeys()
    expect(Object.keys(keys)).toEqual(expect.arrayContaining(['prevName', 'nextName', 'closeName']))
  })

  it.each(LANGS.map((lang) => [lang]))('%s: names carry no chord, chords are announced', (lang) => {
    const s = stringsFor(lang)
    act(() =>
      root.render(createElement(FindPanel, { target: TARGET, strings: s, onClose: () => {} })),
    )
    const prev = host.querySelector<HTMLElement>('[data-find-step="prev"]')!
    const next = host.querySelector<HTMLElement>('[data-find-step="next"]')!
    const close = host.querySelector<HTMLElement>('.find-close')!
    for (const el of [prev, next, close]) {
      const name = el.getAttribute('aria-label') ?? ''
      expect(findDisplayChord(name), `${lang}: ${name}`).toBeNull()
      expect(name, lang).not.toMatch(/\((?:Shift\+)?(?:Enter|Esc)\)/)
    }
    expect(prev.getAttribute('aria-keyshortcuts')).toBe('Shift+Enter')
    expect(next.getAttribute('aria-keyshortcuts')).toBe('Enter')
    expect(close.getAttribute('aria-keyshortcuts')).toBe('Escape')
    // the tooltips are untouched: they still carry the chord
    expect(prev.getAttribute('data-tip')).toBe(s.prevMatch)
    expect(close.getAttribute('data-tip')).toBe(s.closeEsc)
  })
})
