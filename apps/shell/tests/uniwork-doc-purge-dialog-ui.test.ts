/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocPurgeConfirm } from '../src/renderer/src/uniwork-home/DocPurgeConfirm'
import { canPurgeDocuments } from '../src/renderer/src/uniwork-library-api'

/**
 * UNI-2078 slice 2: the one-item "Delete forever" confirm (the web's document-purge-dialog).
 * Title with the item name, the folder variant of the description, a destructive button with a
 * busy label, a failure that stays inside the dialog, and `document_not_in_trash` which hands the
 * host a "refresh and close" instead of an error line. Initial focus is on Cancel.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

type PurgeResult = { ok: true; value: { id: string } } | { ok: false; error: string }

let host: HTMLDivElement
let root: Root
let purgeFn: ReturnType<typeof vi.fn<(id: string) => Promise<PurgeResult>>>

beforeEach(() => {
  localStorage.setItem('genoffice.lang', 'vi')
  purgeFn = vi.fn(async (id: string) => ({ ok: true, value: { id } }))
  ;(window as unknown as { aiOffice: unknown }).aiOffice = { uniworkPurgeDocument: purgeFn }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  delete (window as unknown as { aiOffice?: unknown }).aiOffice
})

const onPurged = vi.fn()
const onNotInTrash = vi.fn()
const onCancel = vi.fn()

async function open(
  doc: { id: string; title: string; kind?: string } = { id: 't-1', title: 'Kế hoạch.docx' },
  lang: 'vi' | 'en' = 'vi',
) {
  onPurged.mockReset()
  onNotInTrash.mockReset()
  onCancel.mockReset()
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: lang },
        createElement(DocPurgeConfirm, { doc, onPurged, onNotInTrash, onCancel }),
      ),
    )
  })
}

const q = <T extends Element>(selector: string) => host.ownerDocument.querySelector<T>(selector)
const confirmButton = () => q<HTMLButtonElement>('[data-purge-confirm]')!
const cancelButton = () => q<HTMLButtonElement>('[data-purge-cancel]')!
const alertText = () => q('[role="alert"]')?.textContent ?? ''
const press = async (el: HTMLElement) => {
  await act(async () => el.click())
  await flush()
}
const isDisabled = (el: HTMLElement) =>
  (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true'

describe('the availability of the call', () => {
  it('canPurgeDocuments is true with the call and false for a stale preload', () => {
    expect(canPurgeDocuments()).toBe(true)
    ;(window as unknown as { aiOffice: unknown }).aiOffice = {}
    expect(canPurgeDocuments()).toBe(false)
  })
})

describe('DocPurgeConfirm: opening', () => {
  it('is a labelled, described modal dialog titled with the item name (vi)', async () => {
    await open()
    const dialog = q('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe(
      'Xóa vĩnh viễn Kế hoạch.docx?',
    )
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)!.textContent).toBe(
      'Mục này sẽ bị xóa vĩnh viễn và không thể hoàn tác.',
    )
  })

  it('speaks English too', async () => {
    await open({ id: 't-1', title: 'Plan.docx' }, 'en')
    expect(q('[role="dialog"]')!.textContent).toContain('Delete Plan.docx forever?')
    expect(q('[role="dialog"]')!.textContent).toContain(
      'This item will be permanently deleted and cannot be undone.',
    )
    expect(confirmButton().textContent).toBe('Delete forever')
    expect(cancelButton().textContent).toBe('Cancel')
  })

  it('a folder says its children you do not manage stay in the trash (vi)', async () => {
    await open({ id: 't-2', title: 'Hồ sơ', kind: 'folder' })
    expect(q('[role="dialog"]')!.textContent).toContain(
      'Thư mục này sẽ bị xóa vĩnh viễn và không thể hoàn tác. Mục con bạn không quản lý vẫn ở lại thùng rác.',
    )
  })

  it('a folder says its children you do not manage stay in the trash (en)', async () => {
    await open({ id: 't-2', title: 'Plans', kind: 'folder' }, 'en')
    expect(q('[role="dialog"]')!.textContent).toContain(
      'Items inside it that you do not manage stay in the trash.',
    )
  })

  it('has a destructive confirm button and a Hủy button', async () => {
    await open()
    expect(confirmButton().textContent).toBe('Xóa vĩnh viễn')
    expect(confirmButton().classList.contains('btn-danger')).toBe(true)
    expect(cancelButton().textContent).toBe('Hủy')
  })

  it('puts the focus on Hủy, not on the destructive button', async () => {
    await open()
    expect(document.activeElement).toBe(cancelButton())
  })

  it('traps Tab inside the dialog', async () => {
    await open()
    confirmButton().focus()
    await act(async () => {
      confirmButton().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(q('[role="dialog"]')!.contains(document.activeElement)).toBe(true)
  })

  it('Cancel and Escape close without calling the bridge', async () => {
    await open()
    await press(cancelButton())
    expect(onCancel).toHaveBeenCalledTimes(1)
    await act(async () => {
      cancelButton().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(purgeFn).not.toHaveBeenCalled()
  })
})

describe('DocPurgeConfirm: confirming', () => {
  it('calls purge once with the id and reports the title', async () => {
    await open()
    await press(confirmButton())
    expect(purgeFn).toHaveBeenCalledTimes(1)
    expect(purgeFn).toHaveBeenCalledWith('t-1')
    expect(onPurged).toHaveBeenCalledWith('Kế hoạch.docx')
    expect(onNotInTrash).not.toHaveBeenCalled()
    expect(alertText()).toBe('')
  })

  it('a double click sends once', async () => {
    let finish: (r: PurgeResult) => void = () => undefined
    purgeFn.mockImplementation(() => new Promise<PurgeResult>((resolve) => (finish = resolve)))
    await open()
    await act(async () => {
      confirmButton().click()
      confirmButton().click()
    })
    await act(async () => {
      confirmButton().click()
    })
    expect(purgeFn).toHaveBeenCalledTimes(1)
    await act(async () => finish({ ok: true, value: { id: 't-1' } }))
    await flush()
    expect(onPurged).toHaveBeenCalledTimes(1)
  })

  it('shows the busy label, locks the buttons and ignores Cancel / Escape while in flight', async () => {
    let finish: (r: PurgeResult) => void = () => undefined
    purgeFn.mockImplementation(() => new Promise<PurgeResult>((resolve) => (finish = resolve)))
    await open()
    await press(confirmButton())
    expect(confirmButton().textContent).toBe('Đang xóa vĩnh viễn…')
    expect(confirmButton().getAttribute('aria-busy')).toBe('true')
    expect(isDisabled(confirmButton())).toBe(true)
    await press(cancelButton())
    await act(async () => {
      cancelButton().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onCancel).not.toHaveBeenCalled()
    await act(async () => finish({ ok: true, value: { id: 't-1' } }))
    await flush()
    expect(onPurged).toHaveBeenCalledTimes(1)
  })
})

describe('DocPurgeConfirm: a failure', () => {
  it('stays inside the dialog with the failure sentence and lets the person retry', async () => {
    purgeFn.mockResolvedValueOnce({ ok: false, error: 'server_error' })
    await open()
    await press(confirmButton())
    expect(q('[role="dialog"]')).not.toBeNull()
    expect(alertText()).toBe('Không xóa được. Chưa có gì thay đổi.')
    expect(onPurged).not.toHaveBeenCalled()
    expect(onNotInTrash).not.toHaveBeenCalled()
    expect(isDisabled(confirmButton())).toBe(false)
    await press(confirmButton())
    expect(purgeFn).toHaveBeenCalledTimes(2)
    expect(onPurged).toHaveBeenCalledTimes(1)
    expect(alertText()).toBe('')
  })

  it('English failure sentence', async () => {
    purgeFn.mockResolvedValueOnce({ ok: false, error: 'server_error' })
    await open({ id: 't-1', title: 'Plan.docx' }, 'en')
    await press(confirmButton())
    expect(alertText()).toBe('Could not delete. Nothing changed.')
  })

  it('folder_too_large says the folder holds too many items', async () => {
    purgeFn.mockResolvedValueOnce({ ok: false, error: 'folder_too_large' })
    await open({ id: 't-2', title: 'Hồ sơ', kind: 'folder' })
    await press(confirmButton())
    expect(alertText()).toBe(
      'Thư mục có quá nhiều mục nên chưa xóa hết được một lần. Hãy xóa từng phần bên trong trước.',
    )
  })

  it('forbidden names the permission, not the generic failure', async () => {
    purgeFn.mockResolvedValueOnce({ ok: false, error: 'forbidden' })
    await open()
    await press(confirmButton())
    expect(alertText()).toBeTruthy()
    expect(alertText()).not.toBe('Không xóa được. Chưa có gì thay đổi.')
  })

  it('a call that rejects is a failure line, never an unhandled error', async () => {
    purgeFn.mockRejectedValueOnce(new Error('boom'))
    await open()
    await press(confirmButton())
    expect(alertText()).toBe('Không xóa được. Chưa có gì thay đổi.')
    expect(isDisabled(confirmButton())).toBe(false)
  })

  it('document_not_in_trash shows no error line: the host refreshes the list and closes', async () => {
    purgeFn.mockResolvedValueOnce({ ok: false, error: 'document_not_in_trash' })
    await open()
    await press(confirmButton())
    expect(onNotInTrash).toHaveBeenCalledTimes(1)
    expect(onPurged).not.toHaveBeenCalled()
    expect(alertText()).toBe('')
  })

  it('a stale preload without the call is a failure line, not a crash', async () => {
    ;(window as unknown as { aiOffice: unknown }).aiOffice = {}
    await open()
    await press(confirmButton())
    expect(alertText()).toBeTruthy()
    expect(onPurged).not.toHaveBeenCalled()
  })
})
