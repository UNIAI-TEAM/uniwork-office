import { defineStrings } from '@genoffice/i18n'
import { zh } from './workbench/zh'
import { en } from './workbench/en'
import { ja } from './workbench/ja'
import { ko } from './workbench/ko'
import { fr } from './workbench/fr'
import { de } from './workbench/de'
import { es } from './workbench/es'
import { th } from './workbench/th'
import { id } from './workbench/id'
import { ru } from './workbench/ru'
import { ar } from './workbench/ar'
import { pt } from './workbench/pt'
import { it } from './workbench/it'
import { pl } from './workbench/pl'
import { cs } from './workbench/cs'
import { nl } from './workbench/nl'
import { ms } from './workbench/ms'
import { he } from './workbench/he'
import { hi } from './workbench/hi'
import { vi } from './workbench/vi'
import { zhTW } from './workbench/zh-TW'

/** Workbench (Bàn làm việc) UI (sharded per locale; zh defines the key set) */
export const workbenchStrings = defineStrings({
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
