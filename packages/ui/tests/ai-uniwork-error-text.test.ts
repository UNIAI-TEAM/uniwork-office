import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import {
  aiUniworkStrings,
  aiUniworkText,
  uniworkErrorForChip,
  uniworkErrorKeyOfText,
} from '../src/strings-ai-uniwork'

// The chat entry of a UniWork error turn only keeps the localized text the transport wrote (the code
// is spent choosing it), so the chip reads the key back from the text (chipwire F1/F2).

const ERROR_KEYS = [
  'aiErrRunLimit',
  'aiErrCredits',
  'aiErrEntitlement',
  'aiErrCapabilityOff',
  'aiErrSession',
  'aiErrRateLimitedNoWait',
  'aiErrUnavailable',
  'aiErrDisconnected',
  'aiErrOffline',
  'aiErrRevoked',
  'aiErrDowngraded',
  'aiConversationRestarted',
  'aiErrWorkbookTooLarge',
  'aiErrQuestionTooLong',
  'aiErrQuestionRejected',
  'aiErrGeneric',
] as const

describe('uniworkErrorKeyOfText', () => {
  it.each([...LANGS])('reads every error key back from its %s text', (lang) => {
    for (const key of ERROR_KEYS) {
      expect(uniworkErrorKeyOfText(aiUniworkText(lang, key)), `${lang}/${key}`).toBe(key)
    }
  })

  it('no two error keys share a text in any language (the reading back is unambiguous)', () => {
    for (const lang of LANGS) {
      const table = aiUniworkStrings[lang] as Record<string, string>
      const texts = ERROR_KEYS.map((k) => table[k]!.trim())
      expect(new Set(texts).size, lang).toBe(texts.length)
    }
  })

  it('ignores surrounding space and returns null for text it did not write', () => {
    expect(uniworkErrorKeyOfText(`  ${aiUniworkText('vi', 'aiErrCredits')}\n`)).toBe('aiErrCredits')
    expect(uniworkErrorKeyOfText('Request failed with status 500')).toBeNull()
    expect(uniworkErrorKeyOfText('')).toBeNull()
    expect(uniworkErrorKeyOfText(null)).toBeNull()
    expect(uniworkErrorKeyOfText(undefined)).toBeNull()
  })
})

describe('uniworkErrorForChip', () => {
  it('is the key when the text is one of ours, else the text itself, else null', () => {
    expect(uniworkErrorForChip(aiUniworkText('en', 'aiErrSession'))).toBe('aiErrSession')
    expect(uniworkErrorForChip('boom')).toBe('boom')
    expect(uniworkErrorForChip(undefined)).toBeNull()
    expect(uniworkErrorForChip('')).toBeNull()
  })
})
