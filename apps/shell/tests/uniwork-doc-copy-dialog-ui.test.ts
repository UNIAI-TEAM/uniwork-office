/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { DocCopyDialog } from '../src/renderer/src/uniwork-home/DocCopyDialog'
import {
  resetDocCopyAvailability,
  useDocCopy,
  type DocCopyHandle,
} from '../src/renderer/src/uniwork-home/use-doc-copy'

/**
 * UNI-2078 slice 1: the copy dialog (web document-copy-dialog.tsx behaviour). An optional
 * title, a REQUIRED consent checkbox that gates the submit, a busy state that sends once,
 * the error line per refusal inside the dialog, and "unavailable" (which also hides the
 * row action for the rest of the session).
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

const DOC = { id: 'doc-1', title: 'Kế hoạch.docx' }

type CopyInput = { documentId: string; title?: string; idempotencyKey?: string }
type CopyResult =
  | { ok: true; value: { id: string; title: string } }
  | { ok: false; error: string; endpointMissing?: boolean }

let host: HTMLDivElement
let root: Root
let copyFn: ReturnType<typeof vi.fn<(input: CopyInput) => Promise<CopyResult>>>

beforeEach(() => {
  localStorage.setItem('genoffice.lang', 'vi')
  resetDocCopyAvailability()
  copyFn = vi.fn(async () => ({
    ok: true,
    value: { id: 'copy-1', title: 'Kế hoạch (bản sao).docx' },
  }))
  ;(window as unknown as { aiOffice: unknown }).aiOffice = { uniworkCopyDocument: copyFn }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  delete (window as unknown as { aiOffice?: unknown }).aiOffice
})

const onCopied = vi.fn()
const onUnavailable = vi.fn()
const onCancel = vi.fn()

async function open(lang: 'vi' | 'en' = 'vi') {
  onCopied.mockReset()
  onUnavailable.mockReset()
  onCancel.mockReset()
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: lang },
        createElement(DocCopyDialog, { doc: DOC, onCopied, onUnavailable, onCancel }),
      ),
    )
  })
}

const q = <T extends Element>(selector: string) => host.ownerDocument.querySelector<T>(selector)
const input = () => q<HTMLInputElement>('input[type="text"]')!
const consent = () => q<HTMLInputElement>('input[type="checkbox"]')!
const submit = () => q<HTMLButtonElement>('button.btn-primary')!
const cancelButton = () => q<HTMLButtonElement>('button.btn-secondary')!
const alertText = () => q('[role="alert"]')?.textContent ?? ''
const isDisabled = (el: HTMLElement) =>
  (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true'

async function check(on = true) {
  if (consent().checked !== on) {
    await act(async () => consent().click())
  }
}
async function type(value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input(), value)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function press(el: HTMLElement) {
  await act(async () => el.click())
  await flush()
}

describe('DocCopyDialog: opening', () => {
  it('is a labelled dialog with the web title and description (vi)', async () => {
    await open('vi')
    const dialog = q('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const label = dialog.getAttribute('aria-labelledby')!
    expect(document.getElementById(label)!.textContent).toBe('Tạo bản sao')
    expect(dialog.textContent).toContain(
      'Bản sao là tài liệu mới, giữ nguyên quyền và nguồn gốc của tài liệu này',
    )
  })

  it('speaks English too', async () => {
    await open('en')
    expect(q('[role="dialog"]')!.textContent).toContain('Create a copy')
    expect(submit().textContent).toBe('Create copy')
  })

  it('focuses the title input on open', async () => {
    await open()
    expect(document.activeElement).toBe(input())
  })

  it('title input: optional, maxLength 500, placeholder "<title> (bản sao)"', async () => {
    await open('vi')
    expect(input().maxLength).toBe(500)
    expect(input().required).toBe(false)
    expect(input().value).toBe('')
    expect(input().placeholder).toBe('Kế hoạch.docx (bản sao)')
  })

  it('English placeholder is "<title> (copy)"', async () => {
    await open('en')
    expect(input().placeholder).toBe('Kế hoạch.docx (copy)')
  })

  it('has the consent checkbox unchecked, with its label and hint', async () => {
    await open('vi')
    expect(consent().checked).toBe(false)
    expect(host.ownerDocument.body.textContent).toContain(
      'Tôi hiểu bản sao giữ nguyên quyền của nguồn',
    )
    expect(host.ownerDocument.body.textContent).toContain(
      'Bản sao không mở rộng quyền cho ai và không sửa tài liệu gốc.',
    )
  })

  it('the checkbox is named by the label alone; the hint is its description (as the web)', async () => {
    await open('vi')
    const byId = (attr: string) =>
      host.ownerDocument.getElementById(consent().getAttribute(attr) ?? '')?.textContent
    expect(byId('aria-labelledby')).toBe('Tôi hiểu bản sao giữ nguyên quyền của nguồn')
    expect(byId('aria-describedby')).toBe(
      'Bản sao không mở rộng quyền cho ai và không sửa tài liệu gốc.',
    )
  })

  it('Cancel and Escape close without calling the bridge', async () => {
    await open()
    await press(cancelButton())
    expect(onCancel).toHaveBeenCalledTimes(1)
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledTimes(2)
    expect(copyFn).not.toHaveBeenCalled()
  })
})

describe('DocCopyDialog: the consent gate', () => {
  it('the submit is disabled until the checkbox is checked, and a click sends nothing', async () => {
    await open()
    expect(isDisabled(submit())).toBe(true)
    await press(submit())
    expect(copyFn).not.toHaveBeenCalled()
    await check()
    expect(isDisabled(submit())).toBe(false)
  })

  it('unchecking disables it again', async () => {
    await open()
    await check()
    await check(false)
    expect(isDisabled(submit())).toBe(true)
    await press(submit())
    expect(copyFn).not.toHaveBeenCalled()
  })

  it('Enter in the title input does not submit while consent is missing', async () => {
    await open()
    await type('Bản mới')
    await act(async () => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await flush()
    expect(copyFn).not.toHaveBeenCalled()
  })
})

describe('DocCopyDialog: a successful copy', () => {
  it('sends the document id, the trimmed title and a key; then reports the copy', async () => {
    await open()
    await type('  Bản mới  ')
    await check()
    await press(submit())
    expect(copyFn).toHaveBeenCalledTimes(1)
    const sent = copyFn.mock.calls[0]![0]
    expect(sent.documentId).toBe('doc-1')
    expect(sent.title).toBe('Bản mới')
    expect(sent.idempotencyKey).toMatch(/^[A-Za-z0-9._:-]{8,128}$/)
    expect(onCopied).toHaveBeenCalledWith('Kế hoạch (bản sao).docx')
  })

  it('a blank title is sent as absent (the server names the copy)', async () => {
    await open()
    await type('   ')
    await check()
    await press(submit())
    expect(copyFn.mock.calls[0]![0].title).toBeUndefined()
    expect('title' in copyFn.mock.calls[0]![0]).toBe(false)
  })

  it('never sends a parent, consent or workspace field of its own', async () => {
    await open()
    await check()
    await press(submit())
    expect(Object.keys(copyFn.mock.calls[0]![0]).sort()).toEqual(['documentId', 'idempotencyKey'])
  })
})

describe('DocCopyDialog: busy state', () => {
  it('a double click sends once, the controls lock and the label says it is working', async () => {
    let finish: (r: CopyResult) => void = () => undefined
    copyFn.mockImplementation(() => new Promise<CopyResult>((resolve) => (finish = resolve)))
    await open()
    await check()
    await act(async () => {
      submit().click()
      submit().click()
    })
    expect(copyFn).toHaveBeenCalledTimes(1)
    expect(submit().getAttribute('aria-busy')).toBe('true')
    expect(isDisabled(submit())).toBe(true)
    expect(input().disabled).toBe(true)
    expect(consent().disabled).toBe(true)
    expect(submit().textContent).toContain('Đang tạo bản sao')
    await act(async () => {
      finish({ ok: true, value: { id: 'c', title: 'x' } })
    })
    await flush()
    expect(onCopied).toHaveBeenCalledTimes(1)
  })

  it('Cancel and Escape do not close the dialog while the copy is in flight', async () => {
    let finish: (r: CopyResult) => void = () => undefined
    copyFn.mockImplementation(() => new Promise<CopyResult>((resolve) => (finish = resolve)))
    await open()
    await check()
    await act(async () => submit().click())
    await press(cancelButton())
    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    expect(onCancel).not.toHaveBeenCalled()
    await act(async () => {
      finish({ ok: true, value: { id: 'c', title: 'x' } })
    })
    await flush()
  })
})

describe('DocCopyDialog: error lines stay inside the dialog', () => {
  async function failWith(error: string, extra: Record<string, unknown> = {}) {
    copyFn.mockResolvedValueOnce({ ok: false, error, ...extra })
    await open()
    await check()
    await press(submit())
  }

  it.each([
    ['owner_requires_copy', 'Tài liệu thuộc Kết quả công việc: bản sao đi qua màn hình sở hữu.'],
    [
      'page_copy_not_supported',
      'Chỉ tài liệu tệp có bản sao ở bước này. UniNote sao chép ở giai đoạn sau.',
    ],
    ['copy_consent_required', 'Cần xác nhận rõ trước khi tạo bản sao.'],
  ])('%s -> its own sentence, dialog stays open', async (code, text) => {
    await failWith(code)
    expect(alertText()).toBe(text)
    expect(q('[role="dialog"]')).not.toBeNull()
    expect(onCopied).not.toHaveBeenCalled()
    expect(onUnavailable).not.toHaveBeenCalled()
  })

  it('any other refusal says the copy failed and nothing changed', async () => {
    await failWith('server_error')
    expect(alertText()).toBe('Không tạo được bản sao. Chưa có gì thay đổi.')
  })

  it('a refused title name says it is too long', async () => {
    await failWith('name_too_long')
    expect(alertText()).toContain('500')
  })

  it('a known app code (forbidden) is told with its own sentence', async () => {
    await failWith('forbidden')
    expect(alertText()).not.toBe('')
    expect(alertText()).not.toBe('Không tạo được bản sao. Chưa có gì thay đổi.')
  })

  it('a rejected bridge call is a failure line, not an unhandled rejection', async () => {
    copyFn.mockRejectedValueOnce(new Error('ipc'))
    await open()
    await check()
    await press(submit())
    expect(alertText().length).toBeGreaterThan(0)
    expect(isDisabled(submit())).toBe(false)
  })

  it('the controls unlock after a failure so the person can retry', async () => {
    await failWith('server_error')
    expect(isDisabled(submit())).toBe(false)
    expect(input().disabled).toBe(false)
    expect(consent().disabled).toBe(false)
    await press(submit())
    expect(copyFn).toHaveBeenCalledTimes(2)
    expect(onCopied).toHaveBeenCalledTimes(1)
  })

  it('the error line clears when the next attempt starts', async () => {
    await failWith('server_error')
    expect(alertText()).not.toBe('')
    await press(submit())
    expect(alertText()).toBe('')
  })
})

describe('DocCopyDialog: unavailable', () => {
  it('endpointMissing shows the unavailable sentence and tells the host', async () => {
    copyFn.mockResolvedValueOnce({ ok: false, error: 'not_found', endpointMissing: true })
    await open()
    await check()
    await press(submit())
    expect(alertText()).toBe('Bản triển khai này chưa có chức năng tạo bản sao.')
    expect(onUnavailable).toHaveBeenCalledTimes(1)
    expect(onCopied).not.toHaveBeenCalled()
  })

  it('English unavailable text', async () => {
    copyFn.mockResolvedValueOnce({ ok: false, error: 'not_found', endpointMissing: true })
    await open('en')
    await check()
    await press(submit())
    expect(alertText()).toBe('This deployment does not have the copy feature yet.')
  })

  it('a plain not_found (the document is gone) is NOT unavailable', async () => {
    copyFn.mockResolvedValueOnce({ ok: false, error: 'not_found' })
    await open()
    await check()
    await press(submit())
    expect(onUnavailable).not.toHaveBeenCalled()
    expect(alertText()).not.toBe('Bản triển khai này chưa có chức năng tạo bản sao.')
  })

  it('a shell with no copy bridge answers unavailable too (a stale preload)', async () => {
    ;(window as unknown as { aiOffice: unknown }).aiOffice = {}
    await open()
    await check()
    await press(submit())
    expect(alertText()).toBe('Bản triển khai này chưa có chức năng tạo bản sao.')
    expect(onUnavailable).toHaveBeenCalledTimes(1)
  })
})

describe('DocCopyDialog: the Idempotency-Key of one open', () => {
  it('a retry of the same open sends the same key', async () => {
    copyFn.mockResolvedValueOnce({ ok: false, error: 'network' })
    await open()
    await check()
    await press(submit())
    await press(submit())
    const [a, b] = copyFn.mock.calls.map((c) => c[0].idempotencyKey)
    expect(a).toBeTruthy()
    expect(a).toBe(b)
  })

  it('a changed title after a failure is a different request, so it gets a new key', async () => {
    copyFn.mockResolvedValueOnce({ ok: false, error: 'network' })
    await open()
    await check()
    await press(submit())
    await type('Tên khác')
    await press(submit())
    const [a, b] = copyFn.mock.calls.map((c) => c[0].idempotencyKey)
    expect(a).not.toBe(b)
  })

  it('a new open of the dialog gets a new key', async () => {
    await open()
    await check()
    await press(submit())
    await act(async () => root.render(null))
    await open()
    await check()
    await press(submit())
    const [a, b] = copyFn.mock.calls.map((c) => c[0].idempotencyKey)
    expect(a).not.toBe(b)
  })
})

describe('useDocCopy: the host hook', () => {
  let handle: DocCopyHandle
  const done = vi.fn()

  function Probe() {
    handle = useDocCopy({ onCopied: done })
    return handle.dialog
  }
  async function mountHook() {
    done.mockReset()
    await act(async () => {
      root.render(createElement(LocaleProvider, { initial: 'vi' }, createElement(Probe)))
    })
  }

  it('is available by default when the shell has the bridge', async () => {
    await mountHook()
    expect(handle.available).toBe(true)
    expect(handle.dialog).toBeNull()
  })

  it('is not available when the shell has no copy bridge', async () => {
    ;(window as unknown as { aiOffice: unknown }).aiOffice = {}
    await mountHook()
    expect(handle.available).toBe(false)
  })

  it('open(doc) mounts the dialog; Cancel unmounts it', async () => {
    await mountHook()
    await act(async () => handle.open(DOC))
    expect(q('[role="dialog"]')).not.toBeNull()
    await press(cancelButton())
    expect(q('[role="dialog"]')).toBeNull()
  })

  it('success closes the dialog and hands the new title to the host', async () => {
    await mountHook()
    await act(async () => handle.open(DOC))
    await check()
    await press(submit())
    expect(done).toHaveBeenCalledWith('Kế hoạch (bản sao).docx')
    expect(q('[role="dialog"]')).toBeNull()
  })

  it('endpointMissing hides the action for the rest of the session, even after a remount', async () => {
    copyFn.mockResolvedValueOnce({ ok: false, error: 'not_found', endpointMissing: true })
    await mountHook()
    await act(async () => handle.open(DOC))
    await check()
    await press(submit())
    expect(handle.available).toBe(false)
    // the dialog still shows its sentence until closed; then the entry is gone
    await act(async () => root.render(null))
    await mountHook()
    expect(handle.available).toBe(false)
  })

  it('open() is a no-op while the action is unavailable', async () => {
    copyFn.mockResolvedValueOnce({ ok: false, error: 'not_found', endpointMissing: true })
    await mountHook()
    await act(async () => handle.open(DOC))
    await check()
    await press(submit())
    await press(cancelButton())
    await act(async () => handle.open(DOC))
    expect(q('[role="dialog"]')).toBeNull()
  })
})
