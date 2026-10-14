/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchModuleId } from '@uniwork/practice-core'

const store = vi.hoisted(() => new Map<string, string>())
vi.mock('../src/renderer/src/workbench-store-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/renderer/src/workbench-store-client')>()),
  wbStoreGetRaw: (key: string) => store.get(key) ?? null,
  wbStoreSetRaw: (key: string, value: string) => {
    store.set(key, value)
  },
  wbStoreRemove: (key: string) => {
    store.delete(key)
  },
  wbStoreRead: <T>(key: string, fallback: T): T => {
    const raw = store.get(key)
    return raw === undefined ? fallback : (JSON.parse(raw) as T)
  },
  wbStoreWrite: (key: string, value: unknown) => {
    store.set(key, JSON.stringify(value))
  },
}))

import type { HomeApi } from '../src/shared/home-api'
import type { UniworkWorkApi } from '../src/shared/uniwork-work-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { WbToastHost, createWbToasts } from '../src/renderer/src/WbToastHost'
import { WorkbenchModulePane } from '../src/renderer/src/WorkbenchModulePanes'
import { editedWhen } from '../src/renderer/src/work-home'
import {
  createStickyNote,
  readForms,
  readStickyNotes,
  writeForms,
  writeStickyNotes,
} from '../src/renderer/src/workbench-pins'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let api: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  store.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  api = {
    newDoc: vi.fn(async () => undefined),
    openPath: vi.fn(async () => undefined),
    pickAttachments: vi.fn(async () => ({
      accepted: [{ path: '/t/leave.docx', name: 'leave.docx', ext: '.docx' }],
      rejected: [],
    })),
  }
  window.aiOffice = api as unknown as HomeApi
  window.uniworkWork = {
    myProfile: vi.fn(async () => ({ ok: false, error: 'signed-out' })),
  } as unknown as UniworkWorkApi
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

async function mount(
  moduleId: WorkbenchModuleId,
  over: { packId?: string | null; selectedPackId?: string | null } = {},
) {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(
          WbToastHost,
          { toasts: createWbToasts() },
          createElement(WorkbenchModulePane, {
            moduleId,
            practiceId: 'sales',
            vi: false,
            packId: over.packId ?? null,
            selectedPackId: over.selectedPackId ?? null,
            packs: [{ id: 'p1', title: 'Q4 launch' }],
            workspace: null,
            workspaceError: null,
            onReload: () => undefined,
          }),
        ),
      ),
    )
  })
}

const button = (text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === text)
const click = async (el: HTMLElement | null | undefined) => {
  await act(async () => el!.click())
  await flush()
}
const type = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const rowTitles = () =>
  Array.from(host.querySelectorAll('.wb-forms-row .wb-forms-name')).map((n) => n.textContent)
const openMenu = async (title: string) =>
  click(host.querySelector<HTMLButtonElement>(`button[aria-label="More actions: ${title}"]`))
