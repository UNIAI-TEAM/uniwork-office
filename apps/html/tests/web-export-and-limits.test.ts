/**
 * UNI-1232 A5 (Export HTML entry on the web), A6 (style edits not committed yet reach the draft
 * copy) and B (one note for fetch/XHR and nested frames in the web preview).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { Ribbon } from '../src/renderer/components/Ribbon'
import { PreviewLimitNote } from '../src/renderer/preview/PreviewLimitNote'
import { usesBlockedPreviewFeatures } from '../src/renderer/preview/preview-limits'
import { textWithPendingStyles } from '../src/renderer/document/pending-draft'
import { buildParseMap } from '../src/renderer/document/parse-map'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { resetForTest } from '../src/renderer/capabilities'
import { appStrings } from '../src/renderer/i18n/strings-app'

vi.mock('../src/renderer/ai/AiPanel', () => ({ GensparkMark: () => null }))

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
  resetForTest()
})

/** the preload members the locale provider and the capability reader touch */
function stubApi(extra: Record<string, unknown> = {}) {
  ;(window as unknown as { htmlApi: unknown }).htmlApi = {
    onLanguageChanged: () => () => {},
    ...extra,
  }
  resetForTest()
}

function mount(node: ReturnType<typeof createElement>) {
  stubApi((window as unknown as { htmlApi?: Record<string, unknown> }).htmlApi)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(createElement(LocaleProvider, { initial: 'en' }, node)))
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return container
}

function ribbon(extra: Record<string, unknown>) {
  const noop = vi.fn()
  return mount(
    createElement(Ribbon, {
      disabled: false,
      dirty: false,
      onSave: noop,
      onSaveAs: noop,
      onFind: noop,
      autoSave: false,
      onToggleAutoSave: noop,
      aiOpen: false,
      onToggleAi: noop,
      onAiPreset: noop,
      canUndo: false,
      canRedo: false,
      onUndo: noop,
      onRedo: noop,
      view: 'preview',
      onView: noop,
      canInsert: true,
      onInsert: noop,
      canvasMode: 'edit',
      onPresent: noop,
      ...extra,
    } as never),
  )
}

describe('Export HTML ribbon entry', () => {
  it('is absent without onExport (desktop: the shell menu owns it)', () => {
    expect(ribbon({}).querySelector('.qa-export')).toBeNull()
  })

  it('exports on click, also from a view-only copy (the whole ribbon is disabled there)', () => {
    const onExport = vi.fn()
    const box = ribbon({ onExport, exportDisabled: false, disabled: true })
    const button = box.querySelector<HTMLButtonElement>('.qa-export')!
    expect(button.textContent).toBe('Export HTML')
    expect(button.disabled).toBe(false)
    act(() => button.click())
    expect(onExport).toHaveBeenCalledTimes(1)
  })

  it('is off while the document is not ready', () => {
    const box = ribbon({ onExport: vi.fn(), exportDisabled: true })
    expect(box.querySelector<HTMLButtonElement>('.qa-export')!.disabled).toBe(true)
  })

  it('has a label in every locale, taken from the shell menu wording', () => {
    const dicts = appStrings as unknown as Record<string, Record<string, string>>
    for (const [lang, dict] of Object.entries(dicts)) {
      expect(dict.exportHtmlEntry, lang).toBeTruthy()
      expect(dict.exportHtmlEntry, lang).not.toMatch(/…$/)
    }
  })
})

describe('style edits not committed yet reach the draft copy', () => {
  const PAGE =
    '<!doctype html><html><body><h1>Title</h1><p style="color: red">Body</p></body></html>'

  function sidOf(tag: string): number {
    const map = buildParseMap(PAGE, 1)
    return map.elements.find((e) => e.tag === tag)!.sid
  }

  it('applies the pending set_style to the copy without touching the committed text', () => {
    const map = buildParseMap(PAGE, 1)
    const out = textWithPendingStyles(PAGE, map, sidOf('h1'), {
      color: 'blue',
      'font-size': '32px',
    })
    expect(out).toContain('<h1 style="color: blue; font-size: 32px">Title</h1>')
    // the committed buffer is exactly what it was
    expect(PAGE).toContain('<h1>Title</h1>')
  })

  it('a null value removes the declaration', () => {
    const map = buildParseMap(PAGE, 1)
    const out = textWithPendingStyles(PAGE, map, sidOf('p'), { color: null })
    expect(out).not.toContain('color')
    expect(out).toContain('<p')
  })

  it('nothing pending, no selection or a vanished element leaves the committed text', () => {
    const map = buildParseMap(PAGE, 1)
    expect(textWithPendingStyles(PAGE, map, sidOf('h1'), {})).toBe(PAGE)
    expect(textWithPendingStyles(PAGE, map, null, { color: 'blue' })).toBe(PAGE)
    expect(textWithPendingStyles(PAGE, map, 9999, { color: 'blue' })).toBe(PAGE)
  })
})

describe('web preview limits note', () => {
  it.each([
    ['fetch call', '<script>fetch("/api/x").then(r => r.json())</script>', true],
    ['XHR', '<script>var x = new XMLHttpRequest()</script>', true],
    ['iframe', '<iframe src="https://example.com/embed"></iframe>', true],
    ['frameset', '<frameset cols="50%,50%"></frameset>', true],
    ['a plain page', '<h1>Hello</h1><script>document.title = "x"</script>', false],
    ['a word that merely contains fetch', '<p>prefetching is nice</p>', false],
  ])('%s', (_name, html, blocked) => {
    expect(usesBlockedPreviewFeatures(html)).toBe(blocked)
  })

  it('says why, in the UI language, with the use-the-app sentence and no action without the grant', () => {
    stubApi({ capabilities: { desktopOpen: false } })
    const box = mount(createElement(PreviewLimitNote))
    const note = box.querySelector('[role="note"]')!
    expect(note.textContent).toContain(appStrings.en.previewLimitNote)
    expect(note.textContent).toContain('Open in the UniWork Office app to use this feature')
    expect(box.querySelector('button')).toBeNull()
  })

  it('offers Open in app when the host grants desktopOpen, and sends one app.open request', () => {
    const openInDesktopApp = vi.fn(async () => 'launched' as const)
    stubApi({ capabilities: { desktopOpen: true }, openInDesktopApp })
    const box = mount(createElement(PreviewLimitNote))
    const button = box.querySelector('button')!
    expect(button.textContent).toBe('Open in app')
    act(() => button.click())
    expect(openInDesktopApp).toHaveBeenCalledTimes(1)
    expect(openInDesktopApp).toHaveBeenCalledWith('html.preview')
  })

  it('every locale has the three strings; the vi text is the agreed sentence', () => {
    const dicts = appStrings as unknown as Record<string, Record<string, string>>
    for (const [lang, dict] of Object.entries(dicts)) {
      for (const key of ['previewLimitNote', 'useInAppMessage', 'openInApp']) {
        expect(dict[key], `${lang}.${key}`).toBeTruthy()
        expect(dict[key], `${lang}.${key}`).not.toMatch(/GO-\d|UNI-\d|github|git\b/i)
      }
    }
    expect(dicts.vi!.useInAppMessage).toBe('Mở trong ứng dụng UniWork Office để dùng tính năng này')
    expect(dicts.en!.useInAppMessage).toBe('Open in the UniWork Office app to use this feature')
  })
})
