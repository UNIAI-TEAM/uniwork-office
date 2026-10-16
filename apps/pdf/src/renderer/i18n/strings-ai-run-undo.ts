import { defineStrings } from '@genoffice/i18n'
import { zh } from './ai-run-undo/zh'
import { en } from './ai-run-undo/en'
import { ja } from './ai-run-undo/ja'
import { ko } from './ai-run-undo/ko'
import { fr } from './ai-run-undo/fr'
import { de } from './ai-run-undo/de'
import { es } from './ai-run-undo/es'
import { th } from './ai-run-undo/th'
import { id } from './ai-run-undo/id'
import { ru } from './ai-run-undo/ru'
import { ar } from './ai-run-undo/ar'
import { pt } from './ai-run-undo/pt'
import { it } from './ai-run-undo/it'
import { pl } from './ai-run-undo/pl'
import { cs } from './ai-run-undo/cs'
import { nl } from './ai-run-undo/nl'
import { ms } from './ai-run-undo/ms'
import { he } from './ai-run-undo/he'
import { hi } from './ai-run-undo/hi'
import { vi } from './ai-run-undo/vi'
import { zhTW } from './ai-run-undo/zh-TW'

/**
 * Strings of the "Undo this run" action under an AI answer that changed the document.
 * One shard per language in ./ai-run-undo/<lang>.ts; zh defines the key set.
 */
export const aiRunUndoStrings = defineStrings({
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
