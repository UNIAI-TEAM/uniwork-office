/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, UniworkDocListPage, UniworkDocSummary } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UniworkOpenDialog } from '../src/renderer/src/UniworkOpenDialog'
import { UniworkNotice } from '../src/renderer/src/UniworkChrome'
import {
  checkDocName,
  hasRowActions,
  initialPickerState,
  isOpenable,
  pickerReducer,
  renameParts,
  rowActionsOf,
  type LibraryDocRow,
  type PickerState,
} from '../src/renderer/src/uniwork-docs-model'
import type {
  CreateDocInput,
  DocActionResult,
  DocRenamedEvent,
  UploadDocInput,
  UploadProgressEvent,
} from '../src/renderer/src/uniwork-library-api'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { uniworkFolderStrings } from '../src/renderer/src/i18n/strings-uniwork-folders'
import { uniworkSaveStrings } from '../src/renderer/src/i18n/strings-uniwork-save'

/**
 * S18: New document, Upload, Rename, Archive / Restore from the UniWork
 * library. The bridge is a typed fake of the G8-17 library IPC; no main runs.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const en = uniworkDocumentStrings.en
const folderEn = uniworkFolderStrings.en
// SAVE-01 Q1: no folder chosen = My Folder (main sends destination my_folder)
const myFolderEn = uniworkSaveStrings.en.usMyFolder

const WORKSPACES = [
  { id: 'w1', name: 'Sales', orgId: 'o1', myRole: 'admin' },
  { id: 'w2', name: 'Ops', orgId: 'o1', myRole: 'member' },
]

function row(id: string, title: string, extra: Partial<LibraryDocRow> = {}): LibraryDocRow {
  return {
    id,
    workspaceId: 'w1',
    title,
    format: 'docx',
    updatedAt: '2026-05-01T10:00:00Z',
    ...extra,
  }
}

const ok = <T>(value: T) => ({ ok: true as const, value })
const fail = (error: string) => ({ ok: false as const, error }) as DocActionResult<never>

type Fake = ReturnType<typeof makeApi>
let host: HTMLDivElement
let root: Root
let api: Fake
let onClose: ReturnType<typeof vi.fn>

function makeApi(docs: LibraryDocRow[]) {
  let progress: ((e: UploadProgressEvent) => void) | null = null
  let renamed: ((e: DocRenamedEvent) => void) | null = null
  const fns = {
    uniworkListWorkspaces: vi.fn(async () => ok(WORKSPACES)),
    uniworkListDocuments: vi.fn(async () =>
      ok<UniworkDocListPage>({ documents: docs, nextCursor: null }),
    ),
    uniworkListSharedWithMe: vi.fn(async () => ok({ documents: [], nextCursor: null })),
    uniworkDocumentProperties: vi.fn(async () => fail('server_error')),
    uniworkOpenDocument: vi.fn(async (_id: string) => ok({ path: '/cache/New.docx' })),
    uniworkCreateDocument: vi.fn(
      async (input: CreateDocInput): Promise<DocActionResult<UniworkDocSummary>> =>
        ok(row('new1', `${input.name}.${input.format}`, { format: input.format })),
    ),
    uniworkPickUploadFile: vi.fn(async () => ({ path: '/home/me/Q3.xlsx', name: 'Q3.xlsx' })),
    uniworkUploadDocument: vi.fn(
      async (_input: UploadDocInput): Promise<DocActionResult<UniworkDocSummary>> =>
        ok(row('up1', 'Q3.xlsx', { format: 'xlsx' })),
    ),
    uniworkCancelUploadDocument: vi.fn(async (_uploadId: string) => undefined),
    onUniworkUploadProgress: vi.fn((cb: (e: UploadProgressEvent) => void) => {
      progress = cb
      return () => {
        progress = null
      }
    }),
    uniworkRenameDocument: vi.fn(
      async (id: string, name: string): Promise<DocActionResult<UniworkDocSummary>> =>
        ok(row(id, name)),
    ),
    uniworkArchiveDocument: vi.fn(async (_id: string) => ok({})),
    uniworkRestoreDocument: vi.fn(async (_id: string) => ok({})),
    // FD-11: the Location picker reads the workspace's folder tree
    uniworkFolderTree: vi.fn(async (_ws: string) =>
      ok([{ id: 'f1', parentId: null, title: 'Contracts', position: 0, children: [] }]),
    ),
    uniworkListChildren: vi.fn(async () => ok({ items: [], nextCursor: null })),
    onUniworkDocRenamed: vi.fn((cb: (e: DocRenamedEvent) => void) => {
      renamed = cb
      return () => {
        renamed = null
      }
    }),
    onUniworkLaunch: vi.fn(() => () => undefined),
  }
  window.aiOffice = fns as unknown as HomeApi
  return Object.assign(fns, {
    pushProgress: (e: UploadProgressEvent) => progress?.(e),
    pushRenamed: (e: DocRenamedEvent) => renamed?.(e),
  })
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  })
}

async function render(docs: LibraryDocRow[]) {
  api = makeApi(docs)
  onClose = vi.fn()
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(UniworkOpenDialog, {
          onClose,
          accountView: 'signed-in',
          onSignIn: () => undefined,
        }),
      ),
    )
  })
  await flush()
}

const rows = () => Array.from(host.querySelectorAll<HTMLElement>('.uw-pick-row'))
const rowOf = (title: string) => rows().find((r) => r.textContent?.includes(title))!
// the menu sits beside the option in the row item (like Details), never inside the role=option element
const menuButton = (r: HTMLElement) =>
  r.closest('.uw-pick-item')?.querySelector<HTMLButtonElement>('.uw-row-menu-btn') ?? null
const modal = () => host.querySelector<HTMLElement>('.modal.uw-act')
const buttonByText = (scope: ParentNode, text: string) =>
  Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.trim() === text,
  )!

async function click(el: Element) {
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

async function key(el: Element, k: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }))
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

async function openMenuItem(title: string, item: string) {
  await click(menuButton(rowOf(title))!)
  // the popup is portalled to the body, outside the dialog
  await click(buttonByText(document.body, item))
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('S18 model', () => {
  it('gives a view-only row no actions, an edit row rename, a manage row archive', () => {
    // G5-05u: `offline` (the pin/unpin item) is null unless the caller passes the library's state
    expect(rowActionsOf(row('a', 'A', { canEdit: false, canManage: false }))).toEqual({
      rename: false,
      archive: false,
      restore: false,
      offline: null,
    })
    expect(hasRowActions(row('a', 'A'))).toBe(false) // no flags (older main): nothing offered
    expect(rowActionsOf(row('a', 'A', { canEdit: true }))).toEqual({
      rename: true,
      archive: false,
      restore: false,
      offline: null,
    })
    expect(rowActionsOf(row('a', 'A', { canEdit: true, canManage: true, archived: true }))).toEqual(
      { rename: false, archive: false, restore: true, offline: null },
    )
  })

  it('refuses an empty name before any call and keeps the extension on rename', () => {
    expect(checkDocName('   ')).toEqual({ ok: false, error: 'name_empty' })
    expect(checkDocName('  Plan ')).toEqual({ ok: true, name: 'Plan' })
    expect(renameParts('Plan.docx', 'docx')).toEqual({ base: 'Plan', ext: '.docx' })
    expect(renameParts('Plan', 'docx')).toEqual({ base: 'Plan', ext: '' })
    expect(renameParts('Notes.txt', null)).toEqual({ base: 'Notes.txt', ext: '' })
  })

  it('renames and archives a listed row; an archived row does not open', () => {
    let s: PickerState = pickerReducer(initialPickerState(), {
      type: 'workspaces-loaded',
      result: ok(WORKSPACES),
    })
    s = pickerReducer(s, {
      type: 'list-loaded',
      requestId: s.list.requestId,
      append: false,
      result: ok({ documents: [row('a', 'A.docx')], nextCursor: null }),
    })
    s = pickerReducer(s, { type: 'doc-renamed', id: 'a', title: 'B.docx' })
    expect(s.list.docs[0]!.title).toBe('B.docx')
    expect(pickerReducer(s, { type: 'doc-renamed', id: 'zz', title: 'x' })).toBe(s)
    s = pickerReducer(s, { type: 'doc-archived', id: 'a', archived: true })
    expect((s.list.docs[0] as LibraryDocRow).archived).toBe(true)
    expect(isOpenable(s.list.docs[0]!)).toBe(false)
  })
})

describe('S18 new document', () => {
  it('creates a document with name, type and location, then opens it by id', async () => {
    await render([row('d1', 'Plan.docx', { canEdit: true })])
    const opener = buttonByText(host, en.uwDocNew)
    opener.focus()
    await click(opener)
    const dialog = modal()!
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const name = dialog.querySelector<HTMLInputElement>('input[type="text"]')!
    expect(document.activeElement).toBe(name)
    await type(name, 'Q4 plan')
    await click(dialog.querySelector('input[value="pptx"]')!)
    // FD-11 S4: "Location" is a button showing the chosen path; it opens the folder picker
    const location = dialog.querySelector<HTMLButtonElement>('.uwf-location-btn')!
    expect(location.textContent).toContain(myFolderEn)
    expect(dialog.querySelectorAll('select')).toHaveLength(1)
    await click(location)
    const picker = host.querySelector('.uwf-picker')!
    expect(api.uniworkFolderTree).toHaveBeenCalledWith('w1')
    const contracts = Array.from(picker.querySelectorAll<HTMLElement>('[role="treeitem"]')).find(
      (el) => el.textContent?.includes('Contracts'),
    )!
    await click(contracts)
    await click(buttonByText(picker as HTMLElement, folderEn.ufChoose))
    expect(host.querySelector('.uwf-picker')).toBeNull()
    expect(location.textContent).toContain('UniWork › Contracts')
    await click(buttonByText(dialog, en.uwDocCreate))
    expect(api.uniworkCreateDocument).toHaveBeenCalledWith({
      workspaceId: 'w1',
      folderId: 'f1',
      name: 'Q4 plan.pptx',
      format: 'pptx',
    })
    // opened by the server id, through the normal open path; no second local copy is made here
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('new1')
    expect(api.uniworkOpenDocument).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('V1-1: location row renders both controls, button carries path text + title, and flex layout shares/stacks without squeezing', async () => {
    await render([])
    await click(buttonByText(host, en.uwDocNew))
    const dialog = modal()!
    const locRow = dialog.querySelector<HTMLElement>('.uw-act-location-row')!
    expect(locRow).not.toBeNull()
    const select = locRow.querySelector<HTMLSelectElement>('.uw-act-select')!
    const btn = locRow.querySelector<HTMLButtonElement>('.uwf-location-btn')!
    expect(select).not.toBeNull()
    expect(btn).not.toBeNull()
    expect(btn.querySelector('.uwf-location-path')?.textContent).toBe(myFolderEn)
    expect(btn.getAttribute('title')).toBe(myFolderEn)

    await click(btn)
    const picker = host.querySelector('.uwf-picker')!
    const contracts = Array.from(picker.querySelectorAll<HTMLElement>('[role="treeitem"]')).find(
      (el) => el.textContent?.includes('Contracts'),
    )!
    await click(contracts)
    await click(buttonByText(picker as HTMLElement, folderEn.ufChoose))
    expect(btn.querySelector('.uwf-location-path')?.textContent).toBe('UniWork › Contracts')
    expect(btn.getAttribute('title')).toBe('UniWork › Contracts')

    const homeCss = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
    const foldersCss = readFileSync(
      join(__dirname, '../src/renderer/src/uniwork-folders/uniwork-folders.css'),
      'utf8',
    )
    expect(homeCss).toMatch(/\.uw-act-location-row\s*>\s*\.uw-act-select\s*\{[^}]*width:\s*auto/)
    expect(foldersCss).toMatch(/\.uwf-location-btn\s*>\s*svg\s*\{[^}]*flex:\s*0\s+0\s+auto/)
    expect(homeCss).toMatch(
      /@media\s*\(max-width:\s*900px\)\s*\{[\s\S]*?\.uw-act-location-row\s*\{[^}]*flex-direction:\s*column/,
    )
  })

  it('shows an empty name at the field, without calling main', async () => {
    await render([])
    await click(buttonByText(host, en.uwDocNew))
    const dialog = modal()!
    await click(buttonByText(dialog, en.uwDocCreate))
    const name = dialog.querySelector<HTMLInputElement>('input[type="text"]')!
    expect(name.getAttribute('aria-invalid')).toBe('true')
    const error = document.getElementById(name.getAttribute('aria-describedby')!)!
    expect(error.textContent).toBe(en.uwDocNameEmpty)
    expect(api.uniworkCreateDocument).not.toHaveBeenCalled()
  })

  it('sends a duplicate name: no field error, the request goes out', async () => {
    // the library already holds "Plan"; duplicates are allowed, so the dialog does not compare
    await render([row('d1', 'Plan.docx', { canEdit: true })])
    await click(buttonByText(host, en.uwDocNew))
    const dialog = modal()!
    const name = dialog.querySelector<HTMLInputElement>('input[type="text"]')!
    await type(name, 'Plan')
    await click(buttonByText(dialog, en.uwDocCreate))
    expect(api.uniworkCreateDocument).toHaveBeenCalledTimes(1)
    expect(api.uniworkCreateDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Plan.docx' }),
    )
    expect(name.getAttribute('aria-invalid')).not.toBe('true')
  })

  it('shows a too-long name at the field without calling main', async () => {
    await render([])
    await click(buttonByText(host, en.uwDocNew))
    const dialog = modal()!
    const name = dialog.querySelector<HTMLInputElement>('input[type="text"]')!
    await type(name, 'a'.repeat(501))
    await click(buttonByText(dialog, en.uwDocCreate))
    expect(api.uniworkCreateDocument).not.toHaveBeenCalled()
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(name.getAttribute('aria-describedby')!)!.textContent).toBe(
      en.uwDocNameTooLong,
    )
    // the extension counts: 496 runes + ".docx" is over the limit
    await type(name, 'a'.repeat(496))
    await click(buttonByText(dialog, en.uwDocCreate))
    expect(api.uniworkCreateDocument).not.toHaveBeenCalled()
    expect(name.getAttribute('aria-invalid')).toBe('true')
    // 500 runes in all pass, even when they are astral characters of two UTF-16 units each
    await type(name, '😀'.repeat(495))
    expect(name.getAttribute('aria-invalid')).toBe('false')
    await click(buttonByText(dialog, en.uwDocCreate))
    expect(api.uniworkCreateDocument).toHaveBeenCalledTimes(1)
  })

  it('shows a server too-long refusal at the field, and any other failure as a toast', async () => {
    await render([])
    api.uniworkCreateDocument.mockResolvedValueOnce(fail('name_too_long'))
    await click(buttonByText(host, en.uwDocNew))
    const dialog = modal()!
    const name = dialog.querySelector<HTMLInputElement>('input[type="text"]')!
    await type(name, 'Plan')
    await click(buttonByText(dialog, en.uwDocCreate))
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(name.getAttribute('aria-describedby')!)!.textContent).toBe(
      en.uwDocNameTooLong,
    )
    expect(host.querySelector('.uw-act-toast')).toBeNull()

    api.uniworkCreateDocument.mockResolvedValueOnce(fail('server_error'))
    await type(name, 'Plan 2')
    expect(name.getAttribute('aria-invalid')).toBe('false')
    await click(buttonByText(dialog, en.uwDocCreate))
    expect(host.querySelector('.uw-act-toast')!.textContent).toBe(en.uwDocActionFailed)
    expect(host.querySelector('.uw-act-toast')!.getAttribute('role')).toBe('alert')
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
  })

  it('Escape cancels only the modal and focus returns to its opener', async () => {
    await render([])
    const opener = buttonByText(host, en.uwDocNew)
    opener.focus()
    await click(opener)
    await key(modal()!.querySelector('input')!, 'Escape')
    expect(modal()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(opener)
  })

  it('traps Tab inside the modal', async () => {
    await render([])
    await click(buttonByText(host, en.uwDocNew))
    const dialog = modal()!
    const create = buttonByText(dialog, en.uwDocCreate)
    create.focus()
    await key(create, 'Tab')
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(dialog.querySelector('input[type="text"]'))
  })
})

describe('S18 upload', () => {
  it('picks a file, uploads it to the location with progress, then opens it', async () => {
    await render([])
    let finish: (v: DocActionResult<UniworkDocSummary>) => void = () => undefined
    api.uniworkUploadDocument.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    )
    await click(buttonByText(host, en.uwDocUpload))
    const dialog = modal()!
    await click(buttonByText(dialog, en.uwDocUploadPick))
    expect(dialog.textContent).toContain('Q3.xlsx')
    const ws = dialog.querySelectorAll<HTMLSelectElement>('select')[0]!
    await act(async () => {
      ws.value = 'w2'
      ws.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    await click(dialog.querySelector('.btn-primary')!)
    const sent = api.uniworkUploadDocument.mock.calls[0]![0]
    expect(sent).toEqual({
      workspaceId: 'w2',
      folderId: null,
      path: '/home/me/Q3.xlsx',
      uploadId: expect.any(String),
    })
    // another upload's progress is not ours
    await act(async () =>
      api.pushProgress({ uploadId: 'other', path: '/x', loaded: 150, total: 200 }),
    )
    expect(dialog.querySelector('progress')!.hasAttribute('value')).toBe(false)
    await act(async () =>
      api.pushProgress({
        uploadId: sent.uploadId,
        path: '/home/me/Q3.xlsx',
        loaded: 50,
        total: 200,
      }),
    )
    const status = dialog.querySelector('.uw-act-progress')!
    expect(status.getAttribute('role')).toBe('status')
    expect(status.textContent).toContain('Uploading “Q3.xlsx”')
    expect(dialog.querySelector('progress')!.getAttribute('value')).toBe('25')
    await act(async () => finish(ok(row('up1', 'Q3.xlsx', { format: 'xlsx' }))))
    await flush()
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('up1')
  })

  it('shows unsupported_format at the file field with no generic toast, and uploads after picking a supported file', async () => {
    await render([])
    api.uniworkPickUploadFile.mockResolvedValueOnce({
      path: '/home/me/notes.txt',
      name: 'notes.txt',
    })
    api.uniworkUploadDocument.mockResolvedValueOnce(fail('unsupported_format'))

    await click(buttonByText(host, en.uwDocUpload))
    const dialog = modal()!
    const pickBtn = buttonByText(dialog, en.uwDocUploadPick)
    await click(pickBtn)
    expect(dialog.querySelector('.uw-act-file-name')?.textContent).toBe('notes.txt')

    await click(dialog.querySelector('.btn-primary')!)
    const fieldError = dialog.querySelector('.uw-act-error')!
    expect(fieldError.getAttribute('role')).toBe('alert')
    expect(fieldError.textContent).toBe(en.uwErrUnsupportedFormat)
    expect(pickBtn.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(pickBtn)
    expect(host.querySelector('.uw-act-toast')).toBeNull()
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()

    await click(pickBtn)
    expect(dialog.querySelector('.uw-act-file-name')?.textContent).toBe('Q3.xlsx')
    expect(fieldError.textContent).toBe('')
    expect(pickBtn.getAttribute('aria-invalid')).toBeNull()

    await click(dialog.querySelector('.btn-primary')!)
    expect(modal()).toBeNull()
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('up1')
  })
})

describe('S18 row menu', () => {
  it('renders no action control for a view-only row', async () => {
    await render([
      row('v', 'Viewer.docx', { canEdit: false, canManage: false }),
      row('e', 'Editor.docx', { canEdit: true, canManage: true }),
    ])
    const viewer = rowOf('Viewer.docx')
    expect(menuButton(viewer)).toBeNull()
    expect(viewer.querySelector('[aria-disabled="true"] .uw-row-menu-btn')).toBeNull()
    const editor = menuButton(rowOf('Editor.docx'))!
    expect(editor.getAttribute('aria-haspopup')).toBe('menu')
    expect(editor.closest('[role="option"]')).toBeNull()
    expect(editor.getAttribute('aria-label')).toBe('More actions for “Editor.docx”')
    await click(editor)
    const items = Array.from(document.body.querySelectorAll('[role="menuitem"]')).map(
      (i) => i.textContent,
    )
    expect(items).toEqual([en.uwDocRename, en.uwDocArchive])
    // no permanent delete anywhere in the dialog
    expect(host.textContent).not.toMatch(/delete/i)
  })

  it('renames in place: Enter saves, the extension is kept', async () => {
    await render([row('e', 'Plan.docx', { canEdit: true })])
    await openMenuItem('Plan.docx', en.uwDocRename)
    const input = rows()[0]!.querySelector<HTMLInputElement>('.uw-rename-input')!
    expect(input.value).toBe('Plan')
    expect(document.activeElement).toBe(input)
    await type(input, 'Plan v2')
    await key(input, 'Enter')
    expect(api.uniworkRenameDocument).toHaveBeenCalledWith('e', 'Plan v2.docx')
    expect(host.querySelector('.uw-rename-input')).toBeNull()
    expect(rows()[0]!.querySelector('.uw-pick-row-title')!.textContent).toBe('Plan v2.docx')
    // Enter in the field did not open the document
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
  })

  it('Escape cancels the rename without closing the library', async () => {
    await render([row('e', 'Plan.docx', { canEdit: true })])
    await openMenuItem('Plan.docx', en.uwDocRename)
    const input = host.querySelector<HTMLInputElement>('.uw-rename-input')!
    await type(input, 'Other')
    await key(input, 'Escape')
    expect(host.querySelector('.uw-rename-input')).toBeNull()
    expect(api.uniworkRenameDocument).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(menuButton(rowOf('Plan.docx')))
  })

  it('shows empty and too-long names at the field, without calling main', async () => {
    await render([row('e', 'Plan.docx', { canEdit: true })])
    await openMenuItem('Plan.docx', en.uwDocRename)
    const input = host.querySelector<HTMLInputElement>('.uw-rename-input')!
    await type(input, '  ')
    await key(input, 'Enter')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(input.getAttribute('aria-describedby')!)!.textContent).toBe(
      en.uwDocNameEmpty,
    )
    expect(api.uniworkRenameDocument).not.toHaveBeenCalled()

    // the limit counts the extension too: 496 + ".docx" is 501
    await type(input, 'a'.repeat(496))
    await key(input, 'Enter')
    const field = host.querySelector<HTMLInputElement>('.uw-rename-input')!
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(field.getAttribute('aria-describedby')!)!.textContent).toBe(
      en.uwDocNameTooLong,
    )
    expect(api.uniworkRenameDocument).not.toHaveBeenCalled()
  })

  it('renames to a duplicate name: the request goes out, no field error', async () => {
    await render([
      row('e', 'Plan.docx', { canEdit: true }),
      row('f', 'Budget.docx', { canEdit: true }),
    ])
    await openMenuItem('Plan.docx', en.uwDocRename)
    const input = host.querySelector<HTMLInputElement>('.uw-rename-input')!
    await type(input, 'Budget')
    await key(input, 'Enter')
    expect(api.uniworkRenameDocument).toHaveBeenCalledWith('e', 'Budget.docx')
    expect(host.querySelector('.uw-rename-input')).toBeNull()
  })

  it('a server failure toasts and the row name reverts', async () => {
    await render([row('e', 'Plan.docx', { canEdit: true })])
    api.uniworkRenameDocument.mockResolvedValueOnce(fail('server_error'))
    await openMenuItem('Plan.docx', en.uwDocRename)
    const input = host.querySelector<HTMLInputElement>('.uw-rename-input')!
    await type(input, 'Gone')
    await key(input, 'Enter')
    expect(host.querySelector('.uw-rename-input')).toBeNull()
    expect(rows()[0]!.querySelector('.uw-pick-row-title')!.textContent).toBe('Plan.docx')
    expect(host.querySelector('.uw-act-toast')!.textContent).toBe(en.uwDocActionFailed)
  })

  it('archives after a one-step confirmation, then offers Restore', async () => {
    await render([row('m', 'Old.docx', { canEdit: true, canManage: true })])
    await openMenuItem('Old.docx', en.uwDocArchive)
    const dialog = modal()!
    expect(dialog.textContent).toContain('Archive “Old.docx”? You can restore it later.')
    expect(api.uniworkArchiveDocument).not.toHaveBeenCalled()
    await click(dialog.querySelector('.btn-primary')!)
    expect(api.uniworkArchiveDocument).toHaveBeenCalledWith('m')
    expect(modal()).toBeNull()
    const archived = rowOf('Old.docx')
    expect(archived.textContent).toContain(en.uwDocArchived)
    expect(archived.getAttribute('aria-disabled')).toBeNull()
    await click(menuButton(archived)!)
    const items = Array.from(document.body.querySelectorAll('[role="menuitem"]')).map(
      (i) => i.textContent,
    )
    expect(items).toEqual([en.uwDocRestore])
    await click(buttonByText(document.body, en.uwDocRestore))
    expect(api.uniworkRestoreDocument).toHaveBeenCalledWith('m')
    expect(rowOf('Old.docx').textContent).not.toContain(en.uwDocArchived)
  })

  it('a failed archive toasts and the row stays as it was', async () => {
    await render([row('m', 'Old.docx', { canManage: true })])
    api.uniworkArchiveDocument.mockResolvedValueOnce(fail('forbidden'))
    await openMenuItem('Old.docx', en.uwDocArchive)
    await click(modal()!.querySelector('.btn-primary')!)
    expect(rowOf('Old.docx').textContent).not.toContain(en.uwDocArchived)
    expect(host.querySelector('.uw-act-toast')!.textContent).toBe(en.uwDocActionFailed)
  })

  it('Escape in the menu closes it and returns focus to its button', async () => {
    await render([row('e', 'Plan.docx', { canEdit: true, canManage: true })])
    const button = menuButton(rowOf('Plan.docx'))!
    await click(button)
    const first = document.body.querySelector<HTMLElement>('[role="menuitem"]')!
    expect(document.activeElement).toBe(first)
    await key(first, 'ArrowDown')
    expect(document.activeElement?.textContent).toBe(en.uwDocArchive)
    await key(document.activeElement!, 'Escape')
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(button)
    expect(onClose).not.toHaveBeenCalled()
  })

  describe('V17b-01: the popup is never clipped by the list', () => {
    const innerHeight = window.innerHeight
    afterEach(() => {
      vi.restoreAllMocks()
      window.innerHeight = innerHeight
    })

    // jsdom has no layout: pretend the "…" button sits at `top` in a 640px window and the popup is 80x160
    const layout = (top: number) => {
      window.innerHeight = 640
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        const menu = this.classList.contains('uw-row-menu-list')
        const button = this.classList.contains('uw-row-menu-btn')
        const box = menu
          ? { top: 0, left: 0, width: 160, height: 80 }
          : button
            ? { top, left: 560, width: 28, height: 28 }
            : { top: 0, left: 0, width: 0, height: 0 }
        return {
          ...box,
          x: box.left,
          y: box.top,
          right: box.left + box.width,
          bottom: box.top + box.height,
          toJSON: () => ({}),
        } as DOMRect
      })
    }

    it('renders outside the scrolling list and the dialog, in the body', async () => {
      layout(100)
      await render([row('e', 'Plan.docx', { canEdit: true, canManage: true })])
      await click(menuButton(rowOf('Plan.docx'))!)
      const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!
      expect(menu.parentElement).toBe(document.body)
      expect(menu.closest('.uw-pick-body, .uw-pick-list, .modal')).toBeNull()
      expect(readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')).toMatch(
        /\.uw-row-menu-list\s*\{[^}]*position:\s*fixed/,
      )
    })

    it('opens downward when there is room below the button', async () => {
      layout(100)
      await render([row('e', 'Plan.docx', { canEdit: true, canManage: true })])
      await click(menuButton(rowOf('Plan.docx'))!)
      const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!
      expect(menu.dataset.placement).toBe('down')
      expect(menu.style.top).toBe('132px') // button bottom 128 + 4 gap
      expect(menu.style.left).toBe('428px') // right edge of the button (588) minus the popup width
    })

    it('flips upward on a last row with no room below, keeping its focus behaviour', async () => {
      layout(590)
      await render([row('e', 'Plan.docx', { canEdit: true, canManage: true })])
      const button = menuButton(rowOf('Plan.docx'))!
      await click(button)
      const menu = document.body.querySelector<HTMLElement>('[role="menu"]')!
      expect(menu.dataset.placement).toBe('up')
      expect(menu.style.top).toBe('506px') // button top 590 - 4 gap - 80 popup height
      expect(document.activeElement).toBe(menu.querySelector('[role="menuitem"]'))
      await key(document.activeElement!, 'Escape')
      expect(document.body.querySelector('[role="menu"]')).toBeNull()
      expect(document.activeElement).toBe(button)
    })
  })
})

describe('S18 archived row and archive confirm (FX4)', () => {
  const archivedRow = () => row('m', 'Old.docx', { canEdit: true, canManage: true, archived: true })

  it('V17-01: the dimming of a parked row never reaches its menu', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
    const block = (selector: string) =>
      css.match(new RegExp(`${selector.replace(/[.>]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
    // the row itself is not translucent (that would dim the menu popup with it)
    expect(block('.uw-pick-row.disabled')).not.toMatch(/opacity/)
    // only the icon and the text are
    expect(block('.uw-pick-row.disabled > .uw-pick-row-text')).toMatch(/opacity:\s*0\.6/)
  })

  it('V17b-02: an archived row keeps its text at full opacity on the muted token', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
    const block = (selector: string) =>
      css.match(new RegExp(`${selector.replace(/[.>]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
    // declared after the .disabled dimming, same specificity, so it wins
    expect(css.indexOf('.uw-pick-row.archived > .uw-pick-row-text')).toBeGreaterThan(
      css.indexOf('.uw-pick-row.disabled > .uw-pick-row-text'),
    )
    expect(block('.uw-pick-row.archived > .uw-pick-row-text')).toMatch(/opacity:\s*1\s*;/)
    expect(block('.uw-pick-row.archived .uw-pick-row-title')).toMatch(
      /color:\s*var\(--text-muted\)/,
    )
  })

  it('V17b-04: the active row has a ring only while focus is inside the list, not in the search', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
    const block = (selector: string) =>
      css.match(new RegExp(`${selector.replace(/[.>:-]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
    expect(block('.uw-pick-row.active')).not.toMatch(/outline/)
    expect(block('.uw-pick-item:focus-within > .uw-pick-row.active')).toMatch(/outline:/)
  })

  it('V17-02: an archived row says it is archived, never "not supported"', async () => {
    await render([archivedRow(), row('u', 'Notes.txt', { format: null })])
    const archived = rowOf('Old.docx')
    const meta = archived.querySelector('.uw-pick-row-meta')!.textContent!
    expect(meta).toContain(en.uwDocArchived)
    // an archived row is parked, not unsupported
    expect(meta).not.toContain('Not supported')
    // FD-14: a really unsupported format is not listed at all
    expect(rowOf('Notes.txt')).toBeUndefined()
  })

  it('FD-14: an image row is absent and one muted line says how many were hidden', async () => {
    await render([
      row('a', 'Plan.docx'),
      row('p1', 'Photo.png', { format: null }),
      row('p2', 'Scan.jpg', { format: null }),
      row('p3', 'Logo.svg', { format: null }),
    ])
    expect(rows().map((r) => r.querySelector('.uw-pick-row-title')!.textContent)).toEqual([
      'Plan.docx',
    ])
    expect(rowOf('Photo.png')).toBeUndefined()
    const hint = host.querySelector<HTMLElement>('.uw-pick-hidden')!
    expect(hint.textContent).toBe(en.uwPickHiddenFormats.replace('{count}', '3'))
    expect(host.querySelectorAll('.uw-pick-hidden')).toHaveLength(1)
  })

  it('FD-14: no hint when nothing was hidden', async () => {
    await render([row('a', 'Plan.docx')])
    expect(host.querySelector('.uw-pick-hidden')).toBeNull()
  })

  it('FD-14: when every row is hidden the empty state shows with the reason', async () => {
    await render([row('p1', 'Photo.png', { format: null })])
    expect(rows()).toHaveLength(0)
    expect(host.textContent).toContain(en.uwPickEmpty)
    expect(host.querySelector('.uw-pick-hidden')!.textContent).toBe(
      en.uwPickHiddenFormats.replace('{count}', '1'),
    )
  })

  it('FD-14: the hint is muted by a semantic token, not a raw colour', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
    const block = css.match(/\.uw-pick-hidden\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(block).toMatch(/color:\s*var\(--text-muted\)/)
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i)
  })

  it('V17-03: an archived row is not aria-disabled and Restore is reachable by keyboard', async () => {
    await render([archivedRow(), row('u', 'Notes.txt', { format: null })])
    const archived = rowOf('Old.docx')
    expect(archived.getAttribute('aria-disabled')).toBeNull()
    const button = menuButton(archived)!
    // in the tab order although the row is never the highlighted one
    expect(button.tabIndex).toBe(0)
    await key(button, 'Enter')
    const item = document.body.querySelector<HTMLElement>('[role="menuitem"]')!
    expect(item.textContent).toBe(en.uwDocRestore)
    expect(document.activeElement).toBe(item)
    await click(item)
    expect(api.uniworkRestoreDocument).toHaveBeenCalledWith('m')
  })

  it('V17-04: the confirm opens on Cancel and focus returns to the row opener', async () => {
    await render([row('m', 'Old.docx', { canEdit: true, canManage: true })])
    const opener = menuButton(rowOf('Old.docx'))!
    await openMenuItem('Old.docx', en.uwDocArchive)
    const dialog = modal()!
    expect(document.activeElement).toBe(buttonByText(dialog, 'Cancel'))
    // the heading names the document
    expect(dialog.querySelector('h3')!.textContent).toContain('Old.docx')
    await key(document.activeElement!, 'Escape')
    expect(modal()).toBeNull()
    expect(api.uniworkArchiveDocument).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(opener)

    // Cancel does the same
    await openMenuItem('Old.docx', en.uwDocArchive)
    await click(buttonByText(modal()!, 'Cancel'))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5))
    })
    expect(document.activeElement).toBe(menuButton(rowOf('Old.docx')))
  })

  it('V17-07: the error toast has an icon and a dismiss button and stays role=alert', async () => {
    await render([row('e', 'Plan.docx', { canEdit: true })])
    api.uniworkRenameDocument.mockResolvedValueOnce(fail('server_error'))
    await openMenuItem('Plan.docx', en.uwDocRename)
    const input = host.querySelector<HTMLInputElement>('.uw-rename-input')!
    await type(input, 'Gone')
    await key(input, 'Enter')
    const toast = host.querySelector<HTMLElement>('.uw-act-toast')!
    expect(toast.getAttribute('role')).toBe('alert')
    expect(toast.querySelector('svg.uw-act-toast-icon')).not.toBeNull()
    await click(buttonByText(toast, ''))
    expect(host.querySelector('.uw-act-toast')).toBeNull()
  })

  it('F7: empty and too-long names set aria-invalid and point aria-describedby at the message', async () => {
    // New document
    await render([])
    await click(buttonByText(host, en.uwDocNew))
    const dialog = modal()!
    const name = dialog.querySelector<HTMLInputElement>('input[type="text"]')!
    const errorId = name.getAttribute('aria-describedby')!
    expect(name.getAttribute('aria-invalid')).toBe('false')
    expect(document.getElementById(errorId)!.textContent).toBe('')
    await click(buttonByText(dialog, en.uwDocCreate))
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(name.getAttribute('aria-describedby')).toBe(errorId)
    expect(document.getElementById(errorId)!.textContent).toBe(en.uwDocNameEmpty)
    await type(name, 'a'.repeat(501))
    expect(name.getAttribute('aria-invalid')).toBe('false')
    await click(buttonByText(dialog, en.uwDocCreate))
    expect(name.getAttribute('aria-invalid')).toBe('true')
    expect(name.getAttribute('aria-describedby')).toBe(errorId)
    expect(document.getElementById(errorId)!.textContent).toBe(en.uwDocNameTooLong)
  })
})

describe('S18 renamed elsewhere', () => {
  it('updates the row title from the main event', async () => {
    await render([row('e', 'Plan.docx', { canEdit: true })])
    await act(async () => api.pushRenamed({ documentId: 'e', title: 'Roadmap.docx' }))
    await flush()
    expect(rows()[0]!.querySelector('.uw-pick-row-title')!.textContent).toBe('Roadmap.docx')
  })

  it('announces the new name politely from the tab strip', async () => {
    api = makeApi([])
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(UniworkNotice, { openDocumentIds: new Set(['e']) }),
        ),
      )
    })
    const live = host.querySelector('[aria-live="polite"]')!
    expect(live.textContent).toBe('')
    await act(async () => api.pushRenamed({ documentId: 'e', title: 'Roadmap.docx' }))
    expect(live.textContent).toBe('The document was renamed to Roadmap.docx.')
  })

  it('RFE17-06: stays silent for a document that is not open in a tab', async () => {
    api = makeApi([])
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(UniworkNotice, { openDocumentIds: new Set(['other']) }),
        ),
      )
    })
    const live = host.querySelector('[aria-live="polite"]')!
    await act(async () => api.pushRenamed({ documentId: 'e', title: 'Roadmap.docx' }))
    expect(live.textContent).toBe('')
    await act(async () => api.pushRenamed({ documentId: 'other', title: 'Other.docx' }))
    expect(live.textContent).toBe('The document was renamed to Other.docx.')
  })
})

/** the library dialog together with the tab strip's live region, as in the window */
async function renderWithChrome(docs: LibraryDocRow[]) {
  api = makeApi(docs)
  onClose = vi.fn()
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(UniworkOpenDialog, {
          onClose,
          accountView: 'signed-in',
          onSignIn: () => undefined,
        }),
        createElement(UniworkNotice, { openDocumentIds: new Set<string>() }),
      ),
    )
  })
  await flush()
}

