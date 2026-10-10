import type { Lang } from '@genoffice/i18n'
import { strings } from './i18n/strings'
import type { StringKey } from './i18n/locale'
import { tFor } from './i18n/locale'

/**
 * Status-bar texts without parameters. The bar keeps the string it was given, so a language
 * switch used to leave "Workbook fully loaded ..." in the old language until the next message.
 */
const STATIC_STATUS_KEYS: readonly StringKey[] = ['appReadyInitial', 'appFullyLoaded']

/**
 * Status-bar texts built from `{name}` style parameters ("Streaming report.xlsx: 6 rows
 * available."). They are kept as the finished string too, so a switch re-reads the parameters out
 * of the old text and renders the same message in the new language.
 */
const PARAM_STATUS_KEYS: readonly StringKey[] = ['appStreamingRows']

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** a locale's template as a whole-message pattern: each `{param}` captures what filled it */
function templatePattern(template: string): { re: RegExp; params: string[] } {
  const params: string[] = []
  const source = template
    .split(/(\{\w+\})/)
    .map((part) => {
      const param = /^\{(\w+)\}$/.exec(part)?.[1]
      if (param === undefined) return escapeRegExp(part)
      params.push(param)
      return '(.+?)'
    })
    .join('')
  return { re: new RegExp(`^${source}$`), params }
}

/** Re-renders `message` in `lang` when it is one of the status texts of another locale. */
export function retranslateStatus(message: string, lang: Lang): string {
  for (const key of STATIC_STATUS_KEYS) {
    for (const table of Object.values(strings)) {
      if ((table as Record<string, string>)[key] === message) return tFor(lang, key)
    }
  }
  for (const key of PARAM_STATUS_KEYS) {
    for (const table of Object.values(strings)) {
      const template = (table as Record<string, string>)[key]
      if (template === undefined) continue
      const { re, params } = templatePattern(template)
      const match = re.exec(message)
      if (!match) continue
      const values = Object.fromEntries(params.map((param, i) => [param, match[i + 1] ?? '']))
      return tFor(lang, key, values)
    }
  }
  return message
}
