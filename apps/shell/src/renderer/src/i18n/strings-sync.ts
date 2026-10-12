import { defineStrings } from '@genoffice/i18n'
import { zh } from './sync/zh'
import { en } from './sync/en'
import { ja } from './sync/ja'
import { ko } from './sync/ko'
import { fr } from './sync/fr'
import { de } from './sync/de'
import { es } from './sync/es'
import { th } from './sync/th'
import { id } from './sync/id'
import { ru } from './sync/ru'
import { ar } from './sync/ar'
import { pt } from './sync/pt'
import { it } from './sync/it'
import { pl } from './sync/pl'
import { cs } from './sync/cs'
import { nl } from './sync/nl'
import { ms } from './sync/ms'
import { he } from './sync/he'
import { hi } from './sync/hi'
import { zhTW } from './sync/zh-TW'
import { vi } from './sync/vi'

/** Desktop sync, offline, lock, conflict and new-version copy (sharded per locale; zh defines the key set) */
export const syncStrings = defineStrings({
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
