/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, UniworkDocLock, UniworkLockReason } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UniworkLockHost } from '../src/renderer/src/UniworkLockPanel'
import { lockCopyOf } from '../src/renderer/src/uniwork-lock-model'
import { takeRequestedSyncTab } from '../src/renderer/src/offline-library-model'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'

/**
 * G5-05u F7 (UNI-1360): every reason of EXPERIENCE.md › Trạng thái khóa (S11)
 * maps to its title and sentence, and to the action of the "Lý do bị chặn"
 * table; the panel is a region labelled by its title, focus goes to the title
 * and "{title}. {body}" is written once to the window's alert node.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const EN = { ...syncStrings.en, ...uniworkDocumentStrings.en } as Record<string, string>

/** S11 table + the action column of "Lý do bị chặn" */
const S11: {
  reason: UniworkLockReason
  libraryOff?: boolean
  title: string
  body: string
  actionKey: string
  action: string
}[] = [
  {
    reason: 'signed_out',
    title: 'uwLockSignedOutTitle',
    body: 'uwLockSignedOut',
    actionKey: 'uwActSignIn',
    action: 'sign-in',
  },
  {
    reason: 'lease_expired',
    title: 'uwLockLeaseTitle',
    body: 'uwLockExpired',
    actionKey: 'uwActReconnect',
    action: 'retry',
  },
  {
    reason: 'lease_expired',
    libraryOff: true,
    title: 'uwLockLeaseTitle',
    body: 'uwLockLibraryOff',
    actionKey: 'uwQueueOpenCenter',
    action: 'sync-center',
  },
  {
    reason: 'keystore_locked',
    title: 'uwLockKeystoreTitle',
    body: 'uwLockKeystore',
    actionKey: 'uwActRetry',
    action: 'retry',
  },
  {
    reason: 'clock_rollback',
    title: 'uwLockClockTitle',
    body: 'uwLockClock',
    actionKey: 'uwActReconnect',
    action: 'retry',
  },
  {
    reason: 'permission_revoked',
    title: 'uwLockRevokedTitle',
    body: 'uwRemoteRevoked',
    actionKey: 'uwActRecheck',
    action: 'retry',
  },
  {
    reason: 'document_deleted',
    title: 'uwLockDeletedTitle',
    body: 'uwRemoteDeleted',
    actionKey: 'uwActRecheck',
    action: 'retry',
  },
  {
    reason: 'foreign_account',
    title: 'uwLockForeignTitle',
    body: 'uwLockForeign',
    actionKey: 'uwActSwitchAccount',
    action: 'switch-account',
  },
  {
    reason: 'organization_suspended',
    title: 'uwLockOrgTitle',
    body: 'uwLockSuspended',
    actionKey: 'uwActRecheck',
    action: 'retry',
  },
  {
    reason: 'member_deactivated',
    title: 'uwLockOrgTitle',
    body: 'uwLockDeactivated',
    actionKey: 'uwActRecheck',
    action: 'retry',
  },
  {
    reason: 'store_newer',
    title: 'uwLockNewerStoreTitle',
    body: 'uwLockNewerStore',
    actionKey: 'uwPickClose',
    action: 'dismiss',
  },
]

const lockOf = (reason: UniworkLockReason, libraryOff?: boolean): UniworkDocLock => ({
  path: `C:\\ud\\uniwork-documents\\d1\\${reason}.docx`,
  reason,
  name: `${reason}.docx`,
  ...(libraryOff ? { libraryOff } : {}),
})

let host: HTMLDivElement
let root: Root
let pushLock: ((l: UniworkDocLock) => void) | null
let accountRetry: ReturnType<typeof vi.fn>
let accountLogin: ReturnType<typeof vi.fn>
let dismiss: ReturnType<typeof vi.fn>

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

