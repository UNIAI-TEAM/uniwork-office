/**
 * @vitest-environment jsdom
 */
import { act, createElement, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AccountLoginEvent,
  AccountSetServerResult,
  AccountState,
  AccountStatus,
  HomeApi,
  SignOutPlan,
  SignOutProgress,
  SignOutPromptRequest,
} from '../src/shared/home-api'
import { AccountEntry } from '../src/renderer/src/AccountEntry'
import { SignOutPrompt } from '../src/renderer/src/SignOutPrompt'
import { useAccount, type AccountController } from '../src/renderer/src/account-model'
import { LocaleProvider } from '../src/renderer/src/locale'
import type { Lang } from '../src/renderer/src/locale'
import type { SettingsSectionId } from '../src/renderer/src/SettingsModal'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const en = accountStrings.en
const vi_ = accountStrings.vi
const syncEn = syncStrings.en
const syncVi = syncStrings.vi

const PROFILE = { accountId: 'acc-1', email: 'lan.nguyen@example.com', displayName: 'Lan Nguyen' }
const ORGS = [{ id: 'org-1', name: 'Acme School', slug: 'acme', role: 'owner' }]
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

let host: HTMLDivElement
let root: Root
let api: ReturnType<typeof makeApi>

function makeApi(
  initial: AccountStatus,
  defaultPlan: SignOutPlan = { count: 0, waiting: 0, keystoreLocked: false, ramOnly: 0 },
) {
  let pushStatus: ((s: AccountStatus) => void) | null = null
  let pushLogin: ((ev: AccountLoginEvent) => void) | null = null
  const progressSubs = new Set<(p: SignOutProgress) => void>()
  const promptSubs = new Set<(req: SignOutPromptRequest) => void>()
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
    accountSetServer: vi.fn(async (_address: string): Promise<AccountSetServerResult> => ({
      ok: true,
      status: statusFor('signed-out'),
    })),
    accountSelectOrg: vi.fn(async (orgId: string) =>
      statusFor('signed-in', { org: ORGS.find((o) => o.id === orgId) }),
    ),
    accountLogout: vi.fn(async (_options?: { confirmed?: boolean }) => undefined),
    openLoginUrl: vi.fn(async () => undefined),
    signOutPlan: vi.fn(async (): Promise<SignOutPlan> => defaultPlan),
    onSignOutProgress: vi.fn((h: (p: SignOutProgress) => void) => {
      progressSubs.add(h)
      return () => {
        progressSubs.delete(h)
      }
    }),
    onSignOutPrompt: vi.fn((h: (req: SignOutPromptRequest) => void) => {
      promptSubs.add(h)
      return () => {
        promptSubs.delete(h)
      }
    }),
    answerSignOutPrompt: vi.fn(async (_requestId: string, _confirmed: boolean) => undefined),
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
    pushStatus: (s: AccountStatus) => pushStatus?.(s),
    pushLogin: (ev: AccountLoginEvent) => pushLogin?.(ev),
    pushProgress: (p: SignOutProgress) => {
      for (const cb of [...progressSubs]) cb(p)
    },
    pushPrompt: (req: SignOutPromptRequest) => {
      for (const cb of [...promptSubs]) cb(req)
    },
  }
}

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
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

async function render(
  status: AccountStatus,
  opts: { lang?: Lang; open?: boolean; plan?: SignOutPlan } = {},
) {
  api = makeApi(status, opts.plan)
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: opts.lang ?? 'en' },
        createElement(Harness, { open: opts.open ?? true }),
      ),
    )
  })
  await flush()
}

const pane = () => host.querySelector<HTMLElement>('.acct-pane')
const promptDialog = () => host.querySelector<HTMLElement>('.acct-pane [role="alertdialog"]')
const button = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('.acct-pane button')).find(
    (b) => b.textContent === label,
  )
const promptButton = (label: string) =>
  Array.from(
    host.querySelectorAll<HTMLButtonElement>('.acct-pane [role="alertdialog"] button'),
  ).find((b) => b.textContent === label)

