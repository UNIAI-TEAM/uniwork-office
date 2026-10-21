// UNI-2011 fix-win1 #3: hovering the Open card's extension line showed the ScreenTip and a native OS
// tooltip, because a child span still carried `title=`. A ScreenTip owner (`data-tip`), anything
// inside it and any element around it must not carry a native title (the OS shows an ancestor's title
// too): one tooltip only.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const RENDERER = join(__dirname, '../src/renderer/src')

type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement

const attrNames = (el: Opening) =>
  el.attributes.properties.flatMap((p) => (ts.isJsxAttribute(p) ? [p.name.getText()] : []))

/** `file:line <tag>` of every intrinsic element with a native `title` attribute on, inside or around a `data-tip` element */
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

  const hasNativeTitle = (el: Opening) =>
    /^[a-z]/.test(el.tagName.getText()) && attrNames(el).includes('title')
  // intrinsic ancestors with a native title, outermost first
  const walk = (n: ts.Node, titled: Opening[]) => {
    const opening = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null
    if (opening && attrNames(opening).includes('data-tip')) {
      scan(n)
      for (const el of titled) found.push(`${file}:${lineOf(el)} <${el.tagName.getText()}>`)
    }
    const next = opening && hasNativeTitle(opening) ? [...titled, opening] : titled
    ts.forEachChild(n, (child) => walk(child, next))
  }
  walk(sf, [])
  return [...new Set(found)]
}

describe('a ScreenTip card carries no native title', () => {
  it('the detector sees a title on a ScreenTip owner and on a descendant', () => {
    const src = `const a = <button data-tip="x"><span title="y">z</span></button>
const b = <button data-tip="x" title="y" />
const c = <button title="only native"><span title="y" /></button>
const d = <div title="around"><p><button data-tip="x" /></p></div>`
    expect(nativeTitlesInsideScreenTips('t.tsx', src)).toEqual([
      't.tsx:1 <span>',
      't.tsx:2 <button>',
      't.tsx:4 <div>',
    ])
  })

  it('no renderer file puts a native title on or under a data-tip element', () => {
    const files = (readdirSync(RENDERER, { recursive: true }) as string[]).filter((f) =>
      f.endsWith('.tsx'),
    )
    expect(files.length).toBeGreaterThan(5)
    const found = files.flatMap((f) =>
      nativeTitlesInsideScreenTips(f, readFileSync(join(RENDERER, f), 'utf8')),
    )
    expect(found).toEqual([])
  })
})
