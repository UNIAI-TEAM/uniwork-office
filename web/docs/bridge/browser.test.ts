// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import browser, { setWebLanguage, setWebTheme } from './browser'

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
  it('calls window.print with a zero-margin page sheet', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(document.getElementById('web-bridge-print-page')?.textContent).toContain('margin: 0')
      window.dispatchEvent(new Event('afterprint'))
    })
    expect(await browser.print(0.9)).toEqual({ ok: true })
    expect(print).toHaveBeenCalledOnce()
    expect(document.getElementById('web-bridge-print-page')).toBeNull()
  })
})
