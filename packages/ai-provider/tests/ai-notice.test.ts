import { afterEach, describe, expect, it } from 'vitest'
import { UNIWORK_CLOUD_SIGNED_OUT, setUniworkCloudStatus } from '../src/uniwork-cloud'
import {
  aiNoticeBody,
  aiNoticeKind,
  aiNoticeKindForCloud,
  aiNoticeTagged,
  aiNoticeText,
  noModelMessage,
  noModelMessageFor,
  type AiNoticeKind,
  type AiNoticeLang,
} from '../src/ai-notice'

const KINDS: AiNoticeKind[] = ['no_model', 'not_entitled', 'credits_exhausted']
const LANGS: AiNoticeLang[] = ['en', 'vi']

describe('ai notices', () => {
  it('recognizes every notice text again, in both languages', () => {
    for (const lang of LANGS) {
      for (const kind of KINDS) expect(aiNoticeKind(aiNoticeText(kind, lang))).toBe(kind)
    }
  })

  it('does not take a real error or an empty message for a notice', () => {
    expect(aiNoticeKind('HTTP 401: invalid key')).toBeNull()
    expect(aiNoticeKind('')).toBeNull()
    expect(aiNoticeKind(undefined)).toBeNull()
  })

  it('never talks about buying a plan in the app or an Office account', () => {
    for (const lang of LANGS) {
      for (const kind of KINDS) {
        const text = aiNoticeText(kind, lang)
        expect(text).not.toMatch(
          /purchase|buy|mua|activated|kích hoạt|Office account|tài khoản Office/i,
        )
        expect(text).not.toMatch(/genspark|token hub|openrouter/i)
      }
    }
    expect(aiNoticeText('not_entitled', 'en')).toContain('organization')
    expect(aiNoticeText('not_entitled', 'vi')).toContain('tổ chức')
  })

  it('maps the cloud state to why there is no model', () => {
    expect(aiNoticeKindForCloud('not-entitled')).toBe('not_entitled')
    expect(aiNoticeKindForCloud('subscription-inactive')).toBe('not_entitled')
    expect(aiNoticeKindForCloud('credits-exhausted')).toBe('credits_exhausted')
    for (const state of ['signed-out', 'unavailable', 'ready'] as const) {
      expect(aiNoticeKindForCloud(state)).toBe('no_model')
    }
  })

  it('picks the notice for en and vi, tagged with its code', () => {
    expect(noModelMessageFor('en', 'ready', 'fallback')).toBe(
      aiNoticeTagged('no_model', aiNoticeText('no_model', 'en')),
    )
    expect(noModelMessageFor('vi', 'not-entitled', 'fallback')).toBe(
      aiNoticeTagged('not_entitled', aiNoticeText('not_entitled', 'vi')),
    )
    expect(noModelMessageFor('en', 'credits-exhausted', 'fallback')).toBe(
      aiNoticeTagged('credits_exhausted', aiNoticeText('credits_exhausted', 'en')),
    )
  })

  it('every locale gets a recognized notice: its own no-key text, English for plan states', () => {
    for (const lang of ['de', 'ja', 'zh', 'ar', 'pt-BR']) {
      const noKey = noModelMessageFor(lang, 'ready', 'Kein API-Schlüssel')
      expect(aiNoticeKind(noKey)).toBe('no_model')
      expect(aiNoticeBody(noKey)).toBe('Kein API-Schlüssel')
      const plan = noModelMessageFor(lang, 'not-entitled', 'Kein API-Schlüssel')
      expect(aiNoticeKind(plan)).toBe('not_entitled')
      expect(aiNoticeBody(plan)).toBe(aiNoticeText('not_entitled', 'en'))
      expect(aiNoticeKind(noModelMessageFor(lang, 'credits-exhausted', 'x'))).toBe(
        'credits_exhausted',
      )
    }
  })

  it('the code, not the wording, marks a notice; the body drops the tag', () => {
    expect(aiNoticeKind('[[ai-notice:no_model]] Irgendein Text')).toBe('no_model')
    expect(aiNoticeBody('[[ai-notice:no_model]] Irgendein Text')).toBe('Irgendein Text')
    expect(aiNoticeKind('[[ai-notice:bogus]] text')).toBeNull()
    expect(aiNoticeBody('HTTP 401: invalid key')).toBe('HTTP 401: invalid key')
  })

  it('reads the cloud state this process holds', () => {
    setUniworkCloudStatus({ ...UNIWORK_CLOUD_SIGNED_OUT, state: 'credits-exhausted' })
    expect(noModelMessage('vi', 'fallback')).toBe(
      aiNoticeTagged('credits_exhausted', aiNoticeText('credits_exhausted', 'vi')),
    )
    setUniworkCloudStatus({ ...UNIWORK_CLOUD_SIGNED_OUT, state: 'not-entitled' })
    expect(noModelMessage('en', 'fallback')).toBe(
      aiNoticeTagged('not_entitled', aiNoticeText('not_entitled', 'en')),
    )
    setUniworkCloudStatus(null)
    expect(noModelMessage('en', 'fallback')).toBe(
      aiNoticeTagged('no_model', aiNoticeText('no_model', 'en')),
    )
  })

  afterEach(() => setUniworkCloudStatus(null))
})
