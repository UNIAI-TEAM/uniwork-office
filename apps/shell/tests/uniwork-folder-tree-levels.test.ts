/**
 * @vitest-environment jsdom
 */
import { act, createElement, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HomeApi,
  UniworkDocProperties,
  UniworkDocSummary,
  UniworkFolderChildren,
  UniworkFolderNode,
  UniworkFolderQuery,
  UniworkResult,
  UniworkTreeChangedEvent,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UniworkBrowser } from '../src/renderer/src/uniwork-folders/UniworkBrowser'
import { useFolderLevels } from '../src/renderer/src/uniwork-folders/use-folder-levels'
import { UniworkLiveHost, resetLiveForTests } from '../src/renderer/src/uniwork-live'
import {
  buildFolderIndex,
  folderLevelOf,
  treeRowAccess,
} from '../src/renderer/src/uniwork-folders/uniwork-folders-model'

/**
 * UNI-2080 (FU-2066-2): the sidebar tree row menu and the Open dialog tree menu follow the level
 * the person has on the folder, as the web's DocumentTreeRowMenu does. A tree node carries no
 * level (the server's tree answer has none), so the level is read from the folder's properties
 * when its menu opens; until it is known the folder reads as view (only the read action shows).
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

function folder(
  id: string,
  title: string,
  extra: Partial<UniworkFolderNode> = {},
): UniworkFolderNode {
  return { id, parentId: null, title, position: 0, children: [], ...extra }
}

const index = buildFolderIndex([
  folder('ws', 'Shared'),
  folder('mf', 'My Folder', { systemKind: 'my_folder', children: [folder('mine', 'Inside mine')] }),
])

describe('treeRowAccess (pure rule)', () => {
  const row = (id: string | null, systemKind?: 'my_folder') => ({
    id,
    ...(systemKind ? { systemKind } : {}),
  })

  it('reads the level from the server value and nothing else', () => {
    expect(folderLevelOf('view')).toBe('view')
    expect(folderLevelOf('edit')).toBe('edit')
    expect(folderLevelOf('manage')).toBe('manage')
    expect(folderLevelOf('owner')).toBeUndefined()
    expect(folderLevelOf(null)).toBeUndefined()
    expect(folderLevelOf(undefined)).toBeUndefined()
  })

  it('viewer: no folder write action on a workspace folder for a viewer role', () => {
    expect(treeRowAccess(row('ws'), 'view', index, 'viewer')).toEqual({
      create: false,
      edit: false,
    })
  })

  it('an unknown level reads as view (the web rowLevel), not as everything', () => {
    expect(treeRowAccess(row('ws'), undefined, index, 'viewer')).toEqual({
      create: false,
      edit: false,
    })
  })

  it('a human member at view level still creates inside a workspace folder but never renames or moves it', () => {
    expect(treeRowAccess(row('ws'), 'view', index, 'member')).toEqual({
      create: true,
      edit: false,
    })
  })

  it('a human member at view level cannot create inside a folder under My Folder', () => {
    expect(treeRowAccess(row('mine'), 'view', index, 'member')).toEqual({
      create: false,
      edit: false,
    })
  })

  it('editor and manager: create, rename and move', () => {
    for (const level of ['edit', 'manage'] as const) {
      expect(treeRowAccess(row('ws'), level, index, 'viewer')).toEqual({
        create: true,
        edit: true,
      })
    }
  })

  it('My Folder: always a place to create in, never renamed or moved, no level needed', () => {
    expect(treeRowAccess(row('mf', 'my_folder'), undefined, index, 'viewer')).toEqual({
      create: true,
      edit: false,
    })
    expect(treeRowAccess(row('mf', 'my_folder'), 'manage', index, 'member')).toEqual({
      create: true,
      edit: false,
    })
  })

  it('the root row keeps New folder and has nothing to rename', () => {
    expect(treeRowAccess(row(null), undefined, index, 'viewer')).toEqual({
      create: true,
      edit: false,
    })
  })
})

const ok = <T>(value: T) => ({ ok: true as const, value })

function props(id: string, myLevel: string | null): UniworkDocProperties {
  return {
    documentId: id,
    workspaceId: 'w1',
    title: id,
    ownerName: null,
    createdByName: null,
    createdAt: null,
    updatedByName: null,
    updatedAt: null,
    myLevel,
    version: null,
    versionByName: null,
    ownerId: null,
    createdById: null,
    updatedById: null,
    ownerKind: null,
    shelvedAt: null,
  }
}

let tree: UniworkFolderNode[]
let levels: Record<string, string | null>
let host: HTMLDivElement
let root: Root
let api: ReturnType<typeof makeApi>

function makeApi() {
  const fns = {
    uniworkFolderTree: vi.fn(async (_ws: string) => ok(tree)),
    uniworkListChildren: vi.fn(
      async (_q: UniworkFolderQuery): Promise<UniworkResult<UniworkFolderChildren>> =>
        ok({ items: [] as UniworkDocSummary[], nextCursor: null }),
    ),
    uniworkSearchDocuments: vi.fn(async () =>
      ok<UniworkFolderChildren>({ items: [], nextCursor: null }),
    ),
    uniworkDocumentProperties: vi.fn(
      async (id: string): Promise<UniworkResult<UniworkDocProperties>> =>
        id in levels ? ok(props(id, levels[id] ?? null)) : { ok: false, error: 'network' },
    ),
    onUniworkTreeChanged: vi.fn((_cb: (e: UniworkTreeChangedEvent) => void) => () => {}),
  }
  window.aiOffice = fns as unknown as HomeApi
  return fns
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

async function render(myRole: string | null = 'member') {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(UniworkLiveHost),
        createElement(UniworkBrowser, {
          workspaceId: 'w1',
          variant: 'pane',
          onOpenDocument: vi.fn(),
          myRole,
        }),
      ),
    )
  })
  await flush()
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string) =>
  Array.from(document.querySelectorAll<T>(sel))
const treeItem = (title: string) =>
  $$('[role="treeitem"]').find((el) => el.querySelector('.uwf-tree-title')?.textContent === title)!

async function click(el: Element | null | undefined) {
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

/** open a tree row's "..." menu and list its entries (`data-folder-action` ids) */
async function treeMenuIds(title: string): Promise<string[]> {
  await click(treeItem(title).querySelector('[data-folder-menu-for]'))
  const ids = $$('[role="menu"] [role="menuitem"]').map((el) =>
    el.getAttribute('data-folder-action')!,
  )
  return ids
}