describe('G8-17 review r3 fixes', () => {
  it('Cancel aborts the upload in main by its id; a late result is still ignored', async () => {
    await render([])
    let finish: (v: DocActionResult<UniworkDocSummary>) => void = () => undefined
    api.uniworkUploadDocument.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    )
    await click(buttonByText(host, en.uwDocUpload))
    const dialog = modal()!
    await click(buttonByText(dialog, en.uwDocUploadPick))
    await click(dialog.querySelector('.btn-primary')!)
    const { uploadId } = api.uniworkUploadDocument.mock.calls[0]![0]
    expect(uploadId).toBeTruthy()
    expect(api.uniworkCancelUploadDocument).not.toHaveBeenCalled()
    await click(dialog.querySelector('.modal-buttons .btn-secondary')!)
    expect(api.uniworkCancelUploadDocument).toHaveBeenCalledTimes(1)
    expect(api.uniworkCancelUploadDocument).toHaveBeenCalledWith(uploadId)
    // the server had answered before the abort took effect
    await act(async () => finish(ok(row('up1', 'Q3.xlsx', { format: 'xlsx' }))))
    await flush()
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
    expect(host.querySelector('.uw-act-toast')).toBeNull()
  })

  it('Escape cancels by id, and the upload_cancelled answer never toasts', async () => {
    await render([])
    let finish: (v: DocActionResult<UniworkDocSummary>) => void = () => undefined
    api.uniworkUploadDocument.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    )
    await click(buttonByText(host, en.uwDocUpload))
    const dialog = modal()!
    await click(buttonByText(dialog, en.uwDocUploadPick))
    await click(dialog.querySelector('.btn-primary')!)
    const { uploadId } = api.uniworkUploadDocument.mock.calls[0]![0]
    await key(dialog, 'Escape')
    expect(api.uniworkCancelUploadDocument).toHaveBeenCalledWith(uploadId)
    await act(async () => finish(fail('upload_cancelled')))
    await flush()
    expect(host.querySelector('.uw-act-toast')).toBeNull()
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
  })

  it('each upload start mints a fresh id', async () => {
    await render([])
    for (let i = 0; i < 2; i++) {
      api.uniworkUploadDocument.mockImplementationOnce(() => new Promise(() => undefined))
      await click(buttonByText(host, en.uwDocUpload))
      const dialog = modal()!
      await click(buttonByText(dialog, en.uwDocUploadPick))
      await click(dialog.querySelector('.btn-primary')!)
      await click(dialog.querySelector('.modal-buttons .btn-secondary')!)
    }
    const [a, b] = api.uniworkUploadDocument.mock.calls.map((c) => c[0].uploadId)
    expect(a).not.toBe(b)
  })

  it('a typed name that already ends in an Office extension is sent as typed', async () => {
    await render([])
    await click(buttonByText(host, en.uwDocNew))
    const dialog = modal()!
    const name = dialog.querySelector<HTMLInputElement>('input[type="text"]')!
    await type(name, 'a.DOCX')
    await click(buttonByText(dialog, en.uwDocCreate))
    // the field still shows what was typed
    expect(name.value).toBe('a.DOCX')
    expect(api.uniworkCreateDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'a.DOCX', format: 'docx' }),
    )
  })

  it('the format extension is appended for a name without one, whatever the format', async () => {
    await render([])
    await click(buttonByText(host, en.uwDocNew))
    const dialog = modal()!
    const name = dialog.querySelector<HTMLInputElement>('input[type="text"]')!
    await type(name, 'Q4 plan')
    await click(dialog.querySelector('input[value="xlsx"]')!)
    await click(buttonByText(dialog, en.uwDocCreate))
    expect(name.value).toBe('Q4 plan')
    expect(api.uniworkCreateDocument).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Q4 plan.xlsx', format: 'xlsx' }),
    )
  })
})

