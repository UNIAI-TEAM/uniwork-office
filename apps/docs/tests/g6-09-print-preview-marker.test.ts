// G6-09 N-2: the Print dialog preview reuses the screen CSS (it clones a .pv-page of the pagination
// preview into the dialog), so the screen-only AI change marker painted on the preview sheet.
// The marker is never document data: the dialog's copy drops it; the printed bytes stay clean.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PrintDialog } from '../src/renderer/components/PrintDialog'
import { LocaleProvider, setModuleLang } from '../src/renderer/i18n/locale'

setModuleLang('en')

let root: Root
let container: HTMLElement

beforeEach(() => {
  Object.assign(window, { desktop: { onLanguageChanged: () => () => undefined } })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  Object.assign(window, { desktop: undefined })
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('print dialog preview and the AI change marker', () => {
  it('the previewed sheet carries no ai-changed block, the source pagination page is untouched', async () => {
    const preview = document.createElement('div')
    preview.className = 'pagination-preview'
    const page = document.createElement('div')
    page.className = 'pv-page'
    page.innerHTML =
      '<div class="doc-page"><p class="ai-changed">edited</p><p>plain</p><p class="x ai-changed">again</p></div>'
    preview.appendChild(page)
    document.body.appendChild(preview)

    vi.useFakeTimers()
    act(() =>
      root.render(
        createElement(LocaleProvider, {
          initial: 'en',
          children: createElement(PrintDialog, {
            onClose: vi.fn(),
            setStatus: vi.fn(),
            onSavePdf: vi.fn(async () => true),
          }),
        }),
      ),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    vi.useRealTimers()

    const zoom = document.querySelector('.print-preview-zoom')!
    expect(zoom.querySelector('.pv-page')).not.toBeNull()
    expect(zoom.textContent).toContain('edited')
    expect(zoom.querySelectorAll('.ai-changed').length).toBe(0)
    // the non-marker class of a marked block survives
    expect(zoom.querySelectorAll('.x').length).toBe(1)
    // the live pagination preview keeps its blocks as they were (print media never paints them)
    expect(page.querySelectorAll('.ai-changed').length).toBe(2)
  })
})
