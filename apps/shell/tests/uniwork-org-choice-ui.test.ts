/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountStatus } from '../src/shared/home-api'
import { AccountPane } from '../src/renderer/src/AccountPane'
import type { AccountController } from '../src/renderer/src/account-model'
import { LocaleProvider } from '../src/renderer/src/locale'
import type { Lang } from '../src/renderer/src/locale'
import {
  allOrgsBlocked,
  firstSelectableOrg,
  moveOrgChoice,
  orgChoiceOf,
  type OrgChoiceRow,
} from '../src/renderer/src/uniwork-docs-model'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'

/**
 * S16: the organization step after sign-in and the "Working organization"
 * row of Settings › Account. The account status is a typed fake of what
 * main reports (needsOrgChoice, rememberedGone, orgsError, per-org
 * membership); no IPC runs here.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const en = { ...accountStrings.en, ...syncStrings.en, ...uniworkDocumentStrings.en }
const vi_ = { ...accountStrings.vi, ...syncStrings.vi, ...uniworkDocumentStrings.vi }

type WireOrg = {
  id: string
  name: string
  slug: string
  role: string
  membership?: 'active' | 'member_deactivated' | 'organization_suspended'
}

const ACME: WireOrg = { id: 'org-1', name: 'Acme School', slug: 'acme', role: 'owner' }
const BETA: WireOrg = { id: 'org-2', name: 'Beta Clinic', slug: 'beta', role: 'member' }
const GAMMA: WireOrg = { id: 'org-3', name: 'Gamma Labs', slug: 'gamma', role: 'admin' }
const SUSPENDED: WireOrg = {
  id: 'org-s',
  name: 'Paused Co',
  slug: 'paused',
  role: 'member',
  membership: 'organization_suspended',
}
const DEACTIVATED: WireOrg = {
  id: 'org-d',
  name: 'Former Ltd',
  slug: 'former',
  role: 'member',
  membership: 'member_deactivated',
}

function signedIn(extra: Record<string, unknown> = {}): AccountStatus {
  return {
    loggedIn: true,
    state: 'signed-in',
    serverOrigin: 'uniwork.example',
    email: 'lan@example.com',
    profile: { accountId: 'a1', email: 'lan@example.com', displayName: 'Lan Nguyen' },
    org: ACME,
    orgs: [ACME, BETA],
    entitlements: null,
    ...extra,
  } as AccountStatus
}

function choosing(orgs: WireOrg[], extra: Record<string, unknown> = {}): AccountStatus {
  return signedIn({ org: undefined, orgs, needsOrgChoice: true, ...extra })
}

let host: HTMLDivElement
let root: Root

function controller(status: AccountStatus, over: Partial<AccountController> = {}) {
  return {
    status,
    view: status.state,
    error: null,
    loginError: null,
    callbackNotice: false,
    loginUrl: null,
    urlCopied: false,
    busy: null,
    orgSwitchFailed: false,
    connectError: null,
    signIn: vi.fn(),
    cancelSignIn: vi.fn(),
    openLoginUrl: vi.fn(),
    copyLoginUrl: vi.fn(),
    signOut: vi.fn(),
    retry: vi.fn(),
    selectOrg: vi.fn(),
    connectServer: vi.fn(),
    refresh: vi.fn(),
    ...over,
  } satisfies AccountController
}

async function render(account: AccountController, lang: Lang = 'en') {
  await act(async () => {
    root.render(
      createElement(LocaleProvider, { initial: lang }, createElement(AccountPane, { account })),
    )
  })
}

const group = () => host.querySelector<HTMLElement>('[role="radiogroup"]')
const radios = () => Array.from(host.querySelectorAll<HTMLElement>('[role="radio"]'))
const radio = (name: string) => radios().find((r) => r.textContent?.includes(name))!
const continueBtn = () =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent === en.uwOrgPickContinue,
  )!

async function key(el: HTMLElement, k: string) {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  })
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click()
  })
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

describe('organization choice model', () => {
  const rows: OrgChoiceRow[] = [
    { id: 's', name: 'S', role: '', membership: 'organization_suspended' },
    { id: 'a', name: 'A', role: 'owner' },
    { id: 'd', name: 'D', role: '', membership: 'member_deactivated' },
    { id: 'b', name: 'B', role: 'member', membership: 'active' },
  ]

  it('starts on the first row that can be chosen and steps over locked rows, wrapping', () => {
    expect(firstSelectableOrg(rows)).toBe('a')
    expect(moveOrgChoice(rows, 'a', 'next')).toBe('b')
    expect(moveOrgChoice(rows, 'b', 'next')).toBe('a')
    expect(moveOrgChoice(rows, 'a', 'prev')).toBe('b')
    expect(moveOrgChoice(rows, null, 'next')).toBe('a')
    expect(moveOrgChoice(rows, 'b', 'first')).toBe('a')
    expect(moveOrgChoice(rows, 'a', 'last')).toBe('b')
  })

  it('is all blocked only when every row is locked', () => {
    expect(allOrgsBlocked(rows)).toBe(false)
    expect(allOrgsBlocked(rows.filter((r) => r.membership && r.membership !== 'active'))).toBe(true)
    expect(allOrgsBlocked([])).toBe(false)
  })

  it('reads the choice state from the account status', () => {
    const model = orgChoiceOf(choosing([ACME, SUSPENDED], { rememberedGone: true }))
    expect(model.needed).toBe(true)
    expect(model.rememberedGone).toBe(true)
    expect(model.rows.map((r) => [r.id, r.role, r.membership])).toEqual([
      ['org-1', 'owner', undefined],
      ['org-s', 'member', 'organization_suspended'],
    ])
    expect(orgChoiceOf(signedIn()).needed).toBe(false)
    expect(orgChoiceOf(null).rows).toEqual([])
  })
})

describe('organization step after sign-in', () => {
  it('picks nothing for the user: no checked row, Continue aria-disabled, focus on the first choosable row', async () => {
    const account = controller(choosing([SUSPENDED, ACME, BETA]))
    await render(account)
    expect(host.textContent).toContain(en.uwOrgPickTitle)
    expect(host.textContent).toContain(en.uwOrgPickBody)
    expect(group()).not.toBeNull()
    expect(radios().filter((r) => r.getAttribute('aria-checked') === 'true')).toEqual([])
    expect(document.activeElement).toBe(radio('Acme School'))
    expect(radio('Acme School').tabIndex).toBe(0)
    expect(radio('Beta Clinic').tabIndex).toBe(-1)
    expect(continueBtn().getAttribute('aria-disabled')).toBe('true')
    await click(continueBtn())
    expect(account.selectOrg).not.toHaveBeenCalled()
    // the org-scoped rows wait for the choice
    expect(host.querySelector('.acct-org-dd')).toBeNull()
    expect(host.textContent).not.toContain(en.acctPlan)
  })

  it('shows my role per row in the reader language', async () => {
    await render(controller(choosing([ACME, BETA])), 'vi')
    expect(radio('Acme School').textContent).toContain('Vai trò: Chủ sở hữu')
    expect(radio('Beta Clinic').textContent).toContain('Vai trò: Thành viên')
    expect(host.textContent).toContain(vi_.uwOrgPickTitle)
  })

  it('locks suspended and deactivated rows with a reason the screen reader gets', async () => {
    const account = controller(choosing([ACME, SUSPENDED, DEACTIVATED]))
    await render(account)
    for (const [name, reason] of [
      ['Paused Co', en.uwOrgRowSuspended],
      ['Former Ltd', en.uwOrgRowDeactivated],
    ] as const) {
      const row = radio(name)
      expect(row.getAttribute('aria-disabled')).toBe('true')
      const describedBy = row.getAttribute('aria-describedby')!
      expect(document.getElementById(describedBy)?.textContent).toBe(reason)
      await click(row)
      expect(row.getAttribute('aria-checked')).toBe('false')
    }
    expect(continueBtn().getAttribute('aria-disabled')).toBe('true')
  })

  it('arrow keys move and check the choice, skipping locked rows; Continue then chooses', async () => {
    const account = controller(choosing([ACME, SUSPENDED, BETA, GAMMA]))
    await render(account)
    await key(radio('Acme School'), 'ArrowDown')
    expect(radio('Beta Clinic').getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(radio('Beta Clinic'))
    await key(radio('Beta Clinic'), 'ArrowUp')
    expect(radio('Acme School').getAttribute('aria-checked')).toBe('true')
    await key(radio('Acme School'), 'ArrowUp')
    expect(radio('Gamma Labs').getAttribute('aria-checked')).toBe('true')
    expect(radios().filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1)
    expect(continueBtn().getAttribute('aria-disabled')).toBe('false')
    await click(continueBtn())
    expect(account.selectOrg).toHaveBeenCalledWith('org-3')
  })

  it('Home and End check the first and last choosable row, skipping locked ones', async () => {
    await render(controller(choosing([SUSPENDED, ACME, BETA, GAMMA, DEACTIVATED])))
    await key(radio('Acme School'), 'End')
    expect(radio('Gamma Labs').getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(radio('Gamma Labs'))
    await key(radio('Gamma Labs'), 'Home')
    expect(radio('Acme School').getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(radio('Acme School'))
    expect(radios().filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1)
  })

  it('Space checks the focused row; Enter on the checked row continues', async () => {
    const account = controller(choosing([ACME, BETA]))
    await render(account)
    await key(radio('Acme School'), ' ')
    expect(radio('Acme School').getAttribute('aria-checked')).toBe('true')
    await key(radio('Acme School'), 'Enter')
    expect(account.selectOrg).toHaveBeenCalledWith('org-1')
  })

  it('drops a checked row that a status push locks: Continue goes back to disabled', async () => {
    const account = controller(choosing([ACME, BETA]))
    await render(account)
    await key(radio('Acme School'), ' ')
    expect(continueBtn().getAttribute('aria-disabled')).toBe('false')
    const locked = { ...BETA, membership: 'organization_suspended' as const }
    await render({ ...account, status: choosing([ACME, locked]) })
    await key(radio('Acme School'), ' ')
    await render({
      ...account,
      status: choosing([{ ...ACME, membership: 'member_deactivated' }, BETA]),
    })
    // Acme is checked then locked: no row stays checked and Continue cannot choose it
    expect(radios().filter((r) => r.getAttribute('aria-checked') === 'true')).toEqual([])
    expect(continueBtn().getAttribute('aria-disabled')).toBe('true')
    await click(continueBtn())
    expect(account.selectOrg).not.toHaveBeenCalled()
  })

  it('focuses the first choosable row once the rows arrive after the step mounted', async () => {
    const account = controller(choosing([]))
    await render(account)
    expect(radios()).toHaveLength(0)
    await render({ ...account, status: choosing([SUSPENDED, ACME, BETA]) })
    expect(document.activeElement).toBe(radio('Acme School'))
    // a later push does not pull focus back
    radio('Beta Clinic').focus()
    await render({ ...account, status: choosing([SUSPENDED, ACME, BETA]) })
    expect(document.activeElement).toBe(radio('Beta Clinic'))
  })

  it('ids of the step are unique per mount', async () => {
    await render(controller(choosing([ACME, BETA])))
    const group_ = group()!
    const title = document.getElementById(group_.getAttribute('aria-labelledby')!)
    expect(title?.textContent).toBe(en.uwOrgPickTitle)
    expect(group_.getAttribute('aria-labelledby')).not.toBe('uw-org-title')
  })

  it('says why it asks again when the remembered organization is gone', async () => {
    await render(controller(choosing([ACME, BETA], { rememberedGone: true })))
    expect(host.textContent).toContain(en.uwOrgPickRememberedGone)
    // guidance, not an error: it never uses the error tone of the locked-row reasons
    const css = readFileSync(resolve(__dirname, '../src/renderer/src/settings.css'), 'utf8')
    const start = css.indexOf('\n.uw-org-gone {')
    expect(start).toBeGreaterThan(-1)
    expect(css.slice(start, css.indexOf('}', start))).not.toContain('danger')
  })

  it('all organizations locked: the lock notice with Sign out, no radio group', async () => {
    // contract §2: derived, not sent (needsOrgChoice false, no org, every row locked)
    const account = controller(
      signedIn({ org: undefined, orgs: [SUSPENDED, DEACTIVATED], needsOrgChoice: false }),
    )
    await render(account)
    expect(group()).toBeNull()
    const notice = host.querySelector<HTMLElement>('[role="alert"]')!
    expect(notice.textContent).toContain(en.uwLockOrgTitle)
    expect(notice.textContent).toContain(en.uwOrgAllBlocked)
    const signOut = Array.from(notice.querySelectorAll('button')).find(
      (b) => b.textContent === en.acctSignOut,
    )!
    await click(signOut)
    expect(account.signOut).toHaveBeenCalledTimes(1)
  })

  it('the list failed to load: says so with Retry', async () => {
    const account = controller(choosing([], { orgsError: 'network' }))
    await render(account)
    expect(host.textContent).toContain(en.uwOrgPickError)
    // same notice layout as the other panels: text left (grows), Retry right
    const notice = host.querySelector<HTMLElement>('.acct-notice.uw-org-error')!
    expect(notice.firstElementChild?.className).toBe('acct-notice-text')
    expect(notice.lastElementChild?.tagName).toBe('BUTTON')
    const retry = Array.from(host.querySelectorAll('button')).find(
      (b) => b.textContent === en.acctRetry,
    )!
    await click(retry)
    expect(account.retry).toHaveBeenCalledTimes(1)
  })

  it('a failed choice keeps the step and says so', async () => {
    await render(controller(choosing([ACME, BETA]), { orgSwitchFailed: true }))
    expect(group()).not.toBeNull()
    expect(host.textContent).toContain(en.acctSwitchOrgFailed)
  })
})

describe('Settings › Account › Working organization', () => {
  it('changes the organization through selectOrg', async () => {
    const account = controller(signedIn({ orgs: [ACME, BETA, SUSPENDED] }))
    await render(account)
    expect(host.textContent).toContain(en.uwOrgSettingsLabel)
    expect(group()).toBeNull()
    await click(host.querySelector<HTMLElement>('.acct-org-dd .gs-dd-btn')!)
    const locked = host.querySelector<HTMLButtonElement>('[role="option"][data-value="org-s"]')!
    expect(locked.disabled).toBe(true)
    expect(locked.getAttribute('aria-label')).toBe(`Paused Co · ${en.uwOrgRowSuspended}`)
    // the reason is its own line in the popup (no mid-word wrap of one long label)
    expect(locked.querySelector('.acct-org-opt-name')?.textContent).toBe('Paused Co')
    expect(locked.querySelector('.acct-org-opt-reason')?.textContent).toBe(en.uwOrgRowSuspended)
    const open = host.querySelector<HTMLElement>('[role="option"][data-value="org-2"]')!
    expect(open.querySelector('.acct-org-opt')).toBeNull()
    const css = readFileSync(resolve(__dirname, '../src/renderer/src/settings.css'), 'utf8')
    expect(css).toMatch(
      /\.acct-org-dd \.gs-dd-item \{[^}]*white-space: normal;[^}]*overflow-wrap: normal;/,
    )
    expect(css).toMatch(
      /\.acct-org-dd \.gs-dd-pop \{[^}]*max-width: calc\(var\(--ui-vw\) \* 100 - 48px\)/,
    )
    await click(open)
    expect(account.selectOrg).toHaveBeenCalledWith('org-2')
  })

  it('names the only organization without a switcher', async () => {
    await render(controller(signedIn({ orgs: [ACME] })))
    expect(host.querySelector('.acct-org-dd')).toBeNull()
    expect(host.textContent).toContain('Acme School')
  })
})
