/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import { DeskTools } from '../src/renderer/src/DeskTools'
import { LocaleProvider } from '../src/renderer/src/locale'
import { WbToastHost, createWbToasts } from '../src/renderer/src/WbToastHost'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let api: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  api = {
    runDeskTool: vi.fn(async () => ({ ok: true, outputs: ['/w/a.docx'] })),
    openPath: vi.fn(async () => undefined),
    revealPath: vi.fn(async () => undefined),
  }
  window.aiOffice = api as unknown as HomeApi
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function render(props: Parameters<typeof DeskTools>[0]) {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(WbToastHost, { toasts: createWbToasts() }, createElement(DeskTools, props)),
      ),
    )
  })
}
const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)
const click = async (label: string) => {
  await act(async () => button(label)!.click())
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}
const typeInto = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const escape = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
}
const noDrop = { dropped: null, onDropHandled: vi.fn(), unsavedPaths: new Set<string>() }

describe('DeskTools', () => {
  it('runs a tool with no inputs (main picks) and offers Open and Show in folder', async () => {
    await render(noDrop)
    await click('PDF → Word')
    expect(api.runDeskTool).toHaveBeenCalledWith({ tool: 'pdf-to-docx' })
    expect(host.textContent).toContain('Created a.docx')
    await click('Open')
    expect(api.openPath).toHaveBeenCalledWith('/w/a.docx')
  })

  it('asks for pages per part before splitting', async () => {
    api.runDeskTool.mockResolvedValueOnce({
      ok: true,
      outputs: ['/o/a-parts/a-1.pdf', '/o/a-parts/a-2.pdf'],
    })
    await render(noDrop)
    await click('Split PDF')
    expect(api.runDeskTool).not.toHaveBeenCalled()
    const input = host.querySelector<HTMLInputElement>('input[type="number"]')!
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      set.call(input, '3')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click('Split')
    expect(api.runDeskTool).toHaveBeenCalledWith({ tool: 'split-pdf', splitEvery: 3 })
    expect(host.textContent).toContain('Created 2 files in a-parts')
  })

  it('shows only the tools that fit dropped files and runs one on them', async () => {
    const onDropHandled = vi.fn()
    await render({ dropped: ['/w/a.pdf', '/w/b.pdf'], onDropHandled, unsavedPaths: new Set() })
    const panel = host.querySelector('.wb-desk-panel')!
    expect(panel.textContent).toContain('Merge PDFs')
    expect(panel.textContent).not.toContain('PDF → Word')
    await act(async () =>
      Array.from(panel.querySelectorAll('button'))
        .find((b) => b.textContent === 'Merge PDFs')!
        .click(),
    )
    expect(api.runDeskTool).toHaveBeenCalledWith({
      tool: 'merge-pdf',
      inputs: ['/w/a.pdf', '/w/b.pdf'],
    })
    expect(onDropHandled).toHaveBeenCalled()
  })

  it('says no tool fits a dropped image, and notes an unsaved file exports as saved', async () => {
    await render({ dropped: ['/w/p.png'], onDropHandled: vi.fn(), unsavedPaths: new Set() })
    expect(host.textContent).toContain('No tool takes this kind of file.')
    await render({
      dropped: ['/w/r.docx'],
      onDropHandled: vi.fn(),
      unsavedPaths: new Set(['/w/r.docx']),
    })
    expect(host.textContent).toContain('Exports the saved version')
  })

  it('turns a refusal into a short message and stays quiet on cancel', async () => {
    api.runDeskTool.mockResolvedValueOnce({ ok: false, error: 'busy' })
    await render(noDrop)
    await click('Merge PDFs')
    expect(host.textContent).toContain('Another tool is still running.')
    api.runDeskTool.mockResolvedValueOnce({ ok: false, canceled: true })
    await click('Export PDF')
    expect(host.querySelector('.wb-toast')).toBeNull()
  })

  it('keeps the typed page count and clamps it only when splitting', async () => {
    await render(noDrop)
    for (const [typed, sent] of [
      ['3', 3],
      ['0', 1],
      ['1000', 999],
    ] as const) {
      await click('Split PDF')
      const input = host.querySelector<HTMLInputElement>('input[type="number"]')!
      await typeInto(input, '')
      expect(input.value).toBe('')
      await typeInto(input, typed)
      await click('Split')
      expect(api.runDeskTool).toHaveBeenLastCalledWith({ tool: 'split-pdf', splitEvery: sent })
    }
  })

  it('focuses the page count, and Escape closes the split prompt back to Split PDF', async () => {
    await render(noDrop)
    await click('Split PDF')
    const input = host.querySelector<HTMLInputElement>('input[type="number"]')!
    expect(document.activeElement).toBe(input)
    await escape(input)
    expect(host.querySelector('input[type="number"]')).toBeNull()
    expect(document.activeElement).toBe(button('Split PDF'))
  })

  it('returns focus to the tool that ran', async () => {
    await render(noDrop)
    await click('Merge PDFs')
    expect(document.activeElement).toBe(button('Merge PDFs'))
  })

  it('Escape on the drop panel cancels it', async () => {
    const onDropHandled = vi.fn()
    await render({ dropped: ['/w/a.pdf'], onDropHandled, unsavedPaths: new Set() })
    await escape(host.querySelector('.wb-desk-panel')!)
    expect(onDropHandled).toHaveBeenCalled()
  })

  it('shows no toast when a tool creates no files', async () => {
    api.runDeskTool.mockResolvedValueOnce({ ok: true, outputs: [] })
    await render(noDrop)
    await click('Merge PDFs')
    expect(host.querySelector('.wb-toast')).toBeNull()
  })
})
