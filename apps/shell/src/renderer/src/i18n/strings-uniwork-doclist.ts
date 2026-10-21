import { defineStrings } from '@genoffice/i18n'
import { zh } from './uniwork-doclist/zh'
import { en } from './uniwork-doclist/en'
import { ja } from './uniwork-doclist/ja'
import { ko } from './uniwork-doclist/ko'
import { fr } from './uniwork-doclist/fr'
import { de } from './uniwork-doclist/de'
import { es } from './uniwork-doclist/es'
import { th } from './uniwork-doclist/th'
import { id } from './uniwork-doclist/id'
import { ru } from './uniwork-doclist/ru'
import { ar } from './uniwork-doclist/ar'
import { pt } from './uniwork-doclist/pt'
import { it } from './uniwork-doclist/it'
import { pl } from './uniwork-doclist/pl'
import { cs } from './uniwork-doclist/cs'
import { nl } from './uniwork-doclist/nl'
import { ms } from './uniwork-doclist/ms'
import { he } from './uniwork-doclist/he'
import { hi } from './uniwork-doclist/hi'
import { zhTW } from './uniwork-doclist/zh-TW'
import { vi } from './uniwork-doclist/vi'

/** Document list copy (columns, dates, access pills, groups, row actions); sharded per locale, zh defines the key set */
export const uniworkDocListStrings = defineStrings({
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
