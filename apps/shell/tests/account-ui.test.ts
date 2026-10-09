/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AccountErrorCode,
  AccountLoginEvent,
  AccountState,
  AccountStatus,
  HomeApi,
} from '../src/shared/home-api'
import { AccountEntry } from '../src/renderer/src/AccountEntry'
import { ACCOUNT_ERROR_KEYS } from '../src/renderer/src/account-model'
import { LocaleProvider } from '../src/renderer/src/locale'
import type { Lang } from '../src/renderer/src/locale'
import type { SettingsSectionId } from '../src/renderer/src/SettingsModal'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const en = accountStrings.en
const vi_ = accountStrings.vi

const PROFILE = { accountId: 'acc-1', email: 'lan.nguyen@example.com', displayName: 'Lan Nguyen' }
const ORGS = [
  { id: 'org-1', name: 'Acme School', slug: 'acme', role: 'owner' },
  { id: 'org-2', name: 'Beta Clinic', slug: 'beta', role: 'member' },
]
const ENTITLEMENTS = {
  orgId: 'org-1',
  planCode: 'pro',
  planName: 'Pro',
  status: 'active',
  features: [],
  fetchedAt: 1,
}

function statusFor(state: AccountState, extra: Partial<AccountStatus> = {}): AccountStatus {
  const withProfile =
    state === 'signed-in' || state === 'refreshing' || state === 'server-unreachable'
  return {
    loggedIn: state === 'signed-in' || state === 'refreshing',
    state,
    serverOrigin: 'uniwork.example',
    ...(withProfile
      ? {
          email: PROFILE.email,
          profile: PROFILE,
          org: ORGS[0],
          orgs: ORGS,
          entitlements: ENTITLEMENTS,
        }
      : {}),
    ...extra,
  }
}

const NO_PROFILE = {
  email: undefined,
  profile: undefined,
  org: undefined,
  orgs: undefined,
  entitlements: undefined,
}

let host: HTMLDivElement
let root: Root
let api: ReturnType<typeof makeApi>

function makeApi(initial: AccountStatus) {
  let pushStatus: ((s: AccountStatus) => void) | null = null
  let pushLogin: ((ev: AccountLoginEvent) => void) | null = null
  const fns = {
    accountStatus: vi.fn(async () => initial),
    onAccountStatus: vi.fn((h: (s: AccountStatus) => void) => {
      pushStatus = h
      return () => {
        pushStatus = null
      }
    }),
    onAccountLogin: vi.fn((h: (ev: AccountLoginEvent) => void) => {
      pushLogin = h
      return () => {
        pushLogin = null
      }
    }),
    accountLogin: vi.fn(async () => true),
    accountCancelLogin: vi.fn(async () => undefined),
    accountRetry: vi.fn(async () => statusFor('signed-in')),
    accountSelectOrg: vi.fn(async (orgId: string) =>
      statusFor('signed-in', { org: ORGS.find((o) => o.id === orgId) }),
    ),
    accountLogout: vi.fn(async () => undefined),
    openLoginUrl: vi.fn(async () => undefined),
  }
  window.aiOffice = {
    ...fns,
    getTheme: async () => 'system',
    getDefaultSaveDir: async () => '',
    getAiPanelPrefs: async () => ({ fontSize: 'default', spellcheck: true }),
    getUpdateChannel: async () => 'stable',
    getAppVersion: async () => '1.0.0',
    getUpdateState: async () => null,
  } as unknown as HomeApi
  return {
    ...fns,
    push: (s: AccountStatus) => pushStatus?.(s),
    login: (ev: AccountLoginEvent) => pushLogin?.(ev),
  }
}

/** sidebar entry with the Settings modal state it lives next to (as SidebarFooter does) */
function Harness({ open }: { open: boolean }) {
  const [settingsOpen, setSettingsOpen] = useState(open)
  const [section, setSection] = useState<SettingsSectionId>('account')
  return createElement(AccountEntry, {
    settingsOpen,
    settingsSection: section,
    onOpenSettings: (s?: SettingsSectionId) => {
      setSection(s ?? 'general')
      setSettingsOpen(true)
    },
    onCloseSettings: () => setSettingsOpen(false),
    skillUpdate: false,
    onSkillUpdateDue: () => undefined,
  })
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

async function render(status: AccountStatus, opts: { lang?: Lang; open?: boolean } = {}) {
  api = makeApi(status)
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: opts.lang ?? 'en' },
        createElement(Harness, { open: opts.open ?? false }),
      ),
    )
  })
  await flush()
}

const entry = () => host.querySelector<HTMLButtonElement>('.account-btn')!
const pane = () => host.querySelector<HTMLElement>('.acct-pane')
const button = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.acct-pane button')).find(
    (b) => b.textContent === label,
  )