beforeEach(async () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  pushLock = null
  accountRetry = vi.fn(async () => undefined)
  accountLogin = vi.fn(async () => true)
  dismiss = vi.fn(async () => undefined)
  window.aiOffice = {
    onUniworkLock: vi.fn((cb: (l: UniworkDocLock) => void) => {
      pushLock = cb
      return () => {
        pushLock = null
      }
    }),
    onUniworkLocksChanged: vi.fn(() => () => undefined),
    uniworkLocks: vi.fn(async () => []),
    dismissUniworkLock: dismiss,
    accountRetry,
    accountLogin,
    wb: { onBucketChanged: vi.fn(() => () => undefined) },
  } as unknown as HomeApi as Window['aiOffice']
  ;(window as unknown as { aiOfficeTabs: unknown }).aiOfficeTabs = {
    activate: vi.fn(async () => undefined),
  }
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(
          UniworkLockHost,
          { homeActive: true },
          createElement('main', null, createElement('h1', null, 'Home')),
        ),
      ),
    )
  })
  await flush()
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  takeRequestedSyncTab()
})

const region = () => host.querySelector<HTMLElement>('[role="region"]')!
const alertNode = () => host.querySelector<HTMLElement>('[role="alert"]')!

describe('S11 lock panel: every reason of the S11 table', () => {
  it.each(S11)(
    '$reason (libraryOff: $libraryOff): title, body and the blocked-reasons action',
    async (c) => {
      expect(lockCopyOf({ reason: c.reason, libraryOff: c.libraryOff })).toEqual({
        titleKey: c.title,
        bodyKey: c.body,
        actionKey: c.actionKey,
        action: c.action,
      })
      await act(async () => pushLock!(lockOf(c.reason, c.libraryOff)))
      await flush()
      const title = region().querySelector<HTMLElement>('h3')!
      expect(title.textContent).toBe(EN[c.title])
      expect(region().querySelector('.uw-lock-body')!.textContent).toBe(EN[c.body])
      expect(region().querySelector('button')!.textContent).toBe(EN[c.actionKey])
      // a11y: region labelled by the title, focus on the title, the action is the next Tab stop
      expect(region().getAttribute('aria-labelledby')).toBe(title.id)
      expect(title.getAttribute('tabindex')).toBe('-1')
      expect(document.activeElement).toBe(title)
      const focusable = Array.from(region().querySelectorAll<HTMLElement>('button, [href]'))
      expect(focusable[0]).toBe(region().querySelector('button'))
      expect(alertNode().textContent).toBe(`${EN[c.title]}. ${EN[c.body]}`)
    },
  )

  it('the alert text is written once: a re-render with the same lock does not add to it', async () => {
    await act(async () => pushLock!(lockOf('clock_rollback')))
    await flush()
    const said = alertNode().textContent
    await act(async () => pushLock!(lockOf('clock_rollback')))
    await flush()
    expect(alertNode().textContent).toBe(said)
    expect(alertNode().childNodes).toHaveLength(1)
  })

  it('Kết nối lại (lease_expired) re-reads the account: the retry path', async () => {
    await act(async () => pushLock!(lockOf('lease_expired')))
    await flush()
    await act(async () => region().querySelector('button')!.click())
    await flush()
    expect(accountRetry).toHaveBeenCalledTimes(1)
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('libraryOff: "Mở trung tâm đồng bộ" closes the panel and opens the sync center', async () => {
    const onOpen = vi.fn()
    window.addEventListener('uniwork:open-settings', onOpen)
    await act(async () => pushLock!(lockOf('lease_expired', true)))
    await flush()
    await act(async () => region().querySelector('button')!.click())
    await flush()
    window.removeEventListener('uniwork:open-settings', onOpen)
    expect(dismiss).toHaveBeenCalledWith(lockOf('lease_expired').path)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect((onOpen.mock.calls[0]![0] as CustomEvent).detail).toEqual({ section: 'sync' })
    expect(accountRetry).not.toHaveBeenCalled()
  })

  it('foreign_account: "Chuyển tài khoản" closes the panel and opens Settings › Account', async () => {
    const onOpen = vi.fn()
    window.addEventListener('uniwork:open-settings', onOpen)
    await act(async () => pushLock!(lockOf('foreign_account')))
    await flush()
    await act(async () => region().querySelector('button')!.click())
    await flush()
    window.removeEventListener('uniwork:open-settings', onOpen)
    expect((onOpen.mock.calls[0]![0] as CustomEvent).detail).toEqual({ section: 'account' })
    expect(accountLogin).not.toHaveBeenCalled()
    expect(dismiss).toHaveBeenCalledTimes(1)
  })
})
