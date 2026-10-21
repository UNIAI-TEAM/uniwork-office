// @vitest-environment node
/**
 * UNI-2060: no string a control uses as its accessible name (an `aria-label={t('key')}`, or the
 * `{t('key')}` text of a button) names a keyboard chord, in any locale. The chord belongs in
 * `aria-keyshortcuts` and the visible tooltip. Found by reading the renderer sources, so a new
 * `aria-label` is covered without editing this test.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { createI18n, LANGS } from '@genoffice/i18n'
import { findDisplayChord } from '@genoffice/shortcuts'
import { strings } from '../src/renderer/i18n/strings'
import { slidesPlainLabel } from '../src/renderer/shortcuts'

const RENDERER = fileURLToPath(new URL('../src/renderer', import.meta.url))
const translate = createI18n(strings)
type Key = keyof typeof strings.zh

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...sources(path))
    else if (path.endsWith('.tsx')) out.push(path)
  }
  return out
}

/**
 * The literal keys of every `t('key')` call inside `node` (ternaries and templates included).
 * A call wrapped in a `*PlainLabel(...)` (it strips a hand-written trailing chord) goes to `plain`.
 */
function translatedKeys(node: ts.Node, into: Set<string>, plain: Set<string>): void {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text.endsWith('PlainLabel')
  ) {
    if (node.arguments[0]) translatedKeys(node.arguments[0], plain, plain)
    return
  }
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 't' &&
    node.arguments[0] &&
    ts.isStringLiteralLike(node.arguments[0])
  ) {
    into.add(node.arguments[0].text)
  }
  ts.forEachChild(node, (child) => translatedKeys(child, into, plain))
}

/** keys used as an accessible name: `aria-label` values and a button's own `{t('key')}` text */
function nameKeys(): { direct: Map<string, string[]>; plain: Map<string, string[]> } {
  const direct = new Map<string, string[]>()
  const plain = new Map<string, string[]>()
  for (const file of sources(RENDERER)) {
    const text = readFileSync(file, 'utf8')
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const found = new Set<string>()
    const wrapped = new Set<string>()
    const visit = (node: ts.Node): void => {
      if (
        ts.isJsxAttribute(node) &&
        node.name.getText(source) === 'aria-label' &&
        node.initializer
      ) {
        translatedKeys(node.initializer, found, wrapped)
      }
      if (
        ts.isJsxElement(node) &&
        node.openingElement.tagName.getText(source) === 'button' &&
        // an aria-label names the button; its text is then only what a sighted user reads
        !node.openingElement.attributes.properties.some(
          (prop) => ts.isJsxAttribute(prop) && prop.name.getText(source) === 'aria-label',
        )
      ) {
        for (const child of node.children) {
          if (ts.isJsxExpression(child) && child.expression) {
            translatedKeys(child.expression, found, wrapped)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    const where = file.slice(RENDERER.length + 1).replace(/\\/g, '/')
    for (const key of found) direct.set(key, [...(direct.get(key) ?? []), where])
    for (const key of wrapped) plain.set(key, [...(plain.get(key) ?? []), where])
  }
  return { direct, plain }
}

/** the detector knows modifier chords, glyphs and bare key names, in the locales' own spelling */
const namesChord = (name: string): boolean => findDisplayChord(name) !== null

describe('accessible-name strings carry no chord, in any locale', () => {
  it('every aria-label / button-text key is plain as it is', () => {
    const { direct } = nameKeys()
    expect(direct.size).toBeGreaterThan(5)
    const offenders: string[] = []
    for (const [key, files] of direct) {
      if (!(key in strings.zh)) continue
      for (const lang of LANGS) {
        const name = translate(lang, key as Key)
        if (namesChord(name)) offenders.push(`${lang} ${key} (${files.join(', ')}): ${name}`)
      }
    }
    expect(offenders.join('\n')).toBe('')
  })

  it('keys wrapped in the plain-label helper are plain once it has run', () => {
    const { plain } = nameKeys()
    expect(plain.size).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const [key, files] of plain) {
      if (!(key in strings.zh)) continue
      for (const lang of LANGS) {
        const name = slidesPlainLabel(translate(lang, key as Key))
        if (namesChord(name)) offenders.push(`${lang} ${key} (${files.join(', ')}): ${name}`)
      }
    }
    expect(offenders.join('\n')).toBe('')
  })
})
