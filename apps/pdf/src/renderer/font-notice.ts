/** emoji and other pictographs: no installed font draws them into a PDF on any platform */
const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

/**
 * Could the desktop app insert this text? It draws with the installed system fonts (CJK, symbols),
 * which the web build (bundled Liberation faces only) cannot; emoji are refused by both. The web
 * "no installed font" message adds the "use the app" hint only when the app would succeed.
 */
export function appMayDrawText(text: string): boolean {
  return !EMOJI_RE.test(text)
}
