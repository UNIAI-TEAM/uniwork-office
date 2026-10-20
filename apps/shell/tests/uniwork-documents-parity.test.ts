/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  UniworkFolderChildren,
  UniworkFolderNode,
  UniworkResult,
  UniworkWorkspaceRef,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { QUICK_CREATE_KINDS } from '../src/renderer/src/uniwork-docs-model'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'

/**
 * UNI-1957: the Documents fixes the web got on 2026-10-19, in the app.
 * - My Folder is listed once in the sidebar: the tree row with the lock glyph;
 *   until the server has created it, one stand-in row first under Folders runs
 *   the existing ensure (the same call the old sub-nav row made).
 * - The folder card's "…" sits inside the card, as a sibling of the card button;
 *   on coarse pointers its 44px target gets room on the card too.
 * - Item 4: the toolbar row carries no "saves to My Folder" notice in any sub-view;
 *   Tạo mới / Tải lên / Tạo nhanh still target My Folder exactly as before.
 * - Item 4b: the My Folder view has no "Private - only you ..." banner; the Trash note stays.
 * - Item 5: one global rule gives everything clickable the pointer cursor, and the Documents
 *   home's clickable elements are all inside that rule's selector set.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })
const MY_FOLDER = 'Thư mục của tôi'

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

const mineNode: UniworkFolderNode = {
  id: 'f-mine',
  parentId: null,
  title: 'My Folder',
  position: 0,
  systemKind: 'my_folder',
  children: [],
}
const boardNode: UniworkFolderNode = {
  id: 'f-board',
  parentId: null,
  title: 'Báo cáo HĐQT Q4',
  position: 1,
  children: [],
}

describe('UNI-1957 Documents parity', () => {
  let host: HTMLDivElement
  let sidebarSlot: HTMLDivElement
  let root: Root
  let api: Record<string, ReturnType<typeof vi.fn>>
  let folderTree: UniworkFolderNode[]
  let ensureCreatesFolder: boolean

  const workspaces: UniworkWorkspaceRef[] = [{ id: 'ws-1', name: 'UniWork', slug: 'uniwork' }]

  async function mount() {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(DocumentsHome, {
            workspaceId: 'ws-1',
            workspaces,
            onWorkspaceChange: vi.fn(),
            onOpenDocument: vi.fn(),
            sidebarHost: sidebarSlot,
          }),
        ),
      )
    })
    await flush()
  }

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('genoffice.lang', 'vi')
    document.documentElement.lang = 'vi'
    ensureCreatesFolder = true
    folderTree = [mineNode, boardNode]

    api = {
      accountStatus: vi.fn(async () => ({ state: 'signed-in' as const, loggedIn: true })),
      uniworkListWorkspaces: vi.fn(async () => ok(workspaces)),
      uniworkFolderTree: vi.fn(async () => ok(folderTree)),
      uniworkEnsureMyFolder: vi.fn(async () => {
        if (ensureCreatesFolder) folderTree = [mineNode, boardNode]
        return ok(mineNode)
      }),
      uniworkListChildren: vi.fn(async (): Promise<UniworkResult<UniworkFolderChildren>> =>
        ok({
          items: [
            {
              id: 'f-board',
              workspaceId: 'ws-1',
              title: 'Báo cáo HĐQT Q4',
              format: 'docx',
              updatedAt: '2026-10-15T10:00:00.000Z',
              kind: 'folder',
              parentId: null,
            },
          ],
          nextCursor: null,
        }),
      ),
      uniworkListDocuments: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListSharedWithMe: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListSharedByMe: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListTrash: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkCreateDocument: vi.fn(async (input: { name: string; format: string }) =>
        ok({
          id: 'new-1',
          workspaceId: 'ws-1',
          title: `${input.name}.${input.format}`,
          format: input.format,
          updatedAt: '2026-10-19T10:00:00.000Z',
        }),
      ),
      uniworkPickUploadFile: vi.fn(async () => ({ path: '/home/me/Q3.xlsx', name: 'Q3.xlsx' })),
      uniworkUploadDocument: vi.fn(async () =>
        ok({
          id: 'up-1',
          workspaceId: 'ws-1',
          title: 'Q3.xlsx',
          format: 'xlsx',
          updatedAt: '2026-10-19T10:00:00.000Z',
        }),
      ),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      onUniworkTreeChanged: vi.fn(() => () => {}),
      onUniworkDocRenamed: vi.fn(() => () => {}),
      onUniworkUploadProgress: vi.fn(() => () => {}),
    }
    ;(window as unknown as { aiOffice: unknown; home: unknown }).aiOffice = api
    ;(window as unknown as { aiOffice: unknown; home: unknown }).home = api
    host = document.createElement('div')
    sidebarSlot = document.createElement('div')
    document.body.appendChild(sidebarSlot)
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    host.remove()
    sidebarSlot.remove()
  })

  const myFolderTitles = () =>
    Array.from(
      sidebarSlot.querySelectorAll<HTMLElement>(
        '.dh-nav-label, .uwf-tree-title, [data-my-folder-standin]',
      ),
    ).filter((el) => el.textContent?.trim() === MY_FOLDER)

  describe('My Folder appears once in the sidebar', () => {
    it('is the tree row with the lock glyph, not a second sub-nav row, and opens with no ensure', async () => {
      await mount()
      const navIds = Array.from(
        sidebarSlot.querySelectorAll<HTMLElement>('.home-area-nav .nav-item'),
      ).map((el) => el.getAttribute('data-nav'))
      expect(navIds).not.toContain('my-folder')
      expect(sidebarSlot.querySelector('[data-my-folder-standin]')).toBeNull()

      const titles = myFolderTitles()
      expect(titles).toHaveLength(1)
      const treeRow = titles[0]!.closest<HTMLElement>('[role="treeitem"]')
      expect(treeRow).not.toBeNull()
      expect(treeRow!.querySelector('svg.uwf-glyph-my-folder')).not.toBeNull()

      await act(async () => {
        treeRow!.click()
      })
      await flush()
      expect(api.uniworkListChildren).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws-1', parentId: 'f-mine' }),
      )
      expect(api.uniworkEnsureMyFolder).not.toHaveBeenCalled()
      expect(treeRow!.getAttribute('aria-selected')).toBe('true')
    })

    it('shows one stand-in row first under Folders until the folder exists, runs the ensure, then the tree row replaces it', async () => {
      folderTree = [boardNode]
      await mount()
      const standIns = sidebarSlot.querySelectorAll<HTMLButtonElement>('[data-my-folder-standin]')
      expect(standIns).toHaveLength(1)
      const standIn = standIns[0]!
      expect(standIn.closest('.home-area-nav')).toBeNull()
      expect(standIn.textContent?.trim()).toBe(MY_FOLDER)
      expect(standIn.querySelector('svg.uwf-glyph-my-folder')).not.toBeNull()
      const treeHost = sidebarSlot.querySelector<HTMLElement>('.dh-sidebar-tree')!
      expect(treeHost.firstElementChild).toBe(standIn)
      expect(api.uniworkEnsureMyFolder).not.toHaveBeenCalled()

      await act(async () => {
        standIn.click()
      })
      await flush()
      expect(api.uniworkEnsureMyFolder).toHaveBeenCalledTimes(1)
      expect(api.uniworkListChildren).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws-1', parentId: 'f-mine' }),
      )

      // the server has the folder now: the stand-in is gone, the tree row is the one entry
      expect(sidebarSlot.querySelector('[data-my-folder-standin]')).toBeNull()
      const titles = myFolderTitles()
      expect(titles).toHaveLength(1)
      expect(titles[0]!.closest('[role="treeitem"]')).not.toBeNull()
    })
  })

  describe('folder card menu', () => {
    const css = readFileSync(
      resolve(__dirname, '../src/renderer/src/uniwork-home/documents-home.css'),
      'utf8',
    )
    /** the text of every `@media (pointer: coarse) { ... }` block */
    const coarse = Array.from(css.matchAll(/@media \(pointer: coarse\) \{([\s\S]*?)\n\}/g))
      .map((m) => m[1]!)
      .join('\n')

    it('is a sibling of the card button, inside the card box, and keyboard reachable', async () => {
      await mount()
      const card = host.querySelector<HTMLElement>('.dh-folder-card[data-folder-id="f-board"]')!
      const open = card.querySelector<HTMLElement>('button.dh-folder-open')!
      const trigger = card.querySelector<HTMLElement>('.dh-folder-actions .uw-row-menu-btn')!
      expect(open.querySelector('.uw-row-menu')).toBeNull()
      expect(trigger.closest('.dh-folder-card')).toBe(card)
      // a real tab stop: the card has no Shift+F10 / context-menu path to it
      expect(trigger.tabIndex).toBe(0)
    })

    it('reserves room for the 44px coarse-pointer button so the name does not run under it', () => {
      // button 44px + the actions box's 12px right padding = 56px of the card's right edge
      const open = coarse.match(/\.dh-folder-open\s*\{([^}]*)\}/)?.[1] ?? ''
      const pad = open.match(/padding-right:\s*(\d+)px/)?.[1]
      expect(Number(pad ?? 0)).toBeGreaterThanOrEqual(56)
    })
  })

  describe('item 4b: no banner in the My Folder view', () => {
    const click = async (el: Element) => {
      await act(async () => {
        ;(el as HTMLElement).click()
      })
      await flush()
    }
    const TRASH_NOTE = 'Mục trong thùng rác có thể khôi phục nếu bạn có quyền Quản lý.'
    const MY_FOLDER_NOTE = ['Riêng tư', 'chỉ bạn có quyền truy cập']

    it('shows no banner and no private note in My Folder, while Trash keeps its note', async () => {
      await mount()
      await click(myFolderTitles()[0]!.closest<HTMLElement>('[role="treeitem"]')!)
      expect(host.querySelector('.dh-subview-banner')).toBeNull()
      for (const text of MY_FOLDER_NOTE) expect(host.textContent).not.toContain(text)
      expect(host.textContent).not.toContain(TRASH_NOTE)

      await click(sidebarSlot.querySelector('.home-area-nav .nav-item[data-nav="trash"]')!)
      const banners = host.querySelectorAll('.dh-subview-banner')
      expect(banners).toHaveLength(1)
      expect(banners[0]!.textContent).toBe(TRASH_NOTE)
    })
  })

  describe('item 5: pointer cursor on everything clickable', () => {
    const home = readFileSync(resolve(__dirname, '../src/renderer/src/home.css'), 'utf8').replace(
      /\r\n/g,
      '\n',
    )
    // :where(<selector list>):where(:not(:disabled, [aria-disabled='true'])) { cursor: pointer }
    // (the exclusion sits inside its own :where(), a bare :not() would add (0,1,0) specificity)
    const rule =
      /:where\(([^)]*)\)\s*:where\(\s*:not\(:disabled,\s*\[aria-disabled=["']true["']\]\)\s*\)\s*\{\s*cursor:\s*pointer;?\s*\}/.exec(
        home,
      )
    const click = async (el: Element) => {
      await act(async () => {
        ;(el as HTMLElement).click()
      })
      await flush()
    }

    it('is one zero-specificity rule in the global renderer sheet, disabled controls excluded', () => {
      expect(rule).not.toBeNull()
      const list = rule![1]!.replace(/'/g, '"')
      for (const target of [
        'button',
        'a[href]',
        'summary',
        'select',
        'label[for]',
        ...['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option'].map(
          (r) => `[role="${r}"]`,
        ),
        ...['treeitem', 'checkbox', 'radio', 'switch'].map((r) => `[role="${r}"]`),
      ]) {
        expect(list, target).toContain(target)
      }
      // once, in the sheet main.tsx loads for every view (not per component)
      expect(home.match(/:where\(:not\(:disabled, \[aria-disabled='true'\]\)\)/g)).toHaveLength(1)
      expect(readFileSync(resolve(__dirname, '../src/renderer/src/main.tsx'), 'utf8')).toContain(
        "import './home.css'",
      )
    })

    it('every clickable element of the Documents home matches that selector set', async () => {
      const doc = {
        id: 'd-1',
        workspaceId: 'ws-1',
        title: 'Kế hoạch Q4',
        format: 'docx',
        updatedAt: '2026-10-15T10:00:00.000Z',
        kind: 'file',
        parentId: null,
      }
      api.uniworkListChildren!.mockImplementation(async () =>
        ok({
          items: [
            doc,
            {
              id: 'f-board',
              workspaceId: 'ws-1',
              title: 'Báo cáo HĐQT Q4',
              format: 'docx',
              updatedAt: '2026-10-15T10:00:00.000Z',
              kind: 'folder',
              parentId: null,
            },
          ],
          nextCursor: null,
        }),
      )
      await mount()
      expect(rule).not.toBeNull()
      // the rule's list is a valid selector; matches() runs it against the real DOM
      const selector = rule![1]!
      const clickable = (label: string, els: Element[]) => {
        expect(els.length, label).toBeGreaterThan(0)
        for (const el of els)
          expect(el.matches(selector), `${label}: ${el.outerHTML.slice(0, 80)}`).toBe(true)
      }
      const all = (root: ParentNode, sel: string) => Array.from(root.querySelectorAll(sel))
      clickable('document row (opens the file)', all(host, '.dh-doc-row .dh-doc-open'))
      clickable('folder card', all(host, '.dh-folder-card .dh-folder-open'))
      clickable('row / card menu trigger', all(host, '.uw-row-menu-btn'))
      clickable('create strip pills', all(host, '.dh-quick-row button'))
      clickable('sidebar tree rows', all(sidebarSlot, '[role="treeitem"]'))
      clickable('sidebar nav', all(sidebarSlot, '.home-area-nav .nav-item'))

      await click(host.querySelector('.dh-doc-row .uw-row-menu-btn')!)
      clickable('menu items', all(document, '[role="menuitem"]'))
    })
  })

  describe('item 4: no My Folder notice on the toolbar row', () => {
    const click = async (el: Element) => {
      await act(async () => {
        ;(el as HTMLElement).click()
      })
      await flush()
    }
    const NOTICE_VI = [
      'chỉ bạn thấy',
      'Tạo mới và tải lên ở trang này vào',
      'Chia sẻ hoặc Di chuyển',
    ]

    const expectNoNotice = () => {
      expect(host.querySelector('.dh-quick-hint')).toBeNull()
      expect(host.querySelector('.dh-quick-hint-link')).toBeNull()
      expect(host.querySelector('.dh-quick-hint-icon')).toBeNull()
      const row = host.querySelector<HTMLElement>('.dh-quick-row')
      if (row) {
        // the label, one pill per quick create kind (UNI-1953: UniNote + the file formats, minus Plain text, UNI-2046),
        // then UNI-1959's share switch and its live hint - nothing else: no lock glyph, no link
        expect(Array.from(row.children).map((el) => el.tagName)).toEqual([
          'SPAN',
          ...QUICK_CREATE_KINDS.map(() => 'BUTTON'),
          'BUTTON',
          'P',
        ])
        expect(row.querySelector('[data-quick-format]')).not.toBeNull()
        expect(row.children[QUICK_CREATE_KINDS.length + 1]!.getAttribute('role')).toBe('switch')
        expect(row.lastElementChild!.className).toBe('dh-quick-share-hint')
      }
      for (const text of NOTICE_VI) expect(host.textContent).not.toContain(text)
    }

    it('is absent in every sub-view', async () => {
      await mount()
      expectNoNotice()
      const nav = (id: string) =>
        sidebarSlot.querySelector<HTMLElement>(`.home-area-nav .nav-item[data-nav="${id}"]`)!
      for (const id of ['recent', 'shared-with-me', 'shared-by-me', 'trash', 'workspace']) {
        await click(nav(id))
        expectNoNotice()
      }
      // My Folder is the tree row now
      const treeRow = myFolderTitles()[0]!.closest<HTMLElement>('[role="treeitem"]')!
      await click(treeRow)
      expectNoNotice()
    })

    const dialog = () => document.querySelector<HTMLElement>('.modal.uw-act')!
    const byText = (root: ParentNode, text: string) =>
      Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => b.textContent?.trim() === text,
      )!

    const views: Array<[string, (() => Promise<void>) | null]> = [
      ['workspace root', null],
      [
        'recent',
        async () =>
          click(sidebarSlot.querySelector('.home-area-nav .nav-item[data-nav="recent"]')!),
      ],
      [
        'shared-with-me',
        async () =>
          click(sidebarSlot.querySelector('.home-area-nav .nav-item[data-nav="shared-with-me"]')!),
      ],
      [
        'my-folder',
        async () => click(myFolderTitles()[0]!.closest<HTMLElement>('[role="treeitem"]')!),
      ],
    ]

    it.each(views)('Tạo nhanh in %s still creates in My Folder', async (_name, go) => {
      await mount()
      if (go) await go()
      // UNI-1959: a pill creates at once with the default name (no name dialog), still in My Folder
      await click(host.querySelector('.dh-quick-row [data-quick-format="docx"]')!)
      expect(document.querySelector('.modal.uw-act')).toBeNull()
      expect(api.uniworkCreateDocument).toHaveBeenCalledTimes(1)
      expect(api.uniworkCreateDocument).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        folderId: 'f-mine',
        name: 'Tài liệu chưa đặt tên.docx',
        format: 'docx',
      })
    })

    it.each(views)('Tải lên in %s still uploads into My Folder', async (_name, go) => {
      await mount()
      if (go) await go()
      await click(byText(host, 'Tải lên'))
      expect(dialog().querySelector('.uwf-location-btn')?.textContent).toContain(MY_FOLDER)
      await click(byText(dialog(), 'Chọn tệp'))
      await click(dialog().querySelector('.btn-primary')!)
      expect(api.uniworkUploadDocument).toHaveBeenCalledTimes(1)
      expect(api.uniworkUploadDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-1',
          folderId: 'f-mine',
          path: '/home/me/Q3.xlsx',
        }),
      )
    })
  })
})
