import { defineStrings } from '@genoffice/i18n'
import { zh } from './account/zh'
import { en } from './account/en'
import { ja } from './account/ja'
import { ko } from './account/ko'
import { fr } from './account/fr'
import { de } from './account/de'
import { es } from './account/es'
import { th } from './account/th'
import { id } from './account/id'
import { ru } from './account/ru'
import { ar } from './account/ar'
import { pt } from './account/pt'
import { it } from './account/it'
import { pl } from './account/pl'
import { cs } from './account/cs'
import { nl } from './account/nl'
import { ms } from './account/ms'
import { he } from './account/he'
import { hi } from './account/hi'
import { zhTW } from './account/zh-TW'
import { vi } from './account/vi'

/** UniWork account entry + Settings → Account (sharded per locale; zh defines the key set) */
export const accountStrings = defineStrings({
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
