import { useEffect, useRef } from 'react'

/**
 * Status-bar line. Callers set an already-translated string, so after a UI
 * language switch the old line would keep showing in the previous language
 * (a Vietnamese "missing fonts" notice under an English UI). The line is
 * transient, so a language change drops it instead of leaving it stale.
 */
export function useClearStatusOnLangChange(lang: string, clear: (empty: string) => void): void {
  const seenLang = useRef(lang)
  useEffect(() => {
    if (seenLang.current === lang) return
    seenLang.current = lang
    clear('')
  }, [lang, clear])
}