async function click(el: Element | null | undefined): Promise<void> {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
}

function expectNoRawKeys(): void {
  expect(host.textContent ?? '').not.toMatch(/\bacct[A-Z]\w+/)
  for (const el of host.querySelectorAll('[data-tip],[aria-label]')) {
    const text = `${el.getAttribute('data-tip') ?? ''} ${el.getAttribute('aria-label') ?? ''}`
    expect(text).not.toMatch(/\bacct[A-Z]\w+/)
  }
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('sidebar account entry', () => {
  const cases: Array<[AccountState, string, string | null]> = [
    ['signed-out', en.acctSignIn, null],
    ['signed-in', 'Lan Nguyen', 'Acme School · Pro'],
    ['refreshing', 'Lan Nguyen', 'Acme School · Pro'],
    ['session-expired', en.acctSignInAgain, en.acctExpiredShort],
    ['session-revoked', en.acctSignInAgain, en.acctRevokedShort],
    ['server-unreachable', 'Lan Nguyen', en.acctUnreachableTitle],
    ['wrong-deployment', en.acctTitle, en.acctWrongServerShort],
    ['not-configured', en.acctTitle, en.acctNotConfiguredShort],
    ['keyring-unavailable', en.acctTitle, en.acctKeyringShort],
  ]

  it.each(cases)('%s shows its own label and sub-line', async (state, name, sub) => {
    await render(statusFor(state))
    expect(entry().dataset.state).toBe(state)
    expect(entry().querySelector('.account-name')?.textContent).toBe(name)
    expect(entry().querySelector('.account-sub')?.textContent ?? null).toBe(sub)
    expectNoRawKeys()
  })

  it('signing-in shows a spinner and the browser hint', async () => {
    await render(statusFor('signing-in'))
    expect(entry().querySelector('.account-spinner')).not.toBeNull()
    expect(entry().querySelector('.account-name')?.textContent).toBe(en.acctSigningIn)
    expect(entry().getAttribute('data-tip')).toBe(en.acctSigningInHint)
  })

  it('shows initials for the signed-in profile', async () => {
    await render(statusFor('signed-in'))
    expect(entry().querySelector('.account-avatar')?.textContent).toBe('LN')
  })

  it('signed out: a click starts the browser sign-in', async () => {
    await render(statusFor('signed-out'))
    await click(entry())
    expect(api.accountLogin).toHaveBeenCalledTimes(1)
    expect(pane()).toBeNull()
  })

  it('session expired: a click signs in again', async () => {
    await render(statusFor('session-expired'))
    await click(entry())
    expect(api.accountLogin).toHaveBeenCalledTimes(1)
  })

  it('signed in: a click opens Settings → Account instead of signing in', async () => {
    await render(statusFor('signed-in'))
    await click(entry())
    expect(api.accountLogin).not.toHaveBeenCalled()
    expect(pane()?.dataset.state).toBe('signed-in')
  })

  it('follows status pushes from main', async () => {
    await render(statusFor('signed-out'))
    await act(async () => api.push(statusFor('signed-in')))
    expect(entry().querySelector('.account-name')?.textContent).toBe('Lan Nguyen')
    await act(async () => api.push(statusFor('session-revoked')))
    expect(entry().querySelector('.account-sub')?.textContent).toBe(en.acctRevokedShort)
  })

  it('a login error event shows human copy, never the code', async () => {
    await render(statusFor('signed-out'))
    await act(async () => api.login({ phase: 'error', error: 'rate_limited' }))
    expect(entry().querySelector('.account-sub')?.textContent).toBe(en.acctErrRateLimited)
    expectNoRawKeys()
  })

  it('a login error from main wins over the generic launch failure', async () => {
    await render(statusFor('signed-out'))
    api.accountLogin.mockImplementationOnce(async () => {
      api.login({ phase: 'error', error: 'rate_limited' })
      return false
    })
    await click(entry())
    expect(entry().querySelector('.account-sub')?.textContent).toBe(en.acctErrRateLimited)
  })

  it('sign-in that could not reach UniWork offers sign in again, not a session outage', async () => {
    await render(statusFor('server-unreachable', { error: 'network', ...NO_PROFILE }))
    expect(entry().dataset.state).toBe('signed-out')
    expect(entry().querySelector('.account-name')?.textContent).toBe(en.acctSignIn)
    expect(entry().querySelector('.account-sub')?.textContent).toBe(en.acctErrNetwork)
    expect(entry().querySelector('.account-sub')?.classList.contains('warn')).toBe(true)
    await click(entry())
    expect(api.accountLogin).toHaveBeenCalledTimes(1)
    expect(pane()).toBeNull()
  })

  it('a rejected sign-in start never says the session is no longer valid', async () => {
    await render(statusFor('signed-out', { error: 'unauthorized' }))
    expect(entry().querySelector('.account-sub')?.textContent).toBe(en.acctErrServerError)
  })

  it('a failed launch is reported', async () => {
    await render(statusFor('signed-out'))
    api.accountLogin.mockResolvedValueOnce(false)
    await click(entry())
    expect(entry().querySelector('.account-sub')?.textContent).toBe(en.acctErrLaunch)
  })

  it('renders natural Vietnamese copy', async () => {
    await render(statusFor('signed-out'), { lang: 'vi' })
    expect(entry().querySelector('.account-name')?.textContent).toBe('Đăng nhập')
    expectNoRawKeys()
  })
})

describe('Settings → Account pane', () => {
  it('signed out: explains and signs in', async () => {
    await render(statusFor('signed-out'), { open: true })
    expect(pane()?.textContent).toContain(en.acctSignedOutTitle)
    await click(button(en.acctSignIn))
    expect(api.accountLogin).toHaveBeenCalledTimes(1)
    expectNoRawKeys()
  })

  it('signing in: cancel, open again and copy link', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await render(statusFor('signing-in'), { open: true })
    expect(pane()?.textContent).toContain(en.acctSigningInHint)
    expect(button(en.acctOpenAgain)).toBeUndefined()
    await act(async () => api.login({ phase: 'url', url: 'https://uniwork.example/consent?x=1' }))
    await click(button(en.acctOpenAgain))
    expect(api.openLoginUrl).toHaveBeenCalledTimes(1)
    await click(button(en.acctCopyLink))
    expect(writeText).toHaveBeenCalledWith('https://uniwork.example/consent?x=1')
    expect(button(en.acctLinkCopied)).toBeDefined()
    await click(button(en.acctCancel))
    expect(api.accountCancelLogin).toHaveBeenCalledTimes(1)
  })

  it('signed in: profile, organization, plan; sign out in one click', async () => {
    await render(statusFor('signed-in'), { open: true })
    const p = pane()!
    expect(p.querySelector('.acct-card-name')?.textContent).toBe('Lan Nguyen')
    expect(p.querySelector('.acct-card-email')?.textContent).toBe(PROFILE.email)
    expect(p.querySelector('.acct-card-avatar')?.textContent).toBe('LN')
    expect(p.textContent).toContain('Pro')
    expect(p.textContent).toContain('uniwork.example')
    await click(button(en.acctSignOut))
    expect(api.accountLogout).toHaveBeenCalledTimes(1)
    expectNoRawKeys()
  })

  it('switches organization when there is more than one', async () => {
    await render(statusFor('signed-in'), { open: true })
    await click(host.querySelector('.acct-org-dd .gs-dd-btn'))
    await click(host.querySelector('[role="option"][data-value="org-2"]'))
    expect(api.accountSelectOrg).toHaveBeenCalledWith('org-2')
    expect(host.querySelector('.acct-org-dd .gs-dd-value')?.textContent).toBe('Beta Clinic')
  })

  it('shows no switcher for a single organization', async () => {
    await render(statusFor('signed-in', { orgs: [ORGS[0]!] }), { open: true })
    expect(host.querySelector('.acct-org-dd')).toBeNull()
    expect(pane()?.textContent).toContain('Acme School')
  })

  it('refreshing keeps the profile and adds a subtle note', async () => {
    await render(statusFor('refreshing'), { open: true })
    expect(pane()?.querySelector('.acct-card-name')?.textContent).toBe('Lan Nguyen')
    expect(pane()?.textContent).toContain(en.acctRefreshing)
  })

  it.each([
    ['session-expired', en.acctExpiredTitle],
    ['session-revoked', en.acctRevokedTitle],
  ] as const)('%s: message and sign in again', async (state, title) => {
    await render(statusFor(state), { open: true })
    expect(pane()?.textContent).toContain(title)
    await click(button(en.acctSignInAgain))
    expect(api.accountLogin).toHaveBeenCalledTimes(1)
  })

  it('server unreachable: cached profile, message and retry', async () => {
    await render(statusFor('server-unreachable', { error: 'network' }), { open: true })
    expect(pane()?.querySelector('.acct-card-name')?.textContent).toBe('Lan Nguyen')
    expect(pane()?.textContent).toContain(en.acctUnreachableTitle)
    expect(pane()?.textContent).toContain(en.acctErrNetwork)
    await click(button(en.acctRetry))
    expect(api.accountRetry).toHaveBeenCalledTimes(1)
    expect(pane()?.dataset.state).toBe('signed-in')
  })

  it('failed sign-in (unreachable, no session): error copy and Sign in, no sign out', async () => {
    await render(statusFor('server-unreachable', { error: 'network', ...NO_PROFILE }), {
      open: true,
    })
    const text = pane()?.textContent ?? ''
    expect(pane()?.dataset.state).toBe('signed-out')
    expect(text).toContain(en.acctErrNetwork)
    expect(text).not.toContain(en.acctUnreachableBody)
    expect(button(en.acctSignOut)).toBeUndefined()
    expect(button(en.acctRetry)).toBeUndefined()
    await click(button(en.acctSignIn))
    expect(api.accountLogin).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['not-configured', 'not_configured', en.acctErrNotConfigured],
    ['keyring-unavailable', 'keyring_unavailable', en.acctErrKeyringUnavailable],
    ['wrong-deployment', 'wrong_deployment', en.acctErrWrongDeployment],
  ] as const)(
    '%s: the notice does not repeat itself as an error line',
    async (state, error, line) => {
      await render(statusFor(state, { error }), { open: true })
      expect(pane()?.textContent).not.toContain(line)
      expect(pane()?.querySelector('.acct-notice-error')).toBeNull()
    },
  )

  it('wrong deployment: names the server, offers sign in again and sign out', async () => {
    await render(statusFor('wrong-deployment'), { open: true })
    expect(pane()?.textContent).toContain(en.acctWrongServerTitle)
    expect(pane()?.textContent).toContain('This app is linked to uniwork.example')
    await click(button(en.acctSignOut))
    expect(api.accountLogout).toHaveBeenCalledTimes(1)
    await click(button(en.acctSignInAgain))
    expect(api.accountLogin).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['not-configured', en.acctNotConfiguredTitle],
    ['keyring-unavailable', en.acctKeyringTitle],
  ] as const)('%s: explains, with no dead button', async (state, title) => {
    await render(statusFor(state, { serverOrigin: undefined }), { open: true })
    expect(pane()?.textContent).toContain(title)
    expect(pane()?.querySelectorAll('button').length).toBe(0)
    expectNoRawKeys()
  })

  it('renders the pane in Vietnamese', async () => {
    await render(statusFor('signed-out'), { open: true, lang: 'vi' })
    expect(pane()?.querySelector('.acct-heading')?.textContent).toBe('Tài khoản UniWork')
    expect(button('Đăng nhập')).toBeDefined()
    expectNoRawKeys()
  })
})