async function click(el: Element | null | undefined): Promise<void> {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => {
    ;(el as HTMLElement).click()
  })
  await flush()
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

describe('Settings → Account sign-out prompt (S3)', () => {
  it('count 0 signs out at once, no prompt', async () => {
    await render(statusFor('signed-in'), {
      plan: { count: 0, waiting: 0, keystoreLocked: false, ramOnly: 0 },
    })
    await click(button(en.acctSignOut))
    expect(api.signOutPlan).toHaveBeenCalledTimes(1)
    expect(promptDialog()).toBeNull()
    expect(api.accountLogout).toHaveBeenCalledTimes(1)
    expect(api.accountLogout).toHaveBeenCalledWith({ confirmed: true })
  })

  it('count > 0 shows role=alertdialog labelled by the title, body with the count, Quay lại focused', async () => {
    await render(statusFor('signed-in'), {
      lang: 'vi',
      plan: { count: 3, waiting: 0, keystoreLocked: false, ramOnly: 0 },
    })
    await click(button(vi_.acctSignOut))
    expect(api.signOutPlan).toHaveBeenCalledTimes(1)
    expect(api.accountLogout).not.toHaveBeenCalled()

    const dialog = promptDialog()!
    expect(dialog).not.toBeNull()
    const labelId = dialog.getAttribute('aria-labelledby')!
    const descId = dialog.getAttribute('aria-describedby')!
    expect(labelId).toBeTruthy()
    expect(descId).toBeTruthy()
    expect(dialog.querySelector(`#${labelId}`)?.textContent).toBe(syncVi.uwSignOutTitle)
    expect(dialog.querySelector(`#${descId}`)?.textContent).toBe(
      syncVi.uwSignOutBody.replace('{count}', '3'),
    )

    const backBtn = promptButton(syncVi.uwActBack)!
    const goBtn = promptButton(syncVi.uwSignOutGo)!
    expect(backBtn).toBeDefined()
    expect(goBtn).toBeDefined()
    expect(goBtn.classList.contains('danger')).toBe(false)
    expect(document.activeElement).toBe(backBtn)
  })

  it('Quay lại: no logout call, focus back on the sign-out button', async () => {
    await render(statusFor('signed-in'), {
      lang: 'vi',
      plan: { count: 2, waiting: 0, keystoreLocked: false, ramOnly: 0 },
    })
    await click(button(vi_.acctSignOut))
    expect(promptDialog()).not.toBeNull()

    await click(promptButton(syncVi.uwActBack))
    expect(promptDialog()).toBeNull()
    expect(api.accountLogout).not.toHaveBeenCalled()
    const signOutBtn = button(vi_.acctSignOut)!
    expect(signOutBtn).toBeDefined()
    expect(document.activeElement).toBe(signOutBtn)
  })

  it('Đăng xuất calls accountLogout({confirmed:true})', async () => {
    await render(statusFor('signed-in'), {
      lang: 'vi',
      plan: { count: 2, waiting: 0, keystoreLocked: false, ramOnly: 0 },
    })
    await click(button(vi_.acctSignOut))
    expect(promptDialog()).not.toBeNull()

    await click(promptButton(syncVi.uwSignOutGo))
    expect(api.accountLogout).toHaveBeenCalledTimes(1)
    expect(api.accountLogout).toHaveBeenCalledWith({ confirmed: true })
    expect(promptDialog()).toBeNull()
  })

  it('keystore variant: uwSignOutKeystore body, Đăng xuất danger, Quay lại focused', async () => {
    await render(statusFor('signed-in'), {
      lang: 'vi',
      plan: { count: 1, waiting: 0, keystoreLocked: true, ramOnly: 1 },
    })
    await click(button(vi_.acctSignOut))
    const dialog = promptDialog()!
    expect(dialog).not.toBeNull()
    const descId = dialog.getAttribute('aria-describedby')!
    expect(dialog.querySelector(`#${descId}`)?.textContent).toBe(syncVi.uwSignOutKeystore)

    const backBtn = promptButton(syncVi.uwActBack)!
    const goBtn = promptButton(syncVi.uwSignOutGo)!
    expect(goBtn.classList.contains('danger')).toBe(true)
    expect(document.activeElement).toBe(backBtn)
  })

  it('waiting: uwSignOutWaiting in a polite live node, Đăng xuất aria-disabled', async () => {
    await render(statusFor('signed-in'), {
      lang: 'vi',
      plan: { count: 1, waiting: 1, keystoreLocked: false, ramOnly: 0 },
    })
    let finishLogout!: () => void
    api.accountLogout.mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          finishLogout = res
        }),
    )

    await click(button(vi_.acctSignOut))
    const goBtn = promptButton(syncVi.uwSignOutGo)!
    goBtn.focus()
    await act(async () => {
      goBtn.click()
      api.pushProgress({ phase: 'waiting' })
    })
    await flush()

    const dialog = promptDialog()!
    expect(dialog).not.toBeNull()
    const live = dialog.querySelector<HTMLElement>('[role="status"][aria-live="polite"]')!
    expect(live).not.toBeNull()
    expect(live.textContent).toBe(syncVi.uwSignOutWaiting)
    const busyGo = promptButton(syncVi.uwSignOutGo)!
    expect(busyGo.getAttribute('aria-disabled')).toBe('true')
    expect(busyGo.disabled).toBe(false)

    // a second click while waiting does not fire another accountLogout call
    await act(async () => {
      busyGo.click()
    })
    expect(api.accountLogout).toHaveBeenCalledTimes(1)

    await act(async () => {
      api.pushProgress({ phase: 'done' })
      finishLogout()
    })
    await flush()
    expect(promptDialog()).toBeNull()
  })

  it('vi + en render the copy', async () => {
    await render(statusFor('signed-in'), {
      lang: 'en',
      plan: { count: 4, waiting: 0, keystoreLocked: false, ramOnly: 0 },
    })
    await click(button(en.acctSignOut))
    let dialog = promptDialog()!
    expect(dialog.textContent).toContain(syncEn.uwSignOutTitle)
    expect(dialog.textContent).toContain(syncEn.uwSignOutBody.replace('{count}', '4'))
    expect(promptButton(syncEn.uwActBack)).toBeDefined()
    expect(promptButton(syncEn.uwSignOutGo)).toBeDefined()

    await click(promptButton(syncEn.uwActBack))
    api.signOutPlan.mockResolvedValueOnce({
      count: 1,
      waiting: 0,
      keystoreLocked: true,
      ramOnly: 1,
    })
    await click(button(en.acctSignOut))
    dialog = promptDialog()!
    expect(dialog.textContent).toContain(syncEn.uwSignOutKeystore)
    expect(pane()?.textContent ?? '').not.toMatch(/\b(uw|acct)[A-Z]\w+/)
  })

  it('main-initiated request shows the same prompt and answers requestId confirmed/false', async () => {
    await render(statusFor('signed-in'), { lang: 'vi', open: false })
    expect(api.onSignOutPrompt).toHaveBeenCalledTimes(1)

    await act(async () => {
      api.pushPrompt({
        requestId: 'req-1',
        plan: { count: 2, waiting: 0, keystoreLocked: false, ramOnly: 0 },
      })
    })
    await flush()

    const dialog = promptDialog()!
    expect(dialog).not.toBeNull()
    expect(dialog.textContent).toContain(syncVi.uwSignOutTitle)
    expect(dialog.textContent).toContain(syncVi.uwSignOutBody.replace('{count}', '2'))
    expect(document.activeElement).toBe(promptButton(syncVi.uwActBack))

    await click(promptButton(syncVi.uwActBack))
    expect(api.answerSignOutPrompt).toHaveBeenCalledTimes(1)
    expect(api.answerSignOutPrompt).toHaveBeenCalledWith('req-1', false)
    expect(api.accountLogout).not.toHaveBeenCalled()
    expect(promptDialog()).toBeNull()

    await act(async () => {
      api.pushPrompt({
        requestId: 'req-2',
        plan: { count: 1, waiting: 0, keystoreLocked: true, ramOnly: 1 },
      })
    })
    await flush()
    expect(promptDialog()?.textContent).toContain(syncVi.uwSignOutKeystore)

    await click(promptButton(syncVi.uwSignOutGo))
    expect(api.answerSignOutPrompt).toHaveBeenCalledTimes(2)
    expect(api.answerSignOutPrompt).toHaveBeenLastCalledWith('req-2', true)
    expect(api.accountLogout).not.toHaveBeenCalled()
  })

  it('a second request answers the first false', async () => {
    await render(statusFor('signed-in'), { lang: 'vi', open: true })
    await act(async () => {
      api.pushPrompt({
        requestId: 'req-first',
        plan: { count: 2, waiting: 0, keystoreLocked: false, ramOnly: 0 },
      })
    })
    await flush()
    expect(promptDialog()).not.toBeNull()

    await act(async () => {
      api.pushPrompt({
        requestId: 'req-second',
        plan: { count: 5, waiting: 0, keystoreLocked: false, ramOnly: 0 },
      })
    })
    await flush()
    expect(api.answerSignOutPrompt).toHaveBeenCalledTimes(1)
    expect(api.answerSignOutPrompt).toHaveBeenCalledWith('req-first', false)
    expect(promptDialog()?.textContent).toContain(syncVi.uwSignOutBody.replace('{count}', '5'))

    // unmounting with a pending request also answers it false
    act(() => root.unmount())
    expect(api.answerSignOutPrompt).toHaveBeenCalledTimes(2)
    expect(api.answerSignOutPrompt).toHaveBeenLastCalledWith('req-second', false)
  })

  it('two hook instances mounted, unmounting the non-owner with a live request makes no answerSignOutPrompt call', async () => {
    function NonOwner() {
      useAccount()
      return null
    }
    let unmountNonOwner!: () => void
    function MultiHarness() {
      const [showOther, setShowOther] = useState(true)
      unmountNonOwner = () => setShowOther(false)
      return createElement(
        LocaleProvider,
        { initial: 'vi' },
        createElement(Harness, { open: true }),
        showOther ? createElement(NonOwner) : null,
      )
    }

    api = makeApi(statusFor('signed-in'))
    await act(async () => {
      root.render(createElement(MultiHarness))
    })
    await flush()

    expect(api.onSignOutPrompt).toHaveBeenCalledTimes(1)

    await act(async () => {
      api.pushPrompt({
        requestId: 'req-live',
        plan: { count: 2, waiting: 0, keystoreLocked: false, ramOnly: 0 },
      })
    })
    await flush()
    expect(promptDialog()).not.toBeNull()

    await act(async () => {
      unmountNonOwner()
    })
    await flush()

    expect(api.answerSignOutPrompt).not.toHaveBeenCalled()
    expect(promptDialog()).not.toBeNull()

    await click(promptButton(syncVi.uwSignOutGo))
    expect(api.answerSignOutPrompt).toHaveBeenCalledTimes(1)
    expect(api.answerSignOutPrompt).toHaveBeenCalledWith('req-live', true)
  })

  it('main-initiated confirm with a waiting progress keeps the prompt: uwSignOutWaiting polite, Đăng xuất aria-disabled, until done', async () => {
    await render(statusFor('signed-in'), { lang: 'vi', open: false })
    await act(async () => {
      api.pushPrompt({
        requestId: 'req-wait',
        plan: { count: 2, waiting: 1, keystoreLocked: false, ramOnly: 0 },
      })
    })
    await flush()

    const goBtn = promptButton(syncVi.uwSignOutGo)!
    expect(goBtn).toBeDefined()
    await act(async () => {
      goBtn.click()
      api.pushProgress({ phase: 'waiting' })
    })
    await flush()

    expect(api.answerSignOutPrompt).toHaveBeenCalledTimes(1)
    expect(api.answerSignOutPrompt).toHaveBeenCalledWith('req-wait', true)

    const dialog = promptDialog()!
    expect(dialog).not.toBeNull()
    const live = dialog.querySelector<HTMLElement>('[role="status"][aria-live="polite"]')!
    expect(live).not.toBeNull()
    expect(live.textContent).toBe(syncVi.uwSignOutWaiting)
    const busyGo = promptButton(syncVi.uwSignOutGo)!
    expect(busyGo.getAttribute('aria-disabled')).toBe('true')
    expect(busyGo.disabled).toBe(false)

    // a second click while waiting does not answer again or call accountLogout
    await act(async () => {
      busyGo.click()
    })
    expect(api.answerSignOutPrompt).toHaveBeenCalledTimes(1)
    expect(api.accountLogout).not.toHaveBeenCalled()

    await act(async () => {
      api.pushProgress({ phase: 'done' })
    })
    await flush()
    expect(promptDialog()).toBeNull()
  })

  it('count 0 + keystoreLocked + ramOnly 0 signs out at once, no prompt', async () => {
    await render(statusFor('signed-in'), {
      plan: { count: 0, waiting: 0, keystoreLocked: true, ramOnly: 0 },
    })
    await click(button(en.acctSignOut))
    expect(api.signOutPlan).toHaveBeenCalledTimes(1)
    expect(promptDialog()).toBeNull()
    expect(api.accountLogout).toHaveBeenCalledTimes(1)
    expect(api.accountLogout).toHaveBeenCalledWith({ confirmed: true })
  })

  it('Escape = Quay lại: no logout call, focus back on the sign-out button', async () => {
    await render(statusFor('signed-in'), {
      lang: 'vi',
      plan: { count: 2, waiting: 0, keystoreLocked: false, ramOnly: 0 },
    })
    await click(button(vi_.acctSignOut))
    expect(promptDialog()).not.toBeNull()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await flush()

    expect(promptDialog()).toBeNull()
    expect(api.accountLogout).not.toHaveBeenCalled()
    const signOutBtn = button(vi_.acctSignOut)!
    expect(signOutBtn).toBeDefined()
    expect(document.activeElement).toBe(signOutBtn)
  })

  it('closing Settings with a live main-initiated prompt answers it false', async () => {
    await render(statusFor('signed-in'), { lang: 'vi', open: false })
    await act(async () => {
      api.pushPrompt({
        requestId: 'req-close',
        plan: { count: 2, waiting: 0, keystoreLocked: false, ramOnly: 0 },
      })
    })
    await flush()
    expect(promptDialog()).not.toBeNull()

    await click(host.querySelector<HTMLButtonElement>('.set-close'))
    expect(host.querySelector('.set-dialog')).toBeNull()
    expect(api.answerSignOutPrompt).toHaveBeenCalledTimes(1)
    expect(api.answerSignOutPrompt).toHaveBeenCalledWith('req-close', false)
  })

  it('d1-2: shows polite uwSignOutCaptureFailed notice in Account pane only when done has captureFailed > 0', async () => {
    await render(statusFor('signed-in'), {
      lang: 'en',
      plan: { count: 1, waiting: 0, keystoreLocked: false, ramOnly: 0 },
    })
    await click(button(en.acctSignOut))
    await click(promptButton(syncEn.uwSignOutGo))
    // done with captureFailed = 0 or absent shows no notice
    api.accountStatus.mockResolvedValue(statusFor('signed-out'))
    await act(async () => {
      api.pushProgress({ phase: 'done' })
      api.pushStatus(statusFor('signed-out'))
    })
    await flush()
    const expectedEn =
      'Some unsaved changes could not be captured in time; the last autosaved version is kept for your account.'
    expect(pane()?.textContent ?? '').not.toContain(expectedEn)

    // Sign in again and sign out with captureFailed: 2
    api.accountStatus.mockResolvedValue(statusFor('signed-in'))
    await act(async () => {
      api.pushStatus(statusFor('signed-in'))
    })
    await flush()
    await click(button(en.acctSignOut))
    api.accountStatus.mockResolvedValue(statusFor('signed-out'))
    await click(promptButton(syncEn.uwSignOutGo))
    await act(async () => {
      api.pushProgress({ phase: 'done', captureFailed: 2 } as SignOutProgress)
      api.pushStatus(statusFor('signed-out'))
    })
    await flush()
    const statusNodes = Array.from(host.querySelectorAll<HTMLElement>('.acct-pane [role="status"]'))
    expect(statusNodes.some((n) => n.textContent?.includes(expectedEn))).toBe(true)
  })

  it('FE d1-n1: clears waiting and busy and refreshes if no done arrives within SIGN_OUT_RECEIPT_WAIT_MS + 10 s after confirm', async () => {
    vi.useFakeTimers()
    try {
      await render(statusFor('signed-in'), { lang: 'vi', open: false })
      await act(async () => {
        api.pushPrompt({
          requestId: 'req-stuck',
          plan: { count: 2, waiting: 1, keystoreLocked: false, ramOnly: 0 },
        })
      })
      await flush()

      const goBtn = promptButton(syncVi.uwSignOutGo)!
      await act(async () => {
        goBtn.click()
      })
      await flush()
      expect(promptDialog()).not.toBeNull()
      expect(promptButton(syncVi.uwSignOutGo)?.getAttribute('aria-disabled')).toBe('true')
      const statusCallsBefore = api.accountStatus.mock.calls.length

      // Advance past SIGN_OUT_RECEIPT_WAIT_MS (30s) + 10s
      await act(async () => {
        vi.advanceTimersByTime(40_000)
      })
      await flush()

      expect(promptDialog()).toBeNull()
      expect(api.accountStatus.mock.calls.length).toBeGreaterThan(statusCallsBefore)
    } finally {
      vi.useRealTimers()
    }
  })

  it('FE d1-n2: done arriving while renderer-initiated accountLogout() is still in flight keeps busy/signingOut until accountLogout settles', async () => {
    await render(statusFor('signed-in'), {
      lang: 'en',
      plan: { count: 0, waiting: 0, keystoreLocked: false, ramOnly: 0 },
    })
    let finishLogout!: () => void
    api.accountLogout.mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          finishLogout = res
        }),
    )

    await click(button(en.acctSignOut))
    expect(api.accountLogout).toHaveBeenCalledTimes(1)
    expect(button(en.acctSigningOut)?.disabled).toBe(true)

    // 'done' arrives while accountLogout is still pending
    await act(async () => {
      api.pushProgress({ phase: 'done' })
    })
    await flush()

    // Button must still be signing-out / disabled, and clicking it must not start a second accountLogout
    const btnDuring = button(en.acctSigningOut)
    expect(btnDuring).toBeDefined()
    expect(btnDuring?.disabled).toBe(true)

    await act(async () => {
      finishLogout()
    })
    await flush()
    expect(button(en.acctSignOut)?.disabled).toBe(false)
  })

  it('SignOutPrompt standalone: Quay lại and Escape return focus to returnFocusRef, confirm does not, no answer/logout sent twice', async () => {
    const cancelSpy = vi.fn()
    const confirmSpy = vi.fn()
    const parentKeyDown = vi.fn()
    let setPromptState!: (plan: SignOutPlan | null) => void
    let setBusyState!: (busy: boolean) => void

    function StandaloneHarness() {
      const [plan, setPlan] = useState<SignOutPlan | null>(null)
      const [isBusy, setIsBusy] = useState(false)
      setPromptState = setPlan
      setBusyState = setIsBusy
      const extBtnRef = useRef<HTMLButtonElement>(null)
      const fakeAccount: AccountController = {
        status: statusFor('signed-in'),
        view: 'signed-in',
        error: null,
        loginError: null,
        callbackNotice: false,
        loginUrl: null,
        urlCopied: false,
        busy: isBusy ? 'signing-out' : null,
        orgSwitchFailed: false,
        connectError: null,
        signOutPrompt: plan,
        signOutWaiting: isBusy,
        signIn: () => undefined,
        cancelSignIn: () => undefined,
        openLoginUrl: () => undefined,
        copyLoginUrl: () => undefined,
        signOut: () => undefined,
        confirmSignOut: () => {
          confirmSpy()
          setPlan(null)
        },
        cancelSignOut: () => {
          cancelSpy()
          setPlan(null)
        },
        retry: () => undefined,
        selectOrg: () => undefined,
        connectServer: () => undefined,
        refresh: () => undefined,
      }
      return createElement(
        LocaleProvider,
        { initial: 'vi' },
        createElement(
          'div',
          { onKeyDown: parentKeyDown },
          createElement(
            'button',
            { ref: extBtnRef, type: 'button', className: 'ext-trigger' },
            'Sign out',
          ),
          createElement('button', { type: 'button', className: 'other-focus' }, 'Other'),
          createElement(SignOutPrompt, { account: fakeAccount, returnFocusRef: extBtnRef }),
        ),
      )
    }

    await act(async () => {
      root.render(createElement(StandaloneHarness))
    })
    await flush()

    const extBtn = host.querySelector<HTMLButtonElement>('.ext-trigger')!
    const otherBtn = host.querySelector<HTMLButtonElement>('.other-focus')!
    const standaloneDialog = () => host.querySelector<HTMLElement>('[role="alertdialog"]')
    const standaloneBtn = (label: string) =>
      Array.from(host.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find(
        (b) => b.textContent === label,
      )

    expect(standaloneDialog()).toBeNull()

    // 1. Open prompt -> Quay lại focused; clicking Quay lại cancels once and returns focus to extBtn
    await act(async () => {
      setPromptState({ count: 2, waiting: 0, keystoreLocked: false, ramOnly: 0 })
    })
    await flush()
    expect(standaloneDialog()).not.toBeNull()
    expect(document.activeElement).toBe(standaloneBtn(syncVi.uwActBack))

    await click(standaloneBtn(syncVi.uwActBack))
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(standaloneDialog()).toBeNull()
    expect(document.activeElement).toBe(extBtn)

    // 2. Re-open -> Escape on alertdialog cancels once, stops propagation, and returns focus to extBtn
    await act(async () => {
      setPromptState({ count: 2, waiting: 0, keystoreLocked: false, ramOnly: 0 })
    })
    await flush()
    expect(document.activeElement).toBe(standaloneBtn(syncVi.uwActBack))

    await act(async () => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
    })
    await flush()
    expect(cancelSpy).toHaveBeenCalledTimes(2)
    expect(parentKeyDown).not.toHaveBeenCalled()
    expect(standaloneDialog()).toBeNull()
    expect(document.activeElement).toBe(extBtn)

    // 3. Re-open while busy -> Quay lại, Escape, and Đăng xuất are guarded (no duplicate cancel/confirm)
    await act(async () => {
      setPromptState({ count: 1, waiting: 1, keystoreLocked: true, ramOnly: 1 })
      setBusyState(true)
    })
    await flush()
    const goBusy = standaloneBtn(syncVi.uwSignOutGo)!
    expect(goBusy.classList.contains('danger')).toBe(true)
    expect(goBusy.getAttribute('aria-disabled')).toBe('true')
    expect(goBusy.getAttribute('aria-busy')).toBe('true')

    await click(standaloneBtn(syncVi.uwActBack))
    await click(goBusy)
    await act(async () => {
      standaloneDialog()!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
    })
    await flush()
    expect(cancelSpy).toHaveBeenCalledTimes(2)
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(standaloneDialog()).not.toBeNull()

    // 4. Clear busy and confirm -> calls confirmSignOut once and does NOT return focus to extBtn
    await act(async () => {
      setBusyState(false)
    })
    await flush()
    otherBtn.focus()
    await click(standaloneBtn(syncVi.uwSignOutGo))
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(cancelSpy).toHaveBeenCalledTimes(2)
    expect(standaloneDialog()).toBeNull()
    expect(document.activeElement).not.toBe(extBtn)
  })
})
