import { defineStrings } from '@genoffice/i18n'
import { zh } from './uniwork-share/zh'
import { en } from './uniwork-share/en'
import { ja } from './uniwork-share/ja'
import { ko } from './uniwork-share/ko'
import { fr } from './uniwork-share/fr'
import { de } from './uniwork-share/de'
import { es } from './uniwork-share/es'
import { th } from './uniwork-share/th'
import { id } from './uniwork-share/id'
import { ru } from './uniwork-share/ru'
import { ar } from './uniwork-share/ar'
import { pt } from './uniwork-share/pt'
import { it } from './uniwork-share/it'
import { pl } from './uniwork-share/pl'
import { cs } from './uniwork-share/cs'
import { nl } from './uniwork-share/nl'
import { ms } from './uniwork-share/ms'
import { he } from './uniwork-share/he'
import { hi } from './uniwork-share/hi'
import { zhTW } from './uniwork-share/zh-TW'
import { vi } from './uniwork-share/vi'

/** Share dialog copy (vi/en are the web's own strings); sharded per locale, zh defines the key set */
export const uniworkShareStrings = defineStrings({
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
