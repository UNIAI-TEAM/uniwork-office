/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HomeApi,
  UniworkDocSummary,
  UniworkFolderChildren,
  UniworkFolderNode,
  UniworkFolderQuery,
  UniworkResult,
  UniworkWorkspaceRef,
} from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { AccessContent } from '../src/renderer/src/doclist/cells'
import { buildRowMenu } from '../src/renderer/src/doclist/row-menu'
import { bulkWorkFor } from '../src/renderer/src/doclist/bulk'
import { FolderNameDialog } from '../src/renderer/src/uniwork-folders/FolderNameDialog'
import { UniworkBrowser } from '../src/renderer/src/uniwork-folders/UniworkBrowser'
import { buildFolderIndex } from '../src/renderer/src/uniwork-folders/uniwork-folders-model'
import {
  canCreateInsideFolder,
  isHumanMemberRole,
  newFolderIsWorkspaceVisible,
} from '../src/renderer/src/uniwork-folders/ws-folder'
import { trashDocument } from '../src/renderer/src/uniwork-library-api'
import { DocumentsHome } from '../src/renderer/src/uniwork-home/DocumentsHome'
import type { DocumentsHomeDoc } from '../src/renderer/src/uniwork-home/documents-home-model'
import { UniworkLiveHost, resetLiveForTests } from '../src/renderer/src/uniwork-live'
import { uniworkFolderStrings } from '../src/renderer/src/i18n/strings-uniwork-folders'
import { uniworkHomeStrings } from '../src/renderer/src/i18n/strings-uniwork-home'
import { uniworkDocListStrings } from '../src/renderer/src/i18n/strings-uniwork-doclist'
import {
  createFakeFolderUploadBridge,
  type FakeFolderUploadBridge,
} from './folder-upload-fake-bridge'

