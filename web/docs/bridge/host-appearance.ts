/**
 * Host-authoritative theme and language (GO-B3 follow-up).
 *
 * The host passes `theme` and `locale` in `init` and later sends `theme` / `language`
 * events. They are applied through browser.ts setWebTheme / setWebLanguage with
 * `{ host: true }`: kept in memory, never written to localStorage (the frame is same-origin
 * with the UniWork page, so its storage is the host's), and from then on they win over any
 * stored value. The renderer follows live: main.tsx listens to `onThemeChanged`, and the
 * LocaleProvider re-renders on `onLanguageChanged` (no reload).
 */
import { awaitHostAppearance, setWebLanguage, setWebTheme } from './browser'
import type { FramePort } from './frame-port'

export function bindHostAppearance(
  port: Pick<FramePort, 'whenInitialized' | 'onTheme' | 'onLanguage'>,
): void {
  const init = port.whenInitialized().then((session) => {
    if (session.theme) setWebTheme(session.theme, { host: true })
    if (session.locale) setWebLanguage(session.locale, { host: true })
  })
  // boot (getTheme / getLanguage) waits for this, bounded
  awaitHostAppearance(init)
  port.onTheme((theme) => setWebTheme(theme, { host: true }))
  port.onLanguage((locale) => setWebLanguage(locale, { host: true }))
}
