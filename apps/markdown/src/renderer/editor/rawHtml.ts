import { Mark, Node } from '@tiptap/core'
import type { JSONContent, MarkdownToken } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import type { MarkdownManager } from '@tiptap/markdown'
import { t } from '../i18n/locale'

/**
 * Byte-faithful raw HTML in the markdown body (comments, <div> wrappers,
 * <details>, inline <span>…). The schema cannot represent arbitrary HTML, and
 * running it through the schema (the upstream default) rewrites or drops it on
 * the first save. Instead the exact source text is kept:
 *
 * - block HTML (a marked `html` block token) → `rawHtmlBlock`, an atom whose
 *   `raw` attribute is serialized back verbatim;
 * - inline HTML (a comment, a lone tag, or an open tag through its matching
 *   close) → text carrying the `rawHtmlInline` mark. A mark instead of an
 *   inline atom so surrounding bold/link marks still wrap it on save; the mark
 *   is `code`, so the serializer neither escapes nor entity-encodes the text.
 *   Formatting tags the schema maps losslessly (`<b>`, `<em>`, `<br>`, `<a href>`…
 *   with no attribute the mapping would drop) are left to the upstream inline
 *   pass (inlineTokens.ts) and render as marks; see `mapsToSchema`.
 *
 * The HTML is never rendered: the editor shows the source as escaped text
 * (textContent only), so nothing in a document can reach the frame DOM as
 * markup. Conversions (docx export, AI input) still degrade the HTML through
 * the schema like before — see `degradeRawHtml`.
 */

export const RAW_HTML_BLOCK = 'rawHtmlBlock'
export const RAW_HTML_INLINE = 'rawHtmlInline'

const ATTR = `\\s+[a-zA-Z_:][\\w.:-]*(?:\\s*=\\s*(?:[^\\s"'=<>\`]+|'[^']*'|"[^"]*"))?`
const OPEN_TAG_RE = new RegExp(`^<([a-zA-Z][a-zA-Z0-9-]*)(?:${ATTR})*\\s*(/?)>`)
const CLOSE_TAG_RE = /^<\/[a-zA-Z][a-zA-Z0-9-]*\s*>/
// CommonMark 0.31 comments, processing instructions, declarations, CDATA
const SPECIAL_RE =
  /^(?:<!-->|<!--->|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![a-zA-Z][^>]*>|<!\[CDATA\[[\s\S]*?\]\]>)/
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

/** Length of the inline raw HTML at the start of `src`; 0 when there is none */
export function matchInlineHtml(src: string): number {
  const special = SPECIAL_RE.exec(src)
  if (special) return special[0].length
  const close = CLOSE_TAG_RE.exec(src)
  if (close) return close[0].length
  const open = OPEN_TAG_RE.exec(src)
  if (!open) return 0
  const name = open[1].toLowerCase()
  if (open[2] === '/' || VOID_TAGS.has(name)) return open[0].length
  // extend through the matching close tag (same-name nesting counted) so a
  // `<span>…</span>` pair stays one chunk; unmatched → the open tag alone
  const tagRe = new RegExp(`<(/?)${name}(?=[\\s/>])[^>]*>`, 'gi')
  tagRe.lastIndex = open[0].length
  let depth = 1
  for (let m = tagRe.exec(src); m; m = tagRe.exec(src)) {
    if (m[1]) depth--
    else if (!m[0].endsWith('/>')) depth++
    if (depth === 0) return m.index + m[0].length
  }
  return open[0].length
}

/**
 * Inline tags the schema represents without loss, with the attributes it keeps
 * (the FORMATTING_TAGS of inlineTokens.ts). Such a tag goes through the
 * upstream inline pass and renders as a mark; any other attribute would be
 * dropped on save, so the tag then stays opaque raw HTML.
 */
const SCHEMA_TAGS: Record<string, readonly string[]> = {
  a: ['href', 'title'],
  b: [],
  br: [],
  code: [],
  del: [],
  em: [],
  i: [],
  img: ['src', 'alt', 'title', 'width', 'height'],
  s: [],
  strike: [],
  strong: [],
}
const TAG_HEAD_RE = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/
const ATTR_NAME_RE = new RegExp(ATTR, 'g')

