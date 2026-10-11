/**
 * Insert text / Add text dialog (UNI-1232 F-2): the textarea owns the focus as soon as the dialog
 * opens (typed characters used to be lost with the focus on the body), Escape cancels, and the
 * opener gets the focus back.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { StaticTextDialog } from '../src/renderer/StaticTextDialog'
import type { TFunc } from '../src/renderer/i18n/locale'

const t = ((key: string) => key) as unknown as TFunc

let root: Root | null = null
let container: HTMLDivElement | null = null
let opener: HTMLButtonElement | null = null

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  container?.remove()
  opener?.remove()
  root = null
  container = null
  opener = null
})

type Props = Partial<Parameters<typeof StaticTextDialog>[0]>

async function open(props: Props = {}, focusOpener = true) {
  // the ribbon button that opens the dialog holds the focus (or nothing does: the body)
  opener = document.createElement('button')
  document.body.appendChild(opener)
  if (focusOpener) opener.focus()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const element = (p: Props) =>
    createElement(StaticTextDialog, {
      t,
      titleKey: 'insertTextTitle',
      text: '',
      size: 14,
      color: '#111111',
      colorOpen: false,
      align: 'left',
      colorFieldRef: { current: null },
      onText: () => {},
      onSize: () => {},
      onColor: () => {},
      onColorOpen: () => {},
      onAlign: () => {},
      onCancel: () => {},
      onConfirm: () => {},
      ...p,
    })
  await act(async () => {
    root!.render(element(props))
    await Promise.resolve()
  })
  return {
    container,
    rerender: (p: Props) => act(async () => root!.render(element({ ...props, ...p }))),
  }
}

describe('StaticTextDialog', () => {
  it('focuses the textarea on open when the opener held the focus', async () => {
    const { container } = await open()
    expect(document.activeElement).toBe(container.querySelector('textarea'))
  })

  it('focuses the textarea on open when nothing held the focus (the body)', async () => {
    const { container } = await open({}, false)
    expect(document.activeElement).toBe(container.querySelector('textarea'))
  })

  it('is a labelled modal dialog; OK needs text', async () => {
    const { container, rerender } = await open()
    const dialog = container.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-label')).toBe('insertTextTitle')
    const ok = [...container.querySelectorAll('button')].find((b) => b.textContent === 'ok')!
    expect(ok.disabled).toBe(true)
    await rerender({ text: 'Hello' })
    expect(ok.disabled).toBe(false)
  })

  it('cancels on Escape unless the color popover is open, and on backdrop click', async () => {
    const onCancel = vi.fn()
    const { container, rerender } = await open({ onCancel })
    const esc = () =>
      act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
    await esc()
    expect(onCancel).toHaveBeenCalledTimes(1)
    await rerender({ colorOpen: true })
    await esc()
    expect(onCancel).toHaveBeenCalledTimes(1)
    await act(async () => {
      container.querySelector<HTMLElement>('.pdf-modal-mask')!.click()
    })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('hands the focus back to the opener on close', async () => {
    await open()
    expect(document.activeElement).toBe(document.querySelector('textarea'))
    await act(async () => root?.unmount())
    root = null
    expect(document.activeElement).toBe(opener)
  })
})
