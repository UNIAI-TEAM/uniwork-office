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
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'

/**
 * UNI-1957: the Documents fixes the web got on 2026-10-19, in the app.
 * - My Folder is listed once in the sidebar: the tree row with the lock glyph;
 *   until the server has created it, one stand-in row first under Folders runs
 *   the existing ensure (the same call the old sub-nav row made).
 * - The folder card's "…" sits inside the card, as a sibling of the card button;
 *   on coarse pointers its 44px target gets room on the card too.
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
  kind: 'my_folder',
  isSystem: true,
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
})
