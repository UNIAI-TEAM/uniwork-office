import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'
import { zh } from './ask-uni-strings/zh'
import { en } from './ask-uni-strings/en'
import { ja } from './ask-uni-strings/ja'
import { ko } from './ask-uni-strings/ko'
import { fr } from './ask-uni-strings/fr'
import { de } from './ask-uni-strings/de'
import { es } from './ask-uni-strings/es'
import { th } from './ask-uni-strings/th'
import { id } from './ask-uni-strings/id'
import { ru } from './ask-uni-strings/ru'
import { ar } from './ask-uni-strings/ar'
import { pt } from './ask-uni-strings/pt'
import { it } from './ask-uni-strings/it'
import { pl } from './ask-uni-strings/pl'
import { cs } from './ask-uni-strings/cs'
import { nl } from './ask-uni-strings/nl'
import { ms } from './ask-uni-strings/ms'
import { he } from './ask-uni-strings/he'
import { hi } from './ask-uni-strings/hi'
import { zhTW } from './ask-uni-strings/zh-TW'
import { vi } from './ask-uni-strings/vi'

/**
 * Ask UNI copy shared by Home and the six editors: the thread, answer, citations, steps, actions,
 * the plain composer and the editor panel body (sharded per locale; zh defines the key set).
 */
export const askUniStrings = defineStrings({
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

export type AskUniStringKey = keyof (typeof askUniStrings)['zh']

const translate = createI18n(askUniStrings)

// params fill {n}, {title}, {kind}, {action}, {seconds}, {count}, {max}, {used}, {list} and {name}
export function askUniText(lang: Lang, key: AskUniStringKey, params?: Params): string {
  return translate(lang, key, params)
}
