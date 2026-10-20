import { uniworkDocListStrings } from '../i18n/strings-uniwork-doclist'

export type DocListKey = keyof typeof uniworkDocListStrings.zh
export type DocListParams = Record<string, string | number>
export type DocListT = (key: DocListKey, params?: DocListParams) => string

const PLACEHOLDER = /\{([a-zA-Z0-9]+)\}/g

/**
 * The doclist copy for a BCP-47 locale (`dateLocale` of `useI18n()`): vi for
 * vi-*, English for everything else - the list formats only define vi and en.
 * UI code that has the app's own `t` passes that instead; this is what the
 * pure formatters fall back to and what the shared vectors are checked with.
 */
export function docListText(locale: string): DocListT {
  const table: Record<string, string> = locale.toLowerCase().startsWith('vi')
    ? uniworkDocListStrings.vi
    : uniworkDocListStrings.en
  return (key, params) =>
    (table[key] ?? key).replace(PLACEHOLDER, (whole, name: string) =>
      params && name in params ? String(params[name]) : whole,
    )
}