describe('error copy', () => {
  const codes: AccountErrorCode[] = [
    'network',
    'timeout',
    'login_timeout',
    'cancelled',
    'invalid_callback',
    'state_mismatch',
    'auth_code_invalid',
    'rate_limited',
    'unauthorized',
    'device_revoked',
    'refresh_reused',
    'wrong_deployment',
    'not_configured',
    'keyring_unavailable',
    'server_error',
    'malformed_response',
  ]

  it('maps every AccountErrorCode to a distinct en + vi string', () => {
    expect(Object.keys(ACCOUNT_ERROR_KEYS).sort()).toEqual([...codes, 'launch'].sort())
    const texts = codes.map((c) => en[ACCOUNT_ERROR_KEYS[c] as keyof typeof en])
    expect(texts.every((x) => typeof x === 'string' && x.length > 0)).toBe(true)
    expect(new Set(texts).size).toBe(texts.length)
    for (const c of codes) expect(vi_[ACCOUNT_ERROR_KEYS[c] as keyof typeof vi_]).toBeTruthy()
  })
})

describe('error text contrast', () => {
  const css = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8')
  const tokens = css('packages/ui/src/tokens.css')

  /** the value of a token inside the block that starts at `selector` */
  function tokenIn(selector: string, name: string): string {
    const block = tokens.slice(tokens.indexOf(selector))
    const m = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)
    if (!m) throw new Error(`${name} missing after ${selector}`)
    return m[1]!
  }
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  }
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi! + 0.05) / (lo! + 0.05)
  }

  it.each([':root', "[data-theme='dark']", '@media (prefers-color-scheme: dark)'])(
    '%s: account error text meets WCAG AA on its backgrounds',
    (selector) => {
      const text = tokenIn(selector, '--danger-text')
      expect(contrast(text, tokenIn(selector, '--danger-bg'))).toBeGreaterThanOrEqual(4.5)
      expect(contrast(text, tokenIn(selector, '--chrome-bg'))).toBeGreaterThanOrEqual(4.5)
    },
  )

  it('the account error rules use the legible token', () => {
    const settings = css('apps/shell/src/renderer/src/settings.css')
    const home = css('apps/shell/src/renderer/src/home.css')
    expect(settings).toMatch(/\.acct-inline-error \{[^}]*color: var\(--danger-text\)/)
    expect(home).toMatch(/\.account-sub\.warn \{[^}]*color: var\(--danger-text\)/)
  })
})
