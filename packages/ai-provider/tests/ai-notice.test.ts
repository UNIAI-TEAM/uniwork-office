import { describe, expect, it } from 'vitest'
import {
  aiNoticeText,
  composerNoteFor,
  type AiNoticeKind,
  type AiNoticeLang,
} from '../src/ai-notice'

const KINDS: AiNoticeKind[] = ['not_entitled', 'credits_exhausted']
const LANGS: AiNoticeLang[] = ['en', 'vi']

describe('ai notices', () => {
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

  it('points at the organization only: no own key, no AI Model settings (UNI-2309)', () => {
    for (const lang of LANGS) {
      for (const kind of KINDS) {
        const text = aiNoticeText(kind, lang)
        expect(text, `${kind} ${lang}`).not.toMatch(/key|khóa|AI Model|Mô hình AI/i)
      }
    }
    expect(aiNoticeText('not_entitled', 'en')).toBe(
      "Your organization's plan does not include UniWork AI. Ask an organization admin about the plan.",
    )
    expect(aiNoticeText('credits_exhausted', 'vi')).toBe(
      'Tổ chức của bạn đã dùng hết tín dụng AI trong kỳ này. Hãy nhờ quản trị viên tổ chức bổ sung.',
    )
  })
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
        signedOut: false,
        cloudState: 'ready',
        capabilityOn: true,
        formatOn: true,
        toolsChat: true,
      }),
    ).toBeNull()
  })

  it('a plan state on UniWork AI has no action: there is no other provider to choose (UNI-2309)', () => {
    const note = composerNoteFor({
      provider: 'uniwork',
      cloudState: 'not-entitled',
      signedOut: false,
    })
    expect(note?.kind).toBe('not-entitled')
    expect(note?.action).toBeNull()
  })

  it('maps each single condition to its note kind, key and action', () => {
    expect(composerNoteFor({ uniworkSelected: true, cloudState: 'signed-out' })).toEqual({
      kind: 'signed-out',
      key: 'aiUniworkSignedOut',
      action: 'sign-in',
    })
    expect(
      composerNoteFor({ uniworkSelected: true, signedOut: true, cloudState: 'ready' }),
    ).toEqual({
      kind: 'signed-out',
      key: 'aiUniworkSignedOut',
      action: 'sign-in',
    })
    expect(
      composerNoteFor({ uniworkSelected: true, cloudState: 'ready', capabilityOn: false }),
    ).toEqual({
      kind: 'off',
      key: 'aiUniworkOff',
      action: null,
    })
    expect(
      composerNoteFor({ uniworkSelected: true, cloudState: 'ready', formatOn: false }),
    ).toEqual({
      kind: 'off',
      key: 'aiUniworkOff',
      action: null,
    })
    expect(
      composerNoteFor({ uniworkSelected: true, cloudState: 'ready', toolsChat: false }),
    ).toEqual({
      kind: 'off',
      key: 'aiUniworkOff',
      action: null,
    })
    expect(composerNoteFor({ uniworkSelected: true, cloudState: 'ready', off: true })).toEqual({
      kind: 'off',
      key: 'aiUniworkOff',
      action: null,
    })
    expect(composerNoteFor({ uniworkSelected: true, cloudState: 'not-entitled' })).toEqual({
      kind: 'not-entitled',
      key: 'not_entitled',
      action: null,
    })
    expect(composerNoteFor({ uniworkSelected: true, cloudState: 'subscription-inactive' })).toEqual(
      {
        kind: 'subscription-inactive',
        key: 'cloudInactiveBody',
        action: null,
      },
    )
    expect(composerNoteFor({ uniworkSelected: true, cloudState: 'credits-exhausted' })).toEqual({
      kind: 'credits-exhausted',
      key: 'credits_exhausted',
      action: null,
    })
    expect(composerNoteFor({ uniworkSelected: true, cloudState: 'unavailable' })).toEqual({
      kind: 'unavailable',
      key: 'aiErrUnavailable',
      action: null,
    })
  })

  it('enforces priority: signed-out > off > not-entitled > subscription-inactive > credits-exhausted > unavailable', () => {
    expect(
      composerNoteFor({
        uniworkSelected: true,
        signedOut: true,
        cloudState: 'credits-exhausted',
        capabilityOn: false,
        off: true,
      })?.kind,
    ).toBe('signed-out')

    expect(
      composerNoteFor({
        uniworkSelected: true,
        signedOut: false,
        cloudState: 'not-entitled',
        capabilityOn: false,
      })?.kind,
    ).toBe('off')

    expect(
      composerNoteFor({
        uniworkSelected: true,
        signedOut: false,
        cloudState: 'subscription-inactive',
        formatOn: false,
      })?.kind,
    ).toBe('off')

    expect(
      composerNoteFor({
        uniworkSelected: true,
        signedOut: false,
        cloudState: 'credits-exhausted',
        toolsChat: false,
      })?.kind,
    ).toBe('off')

    expect(
      composerNoteFor({
        uniworkSelected: true,
        signedOut: false,
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
      action: null,
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
