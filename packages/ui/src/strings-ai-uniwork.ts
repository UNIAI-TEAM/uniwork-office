import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'
import { zh } from './ai-uniwork/zh'
import { en } from './ai-uniwork/en'
import { ja } from './ai-uniwork/ja'
import { ko } from './ai-uniwork/ko'
import { fr } from './ai-uniwork/fr'
import { de } from './ai-uniwork/de'
import { es } from './ai-uniwork/es'
import { th } from './ai-uniwork/th'
import { id } from './ai-uniwork/id'
import { ru } from './ai-uniwork/ru'
import { ar } from './ai-uniwork/ar'
import { pt } from './ai-uniwork/pt'
import { it } from './ai-uniwork/it'
import { pl } from './ai-uniwork/pl'
import { cs } from './ai-uniwork/cs'
import { nl } from './ai-uniwork/nl'
import { ms } from './ai-uniwork/ms'
import { he } from './ai-uniwork/he'
import { hi } from './ai-uniwork/hi'
import { zhTW } from './ai-uniwork/zh-TW'
import { vi } from './ai-uniwork/vi'

/** UniWork AI panel copy shared by every app (sharded per locale; zh defines the key set) */
export const aiUniworkStrings = defineStrings({
  zh,
  en,
  ja,
  ko,
  fr,
  de,
  es,
  th,
  id,
  ru,
  ar,
  pt,
  it,
  pl,
  cs,
  nl,
  ms,
  he,
  hi,
  'zh-TW': zhTW,
  vi,
})

export type AiUniworkStringKey = keyof (typeof aiUniworkStrings)['zh']

const translate = createI18n(aiUniworkStrings)

// params fill the {org}, {remaining}, {limit}, {date}, {written}, {range}, {overwritten}, {seconds}, {module} and {provider} slots
export function aiUniworkText(lang: Lang, key: AiUniworkStringKey, params?: Params): string {
  return translate(lang, key, params)
}
/**
 * The S9 keys whose turns must not offer a send-again (the question was refused; re-sending the
 * same text cannot help). Panels read it off the entry's stored `errorKey` — the transport
 * writes it when it picks the message, so no localized text is ever matched again (RF6-3).
 */
const UNIWORK_REFUSAL_ERROR_KEYS: Readonly<Record<string, true>> = {
  aiErrQuestionTooLong: true,
  aiErrQuestionRejected: true,
}

/** true when the turn ended in a question refusal (the S9 key the transport stored on the entry) */
export function isUniworkRefusalErrorKey(errorKey: string | null | undefined): boolean {
  return !!errorKey && UNIWORK_REFUSAL_ERROR_KEYS[errorKey] === true
}

/**
 * what a panel hands `resultChip` as `error`: `{ code }` when the transport stored the S9 key on
 * the entry, the raw error text for anything else, else null — the chip then maps the code to the
 * action and the specific announcement without ever reading localized text back.
 */
export function uniworkErrorForEntry(
  errorKey: string | null | undefined,
  text: string | null | undefined,
): { code?: string; message?: string } | string | null {
  if (errorKey) return { code: errorKey }
  const trimmed = text?.trim()
  return trimmed ? trimmed : null
}
