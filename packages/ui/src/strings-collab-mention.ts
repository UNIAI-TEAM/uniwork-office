import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'
import { zh } from './collab/i18n/mention/zh'
import { en } from './collab/i18n/mention/en'
import { ja } from './collab/i18n/mention/ja'
import { ko } from './collab/i18n/mention/ko'
import { fr } from './collab/i18n/mention/fr'
import { de } from './collab/i18n/mention/de'
import { es } from './collab/i18n/mention/es'
import { th } from './collab/i18n/mention/th'
import { id } from './collab/i18n/mention/id'
import { ru } from './collab/i18n/mention/ru'
import { ar } from './collab/i18n/mention/ar'
import { pt } from './collab/i18n/mention/pt'
import { it } from './collab/i18n/mention/it'
import { pl } from './collab/i18n/mention/pl'
import { cs } from './collab/i18n/mention/cs'
import { nl } from './collab/i18n/mention/nl'
import { ms } from './collab/i18n/mention/ms'
import { he } from './collab/i18n/mention/he'
import { hi } from './collab/i18n/mention/hi'
import { zhTW } from './collab/i18n/mention/zh-TW'
import { vi } from './collab/i18n/mention/vi'

/** Shared collab @-mention picker copy (sharded per locale, zh defines the key set) */
export const collabMentionStrings = defineStrings({
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

export type CollabMentionStringKey = keyof (typeof collabMentionStrings)['zh']

const translate = createI18n(collabMentionStrings)

// params fill the {count} and {query} slots
export function collabMentionText(
  lang: Lang,
  key: CollabMentionStringKey,
  params?: Params,
): string {
  return translate(lang, key, params)
}
