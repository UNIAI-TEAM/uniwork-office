/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultAiSettings, setUniworkAiAvailable, type AiSettings } from '@genoffice/ai-provider'
import { AiModelPicker, type AiModelPickerBridge } from '../src/AiModelPicker'
import { AI_MODEL_PICKER_STRINGS } from '../src/strings-ai-model-picker'
import { aiUniworkText } from '../src/strings-ai-uniwork'

interface CloudStatusMock {
  state:
    | 'ready'
    | 'not-entitled'
    | 'subscription-inactive'
    | 'credits-exhausted'
    | 'unavailable'
    | 'signed-out'
  signedIn?: boolean
  hasCompletedRead?: boolean
  cloudUnavailable?: boolean
  reason?: string | null
  credits?: {
    remaining: number
    limit: number | null
    periodEndsAt?: string | null
  } | null
}

type ExtendedBridge = AiModelPickerBridge & {
  getCloudStatus?: () => Promise<CloudStatusMock | null> | CloudStatusMock | null
  onCloudStatusChanged?: (cb: (status: CloudStatusMock | null) => void) => () => void
  openAccountSettings?: () => Promise<void> | void
  signIn?: () => Promise<void> | void
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  setUniworkAiAvailable(false)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  setUniworkAiAvailable(false)
  delete (window as unknown as { uniworkCloudStatus?: unknown }).uniworkCloudStatus
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function buildSettings(overrides: Partial<AiSettings> = {}): AiSettings {
  const s = { ...defaultAiSettings(), uniAiAvailable: false, ...overrides }
  s.providers = {
    ...s.providers,
    anthropic: { ...s.providers.anthropic, apiKey: 'sk-ant', model: 'claude-sonnet-4-6' },
    openai: { ...s.providers.openai, apiKey: 'sk-oai', model: 'gpt-5.4' },
  }
  return s
}

async function mountPicker(
  bridgeOverrides: Partial<ExtendedBridge> = {},
  lang: 'en' | 'vi' = 'vi',
  initialSettings?: AiSettings,
) {
  let currentSettings = initialSettings ?? buildSettings({ provider: 'uniwork' })
  const bridge: ExtendedBridge = {
    getSettings: async () => currentSettings,
    setSettings: async (next) => {
      currentSettings = next
    },
    openModelSettings: vi.fn(),
    openAccountSettings: vi.fn(),
    signIn: vi.fn(),
    ...bridgeOverrides,
  }
  await act(async () => {
    root.render(createElement(AiModelPicker, { bridge, lang }))
  })
  await act(async () => {})
  return {
    bridge,
    getChip: () => host.querySelector<HTMLButtonElement>('.ai-model-chip')!,
    getPop: () => host.querySelector<HTMLElement>('.ai-model-pop'),
    getListbox: () => host.querySelector<HTMLElement>('.ai-model-pop-list'),
    getGroups: () => [...host.querySelectorAll<HTMLElement>('.ai-model-group')],
    getOptions: () => [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')],
    getManageBtn: () => host.querySelector<HTMLButtonElement>('.ai-model-manage'),
    getFooter: () => host.querySelector<HTMLElement>('.ai-model-footer'),
    getFooterBtn: () => host.querySelector<HTMLButtonElement>('.ai-model-footer button'),
  }
}

async function openPopup(chip: HTMLButtonElement) {
  await act(async () => {
    chip.click()
  })
  await act(async () => {})
}

function pressKey(target: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

describe('AiModelPicker S7 — row UniWork AI & credits sub-line', () => {
  it('desktop: shows UniWork AI name + aria-hidden credits sub-line and exposes aiUniworkCreditsAria via aria-describedby', async () => {
    setUniworkAiAvailable(true)
    const getCloudStatus = vi.fn(async (): Promise<CloudStatusMock> => ({
      state: 'ready',
      signedIn: true,
      hasCompletedRead: true,
      credits: { remaining: 8200, limit: 10000, periodEndsAt: '2026-11-01T00:00:00Z' },
    }))
    const { getChip, getListbox, getOptions } = await mountPicker({ getCloudStatus }, 'vi')
    expect(getChip().textContent).toBe('UniWork AI')
    expect(getCloudStatus).toHaveBeenCalledTimes(1)

    await openPopup(getChip())
    // Opening the popup must not re-fetch credits on render
    expect(getCloudStatus).toHaveBeenCalledTimes(1)

    const uniworkOpt = getOptions()[0]!
    expect(uniworkOpt.getAttribute('aria-selected')).toBe('true')
    expect(uniworkOpt.disabled).toBe(false)

    // Visible credits sub-line is aria-hidden="true" with cloudCreditsLeft
    const subLine = uniworkOpt.querySelector<HTMLElement>('.ai-model-item-sub')
    expect(subLine).not.toBeNull()
    expect(subLine!.getAttribute('aria-hidden')).toBe('true')
    // F10: the numbers use the UI language's digit grouping
    expect(subLine!.textContent).toBe('Còn 8.200 / 10.000')

    // Screen-reader description via aria-describedby uses aiUniworkCreditsAria, not live region,
    // and is rendered outside role="listbox" (RF1-21)
    const descId = uniworkOpt.getAttribute('aria-describedby')
    expect(descId).toBeTruthy()
    const descEl = document.getElementById(descId!)
    expect(descEl).not.toBeNull()
    expect(getListbox()!.contains(descEl)).toBe(false)
    expect(descEl!.textContent).toBe(
      aiUniworkText('vi', 'aiUniworkCreditsAria', { remaining: '8.200', limit: '10.000' }),
    )
    expect(descEl!.getAttribute('aria-live')).toBeNull()
    expect(descEl!.getAttribute('role')).toBeNull()
    // RF3-2: the spoken text is the catalogue wording; the visible "/" line stays aria-hidden
    expect(descEl!.textContent).toBe('Còn 8.200 trên 10.000 tín dụng')
  })

  it('F10: credits are grouped by the UI language in the visible line and the spoken text (en: 380,000 / 500,000; vi: 380.000 / 500.000)', async () => {
    setUniworkAiAvailable(true)
    const getCloudStatus = async (): Promise<CloudStatusMock> => ({
      state: 'ready',
      signedIn: true,
      hasCompletedRead: true,
      credits: { remaining: 380000, limit: 500000 },
    })
    for (const [lang, visible, spoken] of [
      ['en', '380,000 / 500,000 left', '380,000 of 500,000 credits left'],
      ['vi', 'Còn 380.000 / 500.000', 'Còn 380.000 trên 500.000 tín dụng'],
    ] as const) {
      const { getChip, getOptions } = await mountPicker({ getCloudStatus }, lang)
      await openPopup(getChip())
      const opt = getOptions()[0]!
      expect(opt.querySelector('.ai-model-item-sub')!.textContent).toBe(visible)
      expect(document.getElementById(opt.getAttribute('aria-describedby')!)!.textContent).toBe(
        spoken,
      )
      act(() => root.unmount())
      root = createRoot(host)
    }
  })

  it('F4: opening the picker moves focus onto the selected option; Esc closes and returns focus to the chip', async () => {
    setUniworkAiAvailable(true)
    const { getChip, getOptions } = await mountPicker(
      {
        getCloudStatus: async () => ({
          state: 'ready',
          signedIn: true,
          hasCompletedRead: true,
          credits: { remaining: 10, limit: 20 },
        }),
      },
      'en',
    )
    await openPopup(getChip())
    const options = getOptions()
    expect(options[0]!.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(options[0])
    pressKey(document.activeElement!, 'Escape')
    expect(host.querySelector('.ai-model-pop')).toBeNull()
    expect(document.activeElement).toBe(getChip())
  })

  it('F4: ArrowDown / ArrowUp on the opener open the picker and enter the list; a click opening it also lands in the list', async () => {
    setUniworkAiAvailable(true)
    const settings = buildSettings({ provider: 'anthropic' })
    const { getChip, getOptions } = await mountPicker({}, 'en', settings)
    const chip = getChip()
    act(() => chip.focus())
    pressKey(chip, 'ArrowDown')
    await act(async () => {})
    const options = getOptions()
    expect(options.length).toBeGreaterThan(1)
    const selected = options.find((o) => o.getAttribute('aria-selected') === 'true') ?? options[0]!
    expect(document.activeElement).toBe(selected)
    pressKey(document.activeElement!, 'Escape')
    expect(document.activeElement).toBe(getChip())
    // ArrowUp also opens it
    pressKey(getChip(), 'ArrowUp')
    await act(async () => {})
    expect(host.querySelector('.ai-model-pop')).not.toBeNull()
    expect(getOptions().some((o) => o === document.activeElement)).toBe(true)
  })

  it.each([
    'signed-out',
    'not-entitled',
    'subscription-inactive',
    'credits-exhausted',
    'unavailable',
  ] as const)(
    'desktop: hides the UniWork AI row and shows Choose model on the chip when cloud state is %s even if the flag is still true (RF1-20)',
    async (state) => {
      setUniworkAiAvailable(true)
      const { getChip, getGroups, getOptions } = await mountPicker(
        {
          getCloudStatus: async () => ({
            state,
            signedIn: state !== 'signed-out',
            hasCompletedRead: true,
          }),
        },
        'vi',
        buildSettings({ provider: 'uniwork' }),
      )
      expect(getChip().textContent).toBe(AI_MODEL_PICKER_STRINGS.vi.choose)
      await openPopup(getChip())
      expect(
        getGroups().map((g) => g.querySelector('.ai-model-group-head')?.textContent),
      ).not.toContain('UniWork AI')
      expect(getOptions().map((o) => o.textContent)).not.toContain('UniWork AI')
    },
  )

  it('desktop: shows cloudCreditsUnlimited when credits.limit is null', async () => {
    setUniworkAiAvailable(true)
    const { getChip, getOptions } = await mountPicker(
      {
        getCloudStatus: async () => ({
          state: 'ready',
          signedIn: true,
          hasCompletedRead: true,
          credits: { remaining: 999, limit: null },
        }),
      },
      'en',
    )
    await openPopup(getChip())
    const uniworkOpt = getOptions()[0]!
    const subLine = uniworkOpt.querySelector<HTMLElement>('.ai-model-item-sub')
    expect(subLine).not.toBeNull()
    expect(subLine!.getAttribute('aria-hidden')).toBe('true')
    expect(subLine!.textContent).toBe('Unlimited')
    const descId = uniworkOpt.getAttribute('aria-describedby')
    expect(descId).toBeTruthy()
    expect(document.getElementById(descId!)?.textContent).toBe('Unlimited')
  })

  it('web: the chip reads the credits from window.uniworkCloudStatus and has no manage row', async () => {
    setUniworkAiAvailable(true)
    // what a web frame publishes (web/modules/shared/ai/web-ai.ts): the same window bridge as a
    // desktop preload, fed by the frame's own GET cloud
    ;(window as unknown as { uniworkCloudStatus?: unknown }).uniworkCloudStatus = {
      get: async () => ({
        state: 'ready',
        signedIn: true,
        enabled: true,
        credits: { remaining: 380000, limit: 500000 },
      }),
      onChange: () => () => {},
    }
    // a web panel's bridge: no model settings to open, so no openModelSettings
    const { getChip, getOptions, getManageBtn } = await mountPicker(
      { openModelSettings: undefined },
      'en',
    )
    await openPopup(getChip())
    const uniworkOpt = getOptions()[0]!
    expect(uniworkOpt.querySelector('.ai-model-item-sub')!.textContent).toBe(
      aiUniworkText('en', 'cloudCreditsLeft', { remaining: '380,000', limit: '500,000' }),
    )
    expect(uniworkOpt.getAttribute('aria-describedby')).toBeTruthy()
    expect(getManageBtn()).toBeNull()
  })
})

describe('AiModelPicker S7 — picker footer per cloud state (desktop only)', () => {
  it('shows no footer before the first server read (status null or hasCompletedRead false) and when ready', async () => {
    let status: CloudStatusMock | null = null
    let pushStatus: ((next: CloudStatusMock | null) => void) | undefined
    const { getChip, getFooter } = await mountPicker(
      {
        getCloudStatus: async () => status,
        onCloudStatusChanged: (cb) => {
          pushStatus = cb
          return () => {
            pushStatus = undefined
          }
        },
      },
      'vi',
      buildSettings({ provider: 'anthropic' }),
    )
    await openPopup(getChip())
    expect(getFooter()).toBeNull()

    // Unread snapshot (hasCompletedRead: false) still shows no footer
    await act(async () => {
      pushStatus?.({ state: 'unavailable', hasCompletedRead: false, cloudUnavailable: false })
    })
    expect(getFooter()).toBeNull()

    // Ready state shows no footer
    status = { state: 'ready', signedIn: true, hasCompletedRead: true }
    await act(async () => {
      pushStatus?.(status)
    })
    expect(getFooter()).toBeNull()
  })

  it('signed-out: renders aiUniworkFooterSignIn + Đăng nhập outside listbox, after Quản lý', async () => {
    const signIn = vi.fn()
    const { getChip, getListbox, getManageBtn, getFooter, getFooterBtn } = await mountPicker(
      {
        getCloudStatus: async () => ({
          state: 'signed-out',
          signedIn: false,
          hasCompletedRead: true,
        }),
        signIn,
      },
      'vi',
      buildSettings({ provider: 'anthropic' }),
    )
    await openPopup(getChip())
    const footer = getFooter()
    expect(footer).not.toBeNull()
    expect(getListbox()!.contains(footer)).toBe(false)
    // Placed after Manage button
    expect(getManageBtn()!.nextElementSibling).toBe(footer)
    expect(footer!.textContent).toContain(aiUniworkText('vi', 'aiUniworkFooterSignIn'))
    expect(getFooterBtn()!.textContent).toBe('Đăng nhập')

    await act(async () => {
      getFooterBtn()!.click()
    })
    expect(signIn).toHaveBeenCalledTimes(1)
    expect(getFooter()).toBeNull()
    expect(document.activeElement).toBe(getChip())
  })

  it.each([
    ['not-entitled', 'Gói hiện tại chưa bao gồm', 'Not in your plan'],
    ['subscription-inactive', 'Gói đăng ký không hoạt động', 'Subscription inactive'],
    ['credits-exhausted', 'Đã hết tín dụng AI', 'Out of AI credits'],
  ] as const)(
    'state %s: renders cloudState* label + Chi tiết / Details and calls openAccountSettings',
    async (state, viLabel, enLabel) => {
      const openAccountSettings = vi.fn()
      const { getChip, getFooter, getFooterBtn } = await mountPicker(
        {
          getCloudStatus: async () => ({
            state,
            signedIn: true,
            hasCompletedRead: true,
          }),
          openAccountSettings,
        },
        'vi',
        buildSettings({ provider: 'anthropic' }),
      )
      await openPopup(getChip())
      expect(getFooter()!.textContent).toContain(viLabel)
      expect(getFooterBtn()!.textContent).toBe('Chi tiết')

      await act(async () => {
        getFooterBtn()!.click()
      })
      expect(openAccountSettings).toHaveBeenCalledTimes(1)
      expect(getFooter()).toBeNull()
      expect(document.activeElement).toBe(getChip())

      // Verify English copy too
      act(() => root.unmount())
      root = createRoot(host)
      const enMount = await mountPicker(
        {
          getCloudStatus: async () => ({
            state,
            signedIn: true,
            hasCompletedRead: true,
          }),
        },
        'en',
        buildSettings({ provider: 'anthropic' }),
      )
      await openPopup(enMount.getChip())
      expect(enMount.getFooter()!.textContent).toContain(enLabel)
      expect(enMount.getFooterBtn()!.textContent).toBe('Details')
    },
  )

  it('unavailable: shows footer ONLY when cloudUnavailable is true (cloud_unavailable), not on network/timeout', async () => {
    let pushStatus: ((next: CloudStatusMock | null) => void) | undefined
    const { getChip, getFooter, getFooterBtn } = await mountPicker(
      {
        getCloudStatus: async () => ({
          state: 'unavailable',
          signedIn: true,
          hasCompletedRead: true,
          cloudUnavailable: false,
          reason: 'network',
        }),
        onCloudStatusChanged: (cb) => {
          pushStatus = cb
          return () => {}
        },
      },
      'vi',
      buildSettings({ provider: 'anthropic' }),
    )
    await openPopup(getChip())
    expect(getFooter()).toBeNull()

    await act(async () => {
      pushStatus?.({
        state: 'unavailable',
        signedIn: true,
        hasCompletedRead: true,
        cloudUnavailable: true,
        reason: 'cloud_unavailable',
      })
    })
    expect(getFooter()).not.toBeNull()
    expect(getFooter()!.textContent).toContain('Tạm thời không dùng được')
    expect(getFooterBtn()!.textContent).toBe('Chi tiết')
  })

  it('reads window.uniworkCloudStatus when the bridge does not pass getCloudStatus', async () => {
    ;(window as unknown as { uniworkCloudStatus?: unknown }).uniworkCloudStatus = {
      get: async () => ({
        state: 'credits-exhausted',
        signedIn: true,
        hasCompletedRead: true,
        cloudUnavailable: false,
        credits: { remaining: 0, limit: 1000, periodEndsAt: null },
      }),
      onChanged: () => () => {},
    }
    const desktop = await mountPicker({}, 'vi', buildSettings({ provider: 'anthropic' }))
    await openPopup(desktop.getChip())
    expect(desktop.getFooter()).not.toBeNull()
    expect(desktop.getFooter()!.textContent).toContain('Đã hết tín dụng AI')
  })
})

describe('AiModelPicker S7 — Accessibility Floor ARIA & keyboard', () => {
  it('moves role=listbox + aria-label to .ai-model-pop-list, sets role=group on .ai-model-pop and each .ai-model-group, and wires aria-controls on chip while open', async () => {
    setUniworkAiAvailable(true)
    const { getChip, getPop, getListbox, getGroups, getOptions } = await mountPicker({}, 'vi')
    const chip = getChip()

    expect(chip.getAttribute('aria-haspopup')).toBe('listbox')
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    expect(chip.getAttribute('aria-controls')).toBeNull()
    expect(chip.getAttribute('aria-activedescendant')).toBeNull()

    await openPopup(chip)
    const pop = getPop()!
    const listbox = getListbox()!
    expect(chip.getAttribute('aria-expanded')).toBe('true')
    expect(listbox.id).toBeTruthy()
    expect(chip.getAttribute('aria-controls')).toBe(listbox.id)

    // .ai-model-pop is role=group with aria-label, NOT role=listbox
    expect(pop.getAttribute('role')).toBe('group')
    expect(pop.getAttribute('aria-label')).toBeTruthy()

    // .ai-model-pop-list is role=listbox with aria-label
    expect(listbox.getAttribute('role')).toBe('listbox')
    expect(listbox.getAttribute('aria-label')).toBe(AI_MODEL_PICKER_STRINGS.vi.title)
    expect(listbox.getAttribute('aria-activedescendant')).toBeNull()

    // Each .ai-model-group has role=group and aria-labelledby pointing to its .ai-model-group-head
    const groups = getGroups()
    expect(groups.length).toBeGreaterThanOrEqual(2)
    for (const grp of groups) {
      expect(grp.getAttribute('role')).toBe('group')
      const head = grp.querySelector<HTMLElement>('.ai-model-group-head')!
      expect(head.id).toBeTruthy()
      expect(grp.getAttribute('aria-labelledby')).toBe(head.id)
    }

    // Every option is <button role="option"> with no aria-activedescendant anywhere
    for (const opt of getOptions()) {
      expect(opt.tagName).toBe('BUTTON')
      expect(opt.getAttribute('role')).toBe('option')
    }
  })

  it('implements roving tabindex (single Tab stop on selected option) and ArrowUp/ArrowDown/Home/End navigation across groups', async () => {
    setUniworkAiAvailable(true)
    // Configure two 1-model BYOK providers (kimi + spark) and select kimi (second group's option) initially
    const initial: AiSettings = {
      ...defaultAiSettings(),
      uniAiAvailable: false,
      provider: 'kimi',
    }
    initial.providers = {
      ...initial.providers,
      kimi: { ...initial.providers.kimi, apiKey: 'sk-kimi', model: 'kimi-k3' },
      spark: { ...initial.providers.spark, apiKey: 'ak-spark', model: 'spark-x2.5' },
    }
    let pushStatus: ((next: CloudStatusMock | null) => void) | undefined
    const { getChip, getOptions, getManageBtn, getFooterBtn } = await mountPicker(
      {
        getCloudStatus: async () => ({
          state: 'ready',
          signedIn: true,
          hasCompletedRead: true,
        }),
        onCloudStatusChanged: (cb) => {
          pushStatus = cb
          return () => {
            pushStatus = undefined
          }
        },
      },
      'vi',
      initial,
    )
    await openPopup(getChip())
    const options = getOptions()
    expect(options).toHaveLength(3) // UniWork AI, kimi-k3, spark-x2.5

    // Roving tabindex enters on the selected option (index 1: kimi-k3)
    expect(options.map((o) => o.tabIndex)).toEqual([-1, 0, -1])

    act(() => options[1]!.focus())
    expect(document.activeElement).toBe(options[1])

    // ArrowDown moves to index 2 (spark-x2.5)
    pressKey(options[1]!, 'ArrowDown')
    expect(document.activeElement).toBe(options[2])
    expect(options.map((o) => o.tabIndex)).toEqual([-1, -1, 0])

    // ArrowUp moves back to index 1
    pressKey(options[2]!, 'ArrowUp')
    expect(document.activeElement).toBe(options[1])
    expect(options.map((o) => o.tabIndex)).toEqual([-1, 0, -1])

    // Home jumps to index 0 (UniWork AI)
    pressKey(options[1]!, 'Home')
    expect(document.activeElement).toBe(options[0])
    expect(options.map((o) => o.tabIndex)).toEqual([0, -1, -1])

    // End jumps to last option (index 2)
    pressKey(options[0]!, 'End')
    expect(document.activeElement).toBe(options[2])
    expect(options.map((o) => o.tabIndex)).toEqual([-1, -1, 0])

    // When cloud state transitions to not-entitled, UniWork AI row hides and footer action button joins Tab order
    await act(async () => {
      pushStatus?.({
        state: 'not-entitled',
        signedIn: true,
        hasCompletedRead: true,
      })
    })
    const remainingOptions = getOptions()
    expect(remainingOptions).toHaveLength(2) // kimi-k3, spark-x2.5

    // Tab order stops inside picker: chip -> active option in list -> Manage -> footer action button
    const tabStops = [...host.querySelectorAll<HTMLElement>('button')].filter(
      (b) => b.tabIndex === 0,
    )
    expect(tabStops).toEqual([getChip(), remainingOptions[1]!, getManageBtn()!, getFooterBtn()!])
  })

  it('closes and returns focus to chip on Escape, option pick, Manage click, and footer action (unless focus moved to another surface); outside click leaves focus where clicked', async () => {
    setUniworkAiAvailable(true)
    const { getChip, getOptions, getManageBtn, getPop } = await mountPicker({}, 'vi')
    const chip = getChip()

    // 1. Escape anywhere in popup closes and focuses chip
    await openPopup(chip)
    const opts1 = getOptions()
    act(() => opts1[0]!.focus())
    const escEvent = pressKey(opts1[0]!, 'Escape')
    expect(escEvent.defaultPrevented).toBe(true)
    expect(getPop()).toBeNull()
    expect(document.activeElement).toBe(chip)

    // 2. Picking an option closes and focuses chip
    await openPopup(chip)
    const opts2 = getOptions()
    act(() => opts2[1]!.focus())
    await act(async () => {
      opts2[1]!.click()
    })
    expect(getPop()).toBeNull()
    expect(document.activeElement).toBe(chip)

    // 3. Clicking Manage closes and focuses chip when openModelSettings does not move focus
    await openPopup(chip)
    const manageBtn = getManageBtn()!
    act(() => manageBtn.focus())
    await act(async () => {
      manageBtn.click()
    })
    expect(getPop()).toBeNull()
    expect(document.activeElement).toBe(chip)

    // 4. If Manage opens another surface that takes focus, chip does not steal focus back
    const modalBtn = document.createElement('button')
    document.body.append(modalBtn)
    act(() => root.unmount())
    root = createRoot(host)
    const m2 = await mountPicker(
      {
        openModelSettings: () => {
          modalBtn.focus()
        },
      },
      'vi',
    )
    await openPopup(m2.getChip())
    await act(async () => {
      m2.getManageBtn()!.click()
    })
    expect(document.activeElement).toBe(modalBtn)

    // 5. Outside click closes popup and leaves focus where clicked
    await openPopup(m2.getChip())
    act(() => {
      modalBtn.focus()
      modalBtn.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(m2.getPop()).toBeNull()
    expect(document.activeElement).toBe(modalBtn)
    modalBtn.remove()
  })

  it('enforces focus-ring exception and 44px coarse pointer targets in ai-model-picker.css', () => {
    const css = readFileSync(resolve(__dirname, '../src/ai-model-picker.css'), 'utf8')
    expect(css).toMatch(/\.ai-model-item:focus-visible/)
    expect(css).toMatch(/\.ai-model-item\.selected:focus-visible/)
    expect(css).toMatch(/outline:\s*2px\s+solid\s+var\(--accent\)/)
    expect(css).toMatch(/outline-offset:\s*-2px/)
    expect(css).toMatch(/@media\s*\(\s*pointer:\s*coarse\s*\)/)
    expect(css).toMatch(/min-height:\s*44px/)
  })
})
