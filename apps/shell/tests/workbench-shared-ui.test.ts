/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { WbConfirm } from '../src/renderer/src/WbConfirm'
import { WbMenu, WbMenuItem, WbMenuLabel } from '../src/renderer/src/WbMenu'
import {
  ACTION_DISMISS_MS,
  AUTO_DISMISS_MS,
  MAX_TOASTS,
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
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const title = document.getElementById(dialog.getAttribute('aria-labelledby')!)
    expect(title?.textContent).toBe('Delete pack “Acme”?')
    const body = document.getElementById(dialog.getAttribute('aria-describedby')!)
    expect(body?.textContent).toBe('Files move to the default project.')
    expect(document.activeElement?.textContent).toBe('Cancel')
    expect((document.activeElement as HTMLElement).className).toBe('wb-btn wb-btn-ghost')
  })

  it('Tab and Shift+Tab cycle its two buttons; focus never wanders out to the page', () => {
    const outside = document.createElement('button')
    document.body.append(outside)
    const { dialog } = render()
    const [cancel, confirm] = Array.from(dialog.querySelectorAll('button'))
    const tab = (shiftKey = false) =>
      act(() => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }),
        )
      })
    expect(document.activeElement).toBe(cancel)
    tab()
    expect(document.activeElement).toBe(confirm)
    tab()
    expect(document.activeElement).toBe(cancel)
    tab(true)
    expect(document.activeElement).toBe(confirm)
    tab(true)
    expect(document.activeElement).toBe(cancel)
    outside.remove()
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

  it('a notice closes after 6 seconds, one with an action after 10; the × always closes', () => {
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
    // an action toast does not live forever: it would sit over the page on every tab
    act(() => vi.advanceTimersByTime(ACTION_DISMISS_MS - AUTO_DISMISS_MS - 1))
    expect(shown()).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1))
    expect(shown()).toHaveLength(0)
    act(() => toasts.show({ message: { text: 'Again' } }))
    const close = shown()[0]!.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!
    act(() => close.click())
    expect(shown()).toHaveLength(0)
  })

  it('the clock stops while the pointer is over the stack and resumes with the time it had left', () => {
    mount()
    act(() =>
      toasts.show({
        message: { text: 'Deleted' },
        actions: [{ label: 'wbCommonUndo', onClick: vi.fn() }],
      }),
    )
    act(() => vi.advanceTimersByTime(ACTION_DISMISS_MS - 1000))
    const stack = host.querySelector<HTMLElement>('.wb-toast-stack')!
    // React listens for mouseover/out to synthesize enter/leave
    act(() => {
      shown()[0]!.dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }),
      )
    })
    act(() => vi.advanceTimersByTime(60_000))
    expect(shown()).toHaveLength(1)
    act(() => {
      stack.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }),
      )
    })
    act(() => vi.advanceTimersByTime(999))
    expect(shown()).toHaveLength(1)
    act(() => vi.advanceTimersByTime(1))
    expect(shown()).toHaveLength(0)
  })

  it('never closes while keyboard focus is in it: Undo stays reachable', () => {
    mount()
    act(() =>
      toasts.show({
        message: { text: 'Deleted' },
        actions: [{ label: 'wbCommonUndo', onClick: vi.fn() }],
      }),
    )
    const undo = Array.from(shown()[0]!.querySelectorAll('button')).find(
      (b) => b.textContent === 'Undo',
    )!
    act(() => undo.focus())
    act(() => vi.advanceTimersByTime(ACTION_DISMISS_MS * 5))
    expect(shown()).toHaveLength(1)
    // focus leaves: the clock runs out what it had left
    act(() => undo.blur())
    act(() => vi.advanceTimersByTime(0))
    act(() => vi.advanceTimersByTime(ACTION_DISMISS_MS))
    expect(shown()).toHaveLength(0)
  })

  it(`keeps at most ${MAX_TOASTS}: the oldest gives way`, () => {
    mount()
    act(() => {
      for (let i = 1; i <= MAX_TOASTS + 2; i++) toasts.show({ message: { text: `T${i}` } })
    })
    expect(shown().map((t) => t.querySelector('.wb-toast-text')?.textContent)).toEqual(
      Array.from({ length: MAX_TOASTS }, (_, i) => `T${i + 3}`),
    )
  })

  it('the host takes room at the end of the page and lets clicks through around the toasts', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/home.css'), 'utf8')
    const host = css.slice(
      css.indexOf('\n.wb-toast-host {'),
      css.indexOf('\n}', css.indexOf('\n.wb-toast-host {')),
    )
    expect(host).not.toMatch(/height: 0/)
    expect(host).toMatch(/pointer-events: none;/)
    expect(css).toMatch(/\n\.wb-toast \{[^}]*pointer-events: auto;/)
    expect(css).not.toMatch(/\n\.wb-toast-stack \{[^}]*position: absolute;/)
  })
})
