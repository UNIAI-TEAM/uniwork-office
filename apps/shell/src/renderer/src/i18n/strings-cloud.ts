import { defineStrings } from '@genoffice/i18n'
import { zh } from './cloud/zh'
import { en } from './cloud/en'
import { ja } from './cloud/ja'
import { ko } from './cloud/ko'
import { fr } from './cloud/fr'
import { de } from './cloud/de'
import { es } from './cloud/es'
import { th } from './cloud/th'
import { id } from './cloud/id'
import { ru } from './cloud/ru'
import { ar } from './cloud/ar'
import { pt } from './cloud/pt'
import { it } from './cloud/it'
import { pl } from './cloud/pl'
import { cs } from './cloud/cs'
import { nl } from './cloud/nl'
import { ms } from './cloud/ms'
import { he } from './cloud/he'
import { hi } from './cloud/hi'
import { zhTW } from './cloud/zh-TW'
import { vi } from './cloud/vi'

/** UniWork cloud AI: Settings → Account / AI model / AI media (sharded per locale; zh defines the key set) */
export const cloudStrings = defineStrings({
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
