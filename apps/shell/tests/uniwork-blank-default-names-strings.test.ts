import { describe, expect, it } from 'vitest'
import { BLANK_DEFAULT_NAMES } from '../src/shared/blank-default-names'
import { uniworkHomeStrings } from '../src/renderer/src/i18n/strings-uniwork-home'

/**
 * UNI-1959: main tells a never-saved blank document from an ordinary one by its
 * default title (shared/blank-default-names.ts); the renderer creates the
 * document under the `uhDefaultName*` strings. The two must stay the same text,
 * or a blank document would never ask for its name on the first save.
 */

const KEY = {
  docx: 'uhDefaultNameDocx',
  xlsx: 'uhDefaultNameXlsx',
  pptx: 'uhDefaultNamePptx',
  md: 'uhDefaultNameMd',
  txt: 'uhDefaultNameTxt',
  html: 'uhDefaultNameHtml',
  pdf: 'uhDefaultNamePdf',
} as const

describe('blank default names', () => {
  for (const lang of ['vi', 'en'] as const) {
    it(`main's ${lang} table matches the renderer's uhDefaultName strings`, () => {
      const strings = uniworkHomeStrings[lang] as Record<string, string>
      for (const [kind, key] of Object.entries(KEY)) {
        expect(strings[key], `${lang} ${key}`).toBeTruthy()
        expect(strings[key], `${lang} ${key}`).toBe(
          BLANK_DEFAULT_NAMES[lang][kind as keyof typeof KEY],
        )
      }
    })
  }
})
