/**
 * @vitest-environment jsdom
 *
 * Deep folder tree rows, the same rules as the web's document-tree-row (UNI-2192):
 * 1. the indent is 20px per level, capped at 120px, so a deep name keeps its width;
 * 2. every name carries its full text as a `title` tooltip;
 * 3. the row "…" is an overlay that takes no width at rest: a row with a menu has no reserved end lane
 *    (touch keeps it), the menu shows on hover / focus / open, and only then does the name fade under it.
 * jsdom computes no hover or layout, so the CSS is pinned by its rules and the DOM by its classes and state.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkFolderNode } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import {
  TREE_MAX_PAD,
  TREE_PAD,
  TREE_STEP,
  treeRowPadding,
  UniworkFolderTree,
} from '../src/renderer/src/uniwork-folders/UniworkFolderTree'
import type { FolderMenuItem } from '../src/renderer/src/uniwork-folders/FolderMenu'
import { ROOT_KEY } from '../src/renderer/src/uniwork-folders/uniwork-folders-model'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const DEPTHS = 9
const LONG = 'Báo cáo tổng hợp quý ba của phòng kế hoạch và đầu tư'
const nameAt = (depth: number) => `${LONG} ${depth}`

/** one folder per level, each inside the previous: levels 1..9 once all are expanded */
function chain(depth = 0, parentId: string | null = null): UniworkFolderNode[] {
  if (depth === DEPTHS) return []
  const id = `f-${depth}`
  return [
    {
      id,
      parentId,
      title: nameAt(depth),
      position: 0,
      children: chain(depth + 1, id),
    },
  ]
}

const NODES = chain()
const ALL_OPEN = new Set([ROOT_KEY, ...Array.from({ length: DEPTHS }, (_, i) => `f-${i}`)])

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  localStorage.setItem('genoffice.lang', 'vi')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  vi.restoreAllMocks()
})

async function mount(withMenu: boolean) {
  const menuFor = (): FolderMenuItem[] => [{ id: 'rename', label: 'Rename', onSelect: vi.fn() }]
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'vi' },
        createElement(UniworkFolderTree, {
          nodes: NODES,
          label: 'Cây thư mục',
          expanded: ALL_OPEN,
          onExpandedChange: vi.fn(),
          selectedKey: 'f-0',
          onOpen: vi.fn(),
          hideRoot: true,
          menuFor: withMenu ? menuFor : undefined,
        }),
      ),
    )
  })
}

const rows = () => Array.from(host.querySelectorAll<HTMLElement>('[role="treeitem"]'))

const css = readFileSync(
  resolve(__dirname, '../src/renderer/src/uniwork-folders/uniwork-folders.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '')

/** the declaration blocks of every rule whose selector list contains `selector` exactly */
function rulesFor(selector: string, source = css): string[] {
  const out: string[] = []
  for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (
      m[1]!
        .split(',')
        .map((s) => s.trim())
        .includes(selector)
    )
      out.push(m[2]!)
  }
  return out
}

/** the text of the first `@media <query> { ... }` block (one level of nested rules) */
function mediaBlock(query: string): string {
  const start = css.indexOf(`@media ${query}`)
  expect(start, `@media ${query} exists`).toBeGreaterThan(-1)
  let depth = 0
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i)
  }
  throw new Error(`unterminated @media ${query}`)
}

describe('indent: 20px per level, capped at 120px', () => {
  it('draws the rows of a nine-level chain with the capped padding', async () => {
    await mount(true)
    expect(rows()).toHaveLength(DEPTHS)
    expect(rows().map((r) => r.style.paddingInlineStart)).toEqual([
      '4px',
      '24px',
      '44px',
      '64px',
      '84px',
      '104px',
      '120px',
      '120px',
      '120px',
    ])
  })

  it('grows by TREE_STEP from TREE_PAD and never passes TREE_MAX_PAD', () => {
    expect(treeRowPadding(1)).toBe(TREE_PAD)
    expect(treeRowPadding(2)).toBe(TREE_PAD + TREE_STEP)
    expect(treeRowPadding(6)).toBe(TREE_PAD + 5 * TREE_STEP)
    expect(treeRowPadding(7)).toBe(TREE_MAX_PAD)
    expect(treeRowPadding(20)).toBe(TREE_MAX_PAD)
  })
})

describe('every name carries its full text as a tooltip', () => {
  it('sets title on the name of each row, at every depth', async () => {
    await mount(true)
    const titles = Array.from(host.querySelectorAll<HTMLElement>('.uwf-tree-title'))
    expect(titles.map((el) => el.title)).toEqual(
      Array.from({ length: DEPTHS }, (_, i) => nameAt(i)),
    )
    expect(titles.map((el) => el.textContent)).toEqual(titles.map((el) => el.title))
  })
})

