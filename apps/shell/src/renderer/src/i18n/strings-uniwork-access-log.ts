import { defineStrings } from '@genoffice/i18n'
import { zh } from './uniwork-access-log/zh'
import { en } from './uniwork-access-log/en'
import { ja } from './uniwork-access-log/ja'
import { ko } from './uniwork-access-log/ko'
import { fr } from './uniwork-access-log/fr'
import { de } from './uniwork-access-log/de'
import { es } from './uniwork-access-log/es'
import { th } from './uniwork-access-log/th'
import { id } from './uniwork-access-log/id'
import { ru } from './uniwork-access-log/ru'
import { ar } from './uniwork-access-log/ar'
import { pt } from './uniwork-access-log/pt'
import { it } from './uniwork-access-log/it'
import { pl } from './uniwork-access-log/pl'
import { cs } from './uniwork-access-log/cs'
import { nl } from './uniwork-access-log/nl'
import { ms } from './uniwork-access-log/ms'
import { he } from './uniwork-access-log/he'
import { hi } from './uniwork-access-log/hi'
import { zhTW } from './uniwork-access-log/zh-TW'
import { vi } from './uniwork-access-log/vi'

/** Access log sheet copy (vi/en are the web's own strings); sharded per locale, zh defines the key set */
export const uniworkAccessLogStrings = defineStrings({
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
