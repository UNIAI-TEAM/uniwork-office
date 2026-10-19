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

  it('CSS: the row never wraps its crumbs, ancestors shrink first and the leaf last', () => {
    expect(ruleBody(foldersCss, '.dh-toolbar .uwf-crumbs ol')).toMatch(/flex-wrap:\s*nowrap/)
    const ancestor = ruleBody(foldersCss, '.uwf-crumb-ancestor')
    const leaf = ruleBody(foldersCss, '.uwf-crumb-leaf')
    expect(ancestor).toMatch(/min-width:\s*\d+px/)
    expect(Number.isNaN(shrinkOf(ancestor))).toBe(false)
    expect(shrinkOf(ancestor)).toBeGreaterThan(shrinkOf(leaf))
    expect(leaf).toMatch(/min-width:\s*0/)
    const heading = ruleBody(foldersCss, '.uwf-crumb-heading')
    expect(heading).toMatch(/min-width:\s*0/)
    expect(heading).toMatch(/max-width:\s*none/)
    // the h1 keeps the crumb's single-line ellipsis
    expect(ruleBody(foldersCss, '.uwf-crumb-current')).toMatch(/text-overflow:\s*ellipsis/)
  })

  it('CSS: the search shrinks before the crumbs and no raw colour is added', () => {
    const search = ruleBody(homeCss, '.dh-toolbar-folder .dh-search-box')
    expect(shrinkOf(search)).toBeGreaterThan(1)
    const crumbs = ruleBody(homeCss, '.dh-toolbar-folder > .uwf-crumbs')
    expect(crumbs).toMatch(/flex:\s*1\s+1\s+\d+px/)
    for (const body of [search, crumbs, ruleBody(foldersCss, '.uwf-crumb-rename')]) {
      expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
    }
  })
})
