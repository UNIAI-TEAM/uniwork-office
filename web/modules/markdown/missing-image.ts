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

export function missingImageUrl(src: string): string | null {
  if (!isRelativePicturePath(src)) return null
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="96" viewBox="0 0 360 96">` +
    `<rect x="0.5" y="0.5" width="359" height="95" rx="8" fill="#808080" fill-opacity="0.12" ` +
    `stroke="#808080" stroke-opacity="0.55" stroke-dasharray="4 3"/>` +
    `<g fill="none" stroke="#808080" stroke-opacity="0.8" stroke-width="2" stroke-linejoin="round">` +
    `<rect x="22" y="28" width="44" height="40" rx="4"/><circle cx="36" cy="41" r="4"/>` +
    `<path d="M26 64l13-13 9 9 7-7 9 11"/></g>` +
    `<text x="82" y="53" font-family="sans-serif" font-size="13" fill="#808080">` +
    `${escapeXml(label(src))}</text></svg>`
  return `${PREFIX}${encodeURIComponent(svg)}${FRAGMENT}${encodeURIComponent(src)}`
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
