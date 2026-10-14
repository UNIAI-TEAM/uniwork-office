import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import { strings } from '../src/renderer/i18n/strings'
import { certSignStrings } from '../src/renderer/i18n/cert-sign-strings'

/**
 * The certificate-signing and signatures UI (apps/pdf cert-sign strings) must be translated in
 * every shipped locale. A locale that silently falls back to the English text still passes the
 * key-parity checks, so this compares the shipped value against English key by key.
 */
const dicts = strings as Record<string, Record<string, string>>
const english = certSignStrings.en as Record<string, string>
const certKeys = Object.keys(english)

/** Values that are legitimately spelled the same as English in a given language. */
const SAME_AS_ENGLISH: Record<string, string[]> = {
  fr: ['sigPanel', 'sigOnPage', 'certContact', 'sigContact', 'certPage', 'certPosition'],
  de: ['certPosition'],
  id: ['sigStatusValid'],
  it: ['certPassword'],
}

describe('pdf certificate signing strings', () => {
  it('the English base carries the whole feature copy', () => {
    expect(certKeys.length).toBeGreaterThan(90)
  })

  it.each([...LANGS].filter((lang) => lang !== 'en'))(
    'locale %s translates every certificate / signature string',
    (lang) => {
      const same = certKeys.filter(
        (key) => dicts[lang]![key] === english[key] && !(SAME_AS_ENGLISH[lang] ?? []).includes(key),
      )
      expect(
        same,
        `${lang} still shows English for ${same.length} key(s): ${same.slice(0, 8).join(', ')}`,
      ).toEqual([])
    },
  )

  it.each([...LANGS])('locale %s keeps the certificate placeholders of English', (lang) => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()
    for (const key of certKeys) {
      expect(placeholders(dicts[lang]![key]!), `${lang}.${key}`).toEqual(
        placeholders(english[key]!),
      )
    }
  })

  it('pt is Brazilian Portuguese, like the rest of the PDF app (R3-3)', () => {
    // European forms the shard used before: the password prompt for opening a PDF says "Senha"
    const europeanForms =
      /ficheiro|palavra-passe|guard(?:ar|e|ad[oa])|contacto|ecrã|\bA (?:verificar|assinar)\b/i
    const hits = certKeys.filter((key) => europeanForms.test(dicts.pt![key] ?? ''))
    expect(hits, `pt shard still has European Portuguese in: ${hits.join(', ')}`).toEqual([])
  })
})
