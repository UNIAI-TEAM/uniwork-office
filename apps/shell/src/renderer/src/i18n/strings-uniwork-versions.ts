import { defineStrings } from '@genoffice/i18n'
import { zh } from './uniwork-versions/zh'
import { en } from './uniwork-versions/en'
import { ja } from './uniwork-versions/ja'
import { ko } from './uniwork-versions/ko'
import { fr } from './uniwork-versions/fr'
import { de } from './uniwork-versions/de'
import { es } from './uniwork-versions/es'
import { th } from './uniwork-versions/th'
import { id } from './uniwork-versions/id'
import { ru } from './uniwork-versions/ru'
import { ar } from './uniwork-versions/ar'
import { pt } from './uniwork-versions/pt'
import { it } from './uniwork-versions/it'
import { pl } from './uniwork-versions/pl'
import { cs } from './uniwork-versions/cs'
import { nl } from './uniwork-versions/nl'
import { ms } from './uniwork-versions/ms'
import { he } from './uniwork-versions/he'
import { hi } from './uniwork-versions/hi'
import { zhTW } from './uniwork-versions/zh-TW'
import { vi } from './uniwork-versions/vi'

/** Version history sheet copy (vi/en are the web's own strings); sharded per locale, zh defines the key set */
export const uniworkVersionStrings = defineStrings({
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