describe('G8-17 review r1 fixes', () => {
  it('RFE17-01: a cancelled upload never opens the document or toasts when it finishes', async () => {
    await render([])
    let finish: (v: DocActionResult<UniworkDocSummary>) => void = () => undefined
    api.uniworkUploadDocument.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    )
    await click(buttonByText(host, en.uwDocUpload))
    const dialog = modal()!
    await click(buttonByText(dialog, en.uwDocUploadPick))
    await click(dialog.querySelector('.btn-primary')!)
    expect(api.uniworkUploadDocument).toHaveBeenCalledTimes(1)
    // Cancel while the bytes are going up
    await click(dialog.querySelector('.modal-buttons .btn-secondary')!)
    expect(modal()).toBeNull()
    await act(async () => finish(ok(row('up1', 'Q3.xlsx', { format: 'xlsx' }))))
    await flush()
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
    expect(host.querySelector('.uw-act-toast')).toBeNull()
  })

  it('RFE17-01: Escape cancels a failing upload without a toast either', async () => {
    await render([])
    let finish: (v: DocActionResult<UniworkDocSummary>) => void = () => undefined
    api.uniworkUploadDocument.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    )
    await click(buttonByText(host, en.uwDocUpload))
    const dialog = modal()!
    await click(buttonByText(dialog, en.uwDocUploadPick))
    await click(dialog.querySelector('.btn-primary')!)
    await key(dialog, 'Escape')
    expect(modal()).toBeNull()
    await act(async () => finish(fail('server_error')))
    await flush()
    expect(host.querySelector('.uw-act-toast')).toBeNull()
  })

  it('RFE17-05: the location fields are locked while an upload is busy', async () => {
    await render([])
    api.uniworkUploadDocument.mockImplementationOnce(() => new Promise(() => undefined))
    await click(buttonByText(host, en.uwDocUpload))
    const dialog = modal()!
    await click(buttonByText(dialog, en.uwDocUploadPick))
    const selects = () => Array.from(dialog.querySelectorAll<HTMLSelectElement>('select'))
    const location = () => dialog.querySelector<HTMLButtonElement>('.uwf-location-btn')!
    expect(selects()[0]!.disabled).toBe(false)
    expect(location().getAttribute('aria-disabled')).toBeNull()
    await click(dialog.querySelector('.btn-primary')!)
    expect(selects().every((sel) => sel.disabled)).toBe(true)
    expect(location().getAttribute('aria-disabled')).toBe('true')
    await click(location())
    expect(host.querySelector('.uwf-picker')).toBeNull()
  })

  it('RFE17-02: a successful rename is announced once in the polite live region', async () => {
    await renderWithChrome([row('e', 'Plan.docx', { canEdit: true })])
    const live = host.querySelector('[aria-live="polite"]')!
    expect(live.textContent).toBe('')
    await openMenuItem('Plan.docx', en.uwDocRename)
    const input = host.querySelector<HTMLInputElement>('.uw-rename-input')!
    await type(input, 'Roadmap')
    await key(input, 'Enter')
    expect(live.textContent).toBe('The document was renamed to Roadmap.docx.')
    expect(host.querySelectorAll('[aria-live="polite"] > span')).toHaveLength(1)
  })

  it('RFE17-02: a failed rename announces nothing', async () => {
    await renderWithChrome([row('e', 'Plan.docx', { canEdit: true })])
    api.uniworkRenameDocument.mockResolvedValueOnce(fail('server_error'))
    await openMenuItem('Plan.docx', en.uwDocRename)
    const input = host.querySelector<HTMLInputElement>('.uw-rename-input')!
    await type(input, 'Roadmap')
    await key(input, 'Enter')
    expect(host.querySelector('[aria-live="polite"]')!.textContent).toBe('')
  })

  it('RFE17-03: a second Restore while the first is in flight makes no second call', async () => {
    const archived = row('m', 'Old.docx', { canEdit: true, canManage: true, archived: true })
    await render([archived])
    let finish: (v: DocActionResult<unknown>) => void = () => undefined
    api.uniworkRestoreDocument.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    )
    await openMenuItem('Old.docx', en.uwDocRestore)
    await openMenuItem('Old.docx', en.uwDocRestore)
    expect(api.uniworkRestoreDocument).toHaveBeenCalledTimes(1)
    await act(async () => finish(ok({})))
    await flush()
    expect(rowOf('Old.docx').textContent).not.toContain(en.uwDocArchived)
    // settled: the row can be acted on again
    await openMenuItem('Old.docx', en.uwDocArchive)
    await click(modal()!.querySelector('.btn-primary')!)
    expect(api.uniworkArchiveDocument).toHaveBeenCalledTimes(1)
  })

  it('RFE17-04: only the active row has its "…" in the tab order, archived rows are reached by arrows', async () => {
    const flags = { canEdit: true, canManage: true, archived: true }
    await render([
      row('a', 'Open.docx', { canEdit: true, canManage: true }),
      row('m1', 'Old1.docx', flags),
      row('m2', 'Old2.docx', flags),
    ])
    const stops = () =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('.uw-row-menu-btn'))
        .filter((b) => b.tabIndex === 0)
        .map((b) => b.dataset.menuFor)
    expect(stops()).toEqual(['a'])
    const search = host.querySelector<HTMLInputElement>('.uw-pick-search')!
    await key(search, 'ArrowDown')
    expect(stops()).toEqual(['m1'])
    await key(search, 'ArrowDown')
    expect(stops()).toEqual(['m2'])
    // Restore of that row is one Enter away
    const button = menuButton(rowOf('Old2.docx'))!
    await key(button, 'Enter')
    expect(document.body.querySelector('[role="menuitem"]')!.textContent).toBe(en.uwDocRestore)
  })
})