/** Whether this inline HTML chunk is a formatting tag the schema maps losslessly */
export function mapsToSchema(raw: string): boolean {
  const head = TAG_HEAD_RE.exec(raw)
  const allowed = head ? SCHEMA_TAGS[head[1]!.toLowerCase()] : undefined
  if (!allowed) return false
  if (raw.startsWith('</')) return true
  const open = OPEN_TAG_RE.exec(raw)
  if (!open) return false
  const attrs = open[0].slice(head![0].length).match(ATTR_NAME_RE) ?? []
  return attrs.every((a) => allowed.includes(a.trim().split(/[\s=]/)[0]!.toLowerCase()))
}

function isComment(raw: string): boolean {
  return raw.trimStart().startsWith('<!--')
}

export const RawHtmlBlock = Node.create({
  name: RAW_HTML_BLOCK,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      raw: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-md-raw-html') ?? '',
        renderHTML: (attrs) => ({ 'data-md-raw-html': attrs.raw }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-md-raw-html]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', { ...HTMLAttributes, class: 'md-raw-html' }, ['code', String(node.attrs.raw)]]
  },

  // marked emits block HTML as `html` tokens; only the block-level ones reach
  // here (inline HTML is taken by the RawHtmlInline tokenizer)
  markdownTokenName: 'html',

  parseMarkdown: (token: MarkdownToken) => {
    // an empty result falls back to the upstream html handling
    if (token.block === false) return []
    const raw = String(token.raw ?? token.text ?? '').replace(/\n+$/, '')
    if (!raw.trim()) return []
    return { type: RAW_HTML_BLOCK, attrs: { raw } }
  },

  renderMarkdown: (node: JSONContent) => String(node.attrs?.raw ?? ''),

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div')
      dom.className = 'md-raw-html'
      dom.contentEditable = 'false'
      dom.title = t('rawHtmlKept')
      // the visible "kept as-is, not rendered" label is painted by CSS from this attribute, so the
      // source text (textContent) stays exactly what the file saves
      const label = t('rawHtmlLabel')
      dom.dataset.mdLabel = label
      dom.setAttribute('role', 'group')
      dom.setAttribute('aria-label', label)
      const code = document.createElement('code')
      const apply = (raw: string) => {
        // textContent only: the source is shown, never parsed as markup
        code.textContent = raw
        dom.classList.toggle('md-raw-html-comment', isComment(raw))
      }
      apply(String(node.attrs.raw))
      dom.appendChild(code)
      return {
        dom,
        update: (next) => {
          if (next.type.name !== RAW_HTML_BLOCK) return false
          apply(String(next.attrs.raw))
          return true
        },
      }
    }
  },
})

export const RawHtmlInline = Mark.create({
  name: RAW_HTML_INLINE,
  // the serializer skips escaping/entity encoding for code-type marks
  code: true,
  inclusive: false,
  spanning: false,

  parseHTML() {
    return [{ tag: 'span[data-md-raw-html]' }]
  },

  renderHTML() {
    return [
      'span',
      { 'data-md-raw-html': '', class: 'md-raw-html-inline', title: t('rawHtmlKept') },
      0,
    ]
  },

  parseMarkdown: (token: MarkdownToken, helpers) =>
    helpers.applyMark(RAW_HTML_INLINE, [{ type: 'text', text: String(token.raw ?? '') }]),

  renderMarkdown: (node: JSONContent, helpers) => helpers.renderChildren(node),

  markdownTokenizer: {
    name: RAW_HTML_INLINE,
    level: 'inline',
    start: (src: string) => src.indexOf('<'),
    tokenize: (src: string) => {
      const length = matchInlineHtml(src)
      if (!length) return undefined
      const raw = src.slice(0, length)
      if (mapsToSchema(raw)) return undefined
      return { type: RAW_HTML_INLINE, raw }
    },
  },
})

// ── Save As image rebasing ──

