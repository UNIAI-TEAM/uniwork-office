/** @vitest-environment jsdom */
// The composer's model chip knows UniWork AI only (UNI-2309): it names UniWork AI (or the model it
// serves), its popover shows the organization's credits and the cloud state footer, and there is
// no list of providers to switch to and no "Manage models" row.
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
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  setUniworkAiAvailable(true)
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

const READY = (credits?: CloudStatusMock['credits']): CloudStatusMock => ({
  state: 'ready',
  signedIn: true,
  hasCompletedRead: true,
  ...(credits !== undefined ? { credits } : {}),
})

async function mountPicker(
  bridgeOverrides: Partial<ExtendedBridge> = {},
  lang: 'en' | 'vi' = 'vi',
  settings: AiSettings = defaultAiSettings(),
) {
  const bridge: ExtendedBridge = {
    getSettings: async () => settings,
    openModelSettings: vi.fn(),
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
    getSub: () => host.querySelector<HTMLElement>('.ai-model-item-sub'),
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

function pressKey(target: Element, key: string) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

describe('AiModelPicker: a UniWork AI chip', () => {
  it('names UniWork AI, or the model it serves', async () => {
    const plain = await mountPicker({ getCloudStatus: async () => READY() }, 'en')
    expect(plain.getChip().textContent).toBe('UniWork AI')
    expect(plain.getChip().getAttribute('aria-label')).toBe(
      `${AI_MODEL_PICKER_STRINGS.en.title}: UniWork AI`,
    )
    act(() => root.unmount())
    root = createRoot(host)
    const served = await mountPicker({ getCloudStatus: async () => READY() }, 'en', {
      ...defaultAiSettings(),
      uniworkModel: 'claude-sonnet-x',
    })
    expect(served.getChip().textContent).toBe('claude-sonnet-x')
  })

  it('shows the credit line in the popover, grouped by the UI language, with the spoken text beside it', async () => {
    for (const [lang, visible, spoken] of [
      ['en', '380,000 / 500,000 left', '380,000 of 500,000 credits left'],
      ['vi', 'Còn 380.000 / 500.000', 'Còn 380.000 trên 500.000 tín dụng'],
    ] as const) {
      const getCloudStatus = vi.fn(async () => READY({ remaining: 380000, limit: 500000 }))
      const { getChip, getPop, getSub } = await mountPicker({ getCloudStatus }, lang)
      await openPopup(getChip())
      // opening does not re-fetch the credits
      expect(getCloudStatus).toHaveBeenCalledTimes(1)
      expect(getSub()!.textContent).toBe(visible)
      expect(getSub()!.getAttribute('aria-hidden')).toBe('true')
      expect(getPop()!.querySelector('.ai-model-sr-only')!.textContent).toBe(spoken)
      act(() => root.unmount())
      root = createRoot(host)
    }
  })

  it('shows Unlimited when the plan has no credit limit', async () => {
    const { getChip, getSub } = await mountPicker(
      { getCloudStatus: async () => READY({ remaining: 999, limit: null }) },
      'en',
    )
    await openPopup(getChip())
    expect(getSub()!.textContent).toBe('Unlimited')
  })

  it('has no provider list and no Manage models row', async () => {
    const { getChip, getPop } = await mountPicker(
      { getCloudStatus: async () => READY({ remaining: 10, limit: 20 }) },
      'en',
    )
    expect(getChip().getAttribute('aria-haspopup')).toBeNull()
    await openPopup(getChip())
    const pop = getPop()!
    expect(pop.getAttribute('role')).toBe('group')
    expect(pop.getAttribute('aria-label')).toBe(AI_MODEL_PICKER_STRINGS.en.title)
    expect(getChip().getAttribute('aria-expanded')).toBe('true')
    expect(getChip().getAttribute('aria-controls')).toBe(pop.id)
    expect(host.querySelector('[role="listbox"]')).toBeNull()
    expect(host.querySelector('[role="option"]')).toBeNull()
    expect(host.querySelector('.ai-model-manage')).toBeNull()
    expect(host.textContent).not.toMatch(/Manage models/)
  })

  it('opening the chip mounts no live region: the panel owns the one polite node', async () => {
    const { getChip, getPop } = await mountPicker(
      { getCloudStatus: async () => READY({ remaining: 10, limit: 20 }) },
      'en',
    )
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(0)
    await openPopup(getChip())
    expect(getPop()).not.toBeNull()
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(0)
    expect(document.querySelectorAll('[role="status"], [role="alert"], [role="log"]')).toHaveLength(
      0,
    )
  })

  it('the web reads the credits from window.uniworkCloudStatus', async () => {
    ;(window as unknown as { uniworkCloudStatus?: unknown }).uniworkCloudStatus = {
      get: async () => ({
        state: 'ready',
        signedIn: true,
        enabled: true,
        credits: { remaining: 380000, limit: 500000 },
      }),
      onChange: () => () => {},
    }
    const { getChip, getSub } = await mountPicker({ openModelSettings: undefined }, 'en')
    await openPopup(getChip())
    expect(getSub()!.textContent).toBe(
      aiUniworkText('en', 'cloudCreditsLeft', { remaining: '380,000', limit: '500,000' }),
    )
  })

  it('Escape closes the popover and returns focus to the chip; an outside click leaves focus where it went', async () => {
    const { getChip, getPop } = await mountPicker({ getCloudStatus: async () => READY() }, 'en')
    act(() => getChip().focus())
    await openPopup(getChip())
    const esc = pressKey(getPop()!, 'Escape')
    expect(esc.defaultPrevented).toBe(true)
    expect(getPop()).toBeNull()
    expect(document.activeElement).toBe(getChip())

    const outside = document.createElement('button')
    document.body.append(outside)
    await openPopup(getChip())
    act(() => {
      outside.focus()
      outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(getPop()).toBeNull()
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })
})

describe('AiModelPicker: the cloud state footer', () => {
  it('shows no footer before the first server read, nor when ready', async () => {
    let pushStatus: ((next: CloudStatusMock | null) => void) | undefined
    const { getChip, getFooter } = await mountPicker(
      {
        getCloudStatus: async () => null,
        onCloudStatusChanged: (cb) => {
          pushStatus = cb
          return () => {}
        },
      },
      'vi',
    )
    await openPopup(getChip())
    expect(getFooter()).toBeNull()
    await act(async () => {
      pushStatus?.({ state: 'unavailable', hasCompletedRead: false, cloudUnavailable: false })
    })
    expect(getFooter()).toBeNull()
    await act(async () => {
      pushStatus?.(READY())
    })
    expect(getFooter()).toBeNull()
  })

  it('signed out: the footer offers sign-in, which closes the popover and keeps focus on the chip', async () => {
    const signIn = vi.fn()
    const { getChip, getFooter, getFooterBtn } = await mountPicker(
      {
        getCloudStatus: async () => ({
          state: 'signed-out',
          signedIn: false,
          hasCompletedRead: true,
        }),
        signIn,
      },
      'vi',
    )
    await openPopup(getChip())
    expect(getFooter()!.textContent).toContain(aiUniworkText('vi', 'aiUniworkFooterSignIn'))
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
    'state %s: the footer names it and Details opens the account settings',
    async (state, viLabel, enLabel) => {
      const openModelSettings = vi.fn()
      const vi_ = await mountPicker(
        {
          getCloudStatus: async () => ({ state, signedIn: true, hasCompletedRead: true }),
          openModelSettings,
        },
        'vi',
      )
      await openPopup(vi_.getChip())
      expect(vi_.getFooter()!.textContent).toContain(viLabel)
      expect(vi_.getFooterBtn()!.textContent).toBe('Chi tiết')
      await act(async () => {
        vi_.getFooterBtn()!.click()
      })
      expect(openModelSettings).toHaveBeenCalledTimes(1)
      expect(vi_.getFooter()).toBeNull()

      act(() => root.unmount())
      root = createRoot(host)
      const en = await mountPicker(
        { getCloudStatus: async () => ({ state, signedIn: true, hasCompletedRead: true }) },
        'en',
      )
      await openPopup(en.getChip())
      expect(en.getFooter()!.textContent).toContain(enLabel)
      expect(en.getFooterBtn()!.textContent).toBe('Details')
    },
  )

  it('unavailable: a footer only when the cloud itself is unavailable, not on a network error', async () => {
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
    expect(getFooter()!.textContent).toContain('Tạm thời không dùng được')
    expect(getFooterBtn()!.textContent).toBe('Chi tiết')
  })
})

describe('AiModelPicker: the stylesheet', () => {
  it('keeps the focus ring and 44px coarse-pointer targets of the chip and the footer action', () => {
    const css = readFileSync(resolve(__dirname, '../src/ai-model-picker.css'), 'utf8')
    expect(css).toMatch(/\.ai-model-footer-action:focus-visible/)
    expect(css).toMatch(/outline:\s*2px\s+solid\s+var\(--accent\)/)
    expect(css).toMatch(/@media\s*\(\s*pointer:\s*coarse\s*\)/)
    expect(css).toMatch(/min-height:\s*44px/)
    // the provider list is gone, and so are its rules
    expect(css).not.toMatch(/\.ai-model-pop-list|\.ai-model-manage|\.ai-model-group\b/)
  })
})
