// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UniworkStatusChip } from '../src/renderer/src/UniworkChrome'
import { UniworkLiveHost, resetLiveForTests } from '../src/renderer/src/uniwork-live'
import { en } from '../src/renderer/src/i18n/sync/en'
import { en as enDocs } from '../src/renderer/src/i18n/uniwork-documents/en'
import type {
  AccountState,
  HomeApi,
  UniworkDocStatus,
  UniworkQueuePopoverRequest,
} from '../src/shared/home-api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PATH = '/work/uniwork-documents/d1/Plan.docx'

function status(over: Partial<UniworkDocStatus> = {}): UniworkDocStatus {
  return {
    path: PATH,
    documentId: 'd1',
    workspaceId: 'w1',
    title: 'Plan',
    format: 'docx',
    access: 'edit',
    state: 'saved',
    ...over,
  }
}

let host: HTMLDivElement
let root: Root
let account: AccountState
let pushPopover: ((request: UniworkQueuePopoverRequest) => void) | null
let api: ReturnType<typeof makeApi>
let focusActive: ReturnType<typeof vi.fn>

function makeApi() {
  const fns = {
    accountStatus: vi.fn(async () => ({ loggedIn: account === 'signed-in', state: account })),
    onAccountStatus: vi.fn(() => () => undefined),
    onAccountLogin: vi.fn(() => () => undefined),
    accountLogin: vi.fn(async () => true),
    uniworkSave: vi.fn(async (): Promise<UniworkDocStatus | null> => null),
    uniworkResolveConflict: vi.fn(async (): Promise<UniworkDocStatus | null> => null),
    uniworkRemoteAction: vi.fn(async (): Promise<UniworkDocStatus | null> => null),
    onUniworkQueuePopover: vi.fn((cb: (request: UniworkQueuePopoverRequest) => void) => {
      pushPopover = cb
      return () => {
        if (pushPopover === cb) pushPopover = null
      }
    }),
  }
  window.aiOffice = fns as unknown as HomeApi
  return fns
}

