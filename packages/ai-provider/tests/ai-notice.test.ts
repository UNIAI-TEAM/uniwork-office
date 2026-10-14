import { afterEach, describe, expect, it } from 'vitest'
import { UNIWORK_CLOUD_SIGNED_OUT, setUniworkCloudStatus } from '../src/uniwork-cloud'
import {
  aiNoticeBody,
  aiNoticeKind,
  aiNoticeKindForCloud,
  aiNoticeTagged,
  aiNoticeText,
  composerNoteFor,
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

describe('composerNoteFor (G6-05u S7/S11)', () => {
  it('returns null when UniWork AI is not selected', () => {
    expect(
      composerNoteFor({
        uniworkSelected: false,
        cloudState: 'signed-out',
        capabilityOn: false,
      }),
    ).toBeNull()
    expect(
      composerNoteFor({
        provider: 'openai',
        cloudState: 'credits-exhausted',
      }),
    ).toBeNull()
  })

  it('returns null when UniWork AI is ready and enabled', () => {
    expect(
      composerNoteFor({
        uniworkSelected: true,
        signedIn: true,
        cloudState: 'ready',
        capabilityOn: true,
        formatOn: true,
        toolsChat: true,
      }),
    ).toBeNull()
  })

  it('maps each single condition to its note kind, key and action', () => {
    expect(composerNoteFor({ uniworkSelected: true, cloudState: 'signed-out' })).toEqual({
      kind: 'signed-out',
      key: 'aiUniworkSignedOut',
      action: 'sign-in',
    })
    expect(composerNoteFor({ uniworkSelected: true, signedIn: false, cloudState: 'ready' })).toEqual({
      kind: 'signed-out',
      key: 'aiUniworkSignedOut',
      action: 'sign-in',
    })
    expect(
      composerNoteFor({ uniworkSelected: true, cloudState: 'ready', capabilityOn: false }),
    ).toEqual({
      kind: 'off',
      key: 'aiUniworkOff',
      action: 'choose-provider',
    })
    expect(
      composerNoteFor({ uniworkSelected: true, cloudState: 'ready', formatOn: false }),
    ).toEqual({
      kind: 'off',
      key: 'aiUniworkOff',
      action: 'choose-provider',
    })
    expect(
      composerNoteFor({ uniworkSelected: true, cloudState: 'ready', toolsChat: false }),
    ).toEqual({
      kind: 'off',
      key: 'aiUniworkOff',
      action: 'choose-provider',
    })
    expect(composerNoteFor({ uniworkSelected: true, cloudState: 'ready', off: true })).toEqual({
      kind: 'off',
      key: 'aiUniworkOff',
      action: 'choose-provider',
    })
    expect(composerNoteFor({ uniworkSelected: true, cloudState: 'not-entitled' })).toEqual({
      kind: 'not-entitled',
      key: 'not_entitled',
      action: 'choose-provider',
    })
    expect(composerNoteFor({ uniworkSelected: true, cloudState: 'subscription-inactive' })).toEqual(
      {
        kind: 'subscription-inactive',
        key: 'cloudInactiveBody',
        action: 'choose-provider',
      },
    )
    expect(composerNoteFor({ uniworkSelected: true, cloudState: 'credits-exhausted' })).toEqual({
      kind: 'credits-exhausted',
      key: 'credits_exhausted',
      action: 'choose-provider',
    })
    expect(composerNoteFor({ uniworkSelected: true, cloudState: 'unavailable' })).toEqual({
      kind: 'unavailable',
      key: 'aiErrUnavailable',
      action: 'choose-provider',
    })
  })

  it('enforces priority: signed-out > off > not-entitled > subscription-inactive > credits-exhausted > unavailable', () => {
    expect(
      composerNoteFor({
        uniworkSelected: true,
        signedIn: false,
        cloudState: 'credits-exhausted',
        capabilityOn: false,
        off: true,
      })?.kind,
    ).toBe('signed-out')

    expect(
      composerNoteFor({
        uniworkSelected: true,
        signedIn: true,
        cloudState: 'not-entitled',
        capabilityOn: false,
      })?.kind,
    ).toBe('off')

    expect(
      composerNoteFor({
        uniworkSelected: true,
        signedIn: true,
        cloudState: 'subscription-inactive',
        formatOn: false,
      })?.kind,
    ).toBe('off')

    expect(
      composerNoteFor({
        uniworkSelected: true,
        signedIn: true,
        cloudState: 'credits-exhausted',
        toolsChat: false,
      })?.kind,
    ).toBe('off')

    expect(
      composerNoteFor({
        uniworkSelected: true,
        signedIn: true,
        cloudState: 'unavailable',
        off: true,
      })?.kind,
    ).toBe('off')
  })

  it('viewOnly never suppresses or replaces the composer note', () => {
    expect(
      composerNoteFor({
        uniworkSelected: true,
        cloudState: 'credits-exhausted',
        viewOnly: true,
      }),
    ).toEqual({
      kind: 'credits-exhausted',
      key: 'credits_exhausted',
      action: 'choose-provider',
    })
    expect(
      composerNoteFor({
        uniworkSelected: true,
        cloudState: 'ready',
        viewOnly: true,
      }),
    ).toBeNull()
  })
})

