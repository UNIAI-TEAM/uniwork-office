/**
 * A relative picture the host has no copy of (a single uploaded .md has no sibling `assets/`
 * folder) used to paint the browser's broken-image icon, and the desktop's md-asset: fallback URL
 * is blocked by the frame CSP. The renderer now shows a quiet placeholder with the picture's path,
 * so the reader sees what is missing and the document keeps its authored `![](path)`.
 *
 * The placeholder is a data: SVG (img-src allows data:) whose fragment carries the authored path,
 * so `unresolveMissingImage` hands the editor the original src back (a copy/paste inside the
 * editor never bakes the placeholder into the saved Markdown). Neutral mid-grey strokes with
 * partial opacity read on both the light and the dark page; the document is not re-themed.
 */
const PREFIX = 'data:image/svg+xml;charset=utf-8,'
const FRAGMENT = '#ow-missing='
const MAX_LABEL = 40
/** the note sits right of the icon: ~265 px of 11.5 px text per line */
const NOTE_COLUMNS = 40
const NOTE_LINES = 2

/** a relative path of the document (not a URL, not absolute) */
export function isRelativePicturePath(src: string): boolean {
  if (!src || src.startsWith('/') || src.startsWith('//') || src.startsWith('#')) return false
  return !/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^[a-zA-Z]:[\\/]/.test(src)
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function label(src: string): string {
  return src.length > MAX_LABEL ? `…${src.slice(-(MAX_LABEL - 1))}` : src
}

/** display columns of a string: wide (CJK) characters count 2, combining marks 0 */
function columns(text: string): number {
  let n = 0
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if (/\p{M}/u.test(ch)) continue
    n +=
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6)
        ? 2
        : 1
  }
  return n
}

/** words of a sentence; Intl.Segmenter also finds the breaks of scripts written without spaces (Thai, CJK) */
function words(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)].map(
      (part) => part.segment,
    )
  }
  return text.split(/(\s+)/).filter(Boolean)
}

/** greedy wrap at word breaks; a single word wider than the line is kept whole (the SVG clips it) */
function wrap(text: string, max: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of words(text.trim())) {
    if (line && columns(line) + columns(word) > max) {
      lines.push(line.trimEnd())
      line = word.trimStart()
    } else {
      line += word
    }
  }
  if (line.trim()) lines.push(line.trimEnd())
  return lines
}

/**
 * `note` is the renderer's localised sentence on why the picture is not shown ("not uploaded with
 * this document"); it is drawn under the path so the placeholder explains itself.
 */
export function missingImageUrl(src: string, note?: string): string | null {
  if (!isRelativePicturePath(src)) return null
  const noteLines = note ? wrap(note, NOTE_COLUMNS).slice(0, NOTE_LINES) : []
  const pathY = noteLines.length ? 40 : 53
  const noteSvg = noteLines
    .map((line, i) => `<tspan x="82" dy="${i === 0 ? 0 : 15}">${escapeXml(line)}</tspan>`)
    .join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="96" viewBox="0 0 360 96">` +
    `<rect x="0.5" y="0.5" width="359" height="95" rx="8" fill="#808080" fill-opacity="0.12" ` +
    `stroke="#808080" stroke-opacity="0.55" stroke-dasharray="4 3"/>` +
    `<g fill="none" stroke="#808080" stroke-opacity="0.8" stroke-width="2" stroke-linejoin="round">` +
    `<rect x="22" y="28" width="44" height="40" rx="4"/><circle cx="36" cy="41" r="4"/>` +
    `<path d="M26 64l13-13 9 9 7-7 9 11"/></g>` +
    `<text x="82" y="${pathY}" font-family="sans-serif" font-size="13" fill="#808080">` +
    `${escapeXml(label(src))}</text>` +
    (noteSvg
      ? `<text x="82" y="${pathY + 18}" font-family="sans-serif" font-size="11.5" fill="#808080">${noteSvg}</text>`
      : '') +
    `</svg>`
  return `${PREFIX}${encodeURIComponent(svg)}${FRAGMENT}${encodeURIComponent(src)}`
}

/** a placeholder made by {@link missingImageUrl} (not a real picture) */
export function isMissingImageUrl(url: string): boolean {
  return url.startsWith(PREFIX) && url.includes(FRAGMENT)
}

/** the authored path inside a placeholder URL; null for anything else */
export function unresolveMissingImage(url: string): string | null {
  if (!url.startsWith(PREFIX)) return null
  const at = url.indexOf(FRAGMENT)
  if (at < 0) return null
  try {
    return decodeURIComponent(url.slice(at + FRAGMENT.length))
  } catch {
    return null
  }
}
