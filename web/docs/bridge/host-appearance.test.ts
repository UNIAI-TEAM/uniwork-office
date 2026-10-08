// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import browser from './browser'
import { bindHostAppearance } from './host-appearance'
import { createMockPort } from './testing/mock-port'

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  vi.useRealTimers()
})

const dataTheme = () => document.documentElement.getAttribute('data-theme')

describe('host-authoritative theme + language', () => {
  it('applies init theme/locale, then the host events, live', async () => {
    const mock = createMockPort()
    const themes: string[] = []
    const langs: string[] = []
    browser.onThemeChanged((t) => themes.push(t))
    browser.onLanguageChanged((l) => langs.push(l))
    bindHostAppearance(mock.port)
    mock.init({ theme: 'dark', locale: 'vi-VN' })

    // boot waits for the host's init
    expect(await browser.getTheme()).toBe('dark')
    expect(await browser.getLanguage()).toBe('vi')
    expect(dataTheme()).toBe('dark')

    mock.sendTheme('light')
    expect(dataTheme()).toBe('light')
    expect(await browser.getTheme()).toBe('light')
    mock.sendLanguage('en')
    expect(await browser.getLanguage()).toBe('en')
    expect(themes.at(-1)).toBe('light')
    expect(langs.at(-1)).toBe('en')
  })

  it("wins over localStorage and never writes to it (the storage is the UniWork page's)", async () => {
    localStorage.setItem('genoffice.web.theme', 'light')
    localStorage.setItem('genoffice.web.lang', 'ja')
    const mock = createMockPort()
    bindHostAppearance(mock.port)
    mock.init({ theme: 'dark', locale: 'vi' })
    expect(await browser.getTheme()).toBe('dark')
    expect(await browser.getLanguage()).toBe('vi')
    mock.sendTheme('light')
    mock.sendLanguage('de')
    expect(localStorage.getItem('genoffice.web.theme')).toBe('light') // untouched seed value
    expect(localStorage.getItem('genoffice.web.lang')).toBe('ja')
    expect(await browser.getLanguage()).toBe('de')
  })

  it('does not hang boot when the host never sends init', async () => {
    vi.useFakeTimers()
    const mock = createMockPort()
    bindHostAppearance(mock.port)
    const theme = browser.getTheme()
    await vi.advanceTimersByTimeAsync(3_100)
    expect(await theme).toBeDefined()
  })

  it('an unknown host locale falls back to en instead of throwing', async () => {
    const mock = createMockPort()
    bindHostAppearance(mock.port)
    mock.init({ theme: 'light', locale: 'xx-YY' })
    expect(await browser.getLanguage()).toBe('en')
  })
})
