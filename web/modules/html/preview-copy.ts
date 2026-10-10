/**
 * The page source the scripts preview shows (GO-B4, UNI-1014; UNI-1232 A1): the instrumented
 * buffer as is, except that every document file mapped by the host (OpenPayload.assets / uploads)
 * is brought into the page, because the preview's policy names no 'self' (an opaque page must not
 * reach the app origin by URL, so a same-origin asset URL would be blocked there):
 *   - pictures (`assets/<name>`, a sibling PNG/JPEG/GIF/WebP/SVG): a data: URI,
 *   - `<link rel="stylesheet" href="style.css">`: an inline `<style>` with the file's text,
 *   - `<script src="app.js"></script>`: an inline `<script>` with the file's text.
 *
 * Text-level on purpose: the page runs as written (scripts, inline handlers, comments and
 * formatting untouched); only a mapped reference changes. A file the host does not serve (401/403,
 * not mapped) leaves its tag as written, exactly like before.
 */
import type { ImageBytes } from '../shared/assets'

/** a value between quotes or url( ), without whitespace or markup characters */
const CANDIDATE = /(["'(])\s*([^"'()<>\s]{1,2048})\s*(?=["')])/g

const LINK_TAG = /<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi
const SCRIPT_SRC_TAG = /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>\s*<\/script\s*>/gi
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

type Attrs = Map<string, string>

function parseAttrs(source: string): Attrs {
  const attrs: Attrs = new Map()
  for (const m of source.matchAll(ATTR)) {
    const name = m[1]!.toLowerCase()
    if (!attrs.has(name)) attrs.set(name, m[2] ?? m[3] ?? m[4] ?? '')
  }
  return attrs
}

/** the attributes of a tag source (between the tag name and `>`), minus the named ones, as written */
function keepAttrs(source: string, drop: string[]): string {
  let out = ''
  for (const m of source.matchAll(ATTR)) {
    if (drop.includes(m[1]!.toLowerCase())) continue
    out += ` ${m[0]}`
  }
  return out
}

/** the tags that name a mapped file, in document order */
function isFileRef(src: string): boolean {
  return !!src && !/^(data|blob|https?|javascript|mailto|tel):/i.test(src) && !src.startsWith('//')
}

/** text of a file placed inside `<style>`/`<script>`: its own closing tag must not end the element */
function embeddable(text: string, tag: 'style' | 'script'): string {
  return text.replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1').replace(/<!--/g, '<\\!--')
}

export interface PreviewTextFiles {
  /** text of a mapped stylesheet / script; null = not served */
  read: (src: string) => Promise<string | null>
  /** src -> text, kept per document by the caller */
  cache: Map<string, string>
}

export async function inlineAssetsForPreview(
  html: string,
  resolve: (src: string) => string | null,
  read: (src: string) => Promise<ImageBytes | null>,
  /** src -> data: URI, kept per document by the caller (asset names never change) */
  cache: Map<string, string>,
  /** mapped stylesheets and scripts; omitted = pictures only */
  files?: PreviewTextFiles,
): Promise<string> {
  let source = html
  if (files) source = await inlineTextFiles(source, resolve, files)
  const wanted = new Set<string>()
  for (const m of source.matchAll(CANDIDATE)) {
    const src = m[2]!
    if (!cache.has(src) && !/^(data|blob|https?|javascript):/i.test(src) && resolve(src))
      wanted.add(src)
  }
  await Promise.all(
    [...wanted].map(async (src) => {
      const bytes = await read(src)
      if (bytes) cache.set(src, `data:${bytes.mime};base64,${bytes.base64}`)
    }),
  )
  if (cache.size === 0) return source
  return source.replace(CANDIDATE, (whole, open: string, src: string) => {
    const uri = cache.get(src)
    return uri ? `${open}${uri}` : whole
  })
}

async function inlineTextFiles(
  html: string,
  resolve: (src: string) => string | null,
  files: PreviewTextFiles,
): Promise<string> {
  const wanted = new Set<string>()
  const refs: Array<{ whole: string; kind: 'style' | 'script'; src: string; attrs: string }> = []
  for (const m of html.matchAll(LINK_TAG)) {
    const attrs = parseAttrs(m[0].slice(5, -1))
    const src = (attrs.get('href') ?? '').trim()
    if (!/\bstylesheet\b/i.test(attrs.get('rel') ?? '') || !isFileRef(src) || !resolve(src))
      continue
    refs.push({ whole: m[0], kind: 'style', src, attrs: m[0].slice(5, -1) })
    wanted.add(src)
  }
  for (const m of html.matchAll(SCRIPT_SRC_TAG)) {
    const attrs = parseAttrs(m[1]!)
    const src = (attrs.get('src') ?? '').trim()
    if (!isFileRef(src) || !resolve(src)) continue
    refs.push({ whole: m[0], kind: 'script', src, attrs: m[1]! })
    wanted.add(src)
  }
  if (refs.length === 0) return html
  await Promise.all(
    [...wanted].map(async (src) => {
      if (files.cache.has(src)) return
      const text = await files.read(src)
      if (text !== null) files.cache.set(src, text)
    }),
  )
  let out = html
  /** `defer` classic scripts run after parsing: their inline copy goes to the end of the body */
  const deferred: string[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    const text = files.cache.get(ref.src)
    // the same tag written twice is replaced everywhere on its first visit
    if (text === undefined || seen.has(ref.whole)) continue
    seen.add(ref.whole)
    let replacement: string
    if (ref.kind === 'style') {
      const attrs = keepAttrs(ref.attrs, ['href', 'rel', 'integrity', 'crossorigin', 'as', 'type'])
      replacement = `<style${attrs}>${embeddable(text, 'style')}</style>`
    } else {
      const attrs = parseAttrs(ref.attrs)
      const inline = `<script${keepAttrs(ref.attrs, ['src', 'integrity', 'crossorigin', 'defer', 'async'])}>${embeddable(text, 'script')}</script>`
      const classicDefer =
        attrs.has('defer') && (attrs.get('type') ?? '').toLowerCase() !== 'module'
      if (classicDefer) deferred.push(inline)
      replacement = classicDefer ? '' : inline
    }
    out = out.split(ref.whole).join(replacement)
  }
  if (deferred.length === 0) return out
  const end = out.search(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i)
  return end < 0 ? out + deferred.join('') : out.slice(0, end) + deferred.join('') + out.slice(end)
}
