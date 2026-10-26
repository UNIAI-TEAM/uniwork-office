/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AccountStatus,
  HomeApi,
  UniworkDocActionResult,
  UniworkDocSummary,
  UniworkFirstSaveInput,
  UniworkFolderNode,
  UniworkTreeChangedEvent,
} from '../src/shared/home-api'
import type { TabSummary } from '../src/shared/tabs-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import {
  SaveDialogHost,
  resetFirstSavesForTests,
} from '../src/renderer/src/uniwork-folders/SaveDialog'
import { UniworkNotice } from '../src/renderer/src/UniworkChrome'
import { UniworkLiveHost, resetLiveForTests } from '../src/renderer/src/uniwork-live'
import { uniworkSaveStrings } from '../src/renderer/src/i18n/strings-uniwork-save'
import { uniworkFolderStrings } from '../src/renderer/src/i18n/strings-uniwork-folders'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { setCurrentWorkbenchBucket } from '../src/renderer/src/workbench-bucket'
import { writeActiveWorkspaceId } from '../src/renderer/src/active-workspace'

/**
 * SAVE-01 §4 (AC-1, AC-3, AC-5): the first-save SaveDialog against a typed
 * fake of the BE IPC (packet-SAVE-01-BE "IPC / codes for the FE half"). The
 * push is acked before anything renders, a foreign path is dropped, State 1
 * and State 2 match the board, close/Esc send nothing, the target union is
 * exact, and every refusal code has its own line at the role=alert field.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const vi_ = uniworkSaveStrings.vi
const en = uniworkSaveStrings.en
const ufVi = uniworkFolderStrings.vi
const docEn = uniworkDocumentStrings.en

const TAB_PATH = 'C:\\Users\\me\\Documents\\Biên bản họp tuần 43.docx'

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

function summary(
  id: string,
  title: string,
  extra: Partial<UniworkDocSummary> = {},
): UniworkDocSummary {
  return {
    id,
    workspaceId: 'w1',
    title,
    format: 'docx',
    updatedAt: '2026-10-17T08:00:00Z',
    kind: 'file',
    parentId: 'mf',
    ...extra,
  }
}

const ok = <T>(value: T) => ({ ok: true as const, value })

let tree: UniworkFolderNode[]
let tabs: TabSummary[]
let calls: string[]
let ackSawDialog: boolean[]
let firstSaveAnswer: () => Promise<UniworkDocActionResult<UniworkDocSummary>>
let host: HTMLDivElement
let root: Root
let api: ReturnType<typeof makeApi>

function makeApi() {
  let open: ((r: { path: string }) => void) | null = null
  let treeChanged: ((e: UniworkTreeChangedEvent) => void) | null = null
  let accountStatus: ((s: AccountStatus) => void) | null = null
  const fns = {
    onAccountStatus: vi.fn((cb: (s: AccountStatus) => void) => {
      accountStatus = cb
      return () => {
        accountStatus = null
      }
    }),
    onUniworkFirstSaveOpen: vi.fn((cb: (r: { path: string }) => void) => {
      open = cb
      return () => {
        open = null
      }
    }),
    uniworkFirstSaveOpenAck: vi.fn(async (path: string) => {
      calls.push(`ack:${path}`)
      ackSawDialog.push(document.querySelector('[role="dialog"]') !== null)
    }),
    uniworkEnsureMyFolder: vi.fn(async (ws: string) => {
      calls.push(`ensure:${ws}`)
      return ok(
        summary('mf', 'My Folder', {
          kind: 'folder',
          format: null,
          parentId: null,
          systemKind: 'my_folder',
        }),
      )
    }),
    uniworkFirstSave: vi.fn((input: UniworkFirstSaveInput) => {
      calls.push(`first-save:${JSON.stringify(input.target)}`)
      return firstSaveAnswer()
    }),
    uniworkListWorkspaces: vi.fn(async () =>
      ok([{ id: 'w1', name: 'Team', orgId: 'o1', slug: 'team', orgSlug: 'org', myRole: 'member' }]),
    ),
    uniworkFolderTree: vi.fn(async (_ws: string) => ok(tree)),
    uniworkCreateFolder: vi.fn(async (i: { parentId: string | null; title: string }) =>
      ok(summary('new', i.title, { kind: 'folder', format: null, parentId: i.parentId })),
    ),
    onUniworkTreeChanged: vi.fn((cb: (e: UniworkTreeChangedEvent) => void) => {
      treeChanged = cb
      return () => {
        treeChanged = null
      }
    }),
  }
  // every other subscription the chrome host makes is a no-op here
  window.aiOffice = new Proxy(fns as unknown as HomeApi, {
    get(target, prop) {
      if (prop in target) return (target as unknown as Record<string | symbol, unknown>)[prop]
      if (typeof prop === 'string' && prop.startsWith('on')) return () => () => undefined
      return undefined
    },
  })
  window.aiOfficeTabs = {
    list: vi.fn(async () => {
      calls.push('tabs')
      return tabs
    }),
  } as unknown as typeof window.aiOfficeTabs
  return Object.assign(fns, {
    push: (path: string) => open?.({ path }),
    pushTreeChanged: (e: UniworkTreeChangedEvent) => treeChanged?.(e),
    pushAccountStatus: (st: AccountStatus) => accountStatus?.(st),
  })
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve()
  })
}

async function render(lang: 'vi' | 'en' = 'vi') {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: lang },
        createElement(UniworkLiveHost),
        createElement(SaveDialogHost),
      ),
    )
  })
  await flush()
}

async function push(path = TAB_PATH) {
  await act(async () => {
    api.push(path)
  })
  await flush()
}

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)
const $$ = <T extends Element = HTMLElement>(sel: string) =>
  Array.from(document.querySelectorAll<T>(sel))
const treeItem = (title: string) =>
  $$('[role="treeitem"]').find((el) => el.querySelector('.uwf-tree-title')?.textContent === title)!
const buttonByText = (text: string) =>
  $$<HTMLButtonElement>('button').find((b) => b.textContent?.trim() === text)

async function click(el: Element | null | undefined) {
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

async function key(el: Element, k: string) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  })
  await flush()
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

const firstSaveCalls = () => calls.filter((c) => c.startsWith('first-save'))
const alertText = () => $('.uws-dialog [role="alert"]')?.textContent ?? ''

beforeEach(() => {
  tree = [
    node('a', 'Sai đẹp chiêu', [node('a1', 'Đẹp trai số 2')]),
    node('mf', 'My Folder', [], { systemKind: 'my_folder' }),
    node('h', 'Hợp đồng'),
  ]
  tabs = [
    { id: 'home', kind: 'home', title: 'Home', closable: false, active: false },
    { id: 't1', kind: 'docs', title: 'x', closable: true, active: true, filePath: TAB_PATH },
  ]
  calls = []
  ackSawDialog = []
  firstSaveAnswer = async () => ok(summary('d1', 'Biên bản họp tuần 43.docx'))
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
  resetFirstSavesForTests()
  setCurrentWorkbenchBucket('')
})

describe('SaveDialog host: the first-save-open push (S01-R1-6)', () => {
  it('acks every push before the dialog renders, then opens State 1 for an open tab', async () => {
    await render()
    expect(api.onUniworkFirstSaveOpen).toHaveBeenCalledTimes(1)
    await push()
    expect(api.uniworkFirstSaveOpenAck).toHaveBeenCalledWith(TAB_PATH)
    expect(calls[0]).toBe(`ack:${TAB_PATH}`)
    expect(ackSawDialog).toEqual([false])
    expect($('.uws-dialog')).not.toBeNull()
    // a second push (File > Save again) is acked too
    await push()
    expect(api.uniworkFirstSaveOpenAck).toHaveBeenCalledTimes(2)
    expect($$('.uws-dialog')).toHaveLength(1)
  })

  it('acks even when the tab list read fails (the ack precedes every await)', async () => {
    ;(window.aiOfficeTabs.list as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('gone'))
    await render()
    await push()
    expect(api.uniworkFirstSaveOpenAck).toHaveBeenCalledWith(TAB_PATH)
    expect($('.uws-dialog')).toBeNull()
  })

  it('drops a push for a path that is not an open tab (no dialog, no ensure)', async () => {
    await render()
    await push('C:\\elsewhere\\Other.docx')
    expect(api.uniworkFirstSaveOpenAck).toHaveBeenCalledWith('C:\\elsewhere\\Other.docx')
    expect($('.uws-dialog')).toBeNull()
    expect(api.uniworkEnsureMyFolder).not.toHaveBeenCalled()
  })

  it('UniworkNotice (the tab strip chrome) hosts the SaveDialog', async () => {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'vi' },
          createElement(UniworkNotice, { openDocumentIds: new Set<string>() }),
        ),
      )
    })
    await flush()
    expect(api.onUniworkFirstSaveOpen).toHaveBeenCalledTimes(1)
    await push()
    expect($('.uws-dialog')).not.toBeNull()
  })
})

describe('SaveDialog State 1 "Đặt tên tài liệu"', () => {
  it('renders the board: hint, Tên with the fixed .docx suffix, the My Folder row, one Lưu, no "Giữ tên cũ"', async () => {
    await render()
    await push()
    const dialog = $('.uws-dialog')!
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.querySelector('h3')?.textContent).toBe(vi_.usDialogTitle)
    expect(dialog.textContent).toContain(vi_.usHint)
    const input = $<HTMLInputElement>('.uws-name-input')!
    expect($(`label[for="${input.id}"]`)?.textContent).toBe(vi_.usName)
    expect(input.value).toBe('Biên bản họp tuần 43')
    expect($('.uws-ext')?.textContent).toBe('.docx')
    expect($('.uws-loc-value')?.textContent).toBe('Đang lưu trong: Thư mục của tôi')
    expect($('.uws-loc-sub')?.textContent).toBe(vi_.usMyFolderPrivate)
    expect($('.uws-loc')?.textContent).toContain(vi_.usChange)
    expect($('.uws-loc')?.getAttribute('aria-haspopup')).toBe('dialog')
    const footerButtons = $$('.uws-dialog .modal-buttons button')
    expect(footerButtons.map((b) => b.textContent)).toEqual([vi_.usSave])
    expect(dialog.textContent).not.toContain('Giữ tên cũ')
    expect($('.uws-close')?.getAttribute('aria-label')).toBe(vi_.usClose)
  })

  it('maps legacy .doc / .xls / .ppt tab paths to .docx / .xlsx / .pptx in nameParts and the dialog badge', async () => {
    const xlsTab = 'C:\\Users\\linh\\Documents\\Ngân sách 2026.xls'
    tabs = [
      { id: 'home', kind: 'home', title: 'Home', closable: false, active: false },
      { id: 't1', kind: 'sheets', title: 'x', closable: true, active: true, filePath: xlsTab },
    ]
    await render()
    await push(xlsTab)
    expect($<HTMLInputElement>('.uws-name-input')?.value).toBe('Ngân sách 2026')
    expect($('.uws-ext')?.textContent).toBe('.xlsx')
    await click($('.uws-save'))
    expect(api.uniworkFirstSave).toHaveBeenCalledWith({
      tabPath: xlsTab,
      title: 'Ngân sách 2026.xlsx',
      workspaceId: 'w1',
      target: { kind: 'my_folder' },
    })
  })

  it('ensures My Folder for the workspace when the dialog opens (Q3)', async () => {
    await render()
    await push()
    expect(api.uniworkEnsureMyFolder).toHaveBeenCalledWith('w1')
    expect(api.uniworkEnsureMyFolder).toHaveBeenCalledTimes(1)
  })

  it('Esc closes with zero first-save requests', async () => {
    await render()
    await push()
    await key($('.uws-name-input')!, 'Escape')
    expect($('.uws-dialog')).toBeNull()
    expect(firstSaveCalls()).toEqual([])
    expect(api.uniworkFirstSave).not.toHaveBeenCalled()
  })

  it('the close button cancels with zero first-save requests', async () => {
    await render()
    await push()
    await click($('.uws-close'))
    expect($('.uws-dialog')).toBeNull()
    expect(api.uniworkFirstSave).not.toHaveBeenCalled()
  })

  it('Lưu sends {kind:"my_folder"} by default with the title and its extension; ok closes', async () => {
    await render()
    await push()
    await type($<HTMLInputElement>('.uws-name-input')!, '  Họp tuần 44 ')
    await click($('.uws-save'))
    expect(api.uniworkFirstSave).toHaveBeenCalledTimes(1)
    expect(api.uniworkFirstSave).toHaveBeenCalledWith({
      tabPath: TAB_PATH,
      title: 'Họp tuần 44.docx',
      workspaceId: 'w1',
      target: { kind: 'my_folder' },
    })
    expect($('.uws-dialog')).toBeNull()
  })

  it('an empty name stays at the field and sends nothing', async () => {
    await render()
    await push()
    await type($<HTMLInputElement>('.uws-name-input')!, '   ')
    await click($('.uws-save'))
    expect(api.uniworkFirstSave).not.toHaveBeenCalled()
    expect(alertText()).toBe(uniworkDocumentStrings.vi.uwDocNameEmpty)
  })

  it('busy disables Lưu: a second press while the save runs sends nothing more', async () => {
    let resolve!: (r: UniworkDocActionResult<UniworkDocSummary>) => void
    firstSaveAnswer = () => new Promise((r) => (resolve = r))
    await render()
    await push()
    await click($('.uws-save'))
    const save = $<HTMLButtonElement>('.uws-save')!
    expect(save.getAttribute('aria-disabled')).toBe('true')
    expect(save.getAttribute('aria-busy')).toBe('true')
    expect($<HTMLButtonElement>('.uws-loc')!.getAttribute('aria-disabled')).toBe('true')
    await click(save)
    expect(api.uniworkFirstSave).toHaveBeenCalledTimes(1)
    await act(async () => resolve(ok(summary('d1', 'x.docx'))))
    await flush()
    expect($('.uws-dialog')).toBeNull()
  })
})

describe('SaveDialog refusals (role=alert field pattern)', () => {
  const codes: [string, string][] = [
    ['invalid_destination', en.usErrInvalidDestination],
    ['my_folder_locked', en.usErrMyFolderLocked],
    ['first_save_flush_failed', en.usErrFlushFailed],
    ['not_found', en.usErrNotFound],
    ['conflict', en.usErrAlreadyBound],
    ['idempotency_mismatch', docEn.uwErrIdempotencyMismatch],
    ['network', docEn.uwErrNetwork],
    ['too_large', docEn.uwErrTooLarge],
    ['name_too_long', docEn.uwDocNameTooLong],
  ]

  it.each(codes)('%s renders its own message and keeps the dialog open', async (code, text) => {
    firstSaveAnswer = async () =>
      ({ ok: false, error: code }) as UniworkDocActionResult<UniworkDocSummary>
    await render('en')
    await push()
    await click($('.uws-save'))
    expect(alertText()).toBe(text)
    expect($('.uws-dialog')).not.toBeNull()
    // retryable: Save is pressable again
    expect($('.uws-save')?.getAttribute('aria-disabled')).toBeNull()
  })

  it('a rejected IPC reads as network and does not stick busy', async () => {
    firstSaveAnswer = () => Promise.reject(new Error('ipc gone'))
    await render('en')
    await push()
    await click($('.uws-save'))
    expect(alertText()).toBe(docEn.uwErrNetwork)
    expect($('.uws-save')?.getAttribute('aria-disabled')).toBeNull()
  })

  it('too_large with name and sizes reuses the SIZE-F1 upload refusal copy', async () => {
    firstSaveAnswer = async () => ({
      ok: false,
      error: 'too_large',
      name: 'Biên bản họp tuần 43.docx',
      sizeBytes: 60 * 1024 * 1024,
      maxBytes: 50 * 1024 * 1024,
    })
    await render('en')
    await push()
    await click($('.uws-save'))
    expect(alertText()).toContain('Biên bản họp tuần 43.docx')
    expect(alertText()).toContain('50 MB')
    expect(alertText().startsWith(docEn.uwErrUploadTooLarge.split('{name}')[0]!)).toBe(true)
  })

  it.each([
    ['first_save_bind_failed', 'usErrBindFailed'],
    ['first_save_orphaned', 'usErrOrphaned'],
  ] as const)('%s names the created document (id + title)', async (code, k) => {
    firstSaveAnswer = async () => ({
      ok: false,
      error: code,
      documentId: '01J8X4DOC0N1P2Q3R4S5T6U7',
      documentTitle: 'Họp tuần 44.docx',
    })
    await render('en')
    await push()
    await click($('.uws-save'))
    expect(alertText()).toBe(
      en[k].replace('{title}', 'Họp tuần 44.docx').replace('{id}', '01J8X4DOC0N1P2Q3R4S5T6U7'),
    )
    expect(alertText()).toContain('01J8X4DOC0N1P2Q3R4S5T6U7')
    expect(alertText()).toContain('Họp tuần 44.docx')
  })
})

describe('SaveDialog State 2 "Chọn nơi lưu" (AC-3)', () => {
  async function openPicker() {
    await render()
    await push()
    await click($('.uws-loc'))
  }

  it('renders the board: back, Thư mục mới, Tìm thư mục, tags, check on the current target, confirm (no shared-folder note)', async () => {
    await openPicker()
    expect($('.uws-dialog')).toBeNull()
    const picker = $('.uws-pick')!
    expect(picker.getAttribute('role')).toBe('dialog')
    expect(picker.querySelector('h3')?.textContent).toBe(vi_.usPickTitle)
    expect($('.uwf-picker-back')?.getAttribute('aria-label')).toBe(vi_.usBack)
    expect(buttonByText(ufVi.ufNewFolder)).toBeDefined()
    expect($<HTMLInputElement>('.uwf-picker-search')?.placeholder).toBe(vi_.usSearchFolders)
    // My Folder first, under its label, tagged private and checked (the current target)
    const titles = $$('[role="treeitem"] .uwf-tree-title').map((el) => el.textContent)
    expect(titles.slice(0, 2)).toEqual([ufVi.ufRoot, vi_.usMyFolder])
    const mine = treeItem(vi_.usMyFolder)
    expect(mine.querySelector('.uwf-tree-tag')?.textContent).toBe(vi_.usPrivateTag)
    expect(mine.querySelector('.uwf-tree-check')?.getAttribute('aria-label')).toBe(vi_.usSelected)
    expect(mine.getAttribute('aria-selected')).toBe('true')
    // no visibility is known for other rows: no tag, never a guess
    expect(treeItem('Hợp đồng').querySelector('.uwf-tree-tag')).toBeNull()
    expect($$('.uwf-tree-check')).toHaveLength(1)
    // UNI-1975: folders are not shared, so the picker carries no shared-folder note
    expect($('.uwf-picker-note')).toBeNull()
    expect(picker.textContent).not.toContain('thư mục chung')
    expect($('.uwf-picker-confirm')?.textContent).toBe('Chọn “Thư mục của tôi”')
    // no Cancel in State 2 (back / Esc go back)
    expect(buttonByText(uniworkFolderStrings.vi.ufChoose)).toBeUndefined()
  })

  it('picking another folder sends {kind:"folder", folderId}; the row reads its name', async () => {
    await openPicker()
    await click(treeItem('Hợp đồng'))
    expect(treeItem('Hợp đồng').querySelector('.uwf-tree-check')).not.toBeNull()
    expect($('.uwf-picker-confirm')?.textContent).toBe('Chọn “Hợp đồng”')
    await click($('.uwf-picker-confirm'))
    expect($('.uws-dialog')).not.toBeNull()
    expect($('.uws-loc-value')?.textContent).toBe('Đang lưu trong: Hợp đồng')
    await click($('.uws-save'))
    expect(api.uniworkFirstSave).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: 'folder', folderId: 'h' } }),
    )
  })

  it('choosing My Folder again sends {kind:"my_folder"} (never its id as a folder)', async () => {
    await openPicker()
    await click(treeItem('Hợp đồng'))
    await click($('.uwf-picker-confirm'))
    await click($('.uws-loc'))
    await click(treeItem(vi_.usMyFolder))
    await click($('.uwf-picker-confirm'))
    await click($('.uws-save'))
    expect(api.uniworkFirstSave).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: 'my_folder' } }),
    )
  })

  it('the workspace root cannot be chosen (no empty folder id is ever sent)', async () => {
    await openPicker()
    const rootRow = treeItem(ufVi.ufRoot)
    expect(rootRow.getAttribute('aria-disabled')).toBe('true')
    expect(rootRow.querySelector('.uwf-reason')?.textContent).toBe(vi_.usRootBlocked)
    await click(rootRow)
    expect(treeItem(vi_.usMyFolder).getAttribute('aria-selected')).toBe('true')
  })

  it('back and Esc return to State 1 with the typed name kept and zero requests', async () => {
    await render()
    await push()
    await type($<HTMLInputElement>('.uws-name-input')!, 'Kept name')
    await click($('.uws-loc'))
    await click($('.uwf-picker-back'))
    expect($<HTMLInputElement>('.uws-name-input')?.value).toBe('Kept name')
    await click($('.uws-loc'))
    await key(treeItem('Hợp đồng'), 'Escape')
    expect($('.uws-pick')).toBeNull()
    expect($('.uws-dialog')).not.toBeNull()
    // the State 1 target is unchanged by a cancelled pick
    expect($('.uws-loc-value')?.textContent).toBe('Đang lưu trong: Thư mục của tôi')
    expect(api.uniworkFirstSave).not.toHaveBeenCalled()
  })

  it('Tìm thư mục filters the tree to matches and their ancestors', async () => {
    await openPicker()
    await type($<HTMLInputElement>('.uwf-picker-search')!, 'dep trai')
    const titles = $$('[role="treeitem"] .uwf-tree-title').map((el) => el.textContent)
    expect(titles).toEqual([ufVi.ufRoot, 'Sai đẹp chiêu', 'Đẹp trai số 2'])
  })

  it('Thư mục mới creates a folder through the FD-11 create-folder in the chosen folder (Q7)', async () => {
    await openPicker()
    await click(treeItem('Hợp đồng'))
    await click(buttonByText(ufVi.ufNewFolder))
    const nameInput = $$<HTMLInputElement>('.uw-act-input').at(-1)!
    await type(nameInput, 'Phụ lục')
    tree = [...tree.slice(0, 2), node('h', 'Hợp đồng', [node('new', 'Phụ lục')])]
    await act(async () => {
      nameInput.form!.requestSubmit()
    })
    await flush()
    expect(api.uniworkCreateFolder).toHaveBeenCalledWith({
      workspaceId: 'w1',
      parentId: 'h',
      title: 'Phụ lục',
    })
    // the tree is read again and the new folder is listed under its parent
    expect(treeItem('Phụ lục')).toBeDefined()
    expect($('.uws-pick')).not.toBeNull()
  })
})

describe('SaveDialog while a first save runs (FE-S01-R1-1, -2, -6)', () => {
  const OTHER_PATH = 'C:\\Users\\me\\Documents\\Hợp đồng thuê.docx'
  const DOC_ID = '01J8X4DOC0N1P2Q3R4S5T6U7'
  const named = (code: 'first_save_bind_failed' | 'first_save_orphaned') =>
    ({
      ok: false,
      error: code,
      documentId: DOC_ID,
      documentTitle: 'Họp tuần 44.docx',
    }) as UniworkDocActionResult<UniworkDocSummary>
  const namedText = (k: 'usErrBindFailed' | 'usErrOrphaned') =>
    en[k].replace('{title}', 'Họp tuần 44.docx').replace('{id}', DOC_ID)
  const nameValue = () => $<HTMLInputElement>('.uws-name-input')?.value

  let resolveSave: (r: UniworkDocActionResult<UniworkDocSummary>) => void
  beforeEach(() => {
    firstSaveAnswer = () => new Promise((r) => (resolveSave = r))
    tabs = [
      ...tabs,
      { id: 't2', kind: 'docs', title: 'y', closable: true, active: false, filePath: OTHER_PATH },
    ]
  })

  async function settle(result: UniworkDocActionResult<UniworkDocSummary>) {
    await act(async () => resolveSave(result))
    await flush()
  }

  /** the chrome re-renders without the host: the dialog goes with it */
  async function dropHost() {
    await act(async () => {
      root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(UniworkLiveHost)))
    })
    await flush()
  }

  it.each([
    ['first_save_bind_failed', 'usErrBindFailed'],
    ['first_save_orphaned', 'usErrOrphaned'],
  ] as const)(
    'busy: Esc, the close button and the backdrop keep the dialog; %s is still shown with id + title',
    async (code, k) => {
      await render('en')
      await push()
      await click($('.uws-save'))
      await key($('.uws-name-input')!, 'Escape')
      await click($('.uws-close'))
      await click($('.uw-act-overlay'))
      expect($('.uws-dialog')).not.toBeNull()
      expect($('.uws-close')?.getAttribute('aria-disabled')).toBe('true')
      await settle(named(code))
      expect(alertText()).toBe(namedText(k))
      // settled: close works again and nothing more is sent
      await click($('.uws-close'))
      expect($('.uws-dialog')).toBeNull()
      expect(api.uniworkFirstSave).toHaveBeenCalledTimes(1)
    },
  )

  it('a push for another open tab while busy is held, then opens after the save settles ok', async () => {
    await render('en')
    await push()
    await click($('.uws-save'))
    await push(OTHER_PATH)
    expect(api.uniworkFirstSaveOpenAck).toHaveBeenCalledWith(OTHER_PATH)
    expect($$('.uws-dialog')).toHaveLength(1)
    expect(nameValue()).toBe('Biên bản họp tuần 43')
    expect($('.uws-save')?.getAttribute('aria-busy')).toBe('true')
    await settle(ok(summary('d1', 'Biên bản họp tuần 43.docx')))
    expect($$('.uws-dialog')).toHaveLength(1)
    expect(nameValue()).toBe('Hợp đồng thuê')
    expect($('.uws-save')?.getAttribute('aria-busy')).toBeNull()
  })

  it('a held push waits behind a refused save: the first result is shown, the held tab opens on close', async () => {
    await render('en')
    await push()
    await click($('.uws-save'))
    await push(OTHER_PATH)
    await settle(named('first_save_orphaned'))
    expect(nameValue()).toBe('Biên bản họp tuần 43')
    expect(alertText()).toBe(namedText('usErrOrphaned'))
    // a further push for the other tab still waits behind the shown result
    await push(OTHER_PATH)
    expect(alertText()).toBe(namedText('usErrOrphaned'))
    await click($('.uws-close'))
    expect(nameValue()).toBe('Hợp đồng thuê')
    await click($('.uws-close'))
    expect($('.uws-dialog')).toBeNull()
  })

  it.each([
    ['first_save_bind_failed', 'usErrBindFailed'],
    ['first_save_orphaned', 'usErrOrphaned'],
  ] as const)(
    'the host unmounting mid-save keeps %s and shows it (id + title) when the host renders again',
    async (code, k) => {
      await render('en')
      await push()
      await click($('.uws-save'))
      await dropHost()
      expect($('.uws-dialog')).toBeNull()
      await settle(named(code))
      // said at once through the shell's live region
      expect($('#uw-live-host [role="alert"]')?.textContent).toBe(namedText(k))
      await render('en')
      expect($('.uws-dialog')).not.toBeNull()
      expect(alertText()).toBe(namedText(k))
      expect(alertText()).toContain(DOC_ID)
      expect(alertText()).toContain('Họp tuần 44.docx')
      // shown once: closing it does not bring it back
      await click($('.uws-close'))
      await dropHost()
      await render('en')
      expect($('.uws-dialog')).toBeNull()
      expect(api.uniworkFirstSave).toHaveBeenCalledTimes(1)
    },
  )

  it('a dialog reopened while its tab’s save still runs stays busy and shows that result', async () => {
    await render('en')
    await push()
    await click($('.uws-save'))
    await dropHost()
    await render('en')
    await push()
    expect($('.uws-save')?.getAttribute('aria-busy')).toBe('true')
    await click($('.uws-save'))
    expect(api.uniworkFirstSave).toHaveBeenCalledTimes(1)
    await settle(named('first_save_bind_failed'))
    expect(alertText()).toBe(namedText('usErrBindFailed'))
  })

  it('Save before the workspace resolves shows the busy state and saves once it resolves', async () => {
    let resolveList!: (r: Awaited<ReturnType<HomeApi['uniworkListWorkspaces']>>) => void
    api.uniworkListWorkspaces.mockImplementationOnce(() => new Promise((r) => (resolveList = r)))
    await render('en')
    await push()
    await click($('.uws-save'))
    expect(api.uniworkFirstSave).not.toHaveBeenCalled()
    expect($('.uws-save')?.getAttribute('aria-busy')).toBe('true')
    expect($('.uws-save .uw-spinner')).not.toBeNull()
    await act(async () =>
      resolveList(
        ok([
          { id: 'w1', name: 'Team', orgId: 'o1', slug: 'team', orgSlug: 'org', myRole: 'member' },
        ]),
      ),
    )
    await flush()
    expect(api.uniworkFirstSave).toHaveBeenCalledTimes(1)
    expect(api.uniworkFirstSave).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'w1', target: { kind: 'my_folder' } }),
    )
  })

  it('after the workspace read fails (network), Save re-runs the resolve and then saves', async () => {
    api.uniworkListWorkspaces.mockRejectedValueOnce(new Error('offline'))
    await render('en')
    await push()
    expect(api.uniworkListWorkspaces).toHaveBeenCalledTimes(1)
    await click($('.uws-save'))
    expect(api.uniworkListWorkspaces).toHaveBeenCalledTimes(2)
    expect(api.uniworkEnsureMyFolder).toHaveBeenCalledWith('w1')
    expect(api.uniworkFirstSave).toHaveBeenCalledTimes(1)
  })

  it('a resolve that fails again shows the network error, and the next Save retries it', async () => {
    api.uniworkListWorkspaces
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
    await render('en')
    await push()
    await click($('.uws-save'))
    expect(api.uniworkListWorkspaces).toHaveBeenCalledTimes(2)
    expect(alertText()).toBe(docEn.uwErrNetwork)
    expect($('.uws-save')?.getAttribute('aria-busy')).toBeNull()
    await click($('.uws-save'))
    expect(api.uniworkListWorkspaces).toHaveBeenCalledTimes(3)
    expect(api.uniworkFirstSave).toHaveBeenCalledTimes(1)
  })

  it('busy shows a spinner on Lưu and the name cannot be edited', async () => {
    await render()
    await push()
    await click($('.uws-save'))
    const save = $<HTMLButtonElement>('.uws-save')!
    expect(save.querySelector('.uw-spinner')).not.toBeNull()
    expect(save.textContent).toBe(vi_.usSave)
    expect($<HTMLInputElement>('.uws-name-input')!.readOnly).toBe(true)
    await settle(ok(summary('d1', 'x.docx')))
    expect($('.uws-dialog')).toBeNull()
  })

  it('a same-path re-push keeps the typed name (R1-8 a)', async () => {
    await render()
    await push()
    await type($<HTMLInputElement>('.uws-name-input')!, 'Đang gõ dở')
    await push()
    expect($$('.uws-dialog')).toHaveLength(1)
    expect(nameValue()).toBe('Đang gõ dở')
  })

  const liveAlert = () => $('#uw-live-host [role="alert"]')?.textContent ?? ''

  /** a result kept while the host was away (said once through the live region) */
  async function keepWhileAway(code: 'first_save_bind_failed' | 'first_save_orphaned') {
    await render('en')
    await push()
    await click($('.uws-save'))
    await dropHost()
    await settle(named(code))
  }

  it('a run that settles between the reopened dialog’s render and its mount effect does not stick busy (FE-S01-R2-2)', async () => {
    await render('en')
    await push()
    await click($('.uws-save'))
    await dropHost()
    await render('en')
    // settles right after the commit that mounts the reopened dialog (a DOM
    // mutation microtask), before the task that runs its passive effects
    let armed = true
    const observer = new MutationObserver(() => {
      if (armed && document.querySelector('.uws-dialog')) {
        armed = false
        resolveSave(named('first_save_bind_failed'))
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    // outside act, React runs the passive effects in a later task than the commit
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false
    try {
      api.push(TAB_PATH)
      await new Promise((r) => setTimeout(r, 50))
    } finally {
      observer.disconnect()
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    }
    await flush()
    expect(armed).toBe(false)
    expect($$('.uws-dialog')).toHaveLength(1)
    expect($('.uws-save')?.getAttribute('aria-busy')).toBeNull()
    expect($('.uws-close')?.getAttribute('aria-disabled')).toBeNull()
    expect(alertText()).toBe(namedText('usErrBindFailed'))
    await click($('.uws-close'))
    expect($('.uws-dialog')).toBeNull()
  })

  it('a kept result is never shown after the account changes (FE-S01-R2-3)', async () => {
    setCurrentWorkbenchBucket('acct-a')
    await keepWhileAway('first_save_bind_failed')
    setCurrentWorkbenchBucket('acct-b')
    await render('en')
    expect($('.uws-dialog')).toBeNull()
    await push()
    expect($('.uws-dialog')).not.toBeNull()
    expect(alertText()).toBe('')
    expect($('.uws-dialog')?.textContent).not.toContain(DOC_ID)
    expect($('.uws-dialog')?.textContent).not.toContain('Họp tuần 44')
  })

  it('a kept result is never shown in another workspace (FE-S01-R2-3)', async () => {
    await keepWhileAway('first_save_orphaned')
    writeActiveWorkspaceId('w2')
    await render('en')
    expect($('.uws-dialog')).toBeNull()
    await push()
    expect($('.uws-dialog')).not.toBeNull()
    expect(alertText()).toBe('')
    expect($('.uws-dialog')?.textContent).not.toContain(DOC_ID)
  })

  it('signing out clears a kept result before it is shown (FE-S01-R2-3)', async () => {
    await render('en')
    await push()
    await click($('.uws-save'))
    await dropHost()
    await render('en')
    // another tab's dialog is on screen, so the result is kept when it settles
    await push(OTHER_PATH)
    await settle(named('first_save_bind_failed'))
    expect(nameValue()).toBe('Hợp đồng thuê')
    await act(async () => {
      api.pushAccountStatus({ loggedIn: false, state: 'signed-out' })
    })
    await flush()
    await click($('.uws-close'))
    expect($('.uws-dialog')).toBeNull()
  })

  it('a held push whose tab closed before it is dequeued is dropped (FE-S01-R2-4)', async () => {
    await render('en')
    await push()
    await click($('.uws-save'))
    await push(OTHER_PATH)
    tabs = tabs.filter((tab) => tab.filePath !== OTHER_PATH)
    await settle(ok(summary('d1', 'Biên bản họp tuần 43.docx')))
    expect($('.uws-dialog')).toBeNull()
  })

  it('a kept result for a closed tab is dropped without a dialog, after its one live announce (FE-S01-R2-4)', async () => {
    await keepWhileAway('first_save_bind_failed')
    expect(liveAlert()).toBe(namedText('usErrBindFailed'))
    tabs = tabs.filter((tab) => tab.filePath !== TAB_PATH)
    await render('en')
    expect($('.uws-dialog')).toBeNull()
    // dropped, not deferred: the tab reopening later does not bring it back
    tabs = [
      ...tabs,
      { id: 't1', kind: 'docs', title: 'x', closable: true, active: true, filePath: TAB_PATH },
    ]
    await push()
    expect($('.uws-dialog')).not.toBeNull()
    expect(alertText()).toBe('')
  })

  it('while saving, "Đổi" is disabled and does not open the picker (FE-S01-R2-6)', async () => {
    await render()
    await push()
    await click($('.uws-save'))
    const loc = $('.uws-loc')!
    expect(loc.getAttribute('aria-disabled')).toBe('true')
    expect($('.uws-close')?.getAttribute('aria-disabled')).toBe('true')
    await click(loc)
    expect($('.uws-pick')).toBeNull()
    expect($('.uws-dialog')).not.toBeNull()
  })

  it('a non-naming refusal settling after the host unmounts is not kept, shown or announced (FE-S01-R2-8 a)', async () => {
    await render('en')
    await push()
    await click($('.uws-save'))
    await dropHost()
    await settle({ ok: false, error: 'network' })
    expect(liveAlert()).toBe('')
    await render('en')
    expect($('.uws-dialog')).toBeNull()
  })

  it('a naming refusal while a dialog watches its tab is not sent to the live region (FE-S01-R2-8 b)', async () => {
    await render('en')
    await push()
    await click($('.uws-save'))
    await settle(named('first_save_orphaned'))
    expect(alertText()).toBe(namedText('usErrOrphaned'))
    expect(liveAlert()).toBe('')
  })
})
