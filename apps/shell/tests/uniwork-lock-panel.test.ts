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
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'

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
      action: 'dismiss',
    })
    for (const lang of ['vi', 'en'] as const) {
      const table = { ...syncStrings[lang], ...uniworkDocumentStrings[lang] } as Record<
        string,
        string
      >
      const copy = lockCopyOf({ reason: 'store_newer' })
      for (const k of [copy.titleKey, copy.bodyKey, copy.actionKey]) {
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

  it('merges by path (case-insensitive drive letter), the newest push wins and moves to the end, and removes by path', () => {
    const a = lock('A.docx', 'a')
    const b = lock('B.docx', 'b')
    const aAgain = { ...a, path: a.path.replace('C:', 'c:') }
    expect(mergeLocks([a], [b])).toEqual([a, b])
    expect(mergeLocks([a, b], [aAgain])).toEqual([b, aAgain])
    expect(shownLock(mergeLocks([a, b], [aAgain]))).toBe(aAgain)
    expect(withoutLock([a, b], a.path.toLowerCase())).toEqual([b])
    expect(shownLock([a, b])).toBe(b)
    expect(shownLock([])).toBeNull()
  })
})

let host: HTMLDivElement
let root: Root
let pushLock: ((l: UniworkDocLock) => void) | null
let pushLocksChanged: ((locks: UniworkDocLock[]) => void) | null
let changeAccount: (() => void) | null
let initial: UniworkDocLock[]
let api: {
  onUniworkLock: ReturnType<typeof vi.fn>
  onUniworkLocksChanged: ReturnType<typeof vi.fn>
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

async function mount(
  homeActive = true,
  locale: 'en' | 'vi' = 'en',
  home: () => ReturnType<typeof createElement> = homeStub,
): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: locale },
        createElement(UniworkLockHost, { homeActive }, home()),
      ),
    )
  })
  await flush()
}