function Pill({ s, onStatus = () => undefined }: { s: UniworkDocStatus; onStatus?: () => void }) {
  return createElement(
    LocaleProvider,
    { initial: 'en' },
    createElement(UniworkLiveHost),
    createElement('div', { id: 'editor-stand-in', tabIndex: -1 }),
    createElement(UniworkStatusChip, { key: s.path, status: s, onStatus }),
  )
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

async function mount(s: UniworkDocStatus, onStatus?: () => void): Promise<void> {
  await act(async () => {
    root.render(createElement(Pill, { s, onStatus }))
  })
  await flush()
}

async function click(el: Element | null | undefined): Promise<void> {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

const pill = () => host.querySelector<HTMLElement>('.uw-pill')!
const button = () => pill().querySelector<HTMLButtonElement>('.uw-pill-action')
const polite = () => document.querySelector('#uw-live-host [role=status]')?.textContent ?? ''
const assertive = () => document.querySelector('#uw-live-host [role=alert]')?.textContent ?? ''
const popover = () => document.querySelector<HTMLElement>('[role="dialog"]')

beforeEach(() => {
  localStorage.setItem('uniwork-ui-lang', 'en')
  resetLiveForTests()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  account = 'signed-in'
  pushPopover = null
  api = makeApi()
  focusActive = vi.fn()
  ;(window as unknown as { aiOfficeTabs?: unknown }).aiOfficeTabs = { focusActive }
  delete (window as unknown as { uniworkSyncCenter?: unknown }).uniworkSyncCenter
})

afterEach(() => {
  act(() => root.unmount())
  resetLiveForTests()
  document.body.innerHTML = ''
})

describe('Save pill reads once (T3)', () => {
  it('the label is plain text: no role, no aria-live, no title on the label', async () => {
    await mount(status({ state: 'queued' }))
    const label = pill().querySelector<HTMLElement>('.uw-pill-label')!
    expect(label.textContent).toBe(en.uwChipQueued)
    for (let el: HTMLElement | null = label; el && el !== pill(); el = el.parentElement) {
      expect(el.hasAttribute('role'), el.className).toBe(false)
      expect(el.hasAttribute('aria-live'), el.className).toBe(false)
      expect(el.hasAttribute('title'), el.className).toBe(false)
    }
    expect(pill().querySelector('[role="status"], [role="alert"], [aria-live]')).toBeNull()
  })

  it('RFE6u-01: the tooltip is the native title of the button (drawn above the editor view), no DOM tip', async () => {
    await mount(status({ state: 'queued' }))
    expect(host.querySelector('.uw-pill-tip, [role="tooltip"]')).toBeNull()
    const title = button()!.getAttribute('title')!
    expect(title.startsWith(`${en.uwChipQueued}\n`)).toBe(true)
    expect(title).toContain('queued')
    expect(pill().hasAttribute('title')).toBe(false)
    expect(host.querySelectorAll('[title]')).toHaveLength(1)
  })

  it('RFE6u-01: without a button the group carries the native title', async () => {
    await mount(status({ state: 'dirty' }))
    expect(button()).toBeNull()
    expect(pill().getAttribute('title')).toMatch(/\n/)
    expect(host.querySelector('.uw-pill-tip, [role="tooltip"]')).toBeNull()
  })

  it('is a labelled group', async () => {
    await mount(status({ state: 'queued' }))
    expect(pill().getAttribute('role')).toBe('group')
    expect(pill().getAttribute('aria-label')).toBe('UniWork save status')
  })

  it('with a button, only the button points at the visually hidden description', async () => {
    await mount(status({ state: 'queued' }))
    const described = Array.from(host.querySelectorAll('[aria-describedby]'))
    expect(described).toEqual([button()])
    expect(pill().hasAttribute('aria-describedby')).toBe(false)
    const tip = document.getElementById(button()!.getAttribute('aria-describedby')!)!
    expect(tip.className).toBe('uw-sr-only')
    expect(tip.hasAttribute('role')).toBe(false)
    expect(pill().contains(tip)).toBe(true)
    expect(tip.textContent).toContain('kept safely on this computer')
    // the description is the tip only: the label is not read a second time
    expect(tip.textContent).not.toContain(en.uwChipQueued)
  })

  it('without a button the group itself is focusable and described (still one reading)', async () => {
    await mount(status({ state: 'dirty' }))
    expect(button()).toBeNull()
    expect(pill().getAttribute('tabindex')).toBe('0')
    const tip = document.getElementById(pill().getAttribute('aria-describedby')!)!
    expect(tip.className).toBe('uw-sr-only')
    expect(tip.textContent).not.toBe('')
    expect(host.querySelectorAll('[aria-describedby]')).toHaveLength(1)
  })

  it('with a button the group is only a programmatic focus target', async () => {
    await mount(status({ state: 'queued' }))
    expect(pill().getAttribute('tabindex')).toBe('-1')
  })
})

describe('V6u-01: keyboard focus shows the description inside the strip', () => {
  const focusTip = () => pill().querySelector<HTMLElement>('.uw-pill-focus-tip')

  it('the pill carries a visible, aria-hidden copy of the description after its button', async () => {
    await mount(status({ state: 'queued' }))
    const tip = focusTip()
    expect(tip, 'in-strip description').not.toBeNull()
    const described = document.getElementById(button()!.getAttribute('aria-describedby')!)!
    expect(tip!.textContent).toBe(described.textContent)
    // read once: the visible copy is hidden from screen readers and referenced by nothing
    expect(tip!.getAttribute('aria-hidden')).toBe('true')
    expect(tip!.hasAttribute('id')).toBe(false)
    expect(tip!.hasAttribute('role')).toBe(false)
    expect(tip!.hasAttribute('title')).toBe(false)
    expect(Array.from(host.querySelectorAll('[aria-describedby]'))).toEqual([button()])
    // after the button, so `.uw-pill-action:focus-visible ~ .uw-pill-focus-tip` reaches it
    expect(button()!.compareDocumentPosition(tip!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // a child of the pill (drawn in the strip next to it), not a node below the strip
    expect(tip!.parentElement).toBe(pill())
  })

  it('a pill without a button shows the same copy when the group has the focus', async () => {
    await mount(status({ state: 'dirty' }))
    const described = document.getElementById(pill().getAttribute('aria-describedby')!)!
    expect(focusTip()!.textContent).toBe(described.textContent)
    expect(focusTip()!.getAttribute('aria-hidden')).toBe('true')
  })

  it('Esc hides it without moving focus; focusing the pill again brings it back', async () => {
    await mount(status({ state: 'queued' }))
    act(() => button()!.focus())
    expect(pill().hasAttribute('data-tip-off')).toBe(false)
    await act(async () => {
      button()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(pill().hasAttribute('data-tip-off')).toBe(true)
    expect(document.activeElement).toBe(button())
    act(() => (document.getElementById('editor-stand-in') as HTMLElement).focus())
    act(() => button()!.focus())
    expect(pill().hasAttribute('data-tip-off')).toBe(false)
  })

  it('pointer use hides it (a click is not keyboard focus)', async () => {
    await mount(status({ state: 'queued' }))
    act(() => button()!.focus())
    await act(async () => {
      button()!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(pill().hasAttribute('data-tip-off')).toBe(true)
  })
})

describe('V6u2-01: the focus chip is bounded by the room left of the pill', () => {
  const room = () => pill().style.getPropertyValue('--uw-tip-room')
  /** the pill's window-px rect as Chromium would report it */
  const placePill = (left: number) => {
    pill().getBoundingClientRect = () =>
      ({
        left,
        right: left + 314,
        top: 6,
        bottom: 34,
        width: 314,
        height: 28,
        x: left,
        y: 6,
      }) as DOMRect
  }

  afterEach(() => {
    document.documentElement.style.removeProperty('--ui-scale')
  })

  it('focus measures the pill and sets the room as a custom property (720 px window)', async () => {
    await mount(status({ state: 'queued' }))
    placePill(216)
    act(() => button()!.focus())
    expect(room()).toBe('200px')
    expect(pill().hasAttribute('data-tip-room')).toBe(false)
    // V6u2-02: the sentence sits in a text node the CSS clamps to two lines
    const text = pill().querySelector('.uw-pill-focus-tip > .uw-pill-focus-tip-text')
    expect(text?.textContent).toBe(pill().querySelector('.uw-pill-focus-tip')!.textContent)
  })

  it('a button-less pill measures on its own focus too', async () => {
    await mount(status({ state: 'dirty' }))
    placePill(700)
    act(() => pill().focus())
    expect(room()).toBe('684px')
  })

  it('a resize while it shows measures again', async () => {
    await mount(status({ state: 'queued' }))
    placePill(775)
    act(() => button()!.focus())
    expect(room()).toBe('759px')
    placePill(216)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(room()).toBe('200px')
  })

  it('a resize after focus left does not measure', async () => {
    await mount(status({ state: 'queued' }))
    placePill(775)
    act(() => button()!.focus())
    act(() => (document.getElementById('editor-stand-in') as HTMLElement).focus())
    placePill(216)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(room()).toBe('759px')
  })

  it('the interface scale is taken out (the chip lays out in unscaled px)', async () => {
    document.documentElement.style.setProperty('--ui-scale', '1.25')
    await mount(status({ state: 'queued' }))
    placePill(216)
    act(() => button()!.focus())
    expect(room()).toBe('156px')
  })

  it('never negative: with no usable room the chip is not drawn', async () => {
    await mount(status({ state: 'queued' }))
    placePill(10)
    act(() => button()!.focus())
    expect(room()).toBe('0px')
    expect(pill().getAttribute('data-tip-room')).toBe('none')
    // room again (a wider window): drawn again
    placePill(400)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(room()).toBe('384px')
    expect(pill().hasAttribute('data-tip-room')).toBe(false)
  })
})

describe('RFE6u3-01: the focus-chip measurement attaches on focus and detaches on blur and unmount', () => {
  interface FakeObserver {
    callback: () => void
    observed: Element[]
    disconnects: number
  }
  let observers: FakeObserver[]
  let hadObserver: boolean
  let previousObserver: unknown
  let addSpy: ReturnType<typeof vi.spyOn>
  let removeSpy: ReturnType<typeof vi.spyOn>

  const resizeCalls = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.filter((call) => call[0] === 'resize')
  const liveObservers = () => observers.filter((o) => o.disconnects === 0)

  beforeEach(() => {
    observers = []
    hadObserver = 'ResizeObserver' in window
    previousObserver = (window as unknown as { ResizeObserver?: unknown }).ResizeObserver
    ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      private readonly record: FakeObserver
      constructor(callback: () => void) {
        this.record = { callback, observed: [], disconnects: 0 }
        observers.push(this.record)
      }
      observe(target: Element): void {
        this.record.observed.push(target)
      }
      unobserve(): void {}
      disconnect(): void {
        this.record.disconnects += 1
      }
    }
  })

  afterEach(() => {
    addSpy?.mockRestore()
    removeSpy?.mockRestore()
    if (hadObserver) {
      ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = previousObserver
    } else {
      delete (window as unknown as { ResizeObserver?: unknown }).ResizeObserver
    }
  })

  /** spies go on after the mount so only the focus-driven calls are counted */
  async function mountQueued(): Promise<void> {
    await mount(status({ state: 'queued' }))
    addSpy = vi.spyOn(window, 'addEventListener')
    removeSpy = vi.spyOn(window, 'removeEventListener')
  }

  it('nothing is attached before the pill has the focus', async () => {
    await mountQueued()
    expect(resizeCalls(addSpy)).toHaveLength(0)
    expect(observers).toHaveLength(0)
  })

  it('focus attaches one resize listener and one observer on the pill', async () => {
    await mountQueued()
    act(() => button()!.focus())
    expect(resizeCalls(addSpy)).toHaveLength(1)
    expect(observers).toHaveLength(1)
    expect(observers[0].observed).toEqual([pill()])
    expect(observers[0].disconnects).toBe(0)
    expect(resizeCalls(removeSpy)).toHaveLength(0)
  })

  it('moving the focus inside the pill neither detaches nor attaches again', async () => {
    await mountQueued()
    act(() => pill().focus())
    act(() => button()!.focus())
    expect(resizeCalls(addSpy)).toHaveLength(1)
    expect(resizeCalls(removeSpy)).toHaveLength(0)
    expect(observers).toHaveLength(1)
    expect(liveObservers()).toHaveLength(1)
  })

  it('blur detaches the same listener and disconnects the observer', async () => {
    await mountQueued()
    act(() => button()!.focus())
    const attached = resizeCalls(addSpy)[0][1]
    act(() => (document.getElementById('editor-stand-in') as HTMLElement).focus())
    const detached = resizeCalls(removeSpy)
    expect(detached).toHaveLength(1)
    expect(detached[0][1]).toBe(attached)
    expect(observers[0].disconnects).toBe(1)
    expect(liveObservers()).toHaveLength(0)
  })

  it('a resize or an observer callback after the blur measures nothing', async () => {
    await mountQueued()
    act(() => button()!.focus())
    act(() => (document.getElementById('editor-stand-in') as HTMLElement).focus())
    const measured = vi.fn(() => ({ left: 300 }) as DOMRect)
    pill().getBoundingClientRect = measured
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(measured).not.toHaveBeenCalled()
  })

  it('unmounting while focused removes the listener and disconnects the observer', async () => {
    await mountQueued()
    act(() => button()!.focus())
    const attached = resizeCalls(addSpy)[0][1]
    await act(async () => {
      root.render(createElement('div'))
    })
    const detached = resizeCalls(removeSpy)
    expect(detached).toHaveLength(1)
    expect(detached[0][1]).toBe(attached)
    expect(observers[0].disconnects).toBe(1)
    expect(liveObservers()).toHaveLength(0)
  })

  it('focus again after a blur attaches a fresh pair (no leak across cycles)', async () => {
    await mountQueued()
    act(() => button()!.focus())
    act(() => (document.getElementById('editor-stand-in') as HTMLElement).focus())
    act(() => button()!.focus())
    expect(resizeCalls(addSpy)).toHaveLength(2)
    expect(resizeCalls(removeSpy)).toHaveLength(1)
    expect(observers).toHaveLength(2)
    expect(liveObservers()).toHaveLength(1)
  })
})

describe('Save pill announces each change once (T4)', () => {
  it('says nothing on the first render', async () => {
    await mount(status({ state: 'dirty' }))
    expect(polite()).toBe('')
    expect(assertive()).toBe('')
  })

  it('a change of the active document writes exactly one polite sentence', async () => {
    await mount(status({ state: 'dirty' }))
    await mount(status({ state: 'saving' }))
    expect(polite()).toBe('Plan: Saving…')
    expect(assertive()).toBe('')
    // the same pill model again is not a change
    resetLiveForTests()
    await mount(status({ state: 'saving', lastSavedAt: '2026-03-02T08:30:00Z' }))
    expect(polite()).toBe('')
    expect(assertive()).toBe('')
  })

  it('blocked, failed and conflict go to the assertive node only', async () => {
    await mount(status({ state: 'saving' }))
    await mount(status({ state: 'blocked', error: 'quota_exceeded' }))
    expect(assertive()).toBe('Plan: Blocked: storage full')
    expect(polite()).toBe('')
    resetLiveForTests()
    await mount(status({ state: 'failed', error: 'server_error' }))
    expect(assertive()).toBe(`Plan: ${document.querySelector('.uw-pill-label')!.textContent}`)
    expect(polite()).toBe('')
    resetLiveForTests()
    await mount(status({ state: 'conflict' }))
    expect(assertive()).toBe('Plan: Version conflict')
    expect(polite()).toBe('')
  })

  it('a tab switch (another path, same position) writes nothing', async () => {
    await mount(status({ state: 'dirty' }))
    await mount(
      status({
        path: '/work/uniwork-documents/d2/Other.docx',
        documentId: 'd2',
        title: 'Other',
        state: 'saving',
      }),
    )
    expect(polite()).toBe('')
    expect(assertive()).toBe('')
    // and a change on the new active document is announced with its own title
    await mount(
      status({
        path: '/work/uniwork-documents/d2/Other.docx',
        documentId: 'd2',
        title: 'Other',
        state: 'saved',
      }),
    )
    expect(polite()).toBe('Other: Saved to UniWork')
  })
})

describe('Save pill button state (T5)', () => {
  it('a busy button is aria-disabled, not disabled, keeps focus and ignores a second click', async () => {
    let release: (value: UniworkDocStatus | null) => void = () => undefined
    api.uniworkSave.mockImplementationOnce(
      () => new Promise<UniworkDocStatus | null>((resolve) => (release = resolve)),
    )
    const onStatus = vi.fn()
    await mount(status({ state: 'offline', error: 'network' }), onStatus)
    const btn = button()!
    btn.focus()
    expect(document.activeElement).toBe(btn)
    await click(btn)
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    expect(btn.disabled).toBe(false)
    expect(document.activeElement).toBe(btn)
    await click(btn)
    expect(api.uniworkSave).toHaveBeenCalledTimes(1)
    await act(async () => release(status({ state: 'saved' })))
    await flush()
    expect(onStatus).toHaveBeenCalledWith(status({ state: 'saved' }))
    expect(button()!.hasAttribute('aria-disabled')).toBe(false)
  })

  it('focus moves to the pill group, never to <body>, when the next status removes the button', async () => {
    await mount(status({ state: 'queued' }))
    button()!.focus()
    expect(document.activeElement).toBe(button())
    await mount(status({ state: 'saved' }))
    expect(button()).toBeNull()
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement).toBe(pill())
  })

  it('focus elsewhere is left alone when the button goes away', async () => {
    await mount(status({ state: 'queued' }))
    const stand = document.getElementById('editor-stand-in')!
    stand.focus()
    await mount(status({ state: 'saved' }))
    expect(document.activeElement).toBe(stand)
  })
})

describe('Ctrl/Cmd+S and the queue popover (T8)', () => {
  it('the main push for the active path opens the popover with the blocked-save line, no save call', async () => {
    await mount(status({ state: 'queued' }))
    expect(popover()).toBeNull()
    await act(async () => pushPopover!({ path: PATH }))
    await flush()
    const dialog = popover()!
    expect(dialog).not.toBeNull()
    expect(dialog.textContent).toContain(en.uwQueueBlockedSave)
    expect(polite()).toBe(en.uwQueueBlockedSave)
    expect(api.uniworkSave).not.toHaveBeenCalled()
    expect(api.uniworkResolveConflict).not.toHaveBeenCalled()
  })

  it('a push for another path (a background tab) opens nothing', async () => {
    await mount(status({ state: 'queued' }))
    await act(async () => pushPopover!({ path: '/work/uniwork-documents/d9/Else.docx' }))
    await flush()
    expect(popover()).toBeNull()
  })

  it('a conflict opens the resolve choice instead of a popover', async () => {
    await mount(status({ state: 'conflict' }))
    await act(async () => pushPopover!({ path: PATH }))
    await flush()
    expect(api.uniworkResolveConflict).toHaveBeenCalledWith(PATH)
    expect(popover()).toBeNull()
    expect(api.uniworkSave).not.toHaveBeenCalled()
  })

  it('Esc after a Ctrl/Cmd+S opening hands focus back to the editor view', async () => {
    await mount(status({ state: 'queued' }))
    await act(async () => pushPopover!({ path: PATH }))
    await flush()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(popover()).toBeNull()
    expect(focusActive).toHaveBeenCalledTimes(1)
  })

  it('View queue opens the popover, a second click closes it, Esc returns focus to the button', async () => {
    await mount(status({ state: 'queued' }))
    await click(button())
    expect(popover()).not.toBeNull()
    await click(button())
    expect(popover()).toBeNull()
    await click(button())
    expect(popover()).not.toBeNull()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(popover()).toBeNull()
    expect(document.activeElement).toBe(button())
    expect(focusActive).not.toHaveBeenCalled()
  })

  it('Details on a failed save opens the popover too', async () => {
    await mount(status({ state: 'failed', error: 'server_error' }))
    await click(button())
    expect(popover()).not.toBeNull()
  })

  it('the popover goes away with the status that made it', async () => {
    await mount(status({ state: 'queued' }))
    await click(button())
    await mount(status({ state: 'saved' }))
    expect(popover()).toBeNull()
  })

  it('RFE6u-03: Ctrl/Cmd+S on a queued save writes exactly one polite sentence (the popover line)', async () => {
    await mount(status({ state: 'queued' }))
    const node = document.querySelector('#uw-live-host [role=status]')!
    const writes: string[] = []
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const added of Array.from(record.addedNodes)) writes.push(added.textContent ?? '')
      }
    })
    observer.observe(node, { childList: true })
    // main sets pendingNext, publishes the status, then pushes the popover request
    await mount(status({ state: 'queued', pendingNext: true }))
    await act(async () => pushPopover!({ path: PATH }))
    await flush()
    observer.disconnect()
    expect(pill().querySelector('.uw-pill-label')!.textContent).toBe(en.uwChipQueuedNewer)
    expect(popover()).not.toBeNull()
    expect(writes).toEqual([en.uwQueueBlockedSave])
    expect(assertive()).toBe('')
  })

  /** every text written to the polite node while `run` runs */
  async function politeWritesDuring(run: () => Promise<void>): Promise<string[]> {
    const node = document.querySelector('#uw-live-host [role=status]')!
    const writes: string[] = []
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const added of Array.from(record.addedNodes)) writes.push(added.textContent ?? '')
      }
    })
    observer.observe(node, { childList: true })
    await run()
    await flush()
    observer.disconnect()
    return writes
  }

  it('RFE6u2-01: Ctrl/Cmd+S with the popover already open from the pill says one sentence and keeps the pill as opener', async () => {
    await mount(status({ state: 'queued' }))
    await click(button())
    expect(popover()).not.toBeNull()
    const writes = await politeWritesDuring(async () => {
      await mount(status({ state: 'queued', pendingNext: true }))
      await act(async () => pushPopover!({ path: PATH }))
    })
    // the open popover does not speak again: the pill's sentence is the one for this press
    expect(writes).toEqual([`Plan: ${en.uwChipQueuedNewer}`])
    expect(assertive()).toBe('')
    expect(popover()).not.toBeNull()
    expect(button()!.getAttribute('aria-expanded')).toBe('true')
    // still the pill's popover: Esc goes back to the pill button, not the editor
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(popover()).toBeNull()
    expect(document.activeElement).toBe(button())
    expect(focusActive).not.toHaveBeenCalled()
  })

  it('RFE6u2-01: the same when the request comes before the status', async () => {
    await mount(status({ state: 'queued' }))
    await click(button())
    const writes = await politeWritesDuring(async () => {
      await act(async () => pushPopover!({ path: PATH }))
      await flush()
      await mount(status({ state: 'queued', pendingNext: true }))
    })
    expect(writes).toEqual([`Plan: ${en.uwChipQueuedNewer}`])
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.activeElement).toBe(button())
    expect(focusActive).not.toHaveBeenCalled()
  })

  it('RFE6u2-01: a closed popover and the request before the status: still only the popover line', async () => {
    await mount(status({ state: 'queued' }))
    const writes = await politeWritesDuring(async () => {
      await act(async () => pushPopover!({ path: PATH }))
      await flush()
      await mount(status({ state: 'queued', pendingNext: true }))
    })
    expect(writes).toEqual([en.uwQueueBlockedSave])
  })

  it('RFE6u-03: other queued changes are still announced by the pill', async () => {
    await mount(status({ state: 'queued', pendingNext: true }))
    await mount(status({ state: 'paused_user', pendingNext: true }))
    expect(polite()).not.toBe('')
  })

  it('RFE6u-04: aria-expanded is true for a Ctrl/Cmd+S opening too, and a click then closes it', async () => {
    await mount(status({ state: 'queued' }))
    expect(button()!.getAttribute('aria-expanded')).toBe('false')
    await act(async () => pushPopover!({ path: PATH }))
    await flush()
    expect(popover()).not.toBeNull()
    expect(button()!.getAttribute('aria-expanded')).toBe('true')
    await click(button())
    expect(popover()).toBeNull()
    expect(button()!.getAttribute('aria-expanded')).toBe('false')
  })

  it('RFE6u-07: a failed save names the row reason in the pill, the same one as the popover', async () => {
    const row = {
      id: 'row-1',
      documentId: 'd1',
      documentKey: 'k1',
      title: 'Plan',
      ext: 'docx',
      state: 'failed',
      savedAt: '2026-03-02T08:30:00Z',
      canEdit: true,
      failedReason: 'quota',
    }
    const snap = {
      header: { status: 'online', online: true },
      storeError: false,
      tabs: { attention: [row], pending: [], recent: [] },
      defaultTab: 'attention',
    }
    ;(window as unknown as { uniworkSyncCenter?: unknown }).uniworkSyncCenter = {
      getSnapshot: vi.fn(async () => snap),
      subscribe: vi.fn(() => () => undefined),
    }
    // the status code says "other" (server_error); the row says quota
    await mount(status({ state: 'failed', error: 'server_error' }))
    await flush()
    const tip = document.getElementById(button()!.getAttribute('aria-describedby')!)!
    expect(tip.textContent).toContain(enDocs.uwReasonQuota)
    await click(button())
    expect(popover()!.textContent).toContain(enDocs.uwReasonQuota)
  })

  it('stop the subscription when the pill goes away', async () => {
    await mount(status({ state: 'queued' }))
    expect(pushPopover).not.toBeNull()
    act(() => root.render(createElement('div')))
    expect(pushPopover).toBeNull()
  })
})