/**
 * UNI-2066 WS-B: the list + create rules for workspace folders in the desktop app.
 * A1 no Access pill on a folder row, A2 the workspace note in the create dialog, A3 a
 * duplicate name answers "X (1)", A4 a human workspace member creates inside a workspace
 * folder at view level, A9 "Trống" only for `isEmpty === true`, A10 wording, and the folder
 * trash call (the file-only archive route would refuse a folder).
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const uf = uniworkFolderStrings.en
const ufVi = uniworkFolderStrings.vi
const ok = <T>(value: T): UniworkResult<T> => ({ ok: true, value })

const NOTE_EN =
  'The folder name will show to everyone in the workspace. Documents inside stay visible only to you until you share them.'
const NOTE_VI =
  'Tên thư mục sẽ hiện với mọi người trong workspace. Tài liệu bên trong vẫn chỉ mình bạn xem được cho tới khi bạn chia sẻ.'

function node(
  id: string,
  title: string,
  children: UniworkFolderNode[] = [],
  extra: Partial<UniworkFolderNode> = {},
): UniworkFolderNode {
  return {
    id,
    parentId: null,
    title,
    position: 0,
    children: children.map((c) => ({ ...c, parentId: id })),
    ...extra,
  }
}

function entry(
  id: string,
  title: string,
  extra: Partial<UniworkDocSummary> = {},
): UniworkDocSummary {
  return {
    id,
    workspaceId: 'w1',
    title,
    format: null,
    updatedAt: '2026-10-01T10:00:00Z',
    kind: 'folder',
    parentId: null,
    ...extra,
  }
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string) =>
  Array.from(document.querySelectorAll<T>(sel))

async function click(el: Element | null | undefined) {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

async function contextMenu(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  })
  await flush()
}

const menuActions = () =>
  $$('[role="menuitem"]').map((el) => (el as HTMLElement).dataset.folderAction)
const note = () => $('.modal.uw-act .uw-act-note')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
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
  document.body.innerHTML = ''
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  resetLiveForTests()
})

async function mount(el: ReturnType<typeof createElement>, lang: 'en' | 'vi' = 'en') {
  await act(async () => {
    root.render(
      createElement(LocaleProvider, { initial: lang }, createElement(UniworkLiveHost), el),
    )
  })
  await flush()
}

// ── pure rules ───────────────────────────────────────────

describe('workspace rules (pure)', () => {
  // My Folder (mf) with Drafts under it; Alpha with Sub under it are workspace folders
  const index = buildFolderIndex([
    node('mf', 'My Folder', [node('mf1', 'Drafts')], { systemKind: 'my_folder' }),
    node('a', 'Alpha', [node('a1', 'Sub')]),
  ])

  it('isHumanMemberRole: owner, admin and member only', () => {
    for (const role of ['owner', 'admin', 'member']) expect(isHumanMemberRole(role)).toBe(true)
    for (const role of ['viewer', 'guest', 'agent', 'bot', '', null, undefined]) {
      expect(isHumanMemberRole(role)).toBe(false)
    }
  })

  it('newFolderIsWorkspaceVisible: the root and workspace folders, never My Folder or inside it', () => {
    expect(newFolderIsWorkspaceVisible(null, index)).toBe(true)
    expect(newFolderIsWorkspaceVisible('a', index)).toBe(true)
    expect(newFolderIsWorkspaceVisible('a1', index)).toBe(true)
    expect(newFolderIsWorkspaceVisible('mf', index)).toBe(false)
    expect(newFolderIsWorkspaceVisible('mf1', index)).toBe(false)
  })

  it('newFolderIsWorkspaceVisible: an unknown parent is judged from its row, else not at all', () => {
    expect(newFolderIsWorkspaceVisible('zz', index)).toBe(false)
    expect(newFolderIsWorkspaceVisible('zz', index, { id: 'zz', kind: 'file' })).toBe(false)
    expect(
      newFolderIsWorkspaceVisible('zz', index, { id: 'zz', kind: 'folder', visibility: 'private' }),
    ).toBe(false)
    expect(
      newFolderIsWorkspaceVisible('zz', index, {
        id: 'zz',
        kind: 'folder',
        visibility: 'workspace',
      }),
    ).toBe(true)
    expect(
      newFolderIsWorkspaceVisible('zz', index, {
        id: 'zz',
        kind: 'folder',
        visibility: 'workspace',
        systemKind: 'my_folder',
      }),
    ).toBe(false)
  })

  it('canCreateInsideFolder: edit level (or unknown) creates; a human member also at view level in a workspace folder', () => {
    const viewWs = { id: 'a', kind: 'folder' as const, canEdit: false }
    expect(canCreateInsideFolder(viewWs, index, 'member')).toBe(true)
    expect(canCreateInsideFolder(viewWs, index, 'admin')).toBe(true)
    expect(canCreateInsideFolder(viewWs, index, 'owner')).toBe(true)
    expect(canCreateInsideFolder(viewWs, index, 'viewer')).toBe(false)
    expect(canCreateInsideFolder(viewWs, index, 'guest')).toBe(false)
    expect(canCreateInsideFolder(viewWs, index, 'agent')).toBe(false)
    // an unknown role is never guessed from my_level alone
    expect(canCreateInsideFolder(viewWs, index, null)).toBe(false)
    expect(canCreateInsideFolder(viewWs, index, undefined)).toBe(false)
    // inside My Folder the wider rule does not apply
    expect(
      canCreateInsideFolder({ id: 'mf1', kind: 'folder', canEdit: false }, index, 'member'),
    ).toBe(false)
    expect(
      canCreateInsideFolder({ id: 'mf', kind: 'folder', canEdit: false }, index, 'owner'),
    ).toBe(false)
    // edit level or no flag: as before
    expect(canCreateInsideFolder({ id: 'mf1', kind: 'folder', canEdit: true }, index, null)).toBe(
      true,
    )
    expect(canCreateInsideFolder({ id: 'a', kind: 'folder' }, index, null)).toBe(true)
    // a document is never a place to create in by this rule
    expect(canCreateInsideFolder({ id: 'd', kind: 'file', canEdit: false }, index, 'member')).toBe(
      false,
    )
  })
})

// ── A1: Access cell ─────────────────────────────────────

describe('A1: a folder row has an empty Access cell', () => {
  const file: DocumentsHomeDoc = {
    id: 'd1',
    workspaceId: 'w1',
    title: 'Plan.docx',
    format: 'docx',
    updatedAt: '2026-10-01T10:00:00Z',
    kind: 'file',
    parentId: null,
    visibility: 'workspace',
    myLevel: 'edit',
  }

  it('shows no pill and no level line for a folder, whatever its visibility or level', async () => {
    for (const visibility of ['workspace', 'private', 'restricted'] as const) {
      await mount(
        createElement(AccessContent, {
          doc: { ...file, kind: 'folder', visibility, myLevel: 'manage', isOwner: true },
        }),
      )
      expect(host.querySelector('.dh-vis-badge'), visibility).toBeNull()
      expect(host.querySelector('.dh-level-sub'), visibility).toBeNull()
      expect(host.textContent ?? '', visibility).toBe('')
    }
  })

  it('a file row keeps its pill and level line', async () => {
    await mount(createElement(AccessContent, { doc: file }), 'vi')
    expect(host.querySelector('.dh-vis-badge')?.textContent).toBe(
      uniworkDocListStrings.vi.dlAccessWorkspace,
    )
    expect(host.querySelector('.dh-level-sub')).not.toBeNull()
  })
})

// ── row menu: new subfolder (A4) ────────────────────────

describe('A4: the row menu offers a new subfolder by the create rule', () => {
  const folder = (extra: Partial<DocumentsHomeDoc> = {}): DocumentsHomeDoc => ({
    id: 'f1',
    workspaceId: 'w1',
    title: 'Reports',
    format: null,
    updatedAt: '2026-10-01T10:00:00Z',
    kind: 'folder',
    parentId: null,
    ...extra,
  })
  const run = {
    open: () => {},
    'new-subfolder': () => {},
    rename: () => {},
    move: () => {},
    trash: () => {},
  }
  const ids = (doc: DocumentsHomeDoc, canCreateInside?: boolean) =>
    buildRowMenu({
      screen: 'workspace',
      doc,
      run,
      offlineLabel: null,
      label: (key) => key,
      ...(canCreateInside === undefined ? {} : { canCreateInside }),
    }).map((item) => item.id)

  it('a view-level folder the host says takes new content: only Open and the new subfolder', () => {
    expect(ids(folder({ canEdit: false, canManage: false }), true)).toEqual([
      'open',
      'new-subfolder',
    ])
  })

  it('without the host flag the edit level decides, as rename and move do', () => {
    expect(ids(folder({ canEdit: true, canManage: true }))).toEqual([
      'open',
      'new-subfolder',
      'rename',
      'move',
      'trash',
    ])
    expect(ids(folder({ canEdit: false }))).toEqual(['open'])
    expect(ids(folder({ canEdit: false }), false)).toEqual(['open'])
  })

  it('a host that gives no run entry has no item, and a file never has one', () => {
    const noRun = buildRowMenu({
      screen: 'workspace',
      doc: folder({ canEdit: true }),
      run: { open: () => {} },
      offlineLabel: null,
      label: (key) => key,
    })
    expect(noRun.map((i) => i.id)).toEqual(['open'])
    const fileRow = folder({ kind: 'file', format: 'docx', canEdit: true })
    expect(ids(fileRow, true)).not.toContain('new-subfolder')
  })

  it('the label is "New subfolder"', () => {
    const items = buildRowMenu({
      screen: 'workspace',
      doc: folder({ canEdit: true }),
      run,
      offlineLabel: null,
      label: (key) => (key === 'ufNewSubfolder' ? uf.ufNewSubfolder : key),
    })
    expect(items.find((i) => i.id === 'new-subfolder')?.label).toBe('New subfolder')
  })
})

// ── A2: the dialog note ─────────────────────────────────

describe('A2: FolderNameDialog workspace note', () => {
  const dialog = (workspaceNote?: boolean) =>
    createElement(FolderNameDialog, {
      title: 'New folder',
      submitLabel: 'Create',
      onSubmit: async () => ({ ok: true as const }),
      onCancel: () => {},
      ...(workspaceNote === undefined ? {} : { workspaceNote }),
    })

  it('shows the web sentence under the name field (en) and ties it to the input', async () => {
    await mount(dialog(true))
    expect(note()?.textContent).toBe(NOTE_EN)
    const input = $<HTMLInputElement>('.modal.uw-act input')!
    const described = (input.getAttribute('aria-describedby') ?? '').split(/\s+/)
    expect(described).toContain(note()!.id)
    // the error line stays described too
    expect(described.length).toBeGreaterThanOrEqual(2)
    for (const id of described) expect(document.getElementById(id), id).not.toBeNull()
  })

  it('shows the web sentence in vi, verbatim', async () => {
    await mount(dialog(true), 'vi')
    expect(note()?.textContent).toBe(NOTE_VI)
  })

  it('has no note when the flag is off or absent, and the input keeps only its error line', async () => {
    for (const flag of [false, undefined]) {
      await mount(dialog(flag))
      expect(note()).toBeNull()
      const input = $<HTMLInputElement>('.modal.uw-act input')!
      expect((input.getAttribute('aria-describedby') ?? '').split(/\s+/)).toHaveLength(1)
    }
  })

  it('the strings are defined in vi and en as the web has them and in every locale', () => {
    expect(uniworkFolderStrings.en.ufCreateWorkspaceNote).toBe(NOTE_EN)
    expect(uniworkFolderStrings.vi.ufCreateWorkspaceNote).toBe(NOTE_VI)
    for (const [lang, strings] of Object.entries(uniworkFolderStrings)) {
      expect(strings.ufCreateWorkspaceNote, lang).toBeTruthy()
      expect(strings.ufCardEmpty, lang).toBeTruthy()
    }
    expect(uniworkFolderStrings.vi.ufCardEmpty).toBe('Trống')
    expect(uniworkFolderStrings.en.ufCardEmpty).toBe('Empty')
  })
})

// ── browser harness (tree + contents + create) ──────────

let tree: UniworkFolderNode[]
let children: Record<string, UniworkDocSummary[]>
let api: ReturnType<typeof makeApi>

function makeApi() {
  const fns = {
    uniworkFolderTree: vi.fn(async (_ws: string) => ok(tree)),
    // UNI-2080: a tree menu reads the folder's level when it opens; these rows are all manageable
    uniworkDocumentProperties: vi.fn(async (id: string) =>
      ok({ documentId: id, workspaceId: 'w1', title: id, myLevel: 'manage' }),
    ),
    uniworkListChildren: vi.fn(
      async (q: UniworkFolderQuery): Promise<UniworkResult<UniworkFolderChildren>> => {
        const items = children[q.parentId ?? '']
        return items ? ok({ items, nextCursor: null }) : { ok: false, error: 'not_found' }
      },
    ),
    uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
    uniworkCreateFolder: vi.fn(async (i: { parentId: string | null; title: string }) =>
      ok(entry('new', i.title, { parentId: i.parentId })),
    ),
    uniworkMoveDocument: vi.fn(),
    uniworkRenameDocument: vi.fn(),
    onUniworkTreeChanged: vi.fn(() => () => undefined),
  }
  window.aiOffice = fns as unknown as HomeApi
  return fns
}

function seedBrowser() {
  tree = [
    node('a', 'Alpha'),
    node('mf', 'Stored', [node('mf1', 'Drafts')], { systemKind: 'my_folder' }),
    node('b', 'Beta'),
  ]
  children = {
    '': [
      entry('a', 'Alpha', { canEdit: false, visibility: 'workspace' }),
      entry('b', 'Beta', { canEdit: true, visibility: 'workspace' }),
      entry('mf', 'Stored', { systemKind: 'my_folder' }),
    ],
    a: [],
    b: [],
    mf: [entry('mf1', 'Drafts', { parentId: 'mf', canEdit: false })],
    mf1: [],
  }
  api = makeApi()
}

const treeItem = (title: string) =>
  $$('[role="treeitem"]').find((el) => el.querySelector('.uwf-tree-title')?.textContent === title)!

const browser = (props: Partial<Parameters<typeof UniworkBrowser>[0]> = {}) =>
  createElement(UniworkBrowser, {
    workspaceId: 'w1',
    variant: 'pane',
    onOpenDocument: vi.fn(),
    ...props,
  })

async function newFromTree(title: string) {
  await contextMenu(treeItem(title))
  await click($('[role="menuitem"][data-folder-action="new"]'))
}

describe('A2: the note on every browser create path', () => {
  beforeEach(seedBrowser)

  it('tree menu: a workspace folder and the root get the note, My Folder and its child do not', async () => {
    await mount(browser())
    await newFromTree('Alpha')
    expect(note()?.textContent).toBe(NOTE_EN)
    await click($('.modal.uw-act button.btn-secondary'))

    await newFromTree(uf.ufRoot)
    expect(note()?.textContent).toBe(NOTE_EN)
    await click($('.modal.uw-act button.btn-secondary'))

    await newFromTree('My Folder')
    expect($('.modal.uw-act')).not.toBeNull()
    expect(note()).toBeNull()
    await click($('.modal.uw-act button.btn-secondary'))

    // Drafts is inside My Folder: expand it first
    await click(treeItem('My Folder').querySelector('.uwf-twisty'))
    if (!$$('[role="treeitem"]').some((el) => el.textContent?.includes('Drafts'))) {
      throw new Error('Drafts did not show in the tree')
    }
    await newFromTree('Drafts')
    expect($('.modal.uw-act')).not.toBeNull()
    expect(note()).toBeNull()
  })

  it('the open folder header: the root and a workspace folder get the note, My Folder does not', async () => {
    await mount(browser())
    await click($('.uwf-new-folder'))
    expect(note()?.textContent).toBe(NOTE_EN)
    await click($('.modal.uw-act button.btn-secondary'))

    await click(treeItem('Alpha'))
    await click($('.uwf-new-folder'))
    expect(note()?.textContent).toBe(NOTE_EN)
    await click($('.modal.uw-act button.btn-secondary'))

    await click(treeItem('My Folder'))
    await click($('.uwf-new-folder'))
    expect($('.modal.uw-act')).not.toBeNull()
    expect(note()).toBeNull()
  })

  it('a row menu (the card of a workspace folder): New subfolder shows the note', async () => {
    await mount(browser({ myRole: 'member' }))
    await click($('.uwf-contents button[data-folder-menu-for="b"]'))
    await click($('[role="menuitem"][data-folder-action="new"]'))
    expect(note()?.textContent).toBe(NOTE_EN)
  })

  it('the vi note is the web sentence', async () => {
    await mount(browser(), 'vi')
    await click($('.uwf-new-folder'))
    expect(note()?.textContent).toBe(NOTE_VI)
  })
})

describe('A3: a duplicate name answers "X (1)"', () => {
  beforeEach(seedBrowser)

  it('the browser says the title the server returned, not the typed one', async () => {
    api.uniworkCreateFolder.mockImplementation(async (i) =>
      ok(entry('new', `${i.title} (1)`, { parentId: i.parentId })),
    )
    await mount(browser())
    await click($('.uwf-new-folder'))
    const input = $<HTMLInputElement>('.modal.uw-act input')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'Alpha')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click($('.modal.uw-act button[type="submit"]'))
    expect($('.modal.uw-act')).toBeNull()
    expect(document.getElementById('uw-live-host')?.textContent).toContain(
      uf.ufFolderCreated.replace('{name}', 'Alpha (1)'),
    )
    expect(api.uniworkCreateFolder).toHaveBeenCalledTimes(1)
  })
})

describe('A4: browser menus by the user workspace role', () => {
  beforeEach(seedBrowser)

  const rowMenuOf = async (id: string, myRole?: string | null) => {
    await mount(browser(myRole === undefined ? {} : { myRole }))
    const button = $(`.uwf-contents button[data-folder-menu-for="${id}"]`)
    if (!button) return null
    await click(button)
    return menuActions()
  }

  it('a view-level workspace folder: a human member gets only New subfolder', async () => {
    for (const role of ['member', 'admin', 'owner']) {
      expect(await rowMenuOf('a', role), role).toEqual(['new'])
      await act(async () => root.unmount())
      root = createRoot(host)
    }
  })

  it('viewer, guest, agent and an unknown role get no menu on it', async () => {
    for (const role of ['viewer', 'guest', 'agent', null, undefined]) {
      expect(await rowMenuOf('a', role), String(role)).toBeNull()
      await act(async () => root.unmount())
      root = createRoot(host)
    }
  })

  it('an edit-level folder keeps New, Rename and Move for any role', async () => {
    expect(await rowMenuOf('b', 'viewer')).toEqual(['new', 'rename', 'move'])
  })

  it('a view-level folder inside My Folder never gets the wider rule', async () => {
    await mount(browser({ myRole: 'owner' }))
    await click(treeItem('My Folder'))
    expect($('.uwf-contents button[data-folder-menu-for="mf1"]')).toBeNull()
  })
})

// ── DocumentsHome ───────────────────────────────────────

describe('DocumentsHome: cards, header, New menu and drop for workspace folders', () => {
  let sidebarSlot: HTMLDivElement
  let bridge: FakeFolderUploadBridge
  let homeApi: Record<string, ReturnType<typeof vi.fn>>
  let workspaces: UniworkWorkspaceRef[]
  let rootItems: DocumentsHomeDoc[]
  let homeLevels: Record<string, string>

  const card = (id: string) =>
    host.querySelector<HTMLElement>(`.dh-folder-card[data-folder-id="${id}"]`)
  const cardMenuActions = async (id: string): Promise<string[] | null> => {
    const button = card(id)?.querySelector('[data-folder-menu-for]')
    if (!button) return null
    await click(button)
    const actions = menuActions() as string[]
    await click(button) // close
    return actions
  }
  const library = () => host.querySelector<HTMLElement>('.dh-main')!
  const dragEvent = (type: string): Event => {
    const file = { name: 'a.docx' }
    const event = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', {
      value: {
        types: ['Files'],
        dropEffect: 'none',
        items: [
          { kind: 'file', getAsFile: () => file, webkitGetAsEntry: () => ({ isDirectory: false }) },
        ],
        files: [file],
      },
    })
    return event
  }

  const folderRow = (id: string, title: string, extra: Partial<DocumentsHomeDoc> = {}) =>
    ({
      id,
      workspaceId: 'ws-1',
      title,
      format: null,
      updatedAt: '2026-10-17T08:00:00.000Z',
      kind: 'folder',
      parentId: null,
      visibility: 'workspace',
      ...extra,
    }) as DocumentsHomeDoc

  async function mountHome(role: string | null, lang: 'en' | 'vi' = 'en') {
    workspaces = [
      {
        id: 'ws-1',
        name: 'Acme',
        slug: 'acme',
        orgId: 'org-1',
        orgSlug: 'acme',
        myRole: role,
      } as UniworkWorkspaceRef,
    ]
    await mount(
      createElement(DocumentsHome, {
        workspaceId: 'ws-1',
        workspaces,
        onWorkspaceChange: vi.fn(),
        onOpenDocument: vi.fn(),
        sidebarHost: sidebarSlot,
      }),
      lang,
    )
    await click(sidebarSlot.querySelector('[data-nav="workspace"]'))
  }

  beforeEach(() => {
    resetLiveForTests()
    sidebarSlot = document.createElement('div')
    document.body.appendChild(sidebarSlot)
    bridge = createFakeFolderUploadBridge()
    const homeTree: UniworkFolderNode[] = [
      node('f-mine', 'My Folder', [node('f-mine-sub', 'Drafts')], { systemKind: 'my_folder' }),
      node('f-ws', 'View only'),
      node('f-rw', 'Editable'),
      node('f-empty', 'Empty one'),
      node('f-full', 'Full one'),
      node('f-unknown', 'Unknown one'),
    ]
    homeLevels = { 'f-ws': 'view', 'f-rw': 'manage', 'f-mine-sub': 'manage' }
    rootItems = [
      folderRow('f-ws', 'View only', { canEdit: false, canManage: false, myLevel: 'view' }),
      folderRow('f-rw', 'Editable', { canEdit: true, canManage: true, myLevel: 'manage' }),
      folderRow('f-empty', 'Empty one', { canEdit: true, isEmpty: true }),
      folderRow('f-full', 'Full one', { canEdit: true, isEmpty: false }),
      folderRow('f-unknown', 'Unknown one', { canEdit: true }),
    ]
    homeApi = {
      accountStatus: vi.fn(async () => ({
        state: 'signed-in' as const,
        loggedIn: true,
        email: 'a@acme.vn',
        profile: {
          accountId: 'acc-1',
          email: 'a@acme.vn',
          name: 'An',
          orgId: 'org-1',
          orgName: 'Acme',
          workspaces: [],
        },
      })),
      uniworkListWorkspaces: vi.fn(async () => ok([])),
      uniworkArchiveImpact: vi.fn(async () =>
        ok({ tooLarge: false as const, folders: 1, documents: 0, relocatedCount: 0 }),
      ),
      uniworkTrashShelvedDocument: vi.fn(async (id: string) => ok(entry(id, 'Trashed'))),
      uniworkFolderTree: vi.fn(async () => ok(homeTree)),
      // UNI-2080: the sidebar tree menu reads each folder's level when it opens; f-unknown has none
      uniworkDocumentProperties: vi.fn(async (id: string) =>
        id in homeLevels
          ? ok({ documentId: id, workspaceId: 'ws-1', title: id, myLevel: homeLevels[id] })
          : ({ ok: false, error: 'network' } as const),
      ),
      uniworkEnsureMyFolder: vi.fn(async () => ok({ ...homeTree[0]! })),
      uniworkListChildren: vi.fn(
        async (q: UniworkFolderQuery): Promise<UniworkResult<UniworkFolderChildren>> => {
          if (q.parentId === 'f-mine') return ok({ items: [], nextCursor: null })
          if (q.parentId === null) return ok({ items: rootItems, nextCursor: null })
          return ok({ items: [], nextCursor: null })
        },
      ),
      uniworkListDocuments: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListSharedWithMe: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListSharedByMe: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkListTrash: vi.fn(async () => ok({ documents: [], nextCursor: null })),
      uniworkSearchDocuments: vi.fn(async () => ok({ items: [], nextCursor: null })),
      uniworkCreateFolder: vi.fn(async (i: { parentId: string | null; title: string }) =>
        ok(entry('new', i.title, { parentId: i.parentId })),
      ),
      onUniworkTreeChanged: vi.fn(() => () => {}),
      onUniworkDocRenamed: vi.fn(() => () => {}),
      onUniworkUploadProgress: vi.fn(() => () => {}),
      getPathForFile: vi.fn((file: { name: string }) => `/disk/${file.name}`),
    }
    const w = window as unknown as Record<string, unknown>
    w.aiOffice = homeApi
    w.home = homeApi
    w.uniworkFolderUpload = bridge
  })

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).uniworkFolderUpload
    sidebarSlot.remove()
  })

  // UNI-2080 (FU-2066-2): the sidebar tree row menu follows the level like the card does
  const treeMenuActions = async (id: string): Promise<string[] | null> => {
    const button = sidebarSlot.querySelector(`.uwf-tree [data-folder-menu-for="${id}"]`)
    if (!button) return null
    await click(button)
    const actions = menuActions() as string[]
    await click(button) // close
    return actions
  }

  it('sidebar tree: a viewer gets Open only on a view-level folder, a human member also New subfolder', async () => {
    await mountHome('viewer')
    expect(await treeMenuActions('f-ws')).toEqual(['open'])
    await act(async () => root.unmount())
    root = createRoot(host)
    await mountHome('member')
    expect(await treeMenuActions('f-ws')).toEqual(['open', 'new'])
  })

  it('sidebar tree: an editable folder keeps New subfolder, Rename and Move to', async () => {
    await mountHome('viewer')
    expect(await treeMenuActions('f-rw')).toEqual(['open', 'new', 'rename', 'move'])
  })

  it('sidebar tree: a folder whose level cannot be read offers Open only', async () => {
    await mountHome('viewer')
    expect(await treeMenuActions('f-unknown')).toEqual(['open'])
  })

  it('sidebar tree: My Folder keeps New subfolder and never Rename or Move', async () => {
    await mountHome('viewer')
    expect(await treeMenuActions('f-mine')).toEqual(['open', 'new'])
  })

  it('A4 card: a human member of any grade sees Open + New subfolder on a view-level workspace folder', async () => {
    for (const role of ['member', 'admin', 'owner']) {
      await mountHome(role)
      expect(await cardMenuActions('f-ws'), role).toEqual(['open', 'new'])
      await act(async () => root.unmount())
      root = createRoot(host)
    }
  })

  it('A4 card: viewer, guest, agent and an unknown role get no menu on it', async () => {
    for (const role of ['viewer', 'guest', 'agent', null]) {
      await mountHome(role)
      expect(await cardMenuActions('f-ws'), String(role)).toBeNull()
      await act(async () => root.unmount())
      root = createRoot(host)
    }
  })

  it('A4 card: an editable folder keeps its full menu', async () => {
    await mountHome('viewer')
    expect(await cardMenuActions('f-rw')).toEqual(['open', 'new', 'rename', 'move', 'trash'])
  })

  it('A2 card: New subfolder on a workspace folder card shows the note', async () => {
    await mountHome('member')
    await click(card('f-ws')!.querySelector('[data-folder-menu-for]'))
    await click($('[role="menuitem"][data-folder-action="new"]'))
    expect(note()?.textContent).toBe(NOTE_EN)
  })

  it('A4 header: inside a view-level workspace folder a member gets New subfolder only, with the note', async () => {
    await mountHome('member')
    await click(card('f-ws')!.querySelector('.dh-folder-open'))
    const button = host.querySelector('[data-folder-menu-for="open-folder"]')
    expect(button).not.toBeNull()
    await click(button)
    expect(menuActions()).toEqual(['new'])
    await click($('[role="menuitem"][data-folder-action="new"]'))
    expect(note()?.textContent).toBe(NOTE_EN)
  })

  it('A4 header: a viewer gets no header menu in a view-level folder', async () => {
    await mountHome('viewer')
    // the card has no menu; open it through its name
    await click(card('f-ws')!.querySelector('.dh-folder-open'))
    expect(host.querySelector('[data-folder-menu-for="open-folder"]')).toBeNull()
  })

  it('A4 New menu: a member has the Folder row in a view-level workspace folder, and the note shows', async () => {
    await mountHome('member')
    await click(card('f-ws')!.querySelector('.dh-folder-open'))
    await click(host.querySelector('button.dh-btn-create'))
    const folderRow2 = document.querySelector('[role="menuitem"][data-new-kind="folder"]')
    expect(folderRow2).not.toBeNull()
    await click(folderRow2)
    expect(note()?.textContent).toBe(NOTE_EN)
  })

  it('A2 New menu: in My Folder the dialog has no note', async () => {
    await mountHome('member')
    const mine = $$('[role="treeitem"]').find(
      (el) => el.querySelector('.uwf-tree-title')?.textContent === 'My Folder',
    )
    await click(mine)
    await click(host.querySelector('button.dh-btn-create'))
    await click(document.querySelector('[role="menuitem"][data-new-kind="folder"]'))
    expect($('.modal.uw-act')).not.toBeNull()
    expect(note()).toBeNull()
  })

  it('A4 Upload: a view-level workspace folder takes a drop from a human member, not from a viewer', async () => {
    await mountHome('member')
    await click(card('f-ws')!.querySelector('.dh-folder-open'))
    const memberDrop = dragEvent('drop')
    bridge.preflight.mockResolvedValueOnce([])
    await act(async () => {
      library().dispatchEvent(memberDrop)
    })
    await flush()
    expect(memberDrop.defaultPrevented).toBe(true)
    await act(async () => root.unmount())
    root = createRoot(host)

    bridge.preflight.mockClear()
    await mountHome('viewer')
    await click(card('f-ws')!.querySelector('.dh-folder-open'))
    const viewerDrop = dragEvent('drop')
    await act(async () => {
      library().dispatchEvent(viewerDrop)
    })
    await flush()
    expect(viewerDrop.defaultPrevented).toBe(false)
    expect(bridge.preflight).not.toHaveBeenCalled()
  })

  // ── WS-V2: new content follows the create rule in the toolbar too ──

  const toolbarOffers = () => ({
    create: host.querySelector('button.dh-btn-create') !== null,
    upload: host.querySelector('.dh-btn-upload') !== null,
    quick: host.querySelector('.dh-quick-row') !== null,
  })
  const OFFERED = { create: true, upload: true, quick: true }
  const WITHHELD = { create: false, upload: false, quick: false }
  const openCard = async (id: string) => click(card(id)!.querySelector('.dh-folder-open'))

  it('WS-V2: a human member, admin and owner see New, Upload and Quick create in a view-level workspace folder', async () => {
    for (const role of ['member', 'admin', 'owner']) {
      await mountHome(role)
      await openCard('f-ws')
      expect(toolbarOffers(), role).toEqual(OFFERED)
      await act(async () => root.unmount())
      root = createRoot(host)
    }
  })

  it('WS-V2: a viewer, guest, agent or unknown role sees none of them in a view-level workspace folder', async () => {
    for (const role of ['viewer', 'guest', 'agent', null]) {
      await mountHome(role)
      await openCard('f-ws')
      expect(toolbarOffers(), String(role)).toEqual(WITHHELD)
      await act(async () => root.unmount())
      root = createRoot(host)
    }
  })

  it('WS-V2: an editable folder and the workspace root keep them for a viewer', async () => {
    await mountHome('viewer')
    expect(toolbarOffers()).toEqual(OFFERED)
    await openCard('f-rw')
    expect(toolbarOffers()).toEqual(OFFERED)
  })

  it('WS-V2: leaving the view-only folder brings them back', async () => {
    await mountHome('viewer')
    await openCard('f-ws')
    expect(toolbarOffers()).toEqual(WITHHELD)
    await click(sidebarSlot.querySelector('[data-nav="workspace"]'))
    expect(toolbarOffers()).toEqual(OFFERED)
  })

  // ── WS-V4: the web's folder card and open-folder menus offer the trash for manage ──

  it('WS-V4 card: Move to trash only where the level is manage (the web gate), never on a view-level folder', async () => {
    await mountHome('admin')
    expect(await cardMenuActions('f-rw')).toEqual(['open', 'new', 'rename', 'move', 'trash'])
    // edit without manage, and a view-level folder: no trash
    expect(await cardMenuActions('f-empty')).toEqual(['open', 'new', 'rename', 'move'])
    expect(await cardMenuActions('f-ws')).toEqual(['open', 'new'])
  })

  it('WS-V4 card: the entry reads "Move to trash" and opens the confirm', async () => {
    await mountHome('member')
    await click(card('f-rw')!.querySelector('[data-folder-menu-for]'))
    const entryEl = $('[role="menuitem"][data-folder-action="trash"]')
    expect(entryEl?.textContent).toContain(uniworkDocListStrings.en.dlActTrash)
    await click(entryEl)
    expect($('.modal.uw-act')).not.toBeNull()
    expect($('.modal.uw-act .uw-act-heading')?.textContent).toContain('Editable')
  })

  it('WS-V4 card: confirming reads the impact, trashes through the folder call and refreshes', async () => {
    await mountHome('member')
    await click(card('f-rw')!.querySelector('[data-folder-menu-for]'))
    await click($('[role="menuitem"][data-folder-action="trash"]'))
    await flush()
    expect(homeApi.uniworkArchiveImpact).toHaveBeenCalledWith('f-rw')
    await click($('.modal.uw-act .btn-primary'))
    expect(homeApi.uniworkTrashShelvedDocument).toHaveBeenCalledTimes(1)
    expect(homeApi.uniworkTrashShelvedDocument!.mock.calls[0]![0]).toBe('f-rw')
  })

  it('WS-V4 card: Cancel trashes nothing', async () => {
    await mountHome('member')
    await click(card('f-rw')!.querySelector('[data-folder-menu-for]'))
    await click($('[role="menuitem"][data-folder-action="trash"]'))
    await click($('.modal.uw-act .btn-secondary'))
    expect($('.modal.uw-act')).toBeNull()
    expect(homeApi.uniworkTrashShelvedDocument).not.toHaveBeenCalled()
  })

  it('WS-V4 card: a relocated count shows the sentence in the confirm', async () => {
    homeApi.uniworkArchiveImpact!.mockResolvedValueOnce(
      ok({ tooLarge: false, folders: 1, documents: 3, relocatedCount: 2 }),
    )
    await mountHome('member')
    await click(card('f-rw')!.querySelector('[data-folder-menu-for]'))
    await click($('[role="menuitem"][data-folder-action="trash"]'))
    await flush()
    expect($('.modal.uw-act .uw-act-note')?.textContent).toBe(uf.ufTrashRelocated)
  })

  it('WS-V4 header: the open folder menu has Move to trash for manage, and a trashed open folder returns to the parent list', async () => {
    await mountHome('member')
    await openCard('f-rw')
    await click(host.querySelector('[data-folder-menu-for="open-folder"]'))
    expect(menuActions()).toEqual(['new', 'rename', 'move', 'trash'])
    await click($('[role="menuitem"][data-folder-action="trash"]'))
    await flush()
    expect(homeApi.uniworkArchiveImpact).toHaveBeenCalledWith('f-rw')
    await click($('.modal.uw-act .btn-primary'))
    expect(homeApi.uniworkTrashShelvedDocument!.mock.calls[0]![0]).toBe('f-rw')
    // back at the workspace root: the cards of the root show again
    expect(card('f-ws')).not.toBeNull()
  })

  it('WS-V4 header: no trash in the header of a folder the level does not manage', async () => {
    await mountHome('member')
    await openCard('f-ws')
    await click(host.querySelector('[data-folder-menu-for="open-folder"]'))
    expect(menuActions()).toEqual(['new'])
    await click($('[role="menuitem"][data-folder-action="new"]'))
    await click($('.modal.uw-act .btn-secondary'))
    await click(sidebarSlot.querySelector('[data-nav="workspace"]'))
    await openCard('f-empty')
    await click(host.querySelector('[data-folder-menu-for="open-folder"]'))
    expect(menuActions()).toEqual(['new', 'rename', 'move'])
  })

  it('A9: a card says "Empty" only for isEmpty === true; absent or false says nothing', async () => {
    await mountHome('member')
    const text = (id: string) => card(id)!.textContent ?? ''
    expect(text('f-empty')).toContain(uniworkFolderStrings.en.ufCardEmpty)
    expect(text('f-full')).not.toContain(uniworkFolderStrings.en.ufCardEmpty)
    expect(text('f-unknown')).not.toContain(uniworkFolderStrings.en.ufCardEmpty)
    expect(text('f-rw')).not.toContain(uniworkFolderStrings.en.ufCardEmpty)
    expect(card('f-empty')!.querySelector('.dh-folder-empty')).not.toBeNull()
    expect(card('f-unknown')!.querySelector('.dh-folder-empty')).toBeNull()
  })

  it('A9: the vi card says "Trống"', async () => {
    await mountHome('member', 'vi')
    expect(card('f-empty')!.textContent).toContain('Trống')
    expect(card('f-unknown')!.textContent).not.toContain('Trống')
  })
})

// ── the folder trash call (WS-C open point) ─────────────

describe('trashing a folder uses the kind-agnostic call', () => {
  let fns: Record<string, ReturnType<typeof vi.fn>>
  beforeEach(() => {
    fns = {
      uniworkArchiveDocument: vi.fn(async () => ok({})),
      uniworkTrashShelvedDocument: vi.fn(async () => ok(entry('x', 'X'))),
    }
    window.aiOffice = fns as unknown as HomeApi
  })

  it('a folder or a page goes through uniworkTrashShelvedDocument, a file through archive', async () => {
    await trashDocument({ id: 'f', kind: 'folder' })
    await trashDocument({ id: 'p', kind: 'page' })
    expect(fns.uniworkTrashShelvedDocument!.mock.calls.map((c) => c[0])).toEqual(['f', 'p'])
    expect(fns.uniworkArchiveDocument).not.toHaveBeenCalled()
    await trashDocument({ id: 'd', kind: 'file' })
    await trashDocument({ id: 'e' })
    expect(fns.uniworkArchiveDocument!.mock.calls.map((c) => c[0])).toEqual(['d', 'e'])
  })

  it('bulk trash of a folder row runs the same call on every screen', async () => {
    const doc = (id: string, kind: 'file' | 'folder'): DocumentsHomeDoc => ({
      id,
      workspaceId: 'w1',
      title: id,
      format: null,
      updatedAt: '2026-10-01T10:00:00Z',
      kind,
      parentId: null,
    })
    const work = bulkWorkFor('trash', 'workspace')
    expect(await work(doc('f1', 'folder'))).toEqual({ ok: true })
    expect(await work(doc('d1', 'file'))).toEqual({ ok: true })
    expect(fns.uniworkTrashShelvedDocument!.mock.calls.map((c) => c[0])).toEqual(['f1'])
    expect(fns.uniworkArchiveDocument!.mock.calls.map((c) => c[0])).toEqual(['d1'])
  })
})

// ── A10: wording ────────────────────────────────────────

describe('A10: wording', () => {
  const FORBIDDEN = /th[uư] m[uụ]c chung|shared folder/i

  it('"Thư mục của tôi" is My Folder; no vi / en string of the touched shards says "thư mục chung" / "shared folder"', () => {
    for (const shard of [uniworkFolderStrings, uniworkHomeStrings, uniworkDocListStrings]) {
      for (const lang of ['vi', 'en'] as const) {
        for (const [key, value] of Object.entries(shard[lang])) {
          expect(String(value), `${lang}.${key}`).not.toMatch(FORBIDDEN)
        }
      }
    }
    expect(ufVi.ufCreateWorkspaceNote).not.toMatch(FORBIDDEN)
    expect(uniworkFolderStrings.en.ufCreateWorkspaceNote).not.toMatch(FORBIDDEN)
  })

  it('My Folder reads "Thư mục của tôi" in vi', async () => {
    const { uniworkSaveStrings } = await import('../src/renderer/src/i18n/strings-uniwork-save')
    expect(uniworkSaveStrings.vi.usMyFolder).toBe('Thư mục của tôi')
    expect(uniworkSaveStrings.en.usMyFolder).toBe('My Folder')
  })
})
