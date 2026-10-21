// UNI-2011 fix-win1 #3: hovering the Open card's extension line showed the ScreenTip and a native OS
// tooltip, because a child span still carried `title=`. A ScreenTip owner (`data-tip`) and anything
// inside it must not carry a native title: one tooltip only.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const RENDERER = join(__dirname, '../src/renderer/src')

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement

const attrNames = (el: Opening) =>
  el.attributes.properties.flatMap((p) => (ts.isJsxAttribute(p) ? [p.name.getText()] : []))

/** `file:line <tag>` of every intrinsic element with a native `title` attribute inside a `data-tip` element */
export function nativeTitlesInsideScreenTips(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: string[] = []
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1

  const scan = (root: ts.Node) => {
    const visit = (n: ts.Node) => {
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        const tag = n.tagName.getText()
        // a component may render its own markup; only intrinsic elements put a native title on screen
        if (/^[a-z]/.test(tag) && attrNames(n).includes('title'))
          found.push(`${file}:${lineOf(n)} <${tag}>`)
      }
      ts.forEachChild(n, visit)
    }
    visit(root)
  }

  const walk = (n: ts.Node) => {
    if (ts.isJsxElement(n) && attrNames(n.openingElement).includes('data-tip')) scan(n)
    else if (ts.isJsxSelfClosingElement(n) && attrNames(n).includes('data-tip')) scan(n)
    ts.forEachChild(n, walk)
  }
  walk(sf)
  return [...new Set(found)]
}

describe('a ScreenTip card carries no native title', () => {
  it('the detector sees a title on a ScreenTip owner and on a descendant', () => {
    const src = `const a = <button data-tip="x"><span title="y">z</span></button>
const b = <button data-tip="x" title="y" />
const c = <button title="only native"><span title="y" /></button>`
    expect(nativeTitlesInsideScreenTips('t.tsx', src)).toEqual([
      't.tsx:1 <span>',
      't.tsx:2 <button>',
    ])
  })

  it('no renderer file puts a native title on or under a data-tip element', () => {
    const files = readdirSync(RENDERER).filter((f) => f.endsWith('.tsx'))
    const found = files.flatMap((f) =>
      nativeTitlesInsideScreenTips(f, readFileSync(join(RENDERER, f), 'utf8')),
    )
    expect(found).toEqual([])
  })
})
