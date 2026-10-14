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

// params fill the {org}, {remaining}, {limit}, {seconds}, {module} and {provider} slots
export function aiUniworkText(lang: Lang, key: AiUniworkStringKey, params?: Params): string {
  return translate(lang, key, params)
}

const refusalMessages = new Set(
  Object.values(aiUniworkStrings).flatMap((table) => [
    table.aiErrQuestionTooLong,
    table.aiErrQuestionRejected,
  ]),
)

/**
 * Whether a chat error is the UniWork AI "this question cannot go out as written" message
 * (`question_too_long`, `question_rejected`): sending the same text again cannot help, so a panel
 * offers no Retry and puts the question back in the composer. The panels only get the error text,
 * which the transport wrote in the UI language, so it is matched against every language's copy.
 */
export function isUniworkQuestionRefusal(message: string | null | undefined): boolean {
  const text = message?.trim()
  return !!text && refusalMessages.has(text)
}
