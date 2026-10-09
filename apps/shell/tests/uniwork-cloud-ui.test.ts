/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkCloudState, UniworkCloudStatus } from '@genoffice/ai-provider/browser'
import { LANGS } from '@genoffice/i18n'
import type { HomeApi } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import type { Lang } from '../src/renderer/src/locale'
import {
  UniworkCloudAccountRows,
  UniworkCloudNotice,
  useUniworkCloudStatus,
} from '../src/renderer/src/UniworkCloudPane'
import { cloudStrings } from '../src/renderer/src/i18n/strings-cloud'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const TOOLS = {
  web_search: true,
  image_search: true,
  image_generate: true,
  media_analyze: true,
  transcribe: true,
}

function statusOf(
  state: UniworkCloudState,
  extra: Partial<UniworkCloudStatus> = {},
): UniworkCloudStatus {
  const entitled =
    state !== 'signed-out' && state !== 'not-entitled' && state !== 'subscription-inactive'
  return {
    state,
    enabled: entitled,
    tools: entitled
      ? TOOLS
      : {
          ...TOOLS,
          web_search: false,
          image_search: false,
          image_generate: false,
          media_analyze: false,
          transcribe: false,
        },
    credits: entitled
      ? {
          unit: 'ai.tokens',
          used: 2000,
          limit: 50000,
          remaining: state === 'credits-exhausted' ? 0 : 48000,
          periodEnd: '2026-11-01T00:00:00Z',
        }
      : null,
    ...extra,
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(lang: Lang, node: ReturnType<typeof createElement>) {
  act(() => {
    root.render(createElement(LocaleProvider, { initial: lang, key: lang }, node))
  })
}

describe('AI media cloud notice', () => {
  it.each([
    ['signed-out', 'cloudSignedOutBody'],
    ['not-entitled', 'cloudNotEntitledBody'],
    ['credits-exhausted', 'cloudExhaustedBody'],
    ['unavailable', 'cloudUnavailableBody'],
    ['ready', 'cloudReadyBody'],
  ] as const)('%s shows its explanation in en and vi', (state, bodyKey) => {
    for (const lang of ['en', 'vi'] as const) {
      render(
        lang,
        createElement(UniworkCloudNotice, { status: statusOf(state), onSignIn: () => undefined }),
      )
      const text = host.textContent ?? ''
      expect(text).toContain(cloudStrings[lang][bodyKey])
      expect(host.querySelector('[data-cloud-state]')?.getAttribute('data-cloud-state')).toBe(state)
      expect(text).not.toMatch(/genspark|github|\bgit\b|UNI-\d/i)
    }
  })

  it('signed out offers Sign in (the account entry action); other states do not', () => {
    const onSignIn = vi.fn()
    render('en', createElement(UniworkCloudNotice, { status: statusOf('signed-out'), onSignIn }))
    const button = host.querySelector('button')!
    expect(button.textContent).toBe(accountStrings.en.acctSignIn)
    act(() => button.click())
    expect(onSignIn).toHaveBeenCalledTimes(1)
    render('en', createElement(UniworkCloudNotice, { status: statusOf('not-entitled'), onSignIn }))
    expect(host.querySelector('button')).toBeNull()
  })

  it('out of credits is an alert and shows 0 left', () => {
    render('en', createElement(UniworkCloudNotice, { status: statusOf('credits-exhausted') }))
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    expect(host.textContent).toContain(cloudStrings.en.cloudStateExhausted)
    expect(host.textContent).toContain('0 / 50,000 left')
  })
})

describe('AI media cloud notice: billing, switch and unavailable (M2, m2, N2)', () => {
  const inactive = statusOf('subscription-inactive', { enabled: false })

  it('an inactive subscription is a warning that says so, not "not in your plan"', () => {
    for (const lang of ['en', 'vi'] as const) {
      render(lang, createElement(UniworkCloudNotice, { status: inactive }))
      const text = host.textContent ?? ''
      expect(host.querySelector('[role="alert"]')).not.toBeNull()
      expect(text).toContain(cloudStrings[lang].cloudStateInactive)
      expect(text).toContain(cloudStrings[lang].cloudInactiveBody)
      expect(text).not.toContain(cloudStrings[lang].cloudNotEntitledBody)
      expect(text).not.toContain('AI credits:')
    }
  })

  it('ready with the cloud switch off says the tools are paused and where to turn them on', () => {
    for (const lang of ['en', 'vi'] as const) {
      render(
        lang,
        createElement(UniworkCloudNotice, { status: statusOf('ready'), toolsEnabled: false }),
      )
      const text = host.textContent ?? ''
      expect(text).not.toContain(cloudStrings[lang].cloudReadyBody)
      // placeholders are filled with the switch name and the AI model section, never left raw
      expect(text).toContain(cloudStrings[lang].cloudToolsToggle)
      expect(text).not.toMatch(/{switch}|{section}/)
    }
    render(
      'en',
      createElement(UniworkCloudNotice, { status: statusOf('ready'), toolsEnabled: true }),
    )
    expect(host.textContent).toContain(cloudStrings.en.cloudReadyBody)
  })

  it('an out-of-credits cloud keeps its alert whatever the switch says', () => {
    render(
      'en',
      createElement(UniworkCloudNotice, {
        status: statusOf('credits-exhausted'),
        toolsEnabled: false,
      }),
    )
    expect(host.textContent).toContain(cloudStrings.en.cloudExhaustedBody)
  })

  it('unavailable leads with the product name, not a bare "Unavailable"', () => {
    render('en', createElement(UniworkCloudNotice, { status: statusOf('unavailable') }))
    expect(host.querySelector('.acct-notice-title')?.textContent).toBe(cloudStrings.en.cloudTitle)
  })
})

describe('Account cloud rows', () => {
  it('inactive subscription shows its state without a credits row', () => {
    render(
      'vi',
      createElement(UniworkCloudAccountRows, {
        status: statusOf('subscription-inactive', { enabled: false }),
      }),
    )
    expect(host.textContent).toContain(cloudStrings.vi.cloudStateInactive)
    expect(host.textContent).not.toContain(cloudStrings.vi.cloudCredits)
  })

  it('hidden while signed out', () => {
    render('en', createElement(UniworkCloudAccountRows, { status: statusOf('signed-out') }))
    expect(host.textContent).toBe('')
  })

  it('ready shows state and remaining / limit with the renewal date', () => {
    render('en', createElement(UniworkCloudAccountRows, { status: statusOf('ready') }))
    expect(host.textContent).toContain(cloudStrings.en.cloudStateReady)
    expect(host.textContent).toContain('48,000 / 50,000 left')
    expect(host.textContent).toContain('Renews')
  })

  it('vi copy and an uncapped plan', () => {
    const status = statusOf('ready')
    status.credits = { ...status.credits!, limit: null, remaining: null }
    render('vi', createElement(UniworkCloudAccountRows, { status }))
    expect(host.textContent).toContain(cloudStrings.vi.cloudCreditsUnlimited)
  })

  it('not entitled shows the state without a credits row', () => {
    render('en', createElement(UniworkCloudAccountRows, { status: statusOf('not-entitled') }))
    expect(host.textContent).toContain(cloudStrings.en.cloudStateNotEntitled)
    expect(host.textContent).not.toContain(cloudStrings.en.cloudCredits)
  })
})

describe('useUniworkCloudStatus', () => {
  it('reads, re-reads the credits and follows pushes', async () => {
    let push: ((s: UniworkCloudStatus) => void) | null = null
    window.aiOffice = {
      uniworkCloudStatus: vi.fn(async () => statusOf('ready')),
      uniworkCloudRefresh: vi.fn(async () => statusOf('credits-exhausted')),
      onUniworkCloudStatus: vi.fn((h: (s: UniworkCloudStatus) => void) => {
        push = h
        return () => {
          push = null
        }
      }),
    } as unknown as HomeApi
    function Probe() {
      const s = useUniworkCloudStatus()
      return createElement('span', null, s?.state ?? 'none')
    }
    render('en', createElement(Probe))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(host.textContent).toBe('credits-exhausted')
    act(() => push?.(statusOf('signed-out')))
    expect(host.textContent).toBe('signed-out')
    expect(window.aiOffice.uniworkCloudRefresh).toHaveBeenCalledTimes(1)
  })
})

describe('cloud string shards', () => {
  const referenceKeys = Object.keys(cloudStrings.zh).sort()
  const placeholdersOf = (s: string) => (s.match(/\{[a-zA-Z0-9]+\}/g) ?? []).sort().join(',')

  it('covers every UI language', () => {
    expect(Object.keys(cloudStrings).sort()).toEqual([...LANGS].sort())
  })

  it.each([...LANGS])(
    'locale %s: zh key set, no empty values, zh placeholders, no internal words',
    (lang) => {
      const table = cloudStrings[lang] as Record<string, string>
      const zh = cloudStrings.zh as Record<string, string>
      expect(Object.keys(table).sort()).toEqual(referenceKeys)
      expect(Object.entries(table).filter(([, v]) => !v.trim())).toEqual([])
      expect(
        referenceKeys.filter((k) => placeholdersOf(table[k]!) !== placeholdersOf(zh[k]!)),
      ).toEqual([])
      expect(
        Object.values(table).filter((v) =>
          /genspark|genoffice|github|\bgit\b|\bUNI-\d|\bGO-[A-Z]?\d/i.test(v),
        ),
      ).toEqual([])
    },
  )
})