describe('the row menu is an overlay, not a lane of the row', () => {
  it('marks only rows that carry a menu, with the button inside the row', async () => {
    await mount(true)
    for (const row of rows()) {
      expect(row.classList.contains('uwf-tree-row-menu')).toBe(true)
      const wrap = row.querySelector(':scope > .uw-row-menu.uwf-menu')
      expect(wrap?.querySelector('button[aria-haspopup="menu"]')).not.toBeNull()
    }
    await mount(false)
    for (const row of rows()) {
      expect(row.classList.contains('uwf-tree-row-menu')).toBe(false)
      expect(row.querySelector('.uw-row-menu')).toBeNull()
    }
  })

  it('an open menu marks its button on, the signal the reveal and the name fade read', async () => {
    await mount(true)
    const deep = rows()[7]!
    const button = () => deep.querySelector<HTMLButtonElement>('.uw-row-menu-btn')!
    expect(button().classList.contains('on')).toBe(false)
    await act(async () => {
      deep.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    expect(button().classList.contains('on')).toBe(true)
    expect(button().getAttribute('aria-expanded')).toBe('true')
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    // only that row's button
    expect(host.querySelectorAll('.uw-row-menu-btn.on')).toHaveLength(1)
  })

  it('the menu keys still open it (Shift+F10 on a deep row)', async () => {
    await mount(true)
    const deep = rows()[8]!
    await act(async () => {
      deep.focus()
      deep.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'F10',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    })
    expect(deep.querySelector('.uw-row-menu-btn.on')).not.toBeNull()
  })

  it('takes no width at rest: absolute, hidden until hover / focus / open', () => {
    const wrap = rulesFor('.uw-row-menu.uwf-menu').join('\n')
    expect(wrap).toMatch(/position:\s*absolute/)
    const rest = rulesFor('.uwf-tree .uwf-tree-row .uw-row-menu.uwf-menu .uw-row-menu-btn').join(
      '\n',
    )
    expect(rest).toMatch(/opacity:\s*0\b/)
    const shown = css.match(/([^{}]+)\{\s*opacity:\s*1;\s*\}/g)?.join('\n') ?? ''
    for (const state of [
      ':hover',
      ':focus-visible',
      ':has(:focus-visible)',
      '.uw-row-menu-btn.on',
    ]) {
      expect(shown, `${state} shows the button`).toContain(`.uwf-tree .uwf-tree-row`)
      expect(shown).toContain(state)
    }
  })

  it('reserves no end lane for it, except on touch where it stays visible', () => {
    const lane = rulesFor('.uwf-tree-row.uwf-tree-row-menu')
    expect(lane.join('\n')).toMatch(/padding-inline-end:\s*8px/)
    expect(css).toMatch(/\.uwf-tree-row\s*\{[^}]*padding-inline-end:\s*32px/)
    const coarse = rulesFor('.uwf-tree-row.uwf-tree-row-menu', mediaBlock('(pointer: coarse)'))
    expect(coarse.join('\n')).toMatch(/padding-inline-end:\s*32px/)
  })

  it('fades the name under the button only while the button shows, never on touch', () => {
    const fine = mediaBlock('not (pointer: coarse)')
    for (const state of [
      ':hover',
      ':focus-visible',
      ':has(:focus-visible)',
      ':has(.uw-row-menu-btn.on)',
    ]) {
      const sel = `.uwf-tree-row.uwf-tree-row-menu${state} .uwf-tree-text`
      for (const prefix of ['', "[dir='rtl'] "]) {
        const body = rulesFor(prefix + sel, fine).join('\n')
        expect(body, `${prefix}${sel}`).toMatch(/mask-image:\s*linear-gradient\(/)
        expect(body).toContain('var(--uwf-menu-reach)')
      }
    }
    // not at rest, and no unconditional rule on the name
    expect(rulesFor('.uwf-tree-row.uwf-tree-row-menu .uwf-tree-text').join('\n')).not.toMatch(
      /mask/,
    )
    expect(mediaBlock('(pointer: coarse)')).not.toMatch(/mask-image/)
  })

  it('the fade starts where the button reaches into the name: 28px at 4px from the edge, 8px padding', () => {
    const vars = rulesFor('.uwf-tree').join('\n')
    expect(vars).toContain('--uwf-menu-reach: 24px;')
    expect(vars).toContain('--uwf-menu-fade: 8px;')
    const wrap = rulesFor('.uw-row-menu.uwf-menu').join('\n')
    expect(wrap).toMatch(/inset-inline-end:\s*4px/)
    expect(wrap).toMatch(/width:\s*28px/)
    // 4 + 28 - 8 padding = 24
    expect(4 + 28 - 8).toBe(24)
  })

  it('lets the name box reach the row end, so the fade measures from the row and not from a short name', () => {
    expect(rulesFor('.uwf-tree-row.uwf-tree-row-menu .uwf-tree-text').join('\n')).toMatch(
      /flex:\s*1 1 auto/,
    )
  })
})
