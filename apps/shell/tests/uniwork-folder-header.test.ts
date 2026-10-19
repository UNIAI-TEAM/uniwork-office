/**
 * @vitest-environment jsdom
 */
// UNI-1979: the open folder's header is one row (the web's folder page): the
// breadcrumb's bold leaf is the only folder name, with its rename pencil and
// "…" menu beside it, the search and create actions on the same row, and no
// hint line. jsdom has no layout, so this pins the structure and the CSS rules;
// the visual round proves the layout.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  UniworkFolderChildren,
  UniworkFolderNode,
  UniworkResult,
  UniworkWorkspaceRef,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })
const rendererDir = resolve(__dirname, '../src/renderer/src')
const homeCss = readFileSync(resolve(rendererDir, 'uniwork-home/documents-home.css'), 'utf8')
const foldersCss = readFileSync(resolve(rendererDir, 'uniwork-folders/uniwork-folders.css'), 'utf8')

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

/** the declarations of the first rule whose selector list is exactly `selector` */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)
  return match?.[1] ?? ''
}

function shrinkOf(body: string): number {
  const flex = /flex:\s*\d+\s+(\d+)/.exec(body)
  const shrink = /flex-shrink:\s*(\d+)/.exec(body)
  return Number(flex?.[1] ?? shrink?.[1] ?? Number.NaN)
}

