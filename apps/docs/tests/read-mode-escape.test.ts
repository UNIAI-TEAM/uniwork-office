// UNI-1876 RFW2-2: Read Mode's Esc listener runs in the window capture phase (so the web frame's
// Escape forwarder sees `defaultPrevented`). It must not also fire for an Esc a dialog owns:
// Esc in the Print dialog closes only the dialog, Read Mode stays on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { installReadModeEscape } from '../src/renderer/read-mode-escape'
import { PrintDialog } from '../src/renderer/components/PrintDialog'
import { LocaleProvider } from '../src/renderer/i18n/locale'

let container: HTMLElement
let root: Root
let uninstall: () => void

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(window as unknown as Record<string, unknown>).desktop = { onLanguageChanged: () => () => {} }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  uninstall?.()
  act(() => root.unmount())
  container.remove()
  delete (window as unknown as Record<string, unknown>).desktop
})

const escape = () =>
  new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })

describe('Read Mode Esc', () => {
  it('leaves Read Mode and claims the key for the forwarder when nothing local owns Esc', () => {
    const leave = vi.fn()
    uninstall = installReadModeEscape(leave)
    const event = escape()
    act(() => {
      window.dispatchEvent(event)
    })
    expect(leave).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('Esc in the Print dialog closes only the dialog: Read Mode stays on', () => {
    const leave = vi.fn()
    const closeDialog = vi.fn()
    // registered first, like the App's Read Mode effect (the dialog mounts later)
    uninstall = installReadModeEscape(leave)
    act(() =>
      root.render(
        createElement(LocaleProvider, {
          initial: 'en',
          children: createElement(PrintDialog, {
            onClose: closeDialog,
            setStatus: () => {},
            onSavePdf: async () => false,
          }),
        }),
      ),
    )
    expect(container.querySelector('.modal-backdrop')).not.toBeNull()
    act(() => {
      window.dispatchEvent(escape())
    })
    expect(closeDialog).toHaveBeenCalledTimes(1)
    expect(leave).not.toHaveBeenCalled()
  })

  it('Esc inside a [data-esc-local] surface (comments composer) is left to that surface', () => {
    const leave = vi.fn()
    uninstall = installReadModeEscape(leave)
    const local = document.createElement('div')
    local.setAttribute('data-esc-local', '')
    const input = document.createElement('textarea')
    local.appendChild(input)
    container.appendChild(local)
    act(() => {
      input.dispatchEvent(escape())
    })
    expect(leave).not.toHaveBeenCalled()
  })
})
