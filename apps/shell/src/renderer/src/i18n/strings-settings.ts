import { defineStrings } from '@genoffice/i18n'
import { zh } from './settings/zh'
import { en } from './settings/en'
import { ja } from './settings/ja'
import { ko } from './settings/ko'
import { fr } from './settings/fr'
import { de } from './settings/de'
import { es } from './settings/es'
import { th } from './settings/th'
import { id } from './settings/id'
import { ru } from './settings/ru'
import { ar } from './settings/ar'
import { pt } from './settings/pt'
import { it } from './settings/it'
import { pl } from './settings/pl'
import { cs } from './settings/cs'
import { nl } from './settings/nl'
import { ms } from './settings/ms'
import { he } from './settings/he'
import { hi } from './settings/hi'
import { zhTW } from './settings/zh-TW'
import { vi } from './settings/vi'

/** Settings modal: shared chrome, Backup & storage, UniAI (sharded per locale; zh defines the key set) */
export const settingsStrings = defineStrings({
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
