import { defineStrings } from '@genoffice/i18n'
import { zh } from './inbox/zh'
import { en } from './inbox/en'
import { ja } from './inbox/ja'
import { ko } from './inbox/ko'
import { fr } from './inbox/fr'
import { de } from './inbox/de'
import { es } from './inbox/es'
import { th } from './inbox/th'
import { id } from './inbox/id'
import { ru } from './inbox/ru'
import { ar } from './inbox/ar'
import { pt } from './inbox/pt'
import { it } from './inbox/it'
import { pl } from './inbox/pl'
import { cs } from './inbox/cs'
import { nl } from './inbox/nl'
import { ms } from './inbox/ms'
import { he } from './inbox/he'
import { hi } from './inbox/hi'
import { zhTW } from './inbox/zh-TW'
import { vi } from './inbox/vi'

/** Notices Inbox pane chrome (sharded per locale; zh defines the key set) */
export const inboxStrings = defineStrings({
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
