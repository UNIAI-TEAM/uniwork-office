import { defineStrings } from '@genoffice/i18n'
import { zh } from './genoffice-slides/zh'
import { en } from './genoffice-slides/en'
import { ja } from './genoffice-slides/ja'
import { ko } from './genoffice-slides/ko'
import { fr } from './genoffice-slides/fr'
import { de } from './genoffice-slides/de'
import { es } from './genoffice-slides/es'
import { th } from './genoffice-slides/th'
import { id } from './genoffice-slides/id'
import { ru } from './genoffice-slides/ru'
import { ar } from './genoffice-slides/ar'
import { pt } from './genoffice-slides/pt'
import { it } from './genoffice-slides/it'
import { pl } from './genoffice-slides/pl'
import { cs } from './genoffice-slides/cs'
import { nl } from './genoffice-slides/nl'
import { ms } from './genoffice-slides/ms'
import { he } from './genoffice-slides/he'
import { hi } from './genoffice-slides/hi'
import { vi } from './genoffice-slides/vi'
import { zhTW } from './genoffice-slides/zh-TW'

/**
 * Strings of the Slides features ported from genoffice: Slide Show > Record narration, real 3D
 * models, and A4/A3/portrait/custom slide sizes. One shard per language in
 * ./genoffice-slides/<lang>.ts; zh defines the key set and every other shard is
 * `satisfies Record<keyof typeof zh, string>`, so a missing or extra key is a type error and no
 * locale can fall back to English.
 */
export const genofficeSlidesStrings = defineStrings({
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
