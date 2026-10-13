import { defineStrings } from '@genoffice/i18n'
import { zh } from './discussion/zh'
import { en } from './discussion/en'
import { ja } from './discussion/ja'
import { ko } from './discussion/ko'
import { fr } from './discussion/fr'
import { de } from './discussion/de'
import { es } from './discussion/es'
import { th } from './discussion/th'
import { id } from './discussion/id'
import { ru } from './discussion/ru'
import { ar } from './discussion/ar'
import { pt } from './discussion/pt'
import { it } from './discussion/it'
import { pl } from './discussion/pl'
import { cs } from './discussion/cs'
import { nl } from './discussion/nl'
import { ms } from './discussion/ms'
import { he } from './discussion/he'
import { hi } from './discussion/hi'
import { zhTW } from './discussion/zh-TW'
import { vi } from './discussion/vi'

/** Desktop Discussion panel host copy (sharded per locale; zh defines the key set) */
export const discussionStrings = defineStrings({
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
