const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

function textOf(html: string, tag: string): string {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, 'i').exec(html)
  if (!m) return ''
  return decode(m[1]!.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

const MIN_TITLE_NAME = 2
const MAX_TITLE_NAME = 60

/** The document <title> as a name; empty when missing, a placeholder, or too long to be a name.
 *  Only the head region is searched so an inline <svg><title> in the body cannot stand in for it;
 *  </head> is optional in HTML, so the region ends at whichever of </head>, <body or <svg comes first. */
export function derivePageTitleName(html: string): string {
  const end = /<\/head\s*>|<body[\s>]|<svg[\s>]/i.exec(html)
  const title = textOf(end ? html.slice(0, end.index) : html, 'title')
  return title.length >= MIN_TITLE_NAME && title.length <= MAX_TITLE_NAME ? title : ''
}

const HEADING = /<h([1-6])(?:\s[^>]*)?>([\s\S]*?)<\/h\1\s*>/i
const TRAILING_PUNCTUATION = /[\s.!?,;:\u2026\u3002\uff01\uff1f\uff0c\uff1b\uff1a\u3001]+$/u

/** Name of an untitled page for the tab and the Save dialog: its <title>, else its first heading,
 *  without trailing sentence punctuation; empty (the default untitled name) when it has neither.
 *  Never derived from the user's request. */
export function deriveDocumentName(html: string): string {
  const heading = HEADING.exec(html)
  const name =
    derivePageTitleName(html) ||
    (heading
      ? decode(heading[2]!.replace(/<[^>]*>/g, ''))
          .replace(/\s+/g, ' ')
          .trim()
      : '')
  const cleaned = name.slice(0, MAX_TITLE_NAME).replace(TRAILING_PUNCTUATION, '')
  return cleaned.length >= MIN_TITLE_NAME ? cleaned : ''
}