beforeEach(() => {
  tree = [
    folder('viewerf', 'ViewerFolder'),
    folder('editf', 'EditFolder'),
    folder('managef', 'ManageFolder'),
    folder('unknownf', 'UnknownFolder'),
    folder('mf', 'My Folder', { systemKind: 'my_folder' }),
  ]
  levels = { viewerf: 'view', editf: 'edit', managef: 'manage' }
  api = makeApi()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const map = new Map<string, string>()
  const ls = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true })
  Object.defineProperty(window, 'localStorage', { value: ls, configurable: true })
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  resetLiveForTests()
})

describe('UniworkBrowser tree row menu follows the folder level (UNI-2080)', () => {
  it('a viewer gets Open only: no New sub-folder, Rename or Move to', async () => {
    await render('viewer')
    expect(await treeMenuIds('ViewerFolder')).toEqual(['open'])
    expect(api.uniworkDocumentProperties).toHaveBeenCalledWith('viewerf')
  })

  it('a human member at view level also gets New sub-folder in a workspace folder, still no Rename / Move', async () => {
    await render('member')
    expect(await treeMenuIds('ViewerFolder')).toEqual(['open', 'new'])
  })

  it('an editor gets New sub-folder, Rename and Move to', async () => {
    await render('viewer')
    expect(await treeMenuIds('EditFolder')).toEqual(['open', 'new', 'rename', 'move'])
  })

  it('a manager gets the same write actions as an editor', async () => {
    await render('viewer')
    expect(await treeMenuIds('ManageFolder')).toEqual(['open', 'new', 'rename', 'move'])
  })

  it('a folder whose level cannot be read offers the read action only', async () => {
    await render('viewer')
    expect(await treeMenuIds('UnknownFolder')).toEqual(['open'])
  })

  it('My Folder keeps New sub-folder, never Rename or Move, and needs no level read', async () => {
    await render('viewer')
    expect(await treeMenuIds('My Folder')).toEqual(['open', 'new'])
    expect(api.uniworkDocumentProperties).not.toHaveBeenCalledWith('mf')
  })

  it('the root row keeps New folder', async () => {
    await render('viewer')
    await click($('[data-folder-menu-for=""]'))
    expect(
      $$('[role="menu"] [role="menuitem"]').map((el) => el.getAttribute('data-folder-action')),
    ).toEqual(['new'])
  })

  it('F2 on a focused viewer folder does not start a rename, on an editor folder it does', async () => {
    await render('viewer')
    const press = async (title: string) => {
      await act(async () => treeItem(title).focus())
      await flush()
      await act(async () => {
        treeItem(title).dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))
      })
      await flush()
    }
    await press('ViewerFolder')
    expect($('.uwf-tree .uw-rename-input')).toBeNull()
    await press('EditFolder')
    expect($('.uwf-tree .uw-rename-input')).not.toBeNull()
  })

  it('Open from the menu opens the folder', async () => {
    await render('viewer')
    await treeMenuIds('ViewerFolder')
    await click($('[data-folder-action="open"]'))
    expect(api.uniworkListChildren).toHaveBeenLastCalledWith(
      expect.objectContaining({ parentId: 'viewerf' }),
    )
  })

  it('the level is read again each time the menu opens (a share can change it)', async () => {
    await render('viewer')
    expect(await treeMenuIds('EditFolder')).toContain('rename')
    await click(treeItem('EditFolder').querySelector('[data-folder-menu-for]'))
    levels.editf = 'view'
    expect(await treeMenuIds('EditFolder')).toEqual(['open'])
    expect(api.uniworkDocumentProperties.mock.calls.filter(([id]) => id === 'editf')).toHaveLength(
      2,
    )
  })

  it('focus reads a level only while it is unknown: three rows, three reads, again none', async () => {
    await render('viewer')
    const focusAll = async () => {
      for (const title of ['ViewerFolder', 'EditFolder', 'ManageFolder']) {
        await act(async () => treeItem(title).focus())
        await flush()
      }
    }
    await focusAll()
    expect(api.uniworkDocumentProperties).toHaveBeenCalledTimes(3)
    await act(async () => treeItem('ViewerFolder').blur())
    await focusAll()
    expect(api.uniworkDocumentProperties).toHaveBeenCalledTimes(3)
  })
})

