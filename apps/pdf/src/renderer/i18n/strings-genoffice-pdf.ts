import { defineStrings } from '@genoffice/i18n'
import { zh } from './genoffice-pdf/zh'
import { en } from './genoffice-pdf/en'
import { ja } from './genoffice-pdf/ja'
import { ko } from './genoffice-pdf/ko'
import { fr } from './genoffice-pdf/fr'
import { de } from './genoffice-pdf/de'
import { es } from './genoffice-pdf/es'
import { th } from './genoffice-pdf/th'
import { id } from './genoffice-pdf/id'
import { ru } from './genoffice-pdf/ru'
import { ar } from './genoffice-pdf/ar'
import { pt } from './genoffice-pdf/pt'
import { it } from './genoffice-pdf/it'
import { pl } from './genoffice-pdf/pl'
import { cs } from './genoffice-pdf/cs'
import { nl } from './genoffice-pdf/nl'
import { ms } from './genoffice-pdf/ms'
import { he } from './genoffice-pdf/he'
import { hi } from './genoffice-pdf/hi'
import { vi } from './genoffice-pdf/vi'
import { zhTW } from './genoffice-pdf/zh-TW'

/**
 * Strings of the PDF features ported from genoffice: search options, comments panel, hyperlinks,
 * Bates numbering and editable bookmarks. One shard per language in ./genoffice-pdf/<lang>.ts; zh
 * defines the key set and every other shard is `satisfies Record<keyof typeof zh, string>`, so a
 * missing or extra key is a type error and no locale can fall back to English.
 */
export const genofficePdfStrings = defineStrings({
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
