/**
 * @vitest-environment jsdom
 */
import { act, createElement, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SIGN_OUT_RECEIPT_WAIT_MS,
  type AccountLoginEvent,
  type AccountSetServerResult,
  type AccountState,
  type AccountStatus,
  type HomeApi,
  type SignOutPlan,
  type SignOutProgress,
  type SignOutPromptRequest,
} from '../src/shared/home-api'
import { QUEUE_LIMITS } from '../src/main/uniwork-sync/queue/limits'
import { AccountEntry } from '../src/renderer/src/AccountEntry'
import { SignOutPrompt } from '../src/renderer/src/SignOutPrompt'
import {
  SIGN_OUT_WAIT_SAFETY_MS,
  useAccount,
  type AccountController,
} from '../src/renderer/src/account-model'
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

  it('Tab wraps inside the prompt: it never leaves the alertdialog', async () => {
    await render(statusFor('signed-in'), {
      lang: 'en',
      plan: { count: 2, waiting: 0, keystoreLocked: false, ramOnly: 0 },
    })
    await click(button(en.acctSignOut))
    expect(promptDialog()).not.toBeNull()
    const backBtn = promptButton(syncEn.uwActBack)!
    const goBtn = promptButton(syncEn.uwSignOutGo)!
    expect(document.activeElement).toBe(backBtn)

    // Shift+Tab on the first stop wraps to the last, and the press is consumed
    const wrapBack = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      backBtn.dispatchEvent(wrapBack)
    })
    expect(wrapBack.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(goBtn)

    // Tab on the last stop wraps to the first
    const wrapFwd = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      goBtn.dispatchEvent(wrapFwd)
    })
    expect(wrapFwd.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(backBtn)

    // a Tab that is not at an edge is left alone (the handler does not consume it)
    const midTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      backBtn.dispatchEvent(midTab)
    })
    expect(midTab.defaultPrevented).toBe(false)
    goBtn.focus()
    expect(document.activeElement).toBe(goBtn)
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
      'Some unsaved changes could not be captured in time; the most recent saved or autosaved version is kept for your account.'
    expect(syncEn.uwSignOutCaptureFailed).toBe(expectedEn)
    expect(syncVi.uwSignOutCaptureFailed).toBe(
      'Một số thay đổi chưa lưu kịp; bản lưu hoặc tự lưu gần nhất được giữ cho tài khoản của bạn.',
    )
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
      // A72: the silent expiry reports its outcome instead of vanishing
      const statusNodes = Array.from(host.querySelectorAll<HTMLElement>('.acct-pane [role="status"]'))
      expect(statusNodes.some((n) => n.textContent?.includes(syncVi.uwSignOutTimedOut))).toBe(true)
      // a status push that shows the account signed out again settles the notice
      await act(async () => {
        api.pushStatus(statusFor('signed-out'))
      })
      await flush()
      const statusNodesAfter = Array.from(
        host.querySelectorAll<HTMLElement>('.acct-pane [role="status"]'),
      )
      expect(statusNodesAfter.some((n) => n.textContent?.includes(syncVi.uwSignOutTimedOut))).toBe(
        false,
      )
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
      btnDuring?.click()
    })
    expect(api.accountLogout).toHaveBeenCalledTimes(1)

    await act(async () => {
      finishLogout()
    })
    await flush()
    expect(button(en.acctSignOut)?.disabled).toBe(false)
  })

  it('FE d2-1: safety timer firing while renderer-initiated accountLogout is pending only clears waiting UI; button stays aria-disabled and click does not call accountLogout twice', async () => {
    vi.useFakeTimers()
    try {
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
      await act(async () => {
        goBtn.click()
        api.pushProgress({ phase: 'waiting' })
      })
      await flush()

      expect(api.accountLogout).toHaveBeenCalledTimes(1)
      expect(
        promptDialog()?.querySelector('[role="status"][aria-live="polite"]')?.textContent,
      ).toBe(syncVi.uwSignOutWaiting)
      expect(promptButton(syncVi.uwSignOutGo)?.getAttribute('aria-disabled')).toBe('true')

      // Timer fires after 40s while accountLogout is still pending
      await act(async () => {
        vi.advanceTimersByTime(40_000)
      })
      await flush()

      // Waiting line is cleared, but prompt and busy/signingOut remain until runLogout's finally
      expect(
        promptDialog()?.querySelector('[role="status"][aria-live="polite"]')?.textContent,
      ).toBe('')
      const stillBusyGo = promptButton(syncVi.uwSignOutGo)
      expect(stillBusyGo).toBeDefined()
      expect(stillBusyGo?.getAttribute('aria-disabled')).toBe('true')

      // Clicking while still pending does not invoke a second accountLogout
      await act(async () => {
        stillBusyGo?.click()
      })
      expect(api.accountLogout).toHaveBeenCalledTimes(1)

      // Finishing accountLogout closes the prompt and settles busy
      await act(async () => {
        finishLogout()
      })
      await flush()
      expect(promptDialog()).toBeNull()
      expect(SIGN_OUT_RECEIPT_WAIT_MS).toBe(30_000)
      expect(QUEUE_LIMITS.signOutReceiptWaitMs).toBe(SIGN_OUT_RECEIPT_WAIT_MS)
      expect(SIGN_OUT_WAIT_SAFETY_MS).toBe(SIGN_OUT_RECEIPT_WAIT_MS + 10_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('FE d2-4: done before 40 s cancels the safety timer (no late refresh or prompt clobber); cancel and unmount clear it; captureFailed notice clears on sign-in', async () => {
    vi.useFakeTimers()
    try {
      await render(statusFor('signed-in'), {
        lang: 'en',
        plan: { count: 2, waiting: 1, keystoreLocked: false, ramOnly: 0 },
      })

      // 1. done before 40 s cancels the timer (no late refresh / prompt clobber)
      await act(async () => {
        api.pushPrompt({
          requestId: 'req-done-early',
          plan: { count: 2, waiting: 1, keystoreLocked: false, ramOnly: 0 },
        })
      })
      await flush()
      await click(promptButton(syncEn.uwSignOutGo))
      expect(promptButton(syncEn.uwSignOutGo)?.getAttribute('aria-disabled')).toBe('true')

      api.accountStatus.mockResolvedValue(statusFor('signed-out'))
      await act(async () => {
        vi.advanceTimersByTime(10_000)
        api.pushProgress({ phase: 'done', captureFailed: 1 })
      })
      await flush()
      expect(promptDialog()).toBeNull()

      // Notice is shown after captureFailed: 1
      const expectedEn =
        'Some unsaved changes could not be captured in time; the most recent saved or autosaved version is kept for your account.'
      expect(pane()?.textContent ?? '').toContain(expectedEn)

      // Open a new prompt before the 40s mark and advance past 40s -> neither clobbered nor refreshed
      await act(async () => {
        api.pushPrompt({
          requestId: 'req-after-done',
          plan: { count: 3, waiting: 0, keystoreLocked: false, ramOnly: 0 },
        })
      })
      await flush()
      expect(promptDialog()).not.toBeNull()
      const statusCallsAfterDone = api.accountStatus.mock.calls.length

      await act(async () => {
        vi.advanceTimersByTime(35_000)
      })
      await flush()
      expect(promptDialog()).not.toBeNull()
      expect(api.accountStatus.mock.calls.length).toBe(statusCallsAfterDone)

      // 2. Cancel clears the safety timer
      await act(async () => {
        api.pushProgress({ phase: 'waiting' })
      })
      await flush()
      // Unblock waiting via a fresh prompt or cancel after waiting reset:
      await act(async () => {
        api.pushPrompt({
          requestId: 'req-cancel-clear',
          plan: { count: 2, waiting: 0, keystoreLocked: false, ramOnly: 0 },
        })
      })
      await flush()
      await click(promptButton(syncEn.uwActBack))
      expect(promptDialog()).toBeNull()
      const statusCallsAfterCancel = api.accountStatus.mock.calls.length

      await act(async () => {
        vi.advanceTimersByTime(40_000)
      })
      await flush()
      expect(api.accountStatus.mock.calls.length).toBe(statusCallsAfterCancel)

      // 3. Notice clears on sign-in (clicking Sign in when signed-out)
      expect(pane()?.textContent ?? '').toContain(expectedEn)

      let finishLogin!: (v: boolean) => void
      api.accountLogin.mockImplementationOnce(
        () =>
          new Promise<boolean>((res) => {
            finishLogin = res
          }),
      )
      await click(button(en.acctSignIn))
      expect(pane()?.textContent ?? '').not.toContain(expectedEn)
      await act(async () => {
        finishLogin(true)
      })
      await flush()

      // 4. Unmount clears the safety timer
      await act(async () => {
        api.pushProgress({ phase: 'waiting' })
      })
      await flush()
      const statusCallsBeforeUnmount = api.accountStatus.mock.calls.length
      act(() => root.unmount())
      await act(async () => {
        vi.advanceTimersByTime(40_000)
      })
      await flush()
      expect(api.accountStatus.mock.calls.length).toBe(statusCallsBeforeUnmount)
    } finally {
      vi.useRealTimers()
    }
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

  it('Q2 = a: a switch notice shows what was lost with one acknowledge button, no cancel (vi + en), answers once and returns focus', async () => {
    for (const [lang, sync, acct] of [
      ['vi', syncVi, vi_],
      ['en', syncEn, en],
    ] as const) {
      // Settings closed: the notice brings Settings › Account up by itself
      await render(statusFor('signed-in'), { lang, open: false })
      await act(async () => {
        api.pushPrompt({
          requestId: `notice-${lang}`,
          plan: { count: 1, waiting: 0, keystoreLocked: true, ramOnly: 2 },
          mode: 'notice',
        })
      })
      await flush()

      const dialog = promptDialog()!
      expect(dialog).not.toBeNull()
      expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
      expect(dialog.textContent).toContain(sync.uwSwitchLostTitle)
      expect(dialog.textContent).toContain(sync.uwSwitchLostBody.replace('{count}', '2'))
      const buttons = Array.from(dialog.querySelectorAll('button'))
      expect(buttons.map((b) => b.textContent)).toEqual([sync.uwSwitchLostOk])
      expect(promptButton(sync.uwActBack)).toBeUndefined()
      expect(promptButton(sync.uwSignOutGo)).toBeUndefined()
      expect(document.activeElement).toBe(promptButton(sync.uwSwitchLostOk))
      expect(pane()?.textContent ?? '').not.toMatch(/\b(uw|acct)[A-Z]\w+/)

      await click(promptButton(sync.uwSwitchLostOk))
      expect(api.answerSignOutPrompt).toHaveBeenCalledTimes(1)
      expect(api.answerSignOutPrompt).toHaveBeenCalledWith(`notice-${lang}`, true)
      expect(api.accountLogout).not.toHaveBeenCalled()
      expect(promptDialog()).toBeNull()

      expect(document.activeElement).toBe(button(acct.acctSignOut))

      // a second click path (Escape) has nothing left to answer
      await act(async () => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        )
      })
      await flush()
      expect(api.answerSignOutPrompt).toHaveBeenCalledTimes(1)
      act(() => root.unmount())
      root = createRoot(host)
    }
  })

  it('Q2 = a: Escape acknowledges the notice once; a notice leaves an open sign-out prompt alone', async () => {
    await render(statusFor('signed-in'), { lang: 'vi', open: false })
    await act(async () => {
      api.pushPrompt({
        requestId: 'req-confirm',
        plan: { count: 1, waiting: 0, keystoreLocked: false, ramOnly: 0 },
      })
    })
    await flush()
    await act(async () => {
      api.pushPrompt({
        requestId: 'req-notice',
        plan: { count: 0, waiting: 0, keystoreLocked: true, ramOnly: 1 },
        mode: 'notice',
      })
    })
    await flush()
    // the confirm prompt is not answered by the notice and stays on top
    expect(api.answerSignOutPrompt).not.toHaveBeenCalled()
    expect(promptButton(syncVi.uwActBack)).toBeDefined()
    await click(promptButton(syncVi.uwActBack))
    expect(api.answerSignOutPrompt).toHaveBeenCalledWith('req-confirm', false)

    // now the notice shows; Escape acknowledges it exactly once
    expect(promptDialog()?.textContent).toContain(syncVi.uwSwitchLostTitle)
    await act(async () => {
      promptDialog()!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      )
    })
    await flush()
    expect(api.answerSignOutPrompt).toHaveBeenCalledTimes(2)
    expect(api.answerSignOutPrompt).toHaveBeenLastCalledWith('req-notice', true)
    expect(promptDialog()).toBeNull()
  })

  it("Q2 = a: Tab wraps the notice's one button back onto itself", async () => {
    await render(statusFor('signed-in'), { lang: 'en', open: false })
    await act(async () => {
      api.pushPrompt({
        requestId: 'req-notice-tab',
        plan: { count: 1, waiting: 0, keystoreLocked: true, ramOnly: 2 },
        mode: 'notice',
      })
    })
    await flush()
    const okBtn = promptButton(syncEn.uwSwitchLostOk)!
    expect(document.activeElement).toBe(okBtn)
    const wrap = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      okBtn.dispatchEvent(wrap)
    })
    expect(wrap.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(okBtn)
  })

  it('FE d4-1: a switch notice waits for an open aria-modal dialog: Settings stays closed, then opens and focuses OK', async () => {
    const conflict = document.createElement('div')
    conflict.setAttribute('role', 'dialog')
    conflict.setAttribute('aria-modal', 'true')
    const conflictBtn = document.createElement('button')
    conflict.append(conflictBtn)
    document.body.append(conflict)
    try {
      await render(statusFor('signed-in'), { lang: 'en', open: false })
      conflictBtn.focus()
      await act(async () => {
        api.pushPrompt({
          requestId: 'notice-covered',
          plan: { count: 1, waiting: 0, keystoreLocked: true, ramOnly: 1 },
          mode: 'notice',
        })
      })
      await flush()
      expect(host.querySelector('.set-dialog')).toBeNull()
      expect(document.activeElement).toBe(conflictBtn)

      await act(async () => {
        conflict.remove()
      })
      await flush()
      expect(promptDialog()?.textContent).toContain(syncEn.uwSwitchLostTitle)
      expect(document.activeElement).toBe(promptButton(syncEn.uwSwitchLostOk))
    } finally {
      conflict.remove()
    }
  })

  it('FE d4-1: with Settings already open, a prompt keeps focus off its button until the aria-modal dialog closes', async () => {
    await render(statusFor('signed-in'), { lang: 'en', open: true })
    const conflict = document.createElement('div')
    conflict.setAttribute('role', 'dialog')
    conflict.setAttribute('aria-modal', 'true')
    const conflictBtn = document.createElement('button')
    conflict.append(conflictBtn)
    document.body.append(conflict)
    try {
      conflictBtn.focus()
      await act(async () => {
        api.pushPrompt({
          requestId: 'confirm-covered',
          plan: { count: 1, waiting: 0, keystoreLocked: false, ramOnly: 0 },
        })
      })
      await flush()
      expect(promptButton(syncEn.uwActBack)).toBeDefined()
      expect(document.activeElement).toBe(conflictBtn)

      await act(async () => {
        conflict.remove()
      })
      await flush()
      expect(document.activeElement).toBe(promptButton(syncEn.uwActBack))
    } finally {
      conflict.remove()
    }
  })

  it('FE d4-2: closing Settings with a confirm open cancels only the confirm; the queued notice shows next', async () => {
    await render(statusFor('signed-in'), { lang: 'en', open: false })
    await act(async () => {
      api.pushPrompt({
        requestId: 'req-confirm',
        plan: { count: 1, waiting: 0, keystoreLocked: false, ramOnly: 0 },
      })
    })
    await flush()
    await act(async () => {
      api.pushPrompt({
        requestId: 'req-notice',
        plan: { count: 0, waiting: 0, keystoreLocked: true, ramOnly: 1 },
        mode: 'notice',
      })
    })
    await flush()

    await click(host.querySelector<HTMLButtonElement>('.set-close'))
    expect(api.answerSignOutPrompt).toHaveBeenCalledTimes(1)
    expect(api.answerSignOutPrompt).toHaveBeenCalledWith('req-confirm', false)
    // the notice was not acknowledged unseen: it is on screen now
    expect(promptDialog()?.textContent).toContain(syncEn.uwSwitchLostTitle)

    await click(promptButton(syncEn.uwSwitchLostOk))
    expect(api.answerSignOutPrompt).toHaveBeenCalledTimes(2)
    expect(api.answerSignOutPrompt).toHaveBeenLastCalledWith('req-notice', true)
  })

  it('FE d4-3: a second switch notice adds to the open one and one acknowledge answers both', async () => {
    await render(statusFor('signed-in'), { lang: 'en', open: false })
    await act(async () => {
      api.pushPrompt({
        requestId: 'notice-a',
        plan: { count: 1, waiting: 0, keystoreLocked: true, ramOnly: 2 },
        mode: 'notice',
      })
    })
    await flush()
    expect(promptDialog()?.textContent).toContain(syncEn.uwSwitchLostBody.replace('{count}', '2'))
    await act(async () => {
      api.pushPrompt({
        requestId: 'notice-b',
        plan: { count: 3, waiting: 0, keystoreLocked: true, ramOnly: 3 },
        mode: 'notice',
      })
    })
    await flush()
    // nothing answered yet, and the count covers both accounts
    expect(api.answerSignOutPrompt).not.toHaveBeenCalled()
    expect(promptDialog()?.textContent).toContain(syncEn.uwSwitchLostBody.replace('{count}', '5'))

    await click(promptButton(syncEn.uwSwitchLostOk))
    expect(api.answerSignOutPrompt).toHaveBeenCalledTimes(2)
    expect(api.answerSignOutPrompt).toHaveBeenCalledWith('notice-a', true)
    expect(api.answerSignOutPrompt).toHaveBeenCalledWith('notice-b', true)
    expect(promptDialog()).toBeNull()
  })

  it('FE d4-4: the focus-return microtask leaves focus alone when something else already holds it', async () => {
    const opener = document.createElement('button')
    const other = document.createElement('button')
    document.body.append(other)
    const returnFocusRef = { current: opener }
    const controller = (notice: SignOutPlan | null) =>
      ({ signOutNotice: notice, acknowledgeSignOutNotice: () => undefined }) as AccountController
    const mount = (notice: SignOutPlan | null) =>
      act(async () => {
        root.render(
          createElement(
            LocaleProvider,
            { initial: 'en' },
            createElement(SignOutPrompt, { account: controller(notice), returnFocusRef }),
          ),
        )
      })
    try {
      await mount({ count: 1, waiting: 0, keystoreLocked: true, ramOnly: 1 })
      // the opener is detached while the notice closes: the retry is deferred
      await act(async () => {
        other.focus()
        flushSync(() => {
          root.render(
            createElement(
              LocaleProvider,
              { initial: 'en' },
              createElement(SignOutPrompt, { account: controller(null), returnFocusRef }),
            ),
          )
        })
        // reconnected after the close committed but before its microtask runs
        document.body.append(opener)
      })
      await flush()
      expect(document.activeElement).toBe(other)
    } finally {
      opener.remove()
      other.remove()
    }
  })
})
