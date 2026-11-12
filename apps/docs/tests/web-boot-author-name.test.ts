// @vitest-environment jsdom
/**
 * FE-W1-04 regression test: booting the Docs renderer against a web-frame
 * `safeApi`-wrapped `window.desktop` that omits `getAuthorName` /
 * `setAuthorName` / `onAuthorNameChanged` (where missing methods resolve to
 * `undefined`) must not throw a `TypeError` in `setAuthorName` or `main.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { safeApi } from '../../../web/docs/bridge/safe-api'
import { authorName, setAuthorName } from '../src/renderer/author-name'
import { t } from '../src/renderer/i18n/locale'

const rootRender = vi.fn()

vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({ render: rootRender })),
}))

vi.mock('../src/renderer/App', () => ({
  App: () => null,
}))

vi.mock('@genoffice/ui', () => ({
  applyAiPanelPrefs: vi.fn(),
  installScreenTips: vi.fn(),
}))

vi.mock('@genoffice/ai-provider/browser', () => ({
  mirrorUniworkAiFlag: vi.fn(),
}))

describe('web frame boot smoke without getAuthorName / setAuthorName (FE-W1-04)', () => {
  beforeEach(() => {
    vi.resetModules()
    rootRender.mockClear()
    setAuthorName('')
    document.body.innerHTML = '<div id="root"></div>'
  })

  afterEach(() => {
    setAuthorName('')
    document.body.innerHTML = ''
  })

  it('setAuthorName tolerates undefined and null from safeApi without throwing TypeError', () => {
    expect(() => setAuthorName(undefined)).not.toThrow()
    expect(() => setAuthorName(null)).not.toThrow()
    expect(authorName()).toBe(t('editorDefaultAuthor'))
  })

  it('boots main.tsx cleanly when window.desktop is a safeApi proxy lacking getAuthorName/setAuthorName', async () => {
    // Wrap an empty object in safeApi so getLanguage, getTheme, getDocumentTheme,
    // getAiPanelPrefs, and getAuthorName all resolve to `undefined`.
    const desktop = safeApi<{ getAuthorName?: () => Promise<string | undefined> }>({})
    Object.defineProperty(window, 'desktop', {
      configurable: true,
      writable: true,
      value: desktop,
    })

    const resolved = await desktop.getAuthorName?.()
    expect(resolved).toBeUndefined()
    expect(() => setAuthorName(resolved)).not.toThrow()

    // Dynamic import required: main.tsx runs `void bootstrap()` at module evaluation time
    // after `window.desktop` and `#root` are installed in the test DOM.
    await import('../src/renderer/main')
    // Flush microtasks for bootstrap() Promise chain
    for (let i = 0; i < 6; i++) await Promise.resolve()

    expect(rootRender).toHaveBeenCalledTimes(1)
    expect(authorName()).toBe(t('editorDefaultAuthor'))
  })
})