// the attribute run before `src` is bounded: an unclosed `<img ` followed by a long tail must not go quadratic
const IMG_SRC_RE = /(<img\b[^>]{0,2048}?\ssrc\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi

/** `raw` with every <img src> listed in `rewrites` replaced (same quoting, attribute-encoded) */
export function rewriteRawHtmlImageSources(
  raw: string,
  rewrites: ReadonlyMap<string, string>,
): string {
  return raw.replace(IMG_SRC_RE, (match, head: string, dq?: string, sq?: string, bare?: string) => {
    const value = dq ?? sq ?? bare ?? ''
    const to = rewrites.get(value)
    if (to === undefined) return match
    const encoded = to.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    if (dq !== undefined) return `${head}"${encoded.replace(/"/g, '&quot;')}"`
    if (sq !== undefined) return `${head}'${encoded.replace(/'/g, '&#39;')}'`
    return `${head}"${encoded.replace(/"/g, '&quot;')}"`
  })
}

/**
 * Apply a Save As image rewrite (main rewrote the file's image paths) to the
 * preserved raw HTML too, so the next save writes the new paths. Returns
 * whether anything changed.
 */
export function rewriteRawHtmlImages(
  doc: PmNode,
  tr: Transaction,
  rewrites: ReadonlyMap<string, string>,
): boolean {
  let changed = false
  doc.descendants((node, pos) => {
    if (node.type.name === RAW_HTML_BLOCK) {
      const raw = String(node.attrs.raw ?? '')
      const next = rewriteRawHtmlImageSources(raw, rewrites)
      if (next !== raw) {
        tr.setNodeMarkup(tr.mapping.map(pos), undefined, { ...node.attrs, raw: next })
        changed = true
      }
      return false
    }
    if (node.isText && node.marks.some((m) => m.type.name === RAW_HTML_INLINE)) {
      const text = node.text ?? ''
      const next = rewriteRawHtmlImageSources(text, rewrites)
      if (next !== text) {
        const from = tr.mapping.map(pos)
        tr.replaceWith(
          from,
          tr.mapping.map(pos + node.nodeSize),
          doc.type.schema.text(next, node.marks),
        )
        changed = true
      }
    }
    return true
  })
  return changed
}

// ── conversions: degrade raw HTML through the schema (pre-preservation behaviour) ──

function hasRawHtmlMark(node: JSONContent): boolean {
  return node.type === 'text' && !!node.marks?.some((m) => m.type === RAW_HTML_INLINE)
}

function withMarks(nodes: JSONContent[], marks: JSONContent['marks']): JSONContent[] {
  if (!marks?.length) return nodes
  return nodes.map((n) =>
    n.type === 'text'
      ? { ...n, marks: [...(n.marks ?? []), ...marks] }
      : n.content
        ? { ...n, content: withMarks(n.content, marks) }
        : n,
  )
}

/** Upstream's html → schema conversion (the pre-preservation path); private in its typings */
function parseHtmlChunk(manager: MarkdownManager, raw: string, block: boolean): JSONContent[] {
  const upstream = manager as unknown as {
    parseHTMLToken(token: MarkdownToken): JSONContent | JSONContent[] | null
  }
  const result = upstream.parseHTMLToken({ type: 'html', raw, text: raw, block })
  if (!result) return []
  return Array.isArray(result) ? result : [result]
}

function degradeChildren(content: JSONContent[], manager: MarkdownManager): JSONContent[] {
  return content.flatMap((node): JSONContent[] => {
    if (node.type === RAW_HTML_BLOCK) {
      return parseHtmlChunk(manager, String(node.attrs?.raw ?? ''), true)
    }
    if (hasRawHtmlMark(node)) {
      // ProseMirror merges adjacent chunks with equal marks, so this is one html run
      const marks = node.marks!.filter((m) => m.type !== RAW_HTML_INLINE)
      return withMarks(parseHtmlChunk(manager, node.text ?? '', false), marks)
    }
    return [node.content ? { ...node, content: degradeChildren(node.content, manager) } : node]
  })
}

/**
 * Replace the preserved raw HTML with what the schema makes of it (styling
 * dropped, semantic tags mapped, comments removed) — the behaviour every
 * conversion had before preservation: docx export and model input stay pure.
 */
export function degradeRawHtml(doc: JSONContent, manager: MarkdownManager): JSONContent {
  if (!doc.content) return doc
  return { ...doc, content: degradeChildren(doc.content, manager) }
}
