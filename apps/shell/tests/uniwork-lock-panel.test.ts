/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, UniworkDocLock } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UniworkLockHost } from '../src/renderer/src/UniworkLockPanel'
import {
  lockCopyOf,
  mergeLocks,
  shownLock,
  withoutLock,
} from '../src/renderer/src/uniwork-lock-model'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const lock = (name: string, folder = 'd1'): UniworkDocLock => ({
  path: `C:\\ud\\uniwork-documents\\${folder}\\${name}`,
  reason: 'store_newer',
  name,
})

describe('lock model', () => {
  it('maps store_newer to the S11 keys and the shared Close action', () => {
    expect(lockCopyOf({ reason: 'store_newer' })).toEqual({
      titleKey: 'uwLockNewerStoreTitle',
      bodyKey: 'uwLockNewerStore',
      actionKey: 'uwPickClose',
    })
    for (const lang of ['vi', 'en'] as const) {
      const table = uniworkDocumentStrings[lang] as Record<string, string>
      for (const k of Object.values(lockCopyOf({ reason: 'store_newer' }))) {
        expect(table[k]).toBeTruthy()
      }
    }
  })

  it('has the vi/en copy of the UX copy table', () => {
    expect(uniworkDocumentStrings.en.uwLockNewerStoreTitle).toBe('A newer app version is needed')
    expect(uniworkDocumentStrings.vi.uwLockNewerStoreTitle).toBe('Cần phiên bản ứng dụng mới hơn')
    expect(uniworkDocumentStrings.en.uwLockNewerStore).toBe(
      'This data needs a newer app version. Update UniWork Office; nothing was deleted and no new save was created.',
    )
    expect(uniworkDocumentStrings.vi.uwLockNewerStore).toBe(
      'Dữ liệu này cần phiên bản ứng dụng mới hơn. Hãy cập nhật UniWork Office; dữ liệu không bị xóa và không có lần lưu mới nào được tạo.',
    )
  })

  it('merges by path (case-insensitive drive letter), newest wins, and removes by path', () => {
    const a = lock('A.docx', 'a')
    const b = lock('B.docx', 'b')
    const aAgain = { ...a, path: a.path.replace('C:', 'c:') }
    expect(mergeLocks([a], [b])).toEqual([a, b])
    expect(mergeLocks([a, b], [aAgain])).toEqual([aAgain, b])
    expect(withoutLock([a, b], a.path.toLowerCase())).toEqual([b])
    expect(shownLock([a, b])).toBe(b)
    expect(shownLock([])).toBeNull()
  })
})

let host: HTMLDivElement
let root: Root
let pushLock: ((l: UniworkDocLock) => void) | null
let initial: UniworkDocLock[]
let api: {
  onUniworkLock: ReturnType<typeof vi.fn>
  uniworkLocks: ReturnType<typeof vi.fn>
  dismissUniworkLock: ReturnType<typeof vi.fn>
}
let tabs: { activate: ReturnType<typeof vi.fn> }

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

/** stand-in for the Home area: a search field, a button, a link (everything a Tab could reach) */
const homeStub = () =>
  createElement(
    'main',
    { 'data-testid': 'home' },
    createElement('input', { id: 'home-search', type: 'text' }),
    createElement('button', { id: 'home-action', type: 'button' }, 'New'),
    createElement('a', { id: 'home-link', href: '#x' }, 'Recent'),
  )

async function mount(homeActive = true, locale: 'en' | 'vi' = 'en'): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: locale },
        createElement(UniworkLockHost, { homeActive }, homeStub()),
      ),
    )
  })
  await flush()
}

const region = () => host.querySelector<HTMLElement>('[role="region"]')
const title = () => host.querySelector<HTMLElement>('h3')
const alertNode = () => host.querySelector<HTMLElement>('[role="alert"]')
const alertText = () => alertNode()?.textContent
const homeControls = () =>
  Array.from(
    host.querySelectorAll<HTMLElement>(
      '[data-testid="home"] input, [data-testid="home"] button, [data-testid="home"] a[href]',
    ),
  )
/** what a browser does with `inert`: the element and its whole subtree leave focus order and a11y tree */
const isInert = (el: Element) => el.closest('[inert]') !== null
const homeRegion = () => host.querySelector<HTMLElement>('.uw-home-region')!

