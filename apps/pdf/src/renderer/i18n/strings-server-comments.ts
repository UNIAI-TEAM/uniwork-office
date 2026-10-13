import { defineStrings } from '@genoffice/i18n'
import { zh } from './server-comments/zh'
import { en } from './server-comments/en'
import { ja } from './server-comments/ja'
import { ko } from './server-comments/ko'
import { fr } from './server-comments/fr'
import { de } from './server-comments/de'
import { es } from './server-comments/es'
import { th } from './server-comments/th'
import { id } from './server-comments/id'
import { ru } from './server-comments/ru'
import { ar } from './server-comments/ar'
import { pt } from './server-comments/pt'
import { it } from './server-comments/it'
import { pl } from './server-comments/pl'
import { cs } from './server-comments/cs'
import { nl } from './server-comments/nl'
import { ms } from './server-comments/ms'
import { he } from './server-comments/he'
import { hi } from './server-comments/hi'
import { vi } from './server-comments/vi'
import { zhTW } from './server-comments/zh-TW'

/**
 * Strings of the server comments mode of a bound PDF (G8-15): the collab panel's own copy comes from
 * `@genoffice/ui/collab`; only what the PDF editor adds lives here.
 * One shard per language in ./server-comments/<lang>.ts; zh defines the key set.
 */
export const serverCommentsStrings = defineStrings({
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
