// @vitest-environment node
/**
 * The View tab sidebar buttons (Thumbnails, Outline, Comments, Compare) showed no hover tip while
 * every neighbouring ribbon button did (SB-V2). The App is too big to mount in jsdom, so the tips
 * are pinned from the source: each of the four toggles carries `data-tip={t('<its own label key>')}`.
 * Other rb-big buttons (the Page tab) have no tip yet and are deliberately not pinned here.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const APP_PATH = fileURLToPath(new URL('../src/renderer/App.tsx', import.meta.url))

const SIDEBAR_BUTTONS = [
  { sidebar: 'thumbs', key: 'thumbs' },
  { sidebar: 'outline', key: 'outline' },
  { sidebar: 'comments', key: 'commentsPanel' },
  { sidebar: 'compare', key: 'compare' },
  { sidebar: 'attachments', key: 'attachments' },
] as const

const source = ts.createSourceFile(
  APP_PATH,
  readFileSync(APP_PATH, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)

/** every <button> opening element whose className is the `rb-big${sidebar === '<name>' ...}` toggle */
function sidebarButtons(name: string): ts.JsxOpeningLikeElement[] {
  const found: ts.JsxOpeningLikeElement[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'button') {
      const cls = node.attributes.properties.find(
        (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(source) === 'className',
      )
      const text = cls?.initializer?.getText(source) ?? ''
      if (text.includes('rb-big') && text.includes(`sidebar === '${name}'`)) found.push(node)
    }
    node.forEachChild(visit)
  }
  visit(source)
  return found
}

describe('View tab sidebar buttons', () => {
  for (const { sidebar, key } of SIDEBAR_BUTTONS) {
    it(`${sidebar}: hover tip from its own label key`, () => {
      const buttons = sidebarButtons(sidebar)
      expect(buttons).toHaveLength(1)
      const tip = buttons[0]!.attributes.properties.find(
        (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(source) === 'data-tip',
      )
      expect(tip?.initializer?.getText(source)).toBe(`{t('${key}')}`)
    })
  }
})