/** the signed-in account changed: main already forgot the old locks, the shell is told via the workbench bucket */
async function switchAccount(remaining: UniworkDocLock[]): Promise<void> {
  initial = remaining
  await act(async () => changeAccount!())
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
  pushLocksChanged = null
  changeAccount = null
  initial = []
  api = {
    onUniworkLock: vi.fn((cb: (l: UniworkDocLock) => void) => {
      pushLock = cb
      return () => {
        pushLock = null
      }
    }),
    onUniworkLocksChanged: vi.fn((cb: (locks: UniworkDocLock[]) => void) => {
      pushLocksChanged = cb
      return () => {
        pushLocksChanged = null
      }
    }),
    uniworkLocks: vi.fn(async () => initial),
    dismissUniworkLock: vi.fn(async () => undefined),
  }
  tabs = { activate: vi.fn(async () => undefined) }
  window.aiOffice = {
    ...api,
    wb: {
      onBucketChanged: vi.fn((cb: () => void) => {
        changeAccount = cb
        return () => {
          changeAccount = null
        }
      }),
    },
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

describe('preload locks-changed listener', () => {
  it('fans a list out and ignores a payload that is not an array', async () => {
    vi.resetModules()
    const handlers = new Map<string, (event: unknown, raw: unknown) => void>()
    const exposed: Record<string, Record<string, unknown>> = {}
    const ipcRenderer = {
      on: vi.fn((channel: string, cb: (event: unknown, raw: unknown) => void) => {
        handlers.set(channel, cb)
      }),
      invoke: vi.fn(async () => undefined),
      send: vi.fn(),
      removeListener: vi.fn(),
    }
    vi.doMock('electron', () => ({
      contextBridge: {
        exposeInMainWorld: (key: string, value: Record<string, unknown>) => {
          exposed[key] = value
        },
      },
      ipcRenderer,
      webUtils: { getPathForFile: vi.fn() },
    }))
    try {
      await import('../src/preload/index')
      const bridge = exposed.aiOffice as unknown as LockApiForTest
      const seen: UniworkDocLock[][] = []
      const off = bridge.onUniworkLocksChanged((locks) => seen.push(locks))
      const push = handlers.get('uniwork-doc:locks-changed')!
      push({}, [{ path: 'D:/A.docx', reason: 'store_newer' }])
      expect(seen).toHaveLength(1)
      expect(seen[0]).toHaveLength(1)
      // a malformed payload would otherwise become [] and wipe every panel
      for (const bad of [undefined, null, 'x', 7, { path: 'D:/A.docx' }]) push({}, bad)
      expect(seen).toHaveLength(1)
      // a real empty list still clears
      push({}, [])
      expect(seen).toHaveLength(2)
      expect(seen[1]).toEqual([])
      off()
      push({}, [])
      expect(seen).toHaveLength(2)
    } finally {
      vi.doUnmock('electron')
      vi.resetModules()
    }
  })
})

type LockApiForTest = {
  onUniworkLocksChanged: (cb: (locks: UniworkDocLock[]) => void) => () => void
}

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

  it('Home carries no permanent tabindex: a click on a plain spot of Home focuses nothing', async () => {
    await mount()
    expect(homeRegion().hasAttribute('tabindex')).toBe(false)
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    expect(homeRegion().hasAttribute('tabindex')).toBe(false)
    await clickClose()
    expect(homeRegion().hasAttribute('tabindex')).toBe(false)
  })

  it('Close of the last lock falls back to a visible Home landmark when nothing usable had focus', async () => {
    await mount()
    expect(document.activeElement).toBe(document.body)
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    await clickClose()
    const main = host.querySelector<HTMLElement>('[data-testid="home"]')!
    expect(document.activeElement).toBe(main)
    // the ring marker and the tabindex exist only while it holds focus
    expect(main.hasAttribute('data-uw-focus-fallback')).toBe(true)
    expect(main.getAttribute('tabindex')).toBe('-1')
    await act(async () => host.querySelector<HTMLElement>('#home-action')!.focus())
    expect(main.hasAttribute('data-uw-focus-fallback')).toBe(false)
    expect(main.hasAttribute('tabindex')).toBe(false)
  })

  it("the fallback prefers Home's heading to a landmark, and skips a hidden one", async () => {
    const homeWithHeading = () =>
      createElement(
        'div',
        null,
        createElement('h1', { id: 'hidden-h1', hidden: true }, 'Hidden'),
        createElement('main', { id: 'home-main' }, createElement('h1', { id: 'home-h1' }, 'Hello')),
      )
    await mount(true, 'en', homeWithHeading)
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    await clickClose()
    const heading = host.querySelector<HTMLElement>('#home-h1')!
    expect(document.activeElement).toBe(heading)
    expect(heading.hasAttribute('data-uw-focus-fallback')).toBe(true)
  })

  it('a previously focused element that is no longer connected falls back to the Home target', async () => {
    await mount()
    const button = host.querySelector<HTMLElement>('#home-action')!
    button.focus()
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    button.remove()
    await clickClose()
    expect(document.activeElement).toBe(host.querySelector('[data-testid="home"]'))
  })

  it('focus that already went elsewhere is not pulled back on Close', async () => {
    await mount()
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    const outside = document.createElement('button')
    document.body.append(outside)
    try {
      await act(async () => {
        region()!.querySelector('button')!.click()
        outside.focus()
      })
      await flush()
      expect(document.activeElement).toBe(outside)
    } finally {
      outside.remove()
    }
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

describe('S11 lock panel: account change and re-push', () => {
  it('a lock shown, the account changes and main has none left: the panel is gone and Home is not inert', async () => {
    await mount()
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    expect(region()).not.toBeNull()
    expect(homeRegion().hasAttribute('inert')).toBe(true)
    await switchAccount([])
    expect(api.uniworkLocks).toHaveBeenCalledTimes(2)
    expect(region()).toBeNull()
    expect(alertText()).toBe('')
    expect(homeRegion().hasAttribute('inert')).toBe(false)
    homeControls().forEach((el) => expect(isInert(el)).toBe(false))
  })

  it('the list is replaced by what main has now, not merged', async () => {
    await mount()
    await act(async () => pushLock!(lock('A.docx', 'a')))
    await flush()
    await switchAccount([lock('B.docx', 'b')])
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1)
    // A is gone for good: closing B leaves nothing behind it
    await clickClose()
    expect(api.dismissUniworkLock).toHaveBeenCalledWith(lock('B.docx', 'b').path)
    expect(region()).toBeNull()
  })

  it('a lock pushed while the account read is in flight survives it; a stale one does not', async () => {
    await mount()
    await act(async () => pushLock!(lock('Old.docx', 'o')))
    await flush()
    let release!: (v: UniworkDocLock[]) => void
    api.uniworkLocks.mockImplementationOnce(() => new Promise((res) => (release = res)))
    await act(async () => changeAccount!())
    await act(async () => pushLock!(lock('New.docx', 'n')))
    await act(async () => release([]))
    await flush()
    expect(title()).not.toBeNull()
    await clickClose()
    expect(api.dismissUniworkLock).toHaveBeenCalledWith(lock('New.docx', 'n').path)
    expect(region()).toBeNull()
  })

  it("a failed re-read drops the previous account's panel instead of keeping it", async () => {
    await mount()
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    api.uniworkLocks.mockImplementationOnce(async () => {
      throw new Error('ipc')
    })
    await act(async () => changeAccount!())
    await flush()
    expect(region()).toBeNull()
    expect(homeRegion().hasAttribute('inert')).toBe(false)
  })

  it('the activated set is pruned: the same path locked again for the next account brings Home forward', async () => {
    await mount(false)
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    expect(tabs.activate).toHaveBeenCalledTimes(1)
    await switchAccount([])
    expect(region()).toBeNull()
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    expect(tabs.activate).toHaveBeenCalledTimes(2)
  })

  it('the activated set is pruned to the remaining keys: a lock that left and comes back by a read is newly shown', async () => {
    await mount(false)
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    expect(tabs.activate).toHaveBeenCalledTimes(1)
    await switchAccount([])
    await switchAccount([lock('Plan.docx')]) // no push in between: only the prune can have cleared the key
    expect(region()).not.toBeNull()
    expect(tabs.activate).toHaveBeenCalledTimes(2)
  })

  it('an account change that returns the same lock does not bring Home forward again', async () => {
    await mount(false)
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    await switchAccount([lock('Plan.docx')])
    expect(region()).not.toBeNull()
    expect(tabs.activate).toHaveBeenCalledTimes(1)
  })

  it('a re-push of the shown lock while an editor tab is active brings Home forward again', async () => {
    await mount(false)
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    expect(tabs.activate).toHaveBeenCalledTimes(1)
    await mount(true)
    await mount(false) // the user picks an editor tab, opens the same copy again; main pushes it again
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    expect(tabs.activate).toHaveBeenCalledTimes(2)
    expect(tabs.activate).toHaveBeenLastCalledWith('home')
    expect(host.querySelectorAll('[role="region"]')).toHaveLength(1)
  })

  it('a re-push with Home already in front does not call activate', async () => {
    await mount(true)
    await act(async () => pushLock!(lock('Plan.docx')))
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    expect(tabs.activate).not.toHaveBeenCalled()
  })

  it('a re-push of a queued lock makes it the shown one and brings Home forward', async () => {
    const a = lock('A.docx', 'a')
    const b = lock('B.docx', 'b')
    await mount(false)
    await act(async () => pushLock!(a))
    await act(async () => pushLock!(b))
    await flush()
    expect(tabs.activate).toHaveBeenCalledTimes(2)
    await mount(true)
    await mount(false)
    await act(async () => pushLock!(a)) // A was queued behind B: it is shown now
    await flush()
    expect(tabs.activate).toHaveBeenCalledTimes(3)
    await mount(true)
    await clickClose()
    expect(api.dismissUniworkLock).toHaveBeenCalledWith(a.path)
    expect(region()).not.toBeNull() // B is still behind it
  })
})

describe('S11 lock panel (keystore locked)', () => {
  const keystoreLock = (name = 'Plan.docx'): UniworkDocLock => ({
    ...lock(name),
    reason: 'keystore_locked',
  })
  let accountRetry: ReturnType<typeof vi.fn>
  const actionButton = () => region()!.querySelector('button')!

  beforeEach(() => {
    accountRetry = vi.fn(async () => ({ loggedIn: true, state: 'keystore-locked' }))
    ;(window.aiOffice as unknown as { accountRetry: unknown }).accountRetry = accountRetry
  })

  it('maps keystore_locked to the keychain S11 keys and the Retry action; store_newer is unchanged', () => {
    expect(lockCopyOf({ reason: 'keystore_locked' })).toEqual({
      titleKey: 'uwLockKeystoreTitle',
      bodyKey: 'uwLockKeystore',
      actionKey: 'uwActRetry',
      action: 'retry',
    })
    expect(lockCopyOf({ reason: 'store_newer' }).action).toBe('dismiss')
  })

  it('shows the keychain copy and Retry (en)', async () => {
    await mount()
    await act(async () => pushLock!(keystoreLock()))
    await flush()
    expect(title()!.textContent).toBe(syncStrings.en.uwLockKeystoreTitle)
    expect(region()!.textContent).toContain(syncStrings.en.uwLockKeystore)
    expect(title()!.textContent).not.toBe('A newer app version is needed')
    expect(actionButton().textContent).toBe('Retry')
    expect(alertText()).toBe(
      `${syncStrings.en.uwLockKeystoreTitle}. ${syncStrings.en.uwLockKeystore}`,
    )
  })

  it('shows the Vietnamese copy and Thử lại', async () => {
    await mount(true, 'vi')
    await act(async () => pushLock!(keystoreLock()))
    await flush()
    expect(title()!.textContent).toBe(syncStrings.vi.uwLockKeystoreTitle)
    expect(actionButton().textContent).toBe('Thử lại')
  })

  it('Retry retries the account and re-reads the locks; it does not dismiss', async () => {
    await mount()
    await act(async () => pushLock!(keystoreLock()))
    await flush()
    // the keychain was unlocked: main dropped the lock when the store opened
    initial = []
    api.uniworkLocks.mockClear()
    await act(async () => actionButton().click())
    await flush()
    expect(accountRetry).toHaveBeenCalledTimes(1)
    expect(api.dismissUniworkLock).not.toHaveBeenCalled()
    expect(api.uniworkLocks).toHaveBeenCalledTimes(1)
    expect(region()).toBeNull()
  })

  it('Retry: the first re-read still returns the lock; the pushed empty list removes the panel and focus lands on Home', async () => {
    const still = keystoreLock()
    initial = [still]
    await mount()
    expect(api.onUniworkLocksChanged).toHaveBeenCalledTimes(1)
    await act(async () => actionButton().click())
    await flush()
    // main had not finished opening the store when the re-read ran
    expect(accountRetry).toHaveBeenCalledTimes(1)
    expect(title()!.textContent).toBe(syncStrings.en.uwLockKeystoreTitle)
    // the store opened: main pushes the whole (now empty) list
    await act(async () => pushLocksChanged!([]))
    await flush()
    expect(region()).toBeNull()
    expect(alertText()).toBe('')
    expect(isInert(homeRegion())).toBe(false)
    expect(document.activeElement).toBe(host.querySelector('[data-testid="home"]'))
    expect(api.dismissUniworkLock).not.toHaveBeenCalled()
  })

  it('a pushed list replaces the list and an in-flight read does not bring the lock back', async () => {
    initial = [keystoreLock()]
    await mount()
    let release!: (locks: UniworkDocLock[]) => void
    api.uniworkLocks.mockImplementationOnce(() => new Promise((res) => (release = res)))
    await act(async () => actionButton().click())
    await flush()
    // the read began before main cleared the lock, so it answers with the old list
    await act(async () => pushLocksChanged!([]))
    release([keystoreLock()])
    await flush()
    expect(region()).toBeNull()
    // and the list is exactly what main pushed
    await act(async () => pushLocksChanged!([lock('Other.docx')]))
    expect(title()!.textContent).toBe(uniworkDocumentStrings.en.uwLockNewerStoreTitle)
  })

  it('a lock the user closed while a read is in flight stays closed in a pushed list', async () => {
    await mount()
    await act(async () => pushLock!(lock('A.docx')))
    await flush()
    let release!: (locks: UniworkDocLock[]) => void
    api.uniworkLocks.mockImplementationOnce(() => new Promise((res) => (release = res)))
    await act(async () => changeAccount!())
    await clickClose()
    await act(async () => pushLocksChanged!([lock('A.docx')]))
    release([lock('A.docx')])
    await flush()
    expect(region()).toBeNull()
  })

  it('a push snapshot built before main processed a Close cannot bring the closed panel back', async () => {
    await mount()
    await act(async () => pushLock!(lock('A.docx')))
    await flush()
    // no read in flight: only the dismissed set can hold the path out
    await clickClose()
    expect(region()).toBeNull()
    await act(async () => pushLocksChanged!([lock('A.docx')]))
    await flush()
    expect(region()).toBeNull()
    // main caught up: a list without the path forgets it, so the same path locked again shows
    await act(async () => pushLocksChanged!([]))
    await act(async () => pushLocksChanged!([lock('A.docx')]))
    await flush()
    expect(region()).not.toBeNull()
  })

  it('a pushed lock for a closed path shows again, and a read without it clears the closed memory', async () => {
    await mount()
    await act(async () => pushLock!(lock('A.docx')))
    await flush()
    await clickClose()
    await act(async () => pushLock!(lock('A.docx')))
    await flush()
    expect(region()).not.toBeNull()
    await clickClose()
    // a read (main processed the close) no longer has it, then it is locked again
    initial = []
    await act(async () => changeAccount!())
    await flush()
    await act(async () => pushLocksChanged!([lock('A.docx')]))
    await flush()
    expect(region()).not.toBeNull()
  })

  it('Retry is aria-disabled (never disabled) and aria-busy while pending; a double click makes one accountRetry call', async () => {
    initial = [keystoreLock()]
    let finish!: (s: unknown) => void
    accountRetry.mockImplementationOnce(() => new Promise((res) => (finish = res)))
    await mount()
    const button = actionButton()
    expect(button.disabled).toBe(false)
    expect(button.hasAttribute('aria-busy')).toBe(false)
    expect(button.hasAttribute('aria-disabled')).toBe(false)
    button.focus()
    await act(async () => {
      button.click()
      button.click()
    })
    await flush()
    expect(accountRetry).toHaveBeenCalledTimes(1)
    // not `disabled`: a disabled button would drop the keyboard focus to <body>
    expect(button.disabled).toBe(false)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(document.activeElement).toBe(button)
    await act(async () => {
      button.click()
    })
    expect(accountRetry).toHaveBeenCalledTimes(1)
    await act(async () => finish({ loggedIn: true, state: 'keystore-locked' }))
    await flush()
    expect(actionButton().hasAttribute('aria-disabled')).toBe(false)
    expect(actionButton().hasAttribute('aria-busy')).toBe(false)
    expect(document.activeElement).toBe(actionButton())
    // idle again: the next click retries again
    await act(async () => actionButton().click())
    await flush()
    expect(accountRetry).toHaveBeenCalledTimes(2)
  })

  it('Retry is a native button on the tab order: Enter and Space are not swallowed and activate it', async () => {
    initial = [keystoreLock()]
    await mount()
    const button = actionButton()
    expect(button.tagName).toBe('BUTTON')
    expect(button.type).toBe('button')
    expect(button.tabIndex).toBeGreaterThanOrEqual(0)
    expect(title()!.tabIndex).toBe(-1)
    button.focus()
    expect(document.activeElement).toBe(button)
    for (const key of ['Enter', ' ']) {
      accountRetry.mockClear()
      const down = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      button.dispatchEvent(down)
      button.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }))
      // nothing prevents the browser's own key activation (jsdom has none: it is the click it fires)
      expect(down.defaultPrevented).toBe(false)
      await act(async () => button.click())
      await flush()
      expect(accountRetry).toHaveBeenCalledTimes(1)
    }
  })

  it('keeps the panel when the keychain is still locked after Retry', async () => {
    const still = keystoreLock()
    initial = [still]
    await mount()
    await act(async () => actionButton().click())
    await flush()
    expect(accountRetry).toHaveBeenCalledTimes(1)
    expect(title()!.textContent).toBe(syncStrings.en.uwLockKeystoreTitle)
    expect(api.dismissUniworkLock).not.toHaveBeenCalled()
  })

  it('focus stays on Retry after a rejected retry while the lock is still shown', async () => {
    initial = [keystoreLock()]
    accountRetry.mockRejectedValueOnce(new Error('ipc'))
    await mount()
    actionButton().focus()
    await act(async () => actionButton().click())
    await flush()
    expect(region()).not.toBeNull()
    expect(actionButton().hasAttribute('aria-disabled')).toBe(false)
    expect(document.activeElement).toBe(actionButton())
  })

  it('a failed Retry call still re-reads the locks', async () => {
    initial = [keystoreLock()]
    accountRetry.mockRejectedValueOnce(new Error('ipc'))
    await mount()
    api.uniworkLocks.mockClear()
    await act(async () => actionButton().click())
    await flush()
    expect(api.uniworkLocks).toHaveBeenCalledTimes(1)
    expect(region()).not.toBeNull()
  })

  it('store_newer keeps Close, which dismisses and does not retry', async () => {
    await mount()
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    expect(actionButton().textContent).toBe('Close')
    await clickClose()
    expect(api.dismissUniworkLock).toHaveBeenCalledTimes(1)
    expect(accountRetry).not.toHaveBeenCalled()
    expect(region()).toBeNull()
  })
})

