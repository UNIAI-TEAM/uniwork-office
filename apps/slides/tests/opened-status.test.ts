import { describe, expect, it } from 'vitest'
import { createI18n } from '@genoffice/i18n'
import { appStrings } from '../src/renderer/i18n/strings-app'
import { openedStatusKey } from '../src/shared/opened-status'

const translate = createI18n(appStrings)

describe('opened-deck status text', () => {
  it('uses the singular form for exactly one slide', () => {
    expect(openedStatusKey(1)).toBe('appStatusOpenedOne')
    expect(openedStatusKey(0)).toBe('appStatusOpened')
    expect(openedStatusKey(5)).toBe('appStatusOpened')
  })

  it('reads "1 slide" in English and "5 slides" for five', () => {
    expect(translate('en', openedStatusKey(1), { name: 'A.pptx', count: 1 })).toBe(
      'Opened A.pptx (1 slide)',
    )
    expect(translate('en', openedStatusKey(5), { name: 'A.pptx', count: 5 })).toBe(
      'Opened A.pptx (5 slides)',
    )
  })

  it('every language carries the singular, with the file name and no count placeholder', () => {
    for (const lang of Object.keys(appStrings)) {
      const text = translate(lang as 'en', 'appStatusOpenedOne', { name: 'A.pptx' })
      expect(text, lang).toContain('A.pptx')
      expect(text, lang).not.toContain('{count}')
    }
  })
})
