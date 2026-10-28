import { defineStrings } from '@genoffice/i18n'
import { zh } from './genoffice-markdown/zh'
import { en } from './genoffice-markdown/en'
import { ja } from './genoffice-markdown/ja'
import { ko } from './genoffice-markdown/ko'
import { fr } from './genoffice-markdown/fr'
import { de } from './genoffice-markdown/de'
import { es } from './genoffice-markdown/es'
import { th } from './genoffice-markdown/th'
import { id } from './genoffice-markdown/id'
import { ru } from './genoffice-markdown/ru'
import { ar } from './genoffice-markdown/ar'
import { pt } from './genoffice-markdown/pt'
import { it } from './genoffice-markdown/it'
import { pl } from './genoffice-markdown/pl'
import { cs } from './genoffice-markdown/cs'
import { nl } from './genoffice-markdown/nl'
import { ms } from './genoffice-markdown/ms'
import { he } from './genoffice-markdown/he'
import { hi } from './genoffice-markdown/hi'
import { vi } from './genoffice-markdown/vi'
import { zhTW } from './genoffice-markdown/zh-TW'

/**
 * Strings of the Markdown features ported from genoffice: marks (footnotes, highlight), status bar
 * counts and the wiki vault. One shard per language in ./genoffice-markdown/<lang>.ts; zh defines
 * the key set and every other shard is `satisfies Record<keyof typeof zh, string>`, so a missing or
 * extra key is a type error and no locale can fall back to English.
 */
export const genofficeMarkdownStrings = defineStrings({
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
