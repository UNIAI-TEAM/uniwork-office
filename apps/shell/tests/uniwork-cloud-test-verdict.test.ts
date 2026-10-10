import { describe, expect, it } from 'vitest'
import { UNIWORK_CLOUD_SIGNED_OUT } from '@genoffice/ai-provider/browser'
import type { UniworkCloudState, UniworkCloudStatus } from '@genoffice/ai-provider/browser'
import { cloudTestVerdict } from '../src/renderer/src/UniworkCloudPane'
import type { TFunc } from '../src/renderer/src/locale'
import { en } from '../src/renderer/src/i18n/cloud/en'
import { vi } from '../src/renderer/src/i18n/cloud/vi'

const tOf = (table: Record<string, string>) => ((key: string) => table[key] ?? key) as TFunc
const statusOf = (state: UniworkCloudState): UniworkCloudStatus => ({
  ...UNIWORK_CLOUD_SIGNED_OUT,
  state,
  enabled: state === 'ready' || state === 'credits-exhausted' || state === 'unavailable',
})

describe('settings test connection for the UniWork cloud blocks', () => {
  it('passes when the server says the cloud is ready, and when there is no session or no status', () => {
    expect(cloudTestVerdict(statusOf('ready'), tOf(en))).toEqual({ ok: true })
    expect(cloudTestVerdict(statusOf('signed-out'), tOf(en))).toEqual({ ok: true })
    expect(cloudTestVerdict(null, tOf(en))).toEqual({ ok: true })
  })

  it('names the plan, credits or availability problem in English', () => {
    const t = tOf(en)
    expect(cloudTestVerdict(statusOf('not-entitled'), t)).toEqual({
      ok: false,
      error: 'Not in your plan',
    })
    expect(cloudTestVerdict(statusOf('credits-exhausted'), t)).toEqual({
      ok: false,
      error: 'Out of AI credits',
    })
    expect(cloudTestVerdict(statusOf('subscription-inactive'), t).error).toBe(
      'Subscription inactive',
    )
    expect(cloudTestVerdict(statusOf('unavailable'), t).error).toBe('Unavailable')
  })

  it('answers in Vietnamese with the same labels as the Account rows', () => {
    const t = tOf(vi)
    expect(cloudTestVerdict(statusOf('not-entitled'), t).error).toBe(vi.cloudStateNotEntitled)
    expect(cloudTestVerdict(statusOf('credits-exhausted'), t).error).toBe(vi.cloudStateExhausted)
    expect(cloudTestVerdict(statusOf('subscription-inactive'), t).error).toBe(vi.cloudStateInactive)
    expect(cloudTestVerdict(statusOf('unavailable'), t).error).toBe(vi.cloudStateUnavailable)
    expect(vi.cloudStateExhausted).not.toBe(en.cloudStateExhausted)
  })
})
