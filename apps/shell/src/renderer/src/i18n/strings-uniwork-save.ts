import { defineStrings } from '@genoffice/i18n'
import { zh } from './uniwork-save/zh'
import { en } from './uniwork-save/en'
import { ja } from './uniwork-save/ja'
import { ko } from './uniwork-save/ko'
import { fr } from './uniwork-save/fr'
import { de } from './uniwork-save/de'
import { es } from './uniwork-save/es'
import { th } from './uniwork-save/th'
import { id } from './uniwork-save/id'
import { ru } from './uniwork-save/ru'
import { ar } from './uniwork-save/ar'
import { pt } from './uniwork-save/pt'
import { it } from './uniwork-save/it'
import { pl } from './uniwork-save/pl'
import { cs } from './uniwork-save/cs'
import { nl } from './uniwork-save/nl'
import { ms } from './uniwork-save/ms'
import { he } from './uniwork-save/he'
import { hi } from './uniwork-save/hi'
import { zhTW } from './uniwork-save/zh-TW'
import { vi } from './uniwork-save/vi'

/** SAVE-01 first-save SaveDialog + MYFOLDER-01 My Folder label (sharded per locale; zh defines the key set) */
export const uniworkSaveStrings = defineStrings({
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
