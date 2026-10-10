/**
 * The page source the scripts preview shows (GO-B4, UNI-1014): the instrumented buffer as is,
 * except that every document picture mapped by the host (OpenPayload.assets / uploads,
 * `assets/<name>`) becomes a data: URI. The preview's policy names no 'self' (an opaque page
 * must not reach the app origin by URL), so a same-origin asset URL would be blocked there.
 *
 * Text-level on purpose: the page runs as written (scripts, inline handlers, comments and
 * formatting untouched); only a quoted or url(...) value that resolves to a mapped asset changes.
 */
import type { ImageBytes } from '../shared/assets'

/** a value between quotes or url( ), without whitespace or markup characters */
const CANDIDATE = /(["'(])\s*([^"'()<>\s]{1,2048})\s*(?=["')])/g

export async function inlineAssetsForPreview(
  html: string,
  resolve: (src: string) => string | null,
  read: (src: string) => Promise<ImageBytes | null>,
  /** src -> data: URI, kept per document by the caller (asset names never change) */
  cache: Map<string, string>,
): Promise<string> {
  const wanted = new Set<string>()
  for (const m of html.matchAll(CANDIDATE)) {
    const src = m[2]
    if (!cache.has(src) && !/^(data|blob|https?|javascript):/i.test(src) && resolve(src))
      wanted.add(src)
  }
  await Promise.all(
    [...wanted].map(async (src) => {
      const bytes = await read(src)
      if (bytes) cache.set(src, `data:${bytes.mime};base64,${bytes.base64}`)
    }),
  )
  if (cache.size === 0) return html
  return html.replace(CANDIDATE, (whole, open: string, src: string) => {
    const uri = cache.get(src)
    return uri ? `${open}${uri}` : whole
  })
}
