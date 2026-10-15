/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import type { AccountController } from '../src/renderer/src/account-model'
import { LocaleProvider } from '../src/renderer/src/locale'
import { SettingsModal } from '../src/renderer/src/SettingsModal'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'

/**
 * G5-10: Settings > Sync center. The nav entry opens the pane, the account page links to it only
 * while signed in, and the pane's account buttons are wired to the account's own flows.
 */

interface PaneProps {
  onSignIn?: () => void
  onSignOut?: () => void
  onSwitchAccount?: () => void
}
const pane = vi.hoisted(() => ({ props: null as PaneProps | null }))

vi.mock('../src/renderer/src/SyncCenterPane', () => ({
  SyncCenterPane: (props: PaneProps) => {
    pane.props = props
    return createElement('div', { 'data-testid': 'sync-center-pane' })
  },
}))
vi.mock('../src/renderer/src/AccountPane', () => ({
  AccountPane: () => createElement('div', { 'data-testid': 'account-pane' }),
}))

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const en = syncStrings.en as Record<string, string>

let host: HTMLDivElement
let root: Root
let onClose: ReturnType<typeof vi.fn>

const accountOf = (loggedIn: boolean) =>
  ({
    status: { loggedIn },
    signIn: vi.fn(),
    signOut: vi.fn(),
  }) as unknown as AccountController & {
    signIn: ReturnType<typeof vi.fn>
    signOut: ReturnType<typeof vi.fn>
  }

beforeEach(() => {
  pane.props = null
  onClose = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  window.aiOffice = {
    getTheme: async () => 'system',
    getDefaultSaveDir: async () => '',
    getAiPanelPrefs: async () => ({ fontSize: 'medium', customFontSize: 14, spellcheck: true }),
    getUpdateChannel: async () => 'stable',
    getAppVersion: async () => '1.0.0',
  } as unknown as HomeApi
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function open(account: AccountController): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(SettingsModal, { onClose, account, initialSection: 'account' }),
      ),
    )
    await Promise.resolve()
  })
}

async function click(el: Element | null | undefined): Promise<void> {
  await act(async () => {
    ;(el as HTMLElement).click()
    await Promise.resolve()
  })
}

const navEntry = () =>
  [...host.querySelectorAll<HTMLButtonElement>('.set-nav button')].find((b) =>
    b.textContent?.includes(en.uwSyncTitle!),
  )
const paneLink = () => host.querySelector<HTMLButtonElement>('.set-pane .sc-link')
const syncPane = () => host.querySelector('[data-testid="sync-center-pane"]')
const accountPane = () => host.querySelector('[data-testid="account-pane"]')

describe('Settings > Sync center', () => {
  it('the nav entry shows the pane', async () => {
    await open(accountOf(true))
    expect(syncPane()).toBeNull()
    expect(navEntry()).toBeTruthy()
    await click(navEntry())
    expect(syncPane()).not.toBeNull()
    expect(accountPane()).toBeNull()
  })

  it('the account page links to the pane only while signed in', async () => {
    await open(accountOf(true))
    expect(accountPane()).not.toBeNull()
    expect(paneLink()?.textContent).toBe(en.uwSyncOpenFromSettings)
    await click(paneLink())
    expect(syncPane()).not.toBeNull()

    act(() => root.unmount())
    root = createRoot(host)
    await open(accountOf(false))
    expect(accountPane()).not.toBeNull()
    expect(paneLink()).toBeNull()
    expect(syncPane()).toBeNull()
  })

  it('Switch account goes to the account section', async () => {
    await open(accountOf(true))
    await click(navEntry())
    expect(pane.props?.onSwitchAccount).toBeTypeOf('function')
    await act(async () => pane.props!.onSwitchAccount!())
    expect(accountPane()).not.toBeNull()
    expect(syncPane()).toBeNull()
  })

  it('Sign out and Sign in are the account own flows', async () => {
    const account = accountOf(true)
    await open(account)
    await click(navEntry())
    pane.props!.onSignOut!()
    expect(account.signOut).toHaveBeenCalledTimes(1)
    pane.props!.onSignIn!()
    expect(account.signIn).toHaveBeenCalledTimes(1)
  })
})
