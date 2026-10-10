/**
 * UNI-1232 A5: the web frame has no desktop File menu, so Export Word is a ribbon entry that builds
 * the .docx in the renderer and hands it to the bridge's exportDocx (a browser download). The
 * desktop keeps its menu and shows no entry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/renderer/App'
import { resetForTest } from '../src/renderer/capabilities'
import { LocaleProvider } from '../src/renderer/i18n/locale'

vi.mock('../src/renderer/ai/AiPanel', () => ({
  GensparkMark: () => null,
  AiPanel: () => null,
}))

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const zeroRects = () => [] as unknown as DOMRectList
  Range.prototype.getClientRects ||= zeroRects
  Range.prototype.getBoundingClientRect ||= () => new DOMRect()
  Element.prototype.getClientRects ||= zeroRects
})
const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
  resetForTest()
})

async function mountApp(
  path: string,
  caps: Record<string, unknown> | undefined,
  exportDocx = vi.fn(async () => ({ ok: true, path: 'Notes.docx' })),
) {
  resetForTest()
  const stubs: Record<string, ReturnType<typeof vi.fn>> = {
    consumePending: vi.fn(async () => path),
    readFile: vi.fn(async () => '# Notes\n\nHello world\n'),
    uniworkState: vi.fn(async () => ({ bound: false, readOnly: false })),
    exportDocx,
  }
  const api = new Proxy(stubs, {
    get(target, prop: string) {
      if (prop === 'capabilities') return caps
      if (prop === 'consumeRecovered' || prop === 'provideText') return undefined
      if (prop in target) return target[prop]
      target[prop] = /^on[A-Z]/.test(prop) ? vi.fn(() => () => {}) : vi.fn(async () => undefined)
      return target[prop]
    },
  })
  ;(window as unknown as { markdownApi: unknown }).markdownApi = api
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(LocaleProvider, { initial: 'en' }, createElement(App)))
  })
  for (let i = 0; i < 20; i++) await act(async () => await new Promise((r) => setTimeout(r, 10)))
  cleanups.push(() => {
    act(() => root.unmount())
    container.remove()
  })
  return { container, exportDocx }
}

const entry = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('.qa-export')

describe('Export Word ribbon entry', () => {
  it('desktop (no capability object): no entry, the shell menu owns it', async () => {
    const { container } = await mountApp('/u/notes.md', undefined)
    expect(entry(container)).toBeNull()
  })

  it('web: the entry exports the document as .docx through the bridge', async () => {
    const { container, exportDocx } = await mountApp('/u/notes.md', { platform: 'web' })
    const button = entry(container)!
    expect(button.textContent).toBe('Export Word')
    expect(button.disabled).toBe(false)
    await act(async () => {
      button.click()
      await new Promise((r) => setTimeout(r, 200))
    })
    expect(exportDocx).toHaveBeenCalledTimes(1)
    const request = exportDocx.mock.calls[0]![0] as {
      base64: string
      suggestedName: string
      mode: string
    }
    expect(request.mode).toBe('dialog')
    expect(request.suggestedName).toBe('notes')
    // a .docx is a zip: "PK" in base64
    expect(request.base64.startsWith('UEs')).toBe(true)
  })

  it('web view-only: a reader can still export (it only reads the document)', async () => {
    const { container, exportDocx } = await mountApp('/u/notes.md', {
      platform: 'web',
      save: false,
    })
    const button = entry(container)!
    expect(button.disabled).toBe(false)
    await act(async () => {
      button.click()
      await new Promise((r) => setTimeout(r, 200))
    })
    expect(exportDocx).toHaveBeenCalledTimes(1)
  })

  it('a failed export is announced, not silent', async () => {
    const failing = vi.fn(async () => ({ ok: false, error: 'boom' }))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = await mountApp('/u/notes.md', { platform: 'web' }, failing)
    await act(async () => {
      entry(container)!.click()
      await new Promise((r) => setTimeout(r, 200))
    })
    expect(document.body.textContent).toContain('Export failed')
    err.mockRestore()
  })

  it('a .txt source file has no rendered document to export: the entry is off', async () => {
    const { container } = await mountApp('/u/notes.txt', { platform: 'web' })
    expect(entry(container)!.disabled).toBe(true)
  })
})