async function clickClose(): Promise<void> {
  await act(async () => {
    region()!.querySelector('button')!.click()
  })
  await flush()
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  pushLock = null
  initial = []
  api = {
    onUniworkLock: vi.fn((cb: (l: UniworkDocLock) => void) => {
      pushLock = cb
      return () => {
        pushLock = null
      }
    }),
    uniworkLocks: vi.fn(async () => initial),
    dismissUniworkLock: vi.fn(async () => undefined),
  }
  tabs = { activate: vi.fn(async () => undefined) }
  window.aiOffice = {
    ...api,
    accountStatus: vi.fn(async () => ({ loggedIn: false, state: 'signed-out' })),
    onAccountStatus: vi.fn(() => () => undefined),
    onAccountLogin: vi.fn(() => () => undefined),
    setLanguage: vi.fn(async () => undefined),
  } as unknown as HomeApi
  ;(window as unknown as { aiOfficeTabs: unknown }).aiOfficeTabs = tabs
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('S11 lock panel (newer store)', () => {
  it('shows nothing until a lock arrives', async () => {
    await mount()
    expect(region()).toBeNull()
    expect(api.uniworkLocks).toHaveBeenCalledTimes(1)
  })

  it('a pushed lock shows the region labelled by its title, with the S11 copy (en)', async () => {
    await mount()
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    const r = region()!
    expect(r).not.toBeNull()
    const t = title()!
    expect(r.getAttribute('aria-labelledby')).toBe(t.id)
    expect(t.textContent).toBe('A newer app version is needed')
    expect(r.textContent).toContain('This data needs a newer app version.')
    expect(r.querySelector('button')!.textContent).toBe('Close')
  })

  it('shows the Vietnamese copy', async () => {
    await mount(true, 'vi')
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    expect(title()!.textContent).toBe('Cần phiên bản ứng dụng mới hơn')
    expect(region()!.querySelector('button')!.textContent).toBe('Đóng')
  })

  it('shows a lock read on mount (shell window reload)', async () => {
    initial = [lock('Plan.docx')]
    await mount()
    expect(title()).not.toBeNull()
  })

  it('moves focus to the title (tabindex -1); Close is the only and next tab stop', async () => {
    await mount()
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    const t = title()!
    expect(t.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(t)
    const stops = Array.from(
      region()!.querySelectorAll<HTMLElement>('button, a[href], [tabindex]:not([tabindex="-1"])'),
    )
    expect(stops).toHaveLength(1)
    expect(stops[0]!.tagName).toBe('BUTTON')
    // DOM order: the title comes before the button, so Tab from the title lands on it
    expect(t.compareDocumentPosition(stops[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('writes "{title}. {sentence}" once to the alert node', async () => {
    await mount()
    expect(alertText()).toBe('')
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    expect(alertText()).toBe(
      `${uniworkDocumentStrings.en.uwLockNewerStoreTitle}. ${uniworkDocumentStrings.en.uwLockNewerStore}`,
    )
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1)
  })

  it('keeps one persistent alert node outside the keyed panel, across locks and Close', async () => {
    await mount()
    const node = alertNode()!
    expect(node.closest('.uw-lock-layer')).toBeNull()
    expect(isInert(node)).toBe(false)
    await act(async () => pushLock!(lock('A.docx', 'a')))
    await flush()
    expect(alertNode()).toBe(node)
    expect(node.textContent).not.toBe('')
    await act(async () => pushLock!(lock('B.docx', 'b')))
    await flush()
    expect(alertNode()).toBe(node)
    expect(node.textContent).not.toBe('')
    expect(isInert(node)).toBe(false)
    await clickClose()
    await clickClose()
    expect(region()).toBeNull()
    expect(alertNode()).toBe(node)
    expect(node.textContent).toBe('')
  })

  it('while typing in a field: the alert is written now, focus follows after the keystroke (next frame)', async () => {
    const frames: FrameRequestCallback[] = []
    const raf = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => frames.push(cb))
    try {
      await mount()
      const field = host.querySelector<HTMLInputElement>('#home-search')!
      field.focus()
      expect(document.activeElement).toBe(field)
      await act(async () => pushLock!(lock('Plan.docx')))
      await flush()
      expect(alertText()).not.toBe('')
      expect(document.activeElement).toBe(field)
      expect(frames).toHaveLength(1)
      await act(async () => frames[0]!(0))
      expect(document.activeElement).toBe(title())
    } finally {
      raf.mockRestore()
    }
  })

  it('a field that is not being typed in (a button) takes the focus move at once', async () => {
    await mount()
    host.querySelector<HTMLElement>('#home-action')!.focus()
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    expect(document.activeElement).toBe(title())
  })

  it('a second push for the same path does not stack panels', async () => {
    await mount()
    await act(async () => pushLock!(lock('Plan.docx')))
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1)
  })

  it('Close dismisses through the API with the path, and the panel goes away', async () => {
    const l = lock('Plan.docx')
    await mount()
    await act(async () => pushLock!(l))
    await flush()
    await clickClose()
    expect(api.dismissUniworkLock).toHaveBeenCalledTimes(1)
    expect(api.dismissUniworkLock).toHaveBeenCalledWith(l.path)
    expect(region()).toBeNull()
  })

  it('with two locks the newest shows first; closing it reveals the earlier one', async () => {
    await mount()
    await act(async () => pushLock!(lock('A.docx', 'a')))
    await act(async () => pushLock!(lock('B.docx', 'b')))
    await flush()
    await clickClose()
    expect(api.dismissUniworkLock).toHaveBeenCalledWith(lock('B.docx', 'b').path)
    expect(region()).not.toBeNull()
    expect(document.activeElement).toBe(title())
  })

  it('a lock dismissed while the mount read is in flight stays dismissed', async () => {
    const l = lock('Plan.docx')
    let release!: (v: UniworkDocLock[]) => void
    api.uniworkLocks.mockImplementationOnce(() => new Promise((res) => (release = res)))
    await mount()
    await act(async () => pushLock!(l))
    await clickClose()
    await act(async () => release([l]))
    await flush()
    expect(region()).toBeNull()
  })

  it('an editor tab in front: brings Home forward first, focus follows once Home is visible', async () => {
    await mount(false)
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    expect(tabs.activate).toHaveBeenCalledWith('home')
    expect(document.activeElement).not.toBe(title())
    expect(alertText()).toBe('')
    await mount(true)
    expect(document.activeElement).toBe(title())
    expect(alertText()).not.toBe('')
  })

  it('does not call activate when Home is already in front', async () => {
    await mount(true)
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    expect(tabs.activate).not.toHaveBeenCalled()
  })

  it('user switches away after the lock was shown: no re-activate of Home', async () => {
    await mount(true)
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    await mount(false) // the user clicks an open editor tab
    await mount(true)
    await mount(false)
    expect(tabs.activate).not.toHaveBeenCalled()
  })

  it('brings Home forward once per newly shown lock, not on every homeActive change', async () => {
    await mount(false)
    await act(async () => pushLock!(lock('A.docx', 'a')))
    await flush()
    expect(tabs.activate).toHaveBeenCalledTimes(1)
    await mount(true)
    await mount(false) // the user leaves again while the same lock is up
    expect(tabs.activate).toHaveBeenCalledTimes(1)
    // a further lock is a new one: it comes forward too
    await act(async () => pushLock!(lock('B.docx', 'b')))
    await flush()
    expect(tabs.activate).toHaveBeenCalledTimes(2)
    // and the same path locked again after Close is newly shown as well
    await mount(true)
    await clickClose()
    await clickClose()
    await mount(false)
    await act(async () => pushLock!(lock('B.docx', 'b')))
    await flush()
    expect(tabs.activate).toHaveBeenCalledTimes(3)
  })
})

describe('S11 lock panel: Home behind the panel', () => {
  it('Home controls are focusable before the lock, not while it is shown, and again after Close', async () => {
    await mount()
    expect(homeControls()).toHaveLength(3)
    expect(homeRegion().hasAttribute('inert')).toBe(false)
    homeControls().forEach((el) => expect(isInert(el)).toBe(false))

    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    expect(homeRegion().hasAttribute('inert')).toBe(true)
    // inert = out of the tab order and the a11y tree, for the field, the button and the link alike
    homeControls().forEach((el) => expect(isInert(el)).toBe(true))
    // the panel, its Close button and the alert node stay reachable
    expect(isInert(region()!)).toBe(false)
    expect(isInert(region()!.querySelector('button')!)).toBe(false)
    expect(isInert(alertNode()!)).toBe(false)

    await clickClose()
    expect(homeRegion().hasAttribute('inert')).toBe(false)
    homeControls().forEach((el) => expect(isInert(el)).toBe(false))
  })

  it('stays inert while a second lock is queued behind the first', async () => {
    await mount()
    await act(async () => pushLock!(lock('A.docx', 'a')))
    await act(async () => pushLock!(lock('B.docx', 'b')))
    await flush()
    await clickClose()
    expect(region()).not.toBeNull()
    expect(homeRegion().hasAttribute('inert')).toBe(true)
  })

  it('Close of the last lock puts focus back on what had it when the lock appeared', async () => {
    await mount()
    const button = host.querySelector<HTMLElement>('#home-action')!
    button.focus()
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    expect(document.activeElement).toBe(title())
    await clickClose()
    expect(document.activeElement).toBe(button)
  })

  it('Close of the last lock falls back to the Home region when nothing usable had focus', async () => {
    await mount()
    expect(document.activeElement).toBe(document.body)
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    await clickClose()
    expect(document.activeElement).toBe(homeRegion())
    expect(homeRegion().getAttribute('tabindex')).toBe('-1')
  })

  it('Close with a lock still queued moves focus to the next panel title, not back to Home', async () => {
    await mount()
    const button = host.querySelector<HTMLElement>('#home-action')!
    button.focus()
    await act(async () => pushLock!(lock('A.docx', 'a')))
    await act(async () => pushLock!(lock('B.docx', 'b')))
    await flush()
    await clickClose()
    expect(document.activeElement).toBe(title())
    await clickClose()
    // the element captured for the first lock is still the one restored
    expect(document.activeElement).toBe(button)
  })

  it('does not steal focus on mount when there is no lock', async () => {
    await mount()
    expect(document.activeElement).toBe(document.body)
  })
})
