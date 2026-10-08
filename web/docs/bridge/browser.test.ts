// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import browser, {
  downloadBlob,
  downloadBytes,
  guardedOpen,
  openExternal,
  safeFileName,
  setWebLanguage,
  setWebTheme,
} from './browser'

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('theme', () => {
  it('defaults to system and applies data-theme on change', async () => {
    expect(await browser.getTheme()).toBe('system')
    const seen: string[] = []
    const off = browser.onThemeChanged((t) => seen.push(t))
    setWebTheme('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(await browser.getTheme()).toBe('dark')
    setWebTheme('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    off()
    setWebTheme('light')
    expect(seen).toEqual(['dark', 'system'])
  })
})

describe('language', () => {
  it('maps navigator.languages and honors the localStorage override', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['xx-YY', 'ja-JP'])
    expect(await browser.getLanguage()).toBe('ja')
    const seen: string[] = []
    const off = browser.onLanguageChanged((l) => seen.push(l))
    setWebLanguage('pt')
    expect(await browser.getLanguage()).toBe('pt')
    off()
    expect(seen).toEqual(['pt'])
  })
})

describe('attachments', () => {
  it('registers files as web-file ids and reads text back', async () => {
    const file = new File(['hello world'], 'notes.txt', { type: 'text/plain' })
    const path = browser.getPathForFile(file)
    expect(path).toMatch(/^web-file:\/\/\d+\/notes\.txt$/)
    expect(browser.getPathForFile(file)).toBe(path)
    const added = await browser.addAttachmentPaths([path, '/abs/unknown.txt'])
    expect(added.accepted).toEqual([{ path, name: 'notes.txt', ext: 'txt', sizeBytes: 11 }])
    expect(added.rejected).toHaveLength(1)
    const read = await browser.readAttachment(path, 6, 100)
    expect(read).toMatchObject({ ok: true, text: 'world', totalChars: 11, offset: 6 })
  })

  it('rejects non-text extraction and non-image pastes', async () => {
    const pdf = browser.getPathForFile(new File(['%PDF'], 'a.pdf'))
    expect((await browser.readAttachment(pdf, 0, 10)).ok).toBe(false)
    const bad = await browser.addPastedImage(new ArrayBuffer(4), 'exe')
    expect(bad.accepted).toHaveLength(0)
    const ok = await browser.addPastedImage(new Uint8Array([1, 2, 3]).buffer, 'png')
    expect(ok.accepted[0]?.ext).toBe('png')
    const img = await browser.readAttachmentImage(ok.accepted[0]!.path)
    expect(img).toMatchObject({ ok: true, base64: 'AQID', mime: 'image/png' })
  })
})

describe('print', () => {
  const sheet = () => document.getElementById('web-bridge-print-page')

  beforeEach(() => {
    vi.spyOn(window, 'focus').mockImplementation(() => {})
  })

  it('prints this frame with a zero-margin sheet and resolves on afterprint', async () => {
    let during = ''
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      during = sheet()?.textContent ?? ''
      window.dispatchEvent(new Event('afterprint'))
    })
    expect(await browser.print(1)).toEqual({ ok: true })
    expect(print).toHaveBeenCalledOnce()
    expect(during).toContain('@page { margin: 0; }')
    expect(during).toContain('print-color-adjust: exact')
    expect(during).not.toContain('zoom')
    expect(sheet()).toBeNull()
  })

  it('does not settle before afterprint (Firefox/Safari return from print() at once)', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => {})
    let settled = false
    const pending = browser.print().then((r) => {
      settled = true
      return r
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(settled).toBe(false)
    expect(sheet()).not.toBeNull()
    window.dispatchEvent(new Event('afterprint'))
    expect(await pending).toEqual({ ok: true })
    expect(sheet()).toBeNull()
  })

  it('prints in light for both themes and restores the user theme afterwards', async () => {
    for (const theme of ['dark', 'light', 'system'] as const) {
      setWebTheme(theme)
      let during: string | null = 'unset'
      vi.spyOn(window, 'print').mockImplementation(() => {
        during = document.documentElement.getAttribute('data-theme')
        window.dispatchEvent(new Event('afterprint'))
      })
      await browser.print()
      expect(during).toBe('light')
      expect(document.documentElement.getAttribute('data-theme')).toBe(
        theme === 'system' ? null : theme,
      )
    }
  })

  it('neutralises the preview print-zoom when the renderer asks for a non-1 print scale', async () => {
    let during = ''
    vi.spyOn(window, 'print').mockImplementation(() => {
      during = sheet()?.textContent ?? ''
      window.dispatchEvent(new Event('afterprint'))
    })
    await browser.print(0.5)
    expect(during).toContain('.pagination-preview { zoom: 1 !important; }')
  })

  it('reports a failure to start printing without throwing', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => {
      throw new Error('blocked')
    })
    const result = await browser.print()
    expect(result.ok).toBe(false)
    expect(result.error).toContain('blocked')
    expect(sheet()).toBeNull()
  })
})

