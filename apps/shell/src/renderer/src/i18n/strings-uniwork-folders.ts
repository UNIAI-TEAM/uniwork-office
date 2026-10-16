import { defineStrings } from '@genoffice/i18n'
import { zh } from './uniwork-folders/zh'
import { en } from './uniwork-folders/en'
import { ja } from './uniwork-folders/ja'
import { ko } from './uniwork-folders/ko'
import { fr } from './uniwork-folders/fr'
import { de } from './uniwork-folders/de'
import { es } from './uniwork-folders/es'
import { th } from './uniwork-folders/th'
import { id } from './uniwork-folders/id'
import { ru } from './uniwork-folders/ru'
import { ar } from './uniwork-folders/ar'
import { pt } from './uniwork-folders/pt'
import { it } from './uniwork-folders/it'
import { pl } from './uniwork-folders/pl'
import { cs } from './uniwork-folders/cs'
import { nl } from './uniwork-folders/nl'
import { ms } from './uniwork-folders/ms'
import { he } from './uniwork-folders/he'
import { hi } from './uniwork-folders/hi'
import { zhTW } from './uniwork-folders/zh-TW'
import { vi } from './uniwork-folders/vi'

/** FD-11 UniWork folder tree (sharded per locale; zh defines the key set) */
export const uniworkFolderStrings = defineStrings({
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
