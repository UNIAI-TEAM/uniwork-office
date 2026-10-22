import { createContext, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  createI18n,
  htmlDir,
  htmlLang,
  LANGS,
  type Lang,
  type LangDicts,
  type Params,
} from '@genoffice/i18n'
import { strings } from './strings'
import { accountStrings } from './i18n/strings-account'
import { cloudStrings } from './i18n/strings-cloud'
import { uniworkDocumentStrings } from './i18n/strings-uniwork-documents'
import { uniworkDocListStrings } from './i18n/strings-uniwork-doclist'
import { uniworkFolderStrings } from './i18n/strings-uniwork-folders'
import { uniworkHomeStrings } from './i18n/strings-uniwork-home'
import { uniworkSaveStrings } from './i18n/strings-uniwork-save'
import { uniworkAccessLogStrings } from './i18n/strings-uniwork-access-log'
import { uniworkShareStrings } from './i18n/strings-uniwork-share'
import { syncStrings } from './i18n/strings-sync'
import { workbenchStrings } from './i18n/strings-workbench'
import { discussionStrings } from './i18n/strings-discussion'
import { settingsStrings } from './i18n/strings-settings'
import { askUniStrings } from './i18n/strings-askuni'

export type StringKey =
  | keyof typeof strings.zh
  | keyof typeof accountStrings.zh
  | keyof typeof cloudStrings.zh
  | keyof typeof uniworkDocumentStrings.zh
  | keyof typeof uniworkDocListStrings.zh
  | keyof typeof uniworkFolderStrings.zh
  | keyof typeof uniworkHomeStrings.zh
  | keyof typeof uniworkSaveStrings.zh
  | keyof typeof uniworkAccessLogStrings.zh
  | keyof typeof uniworkShareStrings.zh
  | keyof typeof syncStrings.zh
  | keyof typeof workbenchStrings.zh
  | keyof typeof discussionStrings.zh
  | keyof typeof settingsStrings.zh
  | keyof typeof askUniStrings.zh

// the home table plus the sharded domains (each shard type-checks its own key set;
// widening to Record<Lang, Record<string, string>> here avoids a 21 * 2^N union
// explosion across chained object spreads)
const shards: readonly Record<Lang, Record<string, string>>[] = [
  strings,
  accountStrings,
  cloudStrings,
  uniworkDocumentStrings,
  uniworkDocListStrings,
  uniworkFolderStrings,
  uniworkHomeStrings,
  uniworkSaveStrings,
  uniworkAccessLogStrings,
  uniworkShareStrings,
  syncStrings,
  workbenchStrings,
  discussionStrings,
  settingsStrings,
  askUniStrings,
]

const dicts = Object.fromEntries(
  LANGS.map((l) => [l, Object.assign({}, ...shards.map((s) => s[l]))]),
) as unknown as LangDicts<Record<StringKey, string>>

const translate = createI18n(dicts)
export type TFunc = (key: StringKey, params?: Params) => string

interface LocaleValue {
  lang: Lang
  setLang: (lang: Lang) => void
}

const DEFAULT_LANG: Lang = 'zh'
const LocaleContext = createContext<LocaleValue>({ lang: DEFAULT_LANG, setLang: () => {} })

export function LocaleProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial)
  const value = useMemo<LocaleValue>(
    () => ({
      lang,
      setLang: (next) => {
        // the main process rejects when app-settings.json is unwritable; a language
        // committed here first would survive only until the next launch
        window.aiOffice.setLanguage(next).then(
          () => {
            setLangState(next)
            document.documentElement.lang = htmlLang(next)
            document.documentElement.dir = htmlDir(next)
          },
          (err: unknown) => console.warn('language not saved', err),
        )
      },
    }),
    [lang],
  )
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  t: TFunc
  /** BCP-47 locale for date/number formatting */
  dateLocale: string
}

/** BCP-47 locale per UI language, for date/number formatting */
const DATE_LOCALES: Record<Lang, string> = {
  zh: 'zh-CN',
  en: 'en-US',
  ja: 'ja-JP',
  ko: 'ko-KR',
  fr: 'fr-FR',
  de: 'de-DE',
  es: 'es-ES',
  th: 'th-TH',
  id: 'id-ID',
  ru: 'ru-RU',
  ar: 'ar-SA',
  pt: 'pt-BR',
  it: 'it-IT',
  pl: 'pl-PL',
  cs: 'cs-CZ',
  nl: 'nl-NL',
  ms: 'ms-MY',
  he: 'he-IL',
  hi: 'hi-IN',
  'zh-TW': 'zh-TW',
  vi: 'vi-VN',
}

export function useI18n(): I18n {
  const { lang, setLang } = useContext(LocaleContext)
  return {
    lang,
    setLang,
    t: (key, params) => translate(lang, key, params),
    // a host that mounts the provider without a language still gets the default's locale
    dateLocale: DATE_LOCALES[lang] ?? DATE_LOCALES[DEFAULT_LANG],
  }
}
