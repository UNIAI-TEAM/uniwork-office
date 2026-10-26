import { defineStrings } from '@genoffice/i18n'
import { zh } from './convert-progress/zh'
import { en } from './convert-progress/en'
import { ja } from './convert-progress/ja'
import { ko } from './convert-progress/ko'
import { fr } from './convert-progress/fr'
import { de } from './convert-progress/de'
import { es } from './convert-progress/es'
import { th } from './convert-progress/th'
import { id } from './convert-progress/id'
import { ru } from './convert-progress/ru'
import { ar } from './convert-progress/ar'
import { pt } from './convert-progress/pt'
import { it } from './convert-progress/it'
import { pl } from './convert-progress/pl'
import { cs } from './convert-progress/cs'
import { nl } from './convert-progress/nl'
import { ms } from './convert-progress/ms'
import { he } from './convert-progress/he'
import { hi } from './convert-progress/hi'
import { vi } from './convert-progress/vi'
import { zhTW } from './convert-progress/zh-TW'

/**
 * Strings of the PDF -> Office conversion progress toast (UNI-2167).
 * One shard per language in ./convert-progress/<lang>.ts; zh defines the key set.
 */
export const convertProgressStrings = defineStrings({
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
