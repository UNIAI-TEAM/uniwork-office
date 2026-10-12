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

async function mount(homeActive = true, locale: 'en' | 'vi' = 'en'): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: locale },
        createElement(UniworkLockHost, { homeActive }),
      ),
    )
  })
  await flush()
}

const region = () => host.querySelector<HTMLElement>('[role="region"]')
const title = () => host.querySelector<HTMLElement>('h3')
const alertText = () => host.querySelector('[role="alert"]')?.textContent

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
    expect(alertText()).toBeUndefined()
    await act(async () => pushLock!(lock('Plan.docx')))
    await flush()
    expect(alertText()).toBe(
      `${uniworkDocumentStrings.en.uwLockNewerStoreTitle}. ${uniworkDocumentStrings.en.uwLockNewerStore}`,
    )
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1)
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
})