const menuItem = (text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(
    (b) => b.textContent === text,
  )

describe('Forms tab (redesign spec 4.4)', () => {
  it('toolbar: the count, the local tag and a secondary Add a form; empty: the state panel', async () => {
    await mount('forms')
    expect(host.querySelector('.wb-toolbar-text')?.textContent).toBe('Forms: 0')
    expect(host.querySelector('.wb-toolbar .wb-local-tag')).not.toBeNull()
    const add = host.querySelector<HTMLButtonElement>('.wb-toolbar-actions button')!
    expect(add.className).toBe('wb-btn wb-btn-secondary')
    expect(add.textContent).toBe('Add a form')
    expect(add.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelector('form')).toBeNull()
    expect(host.querySelector('.wb-state')?.textContent).toContain('No forms yet')
  })

  it('Add a form opens the New form card: a real form, three fields, Add locked without a name', async () => {
    await mount('forms')
    await click(button('Add a form'))
    const form = host.querySelector<HTMLFormElement>('form.wb-forms-new')!
    expect(form.querySelector('h3')?.textContent).toBe('New form')
    expect(Array.from(form.querySelectorAll('.wb-field-label')).map((l) => l.textContent)).toEqual([
      'Form title *',
      'Note (optional)',
      'Template file',
    ])
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!
    expect(submit.textContent).toBe('Add to library')
    expect(submit.disabled).toBe(true)
    expect(
      Array.from(form.querySelectorAll('.wb-forms-new-actions button')).map((b) => b.textContent),
    ).toEqual(['Cancel', 'Add to library'])
    // the title input has the focus, and Enter from the note field submits the form
    const [title, note] = Array.from(form.querySelectorAll<HTMLInputElement>('input'))
    expect(document.activeElement).toBe(title)
    await type(title!, 'Leave request')
    await type(note!, 'HR 2026')
    expect(submit.disabled).toBe(false)
    await act(async () => form.requestSubmit())
    expect(host.querySelector('form.wb-forms-new')).toBeNull()
    expect(rowTitles()).toEqual(['Leave request'])
    expect(readForms('sales')[0]).toMatchObject({ title: 'Leave request', note: 'HR 2026' })
  })

  it('the template file row: upload names the form, then Change file', async () => {
    await mount('forms')
    await click(button('Add a form'))
    await click(button('Upload template file…'))
    expect(host.querySelector('.wb-forms-file-name')?.textContent).toBe('leave.docx')
    expect(button('Change file')).toBeDefined()
    expect(host.querySelector<HTMLInputElement>('form input')!.value).toBe('leave')
  })

  it('one banner with the pack chip; no per-row lock line; Draft is never locked (default pack)', async () => {
    writeForms('sales', [{ id: 'f1', title: 'Leave request', note: 'HR' }])
    await mount('forms', { packId: 'p-default' })
    const banner = host.querySelector('.wb-forms-banner')!
    expect(banner.textContent).toContain('Drafts from forms go to')
    expect(banner.querySelector('select')?.getAttribute('aria-label')).toBe('Pack to draft into')
    expect(banner.querySelector('.wb-crumb-name')?.textContent).toBe('Default project')
    expect(banner.textContent).toContain('With no pack selected, they go to the Default project')
    expect(host.querySelector('.wb-forms-locked')).toBeNull()
    const draft = button('Draft')!
    expect(draft.className).toBe('wb-btn wb-btn-secondary wb-btn-sm')
    expect(draft.disabled).toBe(false)
    await click(draft)
    expect(api.newDoc).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p-default' }))
    expect(readForms('sales')[0]!.linkedProjectId).toBe('p-default')
  })

  it('Draft with no pack at all still drafts, as a plain new document', async () => {
    writeForms('sales', [{ id: 'f1', title: 'Leave request' }])
    await mount('forms')
    await click(button('Draft'))
    expect(api.newDoc).toHaveBeenCalledWith(expect.objectContaining({ projectId: undefined }))
  })

  it('a row: badge, name and note, template file, Draft, then the more menu', async () => {
    writeForms('sales', [
      {
        id: 'f1',
        title: 'Leave request',
        note: 'HR',
        filePath: '/t/leave.docx',
        fileName: 'leave.docx',
        fileExt: '.docx',
      },
    ])
    await mount('forms')
    const row = host.querySelector('.wb-forms-list > li.wb-row.wb-forms-row')!
    expect(Array.from(row.children).map((c) => c.className || c.tagName)).toEqual([
      'IMG',
      'wb-forms-text',
      'wb-forms-file-cell',
      'wb-btn wb-btn-secondary wb-btn-sm',
      'wb-row-actions',
    ])
    expect(row.querySelector('.wb-forms-text')?.textContent).toBe('Leave requestHR')
    expect(row.querySelector('.wb-forms-file-cell')?.textContent).toBe('leave.docx')
    await openMenu('Leave request')
    expect(
      Array.from(host.querySelectorAll('[role="menuitem"]')).map((b) => b.textContent),
    ).toEqual(['Open the source template', 'Edit name and note', 'Remove from library'])
    await click(menuItem('Open the source template'))
    expect(api.openPath).toHaveBeenCalledWith('/t/leave.docx')
  })

  it('Edit name and note opens the card filled in, and saving updates the row', async () => {
    writeForms('sales', [{ id: 'f1', title: 'Leave request', note: 'HR' }])
    await mount('forms')
    await openMenu('Leave request')
    await click(menuItem('Edit name and note'))
    const form = host.querySelector<HTMLFormElement>('form.wb-forms-new')!
    expect(form.querySelector('h3')?.textContent).toBe('Edit form')
    const [title] = Array.from(form.querySelectorAll<HTMLInputElement>('input'))
    expect(title!.value).toBe('Leave request')
    await type(title!, 'Annual leave')
    await act(async () => form.requestSubmit())
    expect(rowTitles()).toEqual(['Annual leave'])
    expect(readForms('sales')).toHaveLength(1)
  })

  it('Remove from library: gone at once, a toast with Undo puts it back where it was', async () => {
    writeForms('sales', [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C' },
    ])
    await mount('forms')
    await openMenu('B')
    await click(menuItem('Remove from library'))
    expect(rowTitles()).toEqual(['A', 'C'])
    expect(readForms('sales').map((f) => f.id)).toEqual(['a', 'c'])
    expect(document.activeElement).toBe(host.querySelector('.wb-forms-list'))
    const toast = host.querySelector('.wb-toast')!
    expect(toast.textContent).toContain('Deleted “B”')
    await click(Array.from(toast.querySelectorAll('button')).find((b) => b.textContent === 'Undo'))
    expect(rowTitles()).toEqual(['A', 'B', 'C'])
    expect(readForms('sales').map((f) => f.id)).toEqual(['a', 'b', 'c'])
    expect(host.querySelector('.wb-toast')).toBeNull()
  })
})

describe('Notes tab (redesign spec 4.5)', () => {
  const composer = () => host.querySelector<HTMLTextAreaElement>('.wb-notes-composer textarea')!
  const save = () => button('Save note')!
  const key = (init: KeyboardEventInit) =>
    act(async () => {
      composer().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }),
      )
    })

  it('toolbar count and local tag; the composer card with a locked Save note; the empty panel', async () => {
    await mount('notes')
    expect(host.querySelector('.wb-toolbar-text')?.textContent).toBe('Notes: 0')
    expect(host.querySelector('.wb-toolbar .wb-local-tag')).not.toBeNull()
    expect(composer().getAttribute('aria-label')).toBe('New note')
    expect(host.querySelector('.wb-notes-composer-foot')?.textContent).toMatch(/↵ to save/)
    expect(save().className).toBe('wb-btn wb-btn-primary wb-btn-sm')
    expect(save().disabled).toBe(true)
    expect(host.querySelector('.wb-state')?.textContent).toContain('No notes yet')
  })

  it('Ctrl/Cmd+Enter saves; Enter alone does not (it is a new line)', async () => {
    await mount('notes')
    await type(composer(), 'Call the notary')
    expect(save().disabled).toBe(false)
    await key({})
    expect(readStickyNotes('sales')).toHaveLength(0)
    await key({ ctrlKey: true })
    expect(readStickyNotes('sales').map((n) => n.body)).toEqual(['Call the notary'])
    expect(composer().value).toBe('')
    await type(composer(), 'Book the room')
    await key({ metaKey: true })
    expect(readStickyNotes('sales')).toHaveLength(2)
  })

  it('a note is a card in the wall, edited in place and saved as you type', async () => {
    createStickyNote('sales', 'Call the notary')
    await mount('notes')
    const card = host.querySelector('.wb-notes-wall > li.wb-block.wb-note')!
    const body = card.querySelector('textarea')!
    expect(body.value).toBe('Call the notary')
    expect(card.querySelector('.wb-note-foot .wb-row-sub')?.textContent).toMatch(
      /^Edited \d\d:\d\d$/,
    )
    expect(
      Array.from(card.querySelectorAll('.wb-note-actions button')).map((b) =>
        b.getAttribute('aria-label'),
      ),
    ).toEqual(['Copy', 'Delete note'])
    await type(body, 'Call the notary at 4')
    expect(readStickyNotes('sales')[0]!.body).toBe('Call the notary at 4')
  })

  it('Delete: gone at once, Undo in the toast puts it back where it was', async () => {
    createStickyNote('sales', 'A')
    createStickyNote('sales', 'B')
    createStickyNote('sales', 'C')
    const order = readStickyNotes('sales').map((n) => n.body)
    writeStickyNotes('sales', readStickyNotes('sales'))
    await mount('notes')
    const bodies = () =>
      Array.from(host.querySelectorAll<HTMLTextAreaElement>('.wb-note textarea')).map(
        (t) => t.value,
      )
    expect(bodies()).toEqual(order)
    const middle = host.querySelectorAll('.wb-note')[1]!
    await click(middle.querySelector<HTMLButtonElement>('button[aria-label="Delete note"]'))
    expect(bodies()).toEqual([order[0], order[2]])
    expect(readStickyNotes('sales')).toHaveLength(2)
    expect(document.activeElement).toBe(host.querySelector('.wb-notes-wall'))
    const toast = host.querySelector('.wb-toast')!
    expect(toast.textContent).toContain('Note deleted')
    await click(Array.from(toast.querySelectorAll('button')).find((b) => b.textContent === 'Undo'))
    expect(bodies()).toEqual(order)
    expect(readStickyNotes('sales').map((n) => n.body)).toEqual(order)
  })
})

describe('editedWhen (the shared relative edit time)', () => {
  const now = new Date(2026, 9, 15, 14, 0)
  it('today: the time; yesterday: a word; older: day and month', () => {
    expect(editedWhen(new Date(2026, 9, 15, 10, 42).toISOString(), 'vi', now)).toEqual({
      key: 'wbEditedAt',
      params: { time: '10:42' },
    })
    expect(editedWhen(new Date(2026, 9, 14, 23, 59).toISOString(), 'vi', now)).toEqual({
      key: 'wbEditedYesterday',
    })
    expect(editedWhen(new Date(2026, 9, 13, 9, 0).toISOString(), 'vi', now)).toEqual({
      key: 'wbEditedOn',
      params: { date: '13/10' },
    })
    // the locale's order: month first in English
    expect(editedWhen(new Date(2026, 9, 13, 9, 0).toISOString(), 'en-US', now).params).toEqual({
      date: '10/13',
    })
  })
})