describe('useFolderLevels (UNI-2080 stale answers)', () => {
  it('a read answered after the workspace switched writes no level for the old workspace', async () => {
    let answer: (v: UniworkResult<UniworkDocProperties>) => void = () => {}
    api.uniworkDocumentProperties.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    )
    const seen: Array<string | undefined> = []
    const Probe = ({ ws }: { ws: string }) => {
      const { levelOf, load } = useFolderLevels(ws)
      seen.push(levelOf('f1'))
      useEffect(() => load('f1'), [load])
      return null
    }
    await act(async () => root.render(createElement(Probe, { ws: 'w1' })))
    await act(async () => root.render(createElement(Probe, { ws: 'w2' })))
    await act(async () => answer(ok(props('f1', 'edit'))))
    await flush()
    expect(seen.every((level) => level === undefined)).toBe(true)
  })

  it('an old read finishing does not clear the new workspace inflight mark', async () => {
    let answer: (v: UniworkResult<UniworkDocProperties>) => void = () => {}
    api.uniworkDocumentProperties.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve)),
    )
    let loadNow: (id: string) => void = () => {}
    const Probe = ({ ws }: { ws: string }) => {
      loadNow = useFolderLevels(ws).load
      return null
    }
    await act(async () => root.render(createElement(Probe, { ws: 'w1' })))
    await act(async () => loadNow('f1'))
    await act(async () => root.render(createElement(Probe, { ws: 'w2' })))
    // new workspace asks the same id (pending), then the old answer lands
    api.uniworkDocumentProperties.mockImplementationOnce(() => new Promise(() => {}))
    await act(async () => loadNow('f1'))
    await act(async () => answer(ok(props('f1', 'edit'))))
    await flush()
    await act(async () => loadNow('f1'))
    expect(api.uniworkDocumentProperties).toHaveBeenCalledTimes(2)
  })
})
