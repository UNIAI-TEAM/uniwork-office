// The new-version bar (S6): one region, the sentence read once through the window's live node, the
// 8 s auto-hide that never fires under focus or hover, and the page layout class.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BAR_AUTO_HIDE_MS, createRemoteBar } from './remote-bar'

const bar = () => document.querySelector<HTMLElement>('.uw-remote-bar')

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
  document.documentElement.classList.remove('uw-remote-bar-on')
})

describe('createRemoteBar', () => {
  it('draws one labelled region with the sentence and link actions, in front of the app root', () => {
    document.body.innerHTML = '<div id="root"></div>'
    const onClick = vi.fn()
    createRemoteBar().show({
      tone: 'warn',
      region: 'remote',
      text: 'A newer version is on UniWork.',
      actions: [{ id: 'later', label: 'Later', onClick }],
    })
    const el = bar()!
    expect(el.getAttribute('role')).toBe('region')
    expect(el.getAttribute('aria-label')).toBe('New version')
    expect(el.className).toContain('uw-remote-bar--warn')
    expect(el.textContent).toContain('A newer version is on UniWork.')
    expect(document.body.firstElementChild).toBe(el)
    expect(document.documentElement.classList.contains('uw-remote-bar-on')).toBe(true)
    el.querySelector<HTMLButtonElement>('[data-action="later"]')!.click()
    expect(onClick).toHaveBeenCalledTimes(1)
    // a button, not a link, with a real label
    expect(el.querySelector('button')!.type).toBe('button')
  })

  it('the status variants use the document-status label', () => {
    createRemoteBar().show({ tone: 'error', region: 'lock', text: 'No access.' })
    expect(bar()!.getAttribute('aria-label')).toBe('Document status')
  })

  it('never stacks: a second show replaces the first; hide removes it and the layout class', () => {
    const b = createRemoteBar()
    b.show({ tone: 'info', region: 'remote', text: 'one' })
    b.show({ tone: 'warn', region: 'remote', text: 'two' })
    expect(document.querySelectorAll('.uw-remote-bar')).toHaveLength(1)
    expect(bar()!.textContent).toContain('two')
    expect(b.current()?.text).toBe('two')
    b.hide()
    expect(bar()).toBeNull()
    expect(b.current()).toBeNull()
    expect(document.documentElement.classList.contains('uw-remote-bar-on')).toBe(false)
  })

  it('reads the sentence once: polite for information, alert (cleared after a second) for the rest; the bar has no live attribute', () => {
    const b = createRemoteBar()
    b.show({ tone: 'info', region: 'remote', text: 'Updated.' })
    expect(document.querySelector('[role=status]')!.textContent).toBe('Updated.')
    expect(document.querySelector('[role=alert]')).toBeNull()
    b.show({ tone: 'error', region: 'lock', text: 'No access.' })
    const alert = document.querySelector('[role=alert]')!
    expect(alert.textContent).toBe('No access.')
    expect(bar()!.querySelector('[aria-live],[role=alert],[role=status]')).toBeNull()
    vi.advanceTimersByTime(1000)
    expect(alert.textContent).toBe('')
    // the same bar shown again is not read twice
    b.show({ tone: 'error', region: 'lock', text: 'No access.' })
    expect(alert.textContent).toBe('')
  })

  it('the dirty / AI warning is announced politely too: only an error bar interrupts', () => {
    const b = createRemoteBar()
    b.show({ tone: 'warn', region: 'remote', text: 'A newer version is on UniWork.' })
    expect(document.querySelector('[role=status]')!.textContent).toBe(
      'A newer version is on UniWork.',
    )
    expect(document.querySelector('[role=alert]')).toBeNull()
    b.show({ tone: 'error', region: 'lock', text: 'No access.' })
    expect(document.querySelector('[role=alert]')!.textContent).toBe('No access.')
    // the warning did not leak into the assertive node
    expect(document.querySelector('[role=status]')!.textContent).toBe(
      'A newer version is on UniWork.',
    )
  })

  it('an information bar hides itself after 8 s', () => {
    const b = createRemoteBar()
    b.show({ tone: 'info', region: 'remote', text: 'Updated.', autoHideMs: BAR_AUTO_HIDE_MS })
    vi.advanceTimersByTime(BAR_AUTO_HIDE_MS - 1)
    expect(bar()).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(bar()).toBeNull()
  })

  it('does not hide while the pointer is over it, and hides 8 s after the pointer leaves', () => {
    const b = createRemoteBar()
    b.show({ tone: 'info', region: 'remote', text: 'Updated.', autoHideMs: BAR_AUTO_HIDE_MS })
    bar()!.dispatchEvent(new MouseEvent('mouseenter'))
    vi.advanceTimersByTime(BAR_AUTO_HIDE_MS * 3)
    expect(bar()).not.toBeNull()
    bar()!.dispatchEvent(new MouseEvent('mouseleave'))
    vi.advanceTimersByTime(BAR_AUTO_HIDE_MS)
    expect(bar()).toBeNull()
  })

  it('does not hide while a control in it has the focus', () => {
    const b = createRemoteBar()
    b.show({
      tone: 'info',
      region: 'remote',
      text: 'Updated.',
      actions: [{ id: 'close', label: 'Close', onClick: () => {} }],
      autoHideMs: BAR_AUTO_HIDE_MS,
    })
    const close = bar()!.querySelector<HTMLButtonElement>('button')!
    close.focus()
    vi.advanceTimersByTime(BAR_AUTO_HIDE_MS * 3)
    expect(bar()).not.toBeNull()
    close.blur()
    vi.advanceTimersByTime(BAR_AUTO_HIDE_MS)
    expect(bar()).toBeNull()
  })

  it('a warn or error bar never hides by itself', () => {
    const b = createRemoteBar()
    b.show({ tone: 'warn', region: 'remote', text: 'Newer.' })
    vi.advanceTimersByTime(60_000)
    expect(bar()).not.toBeNull()
  })
})
