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

/**
 * S18: New document, Upload, Rename, Archive / Restore from the UniWork
 * library. The bridge is a typed fake of the G8-17 library IPC; no main runs.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const en = uniworkDocumentStrings.en

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
    uniworkListFolders: vi.fn(async (_ws: string) => ok([{ id: 'f1', title: 'Contracts' }])),
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
const menuButton = (r: HTMLElement) => r.querySelector<HTMLButtonElement>('.uw-row-menu-btn')
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
  await click(buttonByText(host, item))
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
    expect(rowActionsOf(row('a', 'A', { canEdit: false, canManage: false }))).toEqual({
      rename: false,
      archive: false,
      restore: false,
    })
    expect(hasRowActions(row('a', 'A'))).toBe(false) // no flags (older main): nothing offered
    expect(rowActionsOf(row('a', 'A', { canEdit: true }))).toEqual({
      rename: true,
      archive: false,
      restore: false,
    })
    expect(rowActionsOf(row('a', 'A', { canEdit: true, canManage: true, archived: true }))).toEqual(
      { rename: false, archive: false, restore: true },
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
    const folder = dialog.querySelectorAll<HTMLSelectElement>('select')[1]!
    expect(api.uniworkListFolders).toHaveBeenCalledWith('w1')
    await act(async () => {
      folder.value = 'f1'
      folder.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click(buttonByText(dialog, en.uwDocCreate))
    expect(api.uniworkCreateDocument).toHaveBeenCalledWith({
      workspaceId: 'w1',
      folderId: 'f1',
      name: 'Q4 plan',
      format: 'pptx',
    })
    // opened by the server id, through the normal open path; no second local copy is made here
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('new1')
    expect(api.uniworkOpenDocument).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
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
      expect.objectContaining({ name: 'Plan' }),
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
    // 500 runes pass, even when they are astral characters of two UTF-16 units each
    await type(name, '😀'.repeat(500))
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
    expect(api.uniworkUploadDocument).toHaveBeenCalledWith({
      workspaceId: 'w2',
      folderId: null,
      path: '/home/me/Q3.xlsx',
    })
    await act(async () => api.pushProgress({ path: '/home/me/Q3.xlsx', loaded: 50, total: 200 }))
    const status = dialog.querySelector('.uw-act-progress')!
    expect(status.getAttribute('role')).toBe('status')
    expect(status.textContent).toContain('Uploading “Q3.xlsx”')
    expect(dialog.querySelector('progress')!.getAttribute('value')).toBe('25')
    await act(async () => finish(ok(row('up1', 'Q3.xlsx', { format: 'xlsx' }))))
    await flush()
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
    expect(editor.getAttribute('aria-label')).toBe('More actions for “Editor.docx”')
    await click(editor)
    const items = Array.from(host.querySelectorAll('[role="menuitem"]')).map((i) => i.textContent)
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
    const items = Array.from(host.querySelectorAll('[role="menuitem"]')).map((i) => i.textContent)
    expect(items).toEqual([en.uwDocRestore])
    await click(buttonByText(host, en.uwDocRestore))
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
    const first = host.querySelector<HTMLElement>('[role="menuitem"]')!
    expect(document.activeElement).toBe(first)
    await key(first, 'ArrowDown')
    expect(document.activeElement?.textContent).toBe(en.uwDocArchive)
    await key(document.activeElement!, 'Escape')
    expect(host.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(button)
    expect(onClose).not.toHaveBeenCalled()
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

  it('V17-02: an archived row says it is archived, never "not supported"', async () => {
    await render([archivedRow(), row('u', 'Notes.txt', { format: null })])
    const archived = rowOf('Old.docx')
    const meta = archived.querySelector('.uw-pick-row-meta')!.textContent!
    expect(meta).toContain(en.uwDocArchived)
    expect(archived.textContent).not.toContain(en.uwPickUnsupported)
    // a really unsupported format keeps its own reason
    expect(rowOf('Notes.txt').textContent).toContain(en.uwPickUnsupported)
  })

  it('V17-03: an archived row is not aria-disabled and Restore is reachable by keyboard', async () => {
    await render([archivedRow(), row('u', 'Notes.txt', { format: null })])
    const archived = rowOf('Old.docx')
    expect(archived.getAttribute('aria-disabled')).toBeNull()
    expect(rowOf('Notes.txt').getAttribute('aria-disabled')).toBe('true')
    const button = menuButton(archived)!
    // in the tab order although the row is never the highlighted one
    expect(button.tabIndex).toBe(0)
    await key(button, 'Enter')
    const item = host.querySelector<HTMLElement>('[role="menuitem"]')!
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
      root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(UniworkNotice)))
    })
    const live = host.querySelector('[aria-live="polite"]')!
    expect(live.textContent).toBe('')
    await act(async () => api.pushRenamed({ documentId: 'e', title: 'Roadmap.docx' }))
    expect(live.textContent).toBe('The document was renamed to Roadmap.docx.')
  })
})
