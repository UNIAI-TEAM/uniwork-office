import { defineStrings } from '@genoffice/i18n'
import { zh } from './uniwork-documents/zh'
import { en } from './uniwork-documents/en'
import { ja } from './uniwork-documents/ja'
import { ko } from './uniwork-documents/ko'
import { fr } from './uniwork-documents/fr'
import { de } from './uniwork-documents/de'
import { es } from './uniwork-documents/es'
import { th } from './uniwork-documents/th'
import { id } from './uniwork-documents/id'
import { ru } from './uniwork-documents/ru'
import { ar } from './uniwork-documents/ar'
import { pt } from './uniwork-documents/pt'
import { it } from './uniwork-documents/it'
import { pl } from './uniwork-documents/pl'
import { cs } from './uniwork-documents/cs'
import { nl } from './uniwork-documents/nl'
import { ms } from './uniwork-documents/ms'
import { he } from './uniwork-documents/he'
import { hi } from './uniwork-documents/hi'
import { zhTW } from './uniwork-documents/zh-TW'
import { vi } from './uniwork-documents/vi'

/** Open from / save to UniWork (sharded per locale; zh defines the key set) */
export const uniworkDocumentStrings = defineStrings({
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
