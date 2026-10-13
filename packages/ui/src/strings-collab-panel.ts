import { createI18n, defineStrings, type Lang, type Params } from '@genoffice/i18n'
import { zh } from './collab/i18n/panel/zh'
import { en } from './collab/i18n/panel/en'
import { ja } from './collab/i18n/panel/ja'
import { ko } from './collab/i18n/panel/ko'
import { fr } from './collab/i18n/panel/fr'
import { de } from './collab/i18n/panel/de'
import { es } from './collab/i18n/panel/es'
import { th } from './collab/i18n/panel/th'
import { id } from './collab/i18n/panel/id'
import { ru } from './collab/i18n/panel/ru'
import { ar } from './collab/i18n/panel/ar'
import { pt } from './collab/i18n/panel/pt'
import { it } from './collab/i18n/panel/it'
import { pl } from './collab/i18n/panel/pl'
import { cs } from './collab/i18n/panel/cs'
import { nl } from './collab/i18n/panel/nl'
import { ms } from './collab/i18n/panel/ms'
import { he } from './collab/i18n/panel/he'
import { hi } from './collab/i18n/panel/hi'
import { zhTW } from './collab/i18n/panel/zh-TW'
import { vi } from './collab/i18n/panel/vi'

/** Shared collab panel copy (comments + discussion; sharded per locale, zh defines the key set) */
export const collabPanelStrings = defineStrings({
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

export type CollabPanelStringKey = keyof (typeof collabPanelStrings)['zh']

const translate = createI18n(collabPanelStrings)

// params fill the {panel}, {label}, {count}, {quote}, {cell}, {slide}, {page}, {shortcut}, {name} and {time} slots
export function collabPanelText(lang: Lang, key: CollabPanelStringKey, params?: Params): string {
  return translate(lang, key, params)
}
