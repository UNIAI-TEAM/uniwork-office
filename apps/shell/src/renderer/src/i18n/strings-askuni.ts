import { defineStrings } from '@genoffice/i18n'
import { zh } from './askuni/zh'
import { en } from './askuni/en'
import { ja } from './askuni/ja'
import { ko } from './askuni/ko'
import { fr } from './askuni/fr'
import { de } from './askuni/de'
import { es } from './askuni/es'
import { th } from './askuni/th'
import { id } from './askuni/id'
import { ru } from './askuni/ru'
import { ar } from './askuni/ar'
import { pt } from './askuni/pt'
import { it } from './askuni/it'
import { pl } from './askuni/pl'
import { cs } from './askuni/cs'
import { nl } from './askuni/nl'
import { ms } from './askuni/ms'
import { he } from './askuni/he'
import { hi } from './askuni/hi'
import { zhTW } from './askuni/zh-TW'
import { vi } from './askuni/vi'

/** Shell Home Ask UNI mode copy (sharded per locale; zh defines the key set) */
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
