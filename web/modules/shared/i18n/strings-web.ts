import { createI18n, defineStrings, type Lang } from '@genoffice/i18n'
import { zh } from './web/zh'
import { en } from './web/en'
import { ja } from './web/ja'
import { ko } from './web/ko'
import { fr } from './web/fr'
import { de } from './web/de'
import { es } from './web/es'
import { th } from './web/th'
import { id } from './web/id'
import { ru } from './web/ru'
import { ar } from './web/ar'
import { pt } from './web/pt'
import { it } from './web/it'
import { pl } from './web/pl'
import { cs } from './web/cs'
import { nl } from './web/nl'
import { ms } from './web/ms'
import { he } from './web/he'
import { hi } from './web/hi'
import { vi } from './web/vi'
import { zhTW } from './web/zh-TW'

/**
 * Web-only strings of the module frames (Markdown, HTML): save conflict, fatal open, view-only.
 * Thin aggregator over ./web/<lang>.ts (zh defines the key set; every sibling `satisfies` it).
 * The conflict / fatal wording is the Docs frame's (apps/docs app shard, appWeb* keys).
 */
export const webStrings = defineStrings({
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

export type WebStringKey = keyof (typeof webStrings)['zh']

const translate = createI18n(webStrings)

export function webText(lang: Lang, key: WebStringKey): string {
  return translate(lang, key)
}