describe('downloads', () => {
  it('safeFileName strips separators and reserved characters', () => {
    expect(safeFileName('a/b\\c:d*e?.docx')).toBe('a_b_c_d_e_.docx')
    expect(safeFileName('  ')).toBe('document')
    expect(safeFileName('..')).toBe('document')
    expect(safeFileName('报告 v2.docx')).toBe('报告 v2.docx')
  })

  it('downloadBlob clicks a transient <a download> on a blob URL, then revokes it', () => {
    vi.useFakeTimers()
    const create = vi.fn(() => 'blob:mock/1')
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    let seen: { href: string; download: string } | null = null
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      seen = { href: this.href, download: this.download }
    })
    downloadBlob('x/y.docx', new Blob(['hi']))
    expect(click).toHaveBeenCalledOnce()
    expect(seen).toEqual({ href: 'blob:mock/1', download: 'x_y.docx' })
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revoke).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revoke).toHaveBeenCalledWith('blob:mock/1')
    vi.useRealTimers()
  })

  it('downloadBytes wraps the bytes in a typed Blob', () => {
    let blob: Blob | null = null
    Object.assign(URL, {
      createObjectURL: (b: Blob) => ((blob = b), 'blob:mock/2'),
      revokeObjectURL: () => {},
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    downloadBytes('a.pdf', new Uint8Array([1, 2, 3]), 'application/pdf')
    expect(blob!.type).toBe('application/pdf')
    expect(blob!.size).toBe(3)
  })
})

describe('external links', () => {
  it('guardedOpen opens http(s) in a new tab without an opener', () => {
    const native = vi.fn(() => null)
    const open = guardedOpen(native as unknown as typeof window.open)
    open('https://example.com/a?b=1', '_self', 'popup')
    expect(native).toHaveBeenCalledWith(
      'https://example.com/a?b=1',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///etc/passwd',
    'blob:x',
    '/relative',
    '',
    'mailto:a@b.c',
  ])('guardedOpen blocks %j', (url) => {
    const native = vi.fn()
    expect(guardedOpen(native as unknown as typeof window.open)(url)).toBeNull()
    expect(native).not.toHaveBeenCalled()
  })

  it('openExternal reports whether the link was allowed', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    expect(openExternal('https://example.com')).toBe(true)
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
    open.mockClear()
    expect(openExternal('javascript:alert(1)')).toBe(false)
    expect(openExternal(undefined)).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('the renderer window.open is replaced by the guard at load', () => {
    // browser.ts installed it on import; a javascript: URL never reaches the browser
    expect(window.open('javascript:alert(1)')).toBeNull()
  })
})

describe('clipboard', () => {
  it('copyImageToClipboard rejects non-image data and missing clipboard support', async () => {
    expect(await browser.copyImageToClipboard('https://x/y.png')).toBe(false)
    expect(await browser.copyImageToClipboard('data:image/png;base64,AAAA')).toBe(false)
  })

  it('writes image/png + text/html carrying the display size', async () => {
    const write = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { write } })
    class FakeClipboardItem {
      constructor(public items: Record<string, Blob>) {}
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    // 1x1 PNG
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    const ok = await browser.copyImageToClipboard(png, JSON.stringify({ imageWidthPx: 40.4 }))
    expect(ok).toBe(true)
    const item = (write.mock.calls[0] as unknown as [FakeClipboardItem[]])[0][0]!
    expect(Object.keys(item.items).sort()).toEqual(['image/png', 'text/html'])
    expect(await item.items['text/html']!.text()).toContain('width="40"')
    vi.unstubAllGlobals()
  })
})
