import { createI18n, defineStrings, type Lang } from '@genoffice/i18n'
import { zh } from './ai-web/zh'
import { en } from './ai-web/en'
import { ja } from './ai-web/ja'
import { ko } from './ai-web/ko'
import { fr } from './ai-web/fr'
import { de } from './ai-web/de'
import { es } from './ai-web/es'
import { th } from './ai-web/th'
import { id } from './ai-web/id'
import { ru } from './ai-web/ru'
import { ar } from './ai-web/ar'
import { pt } from './ai-web/pt'
import { it } from './ai-web/it'
import { pl } from './ai-web/pl'
import { cs } from './ai-web/cs'
import { nl } from './ai-web/nl'
import { ms } from './ai-web/ms'
import { he } from './ai-web/he'
import { hi } from './ai-web/hi'
import { vi } from './ai-web/vi'
import { zhTW } from './ai-web/zh-TW'

/**
 * Web-only strings of the frame AI bridge (CONTRACT C16, every module incl. Docs): the AI settings
 * dialog (UniWork-stored provider keys) and the typed failure states of the AI routes.
 * Thin aggregator over ./ai-web/<lang>.ts (zh defines the key set; every sibling `satisfies` it).
 */
export const aiWebStrings = defineStrings({
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
  vi,
  'zh-TW': zhTW,
})

export type AiWebStringKey = keyof (typeof aiWebStrings)['zh']

const translate = createI18n(aiWebStrings)

export function aiWebText(
  lang: Lang,
  key: AiWebStringKey,
  params?: Record<string, string | number>,
): string {
  return translate(lang, key, params)
}
