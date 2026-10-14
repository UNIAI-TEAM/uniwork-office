import { defineStrings } from '@genoffice/i18n'
import { zh } from './cert-sign/zh'
import { en } from './cert-sign/en'
import { ja } from './cert-sign/ja'
import { ko } from './cert-sign/ko'
import { fr } from './cert-sign/fr'
import { de } from './cert-sign/de'
import { es } from './cert-sign/es'
import { th } from './cert-sign/th'
import { id } from './cert-sign/id'
import { ru } from './cert-sign/ru'
import { ar } from './cert-sign/ar'
import { pt } from './cert-sign/pt'
import { it } from './cert-sign/it'
import { pl } from './cert-sign/pl'
import { cs } from './cert-sign/cs'
import { nl } from './cert-sign/nl'
import { ms } from './cert-sign/ms'
import { he } from './cert-sign/he'
import { hi } from './cert-sign/hi'
import { vi } from './cert-sign/vi'
import { zhTW } from './cert-sign/zh-TW'

/**
 * Certificate (digital) signature UI strings of the PDF renderer: the ribbon entry, the sign
 * dialog, the signatures dialog and the status banner. One shard per language in
 * ./cert-sign/<lang>.ts; zh defines the key set and every other shard is
 * `satisfies Record<keyof typeof zh, string>`, so a missing or extra key is a type error and no
 * locale can fall back to English.
 */
export const certSignStrings = defineStrings({
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