describe('UNI-1979 open-folder header: one row, the folder name once', () => {
  let host: HTMLDivElement
  let root: Root
  let workspaces: UniworkWorkspaceRef[]
  let folderTree: UniworkFolderNode[]

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'en')
    document.documentElement.lang = 'en'
    workspaces = [{ id: 'ws-1', name: 'UniWork', slug: 'uniwork' }]
    folderTree = [
      {
        id: 'f-mine',
        parentId: null,
        title: 'My Folder',
        position: 0,
        systemKind: 'my_folder',
        children: [],
      },
      {
        id: 'f-alpha',
        parentId: null,
        title: 'Alpha Folder',
        position: 1,
        children: [
          { id: 'f-beta', parentId: 'f-alpha', title: 'Beta Leaf', position: 0, children: [] },
        ],
      },
    ]
    const api: Record<string, ReturnType<typeof vi.fn>> = {
      accountStatus: vi.fn(async () => ({
        state: 'signed-in' as const,
        loggedIn: true,
        email: 'minh@uniwork.vn',
        profile: {
          accountId: 'acc-1',
          email: 'minh@uniwork.vn',
          name: 'Minh',
          orgId: 'org-1',
          orgName: 'UniWork',
          workspaces,
        },
      })),
      uniworkListWorkspaces: vi.fn(async () => ok(workspaces)),
      uniworkFolderTree: vi.fn(async () => ok(folderTree)),
      uniworkEnsureMyFolder: vi.fn(async () => ok(folderTree[0]!)),
      uniworkListChildren: vi.fn(async (): Promise<UniworkResult<UniworkFolderChildren>> =>
        ok({ items: [], nextCursor: null }),
      ),
      uniworkListDocuments: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      onUniworkTreeChanged: vi.fn(() => () => {}),
      onUniworkDocRenamed: vi.fn(() => () => {}),
      onUniworkUploadProgress: vi.fn(() => () => {}),
    }
    ;(window as unknown as { aiOffice: unknown; home: unknown }).aiOffice = api
    ;(window as unknown as { aiOffice: unknown; home: unknown }).home = api
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
  })

  async function openFolder(folderId: string): Promise<void> {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            onOpenDocument: vi.fn(),
            initialFolderId: folderId,
          }),
        ),
      )
    })
    await flush()
  }

  const headerRow = () => host.querySelector<HTMLElement>('.dh-toolbar')!

  it('renders the folder name once: the breadcrumb leaf is the page h1, no second title', async () => {
    await openFolder('f-beta')
    const main = host.querySelector<HTMLElement>('.dh-main')!
    expect(main.querySelectorAll('h1')).toHaveLength(1)
    const leaf = main.querySelector<HTMLElement>('h1')!
    expect(leaf.textContent).toBe('Beta Leaf')
    expect(leaf.closest('nav.uwf-crumbs')).not.toBeNull()
    expect(leaf.getAttribute('aria-current')).toBe('page')
    expect(leaf.getAttribute('title')).toBe('Beta Leaf')
    const named = Array.from(main.querySelectorAll('*')).filter(
      (el) => el.children.length === 0 && el.textContent?.trim() === 'Beta Leaf',
    )
    expect(named).toHaveLength(1)
    expect(main.querySelector('.dh-title-group')).toBeNull()
  })

  it('puts the rename pencil and the folder "…" menu beside the leaf', async () => {
    await openFolder('f-beta')
    const leaf = host.querySelector<HTMLElement>('.dh-main h1')!
    const crumb = leaf.closest<HTMLElement>('li.uwf-crumb')!
    expect(crumb).not.toBeNull()
    const rename = crumb.querySelector<HTMLButtonElement>('button[aria-label="Rename"]')
    const menu = crumb.querySelector<HTMLButtonElement>('button[data-folder-menu-for]')
    expect(rename).not.toBeNull()
    expect(menu).not.toBeNull()
    // order: name, pencil, menu
    const order = Array.from(
      crumb.querySelectorAll('h1, button[aria-label="Rename"], [data-folder-menu-for]'),
    )
    expect(order).toEqual([leaf, rename, menu])
  })

  it('the folder menu offers new subfolder, rename and move, and never Share', async () => {
    await openFolder('f-beta')
    const menu = host
      .querySelector<HTMLButtonElement>('.dh-main h1')!
      .closest('li.uwf-crumb')!
      .querySelector<HTMLButtonElement>('button[data-folder-menu-for]')!
    await act(async () => {
      menu.click()
    })
    const items = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    expect(items.map((i) => i.getAttribute('data-folder-action'))).toEqual([
      'new',
      'rename',
      'move',
    ])
    expect(items.map((i) => i.textContent)).toEqual(['New subfolder', 'Rename', 'Move to…'])
    expect(document.body.querySelector('[role="menu"]')?.textContent).not.toMatch(/share/i)
  })

  it('the rename pencil opens the rename dialog for the open folder', async () => {
    await openFolder('f-beta')
    const rename = host
      .querySelector<HTMLButtonElement>('.dh-main h1')!
      .closest('li.uwf-crumb')!
      .querySelector<HTMLButtonElement>('button[aria-label="Rename"]')!
    await act(async () => {
      rename.click()
    })
    await flush()
    const input = document.body.querySelector<HTMLInputElement>('[role="dialog"] input')
    expect(input?.value).toBe('Beta Leaf')
  })

  it('My Folder offers neither the pencil nor rename / move in its menu', async () => {
    await openFolder('f-mine')
    const crumb = host.querySelector<HTMLElement>('.dh-main h1')!.closest('li.uwf-crumb')!
    expect(crumb.querySelector('button[aria-label="Rename"]')).toBeNull()
    await act(async () => {
      crumb.querySelector<HTMLButtonElement>('button[data-folder-menu-for]')!.click()
    })
    const ids = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
      (i) => i.getAttribute('data-folder-action'),
    )
    expect(ids).toEqual(['new'])
  })

  it('keeps the breadcrumb, the search and the create actions in one header row', async () => {
    await openFolder('f-beta')
    const row = headerRow()
    expect(row.querySelector('nav.uwf-crumbs')).not.toBeNull()
    expect(row.querySelector('.dh-search-box')).not.toBeNull()
    expect(row.querySelector('.dh-btn-upload')).not.toBeNull()
    expect(row.querySelector('.dh-btn-create')).not.toBeNull()
    expect(host.querySelector('.dh-main > nav.uwf-crumbs')).toBeNull()
    // the leaf is the first thing in the row; nothing stacks above it
    expect(host.querySelector('.dh-main')!.firstElementChild).toBe(row)
  })

  it('has no "files here go to ..." hint line, in the view or in any locale shard', async () => {
    await openFolder('f-beta')
    const main = host.querySelector<HTMLElement>('.dh-main')!
    expect(main.querySelector('.dh-folder-hint, .dh-folder-info, .uwf-hint, .uwf-info')).toBeNull()
    expect(main.textContent).not.toMatch(/will be placed|uploaded files here|Drag and drop files/i)
    for (const domain of ['uniwork-home', 'uniwork-folders']) {
      const dir = resolve(rendererDir, 'i18n', domain)
      for (const file of readdirSync(dir)) {
        const text = readFileSync(resolve(dir, file), 'utf8')
        expect(text, `${domain}/${file}`).not.toMatch(/info_?banner|folderHint|FolderInfoBanner/i)
      }
    }
  })

  it('keeps the create actions together as the last child of the header row', async () => {
    await openFolder('f-beta')
    const row = headerRow()
    const actions = row.lastElementChild as HTMLElement
    expect(actions.classList.contains('dh-toolbar-actions')).toBe(true)
    expect(actions.querySelector('.dh-btn-upload')).not.toBeNull()
    expect(actions.querySelector('.dh-btn-create')).not.toBeNull()
    // the search box is a child of the row itself (its own row or inline, by container width)
    expect(row.querySelector(':scope > .dh-search-box')).not.toBeNull()
  })

  it('CSS: the row never wraps its crumbs, ancestors and home shrink first, the leaf last', () => {
    expect(ruleBody(foldersCss, '.dh-toolbar .uwf-crumbs ol')).toMatch(/flex-wrap:\s*nowrap/)
    const root = ruleBody(foldersCss, '.uwf-crumb-root')
    const ancestor = ruleBody(foldersCss, '.uwf-crumb-ancestor')
    const leaf = ruleBody(foldersCss, '.uwf-crumb-leaf')
    // the web's weights: home crumb and ancestors 1000 against the leaf's 1
    expect(shrinkOf(root)).toBe(1000)
    expect(shrinkOf(ancestor)).toBe(1000)
    expect(shrinkOf(leaf)).toBe(1)
    // and floors, so nothing slides under a neighbour (web min-w-9 / min-w-10 / min-w-10)
    expect(root).toMatch(/min-width:\s*2\.25rem/)
    expect(ancestor).toMatch(/min-width:\s*2\.5rem/)
    expect(leaf).toMatch(/min-width:\s*2\.5rem/)
    const heading = ruleBody(foldersCss, '.uwf-crumb-heading')
    expect(heading).toMatch(/min-width:\s*2\.5rem/)
    expect(heading).toMatch(/max-width:\s*none/)
    // the h1 keeps the crumb's single-line ellipsis
    expect(ruleBody(foldersCss, '.uwf-crumb-current')).toMatch(/text-overflow:\s*ellipsis/)
  })

  it('CSS: the header row is a size container that always wraps, crumbs and actions on row one', () => {
    const row = ruleBody(homeCss, '.dh-toolbar.dh-toolbar-folder')
    expect(row).toMatch(/container-type:\s*inline-size/)
    expect(row).toMatch(/flex-wrap:\s*wrap/)
    // the wide-window rule that stops .dh-toolbar wrapping must not reach the folder row
    const wide =
      homeCss.match(/@media\s*\(\s*min-width:\s*1101px\s*\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(ruleBody(wide, '.dh-toolbar.dh-toolbar-folder')).toMatch(/flex-wrap:\s*wrap/)
    const crumbs = ruleBody(homeCss, '.dh-toolbar-folder > .uwf-crumbs')
    // the app row also holds the workspace select, so the crumbs' basis is below the web's 18rem
    // (8rem): ~128 + select 96 + actions ~242 + 2 x 12 gap = ~490px stays on row one at 510px
    expect(crumbs).toMatch(/flex:\s*1\s+1\s+8rem/)
    expect(crumbs).toMatch(/min-width:\s*0\b/)
    const actions = ruleBody(homeCss, '.dh-toolbar-actions')
    expect(actions).toMatch(/flex:\s*none/)
    // when the actions do wrap they stay at the inline end, never left under the crumbs
    expect(actions).toMatch(/margin-inline-start:\s*auto/)
  })

  it('CSS: the workspace select shrinks with an ellipsis and is as tall as the search box and buttons', () => {
    const select = ruleBody(homeCss, '.dh-ws-select')
    expect(select).toMatch(/flex:\s*0\s+1\s+auto/)
    expect(select).toMatch(/min-width:\s*96px/)
    expect(select).toMatch(/text-overflow:\s*ellipsis/)
    const height = (body: string): string => /height:\s*(\d+px)/.exec(body)?.[1] ?? ''
    expect(height(select)).toBe('36px')
    expect(height(select)).toBe(height(ruleBody(homeCss, '.dh-search-box')))
    expect(height(select)).toBe(height(ruleBody(homeCss, '.dh-toolbar-btn')))
  })

  it('CSS: coarse pointer, the pencil and the "…" are 44 x 44 and the menu wrapper grows with its button', () => {
    const coarse =
      foldersCss.match(/@media\s*\(\s*pointer:\s*coarse\s*\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(coarse, 'a (pointer: coarse) block').not.toBe('')
    expect(ruleBody(coarse, '.uwf-crumb-rename')).toMatch(/min-width:\s*44px/)
    expect(coarse).toMatch(/\.uwf-crumb-rename,[^{]*\{[^}]*min-height:\s*44px/)
    const menu = ruleBody(coarse, '.uwf-crumb .uw-row-menu.uwf-menu')
    expect(menu).toMatch(/width:\s*44px/)
    expect(menu).toMatch(/height:\s*44px/)
    // the leaf reserves room for both 44px targets (2 x 44 + 2px gap) in the header row
    expect(ruleBody(coarse, '.dh-toolbar .uwf-crumb-leaf')).toMatch(/calc\(2\.5rem \+ 92px\)/)
  })

  it('CSS: the search box is on its own row below 60rem and inline from 60rem up', () => {
    const own = ruleBody(homeCss, '.dh-toolbar-folder .dh-search-box')
    expect(own).toMatch(/order:\s*1\b/)
    expect(own).toMatch(/flex:\s*0\s+0\s+100%/)
    const container = homeCss.match(/@container\s*\(\s*min-width:\s*60rem\s*\)\s*\{([\s\S]*?)\n\}/)
    expect(container, 'an @container (min-width: 60rem) rule').not.toBeNull()
    const inline = ruleBody(container?.[1] ?? '', '.dh-toolbar-folder .dh-search-box')
    expect(inline).toMatch(/order:\s*0\b/)
    expect(inline).toMatch(/flex:\s*0\s+0\s+auto/)
    expect(inline).toMatch(/width:\s*14rem/)
    // never a viewport media query for the search position: the sidebars decide the width
    expect(homeCss).not.toMatch(/@media[^{]*\{\s*\.dh-toolbar-folder \.dh-search-box/)
  })

  it('CSS: no raw colour is added', () => {
    for (const body of [
      ruleBody(homeCss, '.dh-toolbar.dh-toolbar-folder'),
      ruleBody(homeCss, '.dh-toolbar-folder > .uwf-crumbs'),
      ruleBody(homeCss, '.dh-toolbar-folder .dh-search-box'),
      ruleBody(foldersCss, '.uwf-crumb-rename'),
    ]) {
      expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
    }
  })
})