describe('S11 lock panel (signed out)', () => {
  const signedOutLock = (name = 'Plan.docx'): UniworkDocLock => ({
    ...lock(name),
    reason: 'signed_out',
  })
  let accountLogin: ReturnType<typeof vi.fn>
  const actionButton = () => region()!.querySelector('button')!

  beforeEach(() => {
    accountLogin = vi.fn(async () => true)
    ;(window.aiOffice as unknown as { accountLogin: unknown }).accountLogin = accountLogin
  })

  it('reason signed_out renders uwLockSignedOutTitle / uwLockSignedOut', async () => {
    expect(lockCopyOf({ reason: 'signed_out' })).toEqual({
      titleKey: 'uwLockSignedOutTitle',
      bodyKey: 'uwLockSignedOut',
      actionKey: 'uwActSignIn',
      action: 'sign-in',
    })
    const { blockedReasonKey } = await import('../src/renderer/src/uniwork-docs-model')
    expect(blockedReasonKey('signed_out')).toBe('uwReasonSignedOut')
    expect(blockedReasonKey('store_newer')).toBe('uwReasonStoreNewer')

    await mount(true, 'en')
    await act(async () => pushLock!(signedOutLock()))
    await flush()
    expect(title()!.textContent).toBe(syncStrings.en.uwLockSignedOutTitle)
    expect(region()!.textContent).toContain(syncStrings.en.uwLockSignedOut)
    expect(actionButton().textContent).toBe(syncStrings.en.uwActSignIn)
    expect(alertText()).toBe(
      `${syncStrings.en.uwLockSignedOutTitle}. ${syncStrings.en.uwLockSignedOut}`,
    )

    await act(async () => actionButton().click())
    await flush()
    expect(accountLogin).toHaveBeenCalledTimes(1)
    expect(api.dismissUniworkLock).not.toHaveBeenCalled()

    act(() => root.unmount())
    root = createRoot(host)
    initial = [signedOutLock()]
    await mount(true, 'vi')
    expect(title()!.textContent).toBe(syncStrings.vi.uwLockSignedOutTitle)
    expect(region()!.textContent).toContain(syncStrings.vi.uwLockSignedOut)
    expect(actionButton().textContent).toBe(syncStrings.vi.uwActSignIn)
  })
})
