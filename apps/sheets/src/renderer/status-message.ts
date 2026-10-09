import type { Lang } from '@genoffice/i18n'
import { strings } from './i18n/strings'
import type { StringKey } from './i18n/locale'
import { tFor } from './i18n/locale'

/**
 * Status-bar texts without parameters. The bar keeps the string it was given, so a language
 * switch used to leave "Workbook fully loaded ..." in the old language until the next message.
 */
const STATIC_STATUS_KEYS: readonly StringKey[] = ['appReadyInitial', 'appFullyLoaded']

/** Re-renders `message` in `lang` when it is one of the static status texts of another locale. */
export function retranslateStatus(message: string, lang: Lang): string {
  for (const key of STATIC_STATUS_KEYS) {
    for (const table of Object.values(strings)) {
      if ((table as Record<string, string>)[key] === message) return tFor(lang, key)
    }
  }
  return message
}
