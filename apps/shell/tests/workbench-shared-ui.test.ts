/**
 * @vitest-environment jsdom
 */
import { act, createElement, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { WbConfirm } from '../src/renderer/src/WbConfirm'
import { WbMenu, WbMenuItem, WbMenuLabel } from '../src/renderer/src/WbMenu'
import {
  AUTO_DISMISS_MS,
  WbToastHost,
  createWbToasts,
  type WbToasts,
} from '../src/renderer/src/WbToastHost'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const key = (el: Element, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })

function MenuHarness({ onPick }: { onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const pick = (id: string) => {
    setOpen(false)
    onPick(id)
  }
  return createElement(
    'div',
    { className: 'wb-menu-wrap' },
    createElement('button', { ref, id: 'trigger', onClick: () => setOpen((o) => !o) }, 'Open'),
    createElement(
      WbMenu,
      { open, onClose: () => setOpen(false), anchorRef: ref, label: 'Things' },
      createElement(WbMenuLabel, null, 'Group'),
      createElement(WbMenuItem, { onSelect: () => pick('a') }, 'Alpha'),
      createElement(WbMenuItem, { onSelect: () => pick('b'), disabled: true }, 'Beta'),
      createElement(WbMenuItem, { onSelect: () => pick('c') }, 'Gamma'),
    ),
  )
}

describe('WbMenu', () => {
  const trigger = () => host.querySelector<HTMLButtonElement>('#trigger')!
  const menu = () => host.querySelector<HTMLElement>('[role="menu"]')
  const open = async () => {
    trigger().focus()
    await act(async () => trigger().click())
  }

  it('opens with focus on the first item; arrows, Home and End skip disabled items and wrap', async () => {
    await act(async () => root.render(createElement(MenuHarness, { onPick: vi.fn() })))
    await open()
    expect(menu()?.getAttribute('aria-label')).toBe('Things')
    // the group caption is presentational, never a stop
    expect(host.querySelector('.wb-menu-label-row')?.getAttribute('role')).toBe('presentation')
    expect(document.activeElement?.textContent).toBe('Alpha')
    key(menu()!, 'ArrowDown')
    expect(document.activeElement?.textContent).toBe('Gamma')
    key(menu()!, 'ArrowDown')
    expect(document.activeElement?.textContent).toBe('Alpha')
    key(menu()!, 'ArrowUp')
    expect(document.activeElement?.textContent).toBe('Gamma')
    key(menu()!, 'Home')
    expect(document.activeElement?.textContent).toBe('Alpha')
    key(menu()!, 'End')
    expect(document.activeElement?.textContent).toBe('Gamma')
  })

  it('Escape closes it and gives focus back to the trigger', async () => {
    await act(async () => root.render(createElement(MenuHarness, { onPick: vi.fn() })))
    await open()
    key(document.activeElement!, 'Escape')
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('choosing an item runs it, closes the menu and returns focus', async () => {
    const onPick = vi.fn()
    await act(async () => root.render(createElement(MenuHarness, { onPick })))
    await open()
    await act(async () => (document.activeElement as HTMLButtonElement).click())
    expect(onPick).toHaveBeenCalledWith('a')
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('a click outside closes it; a click on the trigger is left to the trigger', async () => {
    await act(async () => root.render(createElement(MenuHarness, { onPick: vi.fn() })))
    await open()
    await act(async () => {
      trigger().dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(menu()).not.toBeNull()
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(menu()).toBeNull()
  })

  it('opens upwards when there is no room below the trigger', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 700,
      bottom: 732,
      left: 0,
      right: 80,
      width: 80,
      height: 32,
    } as DOMRect)
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200)
    try {
      await act(async () => root.render(createElement(MenuHarness, { onPick: vi.fn() })))
      Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })
      await open()
      expect(menu()?.classList.contains('is-up')).toBe(true)
    } finally {
      rect.mockRestore()
      height.mockRestore()
    }
  })
})

describe('WbConfirm', () => {
  function render(props: Partial<Parameters<typeof WbConfirm>[0]> = {}) {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    act(() =>
      root.render(
        createElement(WbConfirm, {
          title: 'Delete pack “Acme”?',
          body: 'Files move to the default project.',
          confirmLabel: 'Delete',
          cancelLabel: 'Cancel',
          tone: 'danger',
          onConfirm,
          onCancel,
          ...props,
        }),
      ),
    )
    return { onConfirm, onCancel, dialog: host.querySelector<HTMLElement>('.wb-confirm')! }
  }

  it('is a labelled alertdialog with its line, and focus starts on Cancel', () => {
    const { dialog } = render()
    expect(dialog.getAttribute('role')).toBe('alertdialog')
    const title = document.getElementById(dialog.getAttribute('aria-labelledby')!)
    expect(title?.textContent).toBe('Delete pack “Acme”?')
    const body = document.getElementById(dialog.getAttribute('aria-describedby')!)
    expect(body?.textContent).toBe('Files move to the default project.')
    expect(document.activeElement?.textContent).toBe('Cancel')
    expect((document.activeElement as HTMLElement).className).toBe('wb-btn wb-btn-ghost')
  })

  it('Escape cancels; the confirm button calls back', () => {
    const { dialog, onCancel, onConfirm } = render()
    key(dialog, 'Escape')
    expect(onCancel).toHaveBeenCalledTimes(1)
    const confirm = dialog.querySelector<HTMLButtonElement>('.wb-btn-danger')!
    expect(confirm.textContent).toBe('Delete')
    act(() => confirm.click())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('a click outside cancels; a primary tone draws the primary button', () => {
    const { dialog, onCancel } = render({ tone: 'primary', body: undefined })
    expect(dialog.querySelector('.wb-btn-primary')?.textContent).toBe('Delete')
    expect(dialog.hasAttribute('aria-describedby')).toBe(false)
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('gives focus back to the control that opened it', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    render()
    expect(document.activeElement?.textContent).toBe('Cancel')
    act(() => root.render(createElement('div')))
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('the answer disabled the opener: focus goes to returnFocus, else the tabindex=-1 container', () => {
    const pane = document.createElement('section')
    pane.tabIndex = -1
    const opener = document.createElement('button')
    pane.append(opener)
    const list = document.createElement('ul')
    list.tabIndex = -1
    document.body.append(pane, list)
    opener.focus()
    render({ returnFocus: () => list })
    opener.disabled = true
    act(() => root.render(createElement('div')))
    expect(document.activeElement).toBe(list)

    opener.disabled = false
    opener.focus()
    render()
    opener.remove()
    act(() => root.render(createElement('div')))
    // a removed opener has no container left to find: nothing to focus, and no throw
    expect(document.activeElement).not.toBe(opener)

    pane.append(opener)
    opener.focus()
    render()
    opener.disabled = true
    act(() => root.render(createElement('div')))
    expect(document.activeElement).toBe(pane)
    pane.remove()
    list.remove()
  })
})

describe('WbToastHost', () => {
  let toasts: WbToasts
  const mount = () =>
    act(() =>
      root.render(
        createElement(LocaleProvider, { initial: 'en' }, createElement(WbToastHost, { toasts })),
      ),
    )
  const shown = () => Array.from(host.querySelectorAll<HTMLElement>('.wb-toast-stack > .wb-toast'))

  beforeEach(() => {
    vi.useFakeTimers()
    toasts = createWbToasts()
  })

  it('stacks toasts in one host; the same id replaces the one shown', () => {
    mount()
    // the live region exists before the first toast
    expect(host.querySelector('.wb-toast-stack[aria-live="polite"]')).not.toBeNull()
    act(() => {
      toasts.show({ message: { text: 'First' } })
      toasts.show({ id: 'tool', message: { text: 'Second' } })
    })
    expect(host.querySelectorAll('.wb-toast-host')).toHaveLength(1)
    expect(shown().map((t) => t.querySelector('.wb-toast-text')?.textContent)).toEqual([
      'First',
      'Second',
    ])
    act(() => toasts.show({ id: 'tool', message: { text: 'Third' }, tone: 'alert' }))
    expect(shown()).toHaveLength(2)
    expect(shown()[1]!.textContent).toContain('Third')
    expect(shown()[1]!.getAttribute('role')).toBe('alert')
    // a notice is announced by the stack, a polite live region that is always mounted
    expect(shown()[0]!.hasAttribute('role')).toBe(false)
    expect(host.querySelector('.wb-toast-stack')!.getAttribute('aria-live')).toBe('polite')
  })

  it('translates a key at render and runs an action (Undo / Retry), then closes', () => {
    const undo = vi.fn()
    mount()
    act(() =>
      toasts.show({
        message: { key: 'wbDeskToolDone', params: { name: 'a.pdf' } },
        actions: [{ label: 'acctRetry', onClick: undo }],
      }),
    )
    expect(shown()[0]!.textContent).toContain('a.pdf')
    const action = Array.from(shown()[0]!.querySelectorAll('button')).find(
      (b) => b.textContent === 'Retry',
    )!
    act(() => action.click())
    expect(undo).toHaveBeenCalledTimes(1)
    expect(shown()).toHaveLength(0)
  })

  it('closes itself after 6 seconds unless it carries an action; the × always closes', () => {
    mount()
    act(() => {
      toasts.show({ message: { text: 'Saved' } })
      toasts.show({
        message: { text: 'Failed' },
        actions: [{ label: 'acctRetry', onClick: vi.fn() }],
      })
    })
    act(() => vi.advanceTimersByTime(AUTO_DISMISS_MS - 1))
    expect(shown()).toHaveLength(2)
    act(() => vi.advanceTimersByTime(1))
    expect(shown().map((t) => t.querySelector('.wb-toast-text')?.textContent)).toEqual(['Failed'])
    act(() => vi.advanceTimersByTime(60_000))
    expect(shown()).toHaveLength(1)
    const close = shown()[0]!.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!
    act(() => close.click())
    expect(shown()).toHaveLength(0)
  })
})
