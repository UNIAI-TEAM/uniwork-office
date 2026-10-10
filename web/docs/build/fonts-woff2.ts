import { existsSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
export const WOFF2_DIR = resolve(here, '../fonts')

// fonts.css references TTFs as `./X.ttf` (apps/docs) or `@genoffice/ui/fonts/X.ttf` (shared Carlito GO)
const TTF_URL = /url\((['"]?)(?:@genoffice\/ui\/fonts\/|\.\/)([A-Za-z0-9-]+)\.ttf\1\)/g

/**
 * Rewrite the TTF `url()`s of a stylesheet to the WOFF2 twins in web/docs/fonts/ (made by make-woff2.py).
 * A TTF without a twin is left as is (reported through `onMissing`): the build still works, only bigger.
 */
export function rewriteTtfUrls(
  css: string,
  cssFile: string,
  {
    woff2Dir = WOFF2_DIR,
    onMissing = () => {},
  }: { woff2Dir?: string; onMissing?: (name: string) => void } = {},
): string {
  return css.replace(TTF_URL, (whole, quote: string, name: string) => {
    const twin = resolve(woff2Dir, `${name}.woff2`)
    if (!existsSync(twin)) {
      onMissing(name)
      return whole
    }
    let rel = relative(dirname(cssFile), twin).split('\\').join('/')
    if (!rel.startsWith('.')) rel = `./${rel}`
    return `url(${quote}${rel}${quote})`
  })
}

// JS imports of a font file as a URL: `import url from '@genoffice/ui/fonts/Carlito-Regular.ttf?url'`
const TTF_URL_IMPORT =
  /^(?:@genoffice\/ui\/fonts\/|\.{1,2}\/(?:[^?]*\/)?)([A-Za-z0-9-]+)\.ttf\?url$/

/**
 * The WOFF2 twin (with `?url`) a `<name>.ttf?url` import resolves to, or null when the import is not a
 * TTF URL import or has no twin. The canvas FontFace API the Sheets cell-font fallback uses reads WOFF2
 * like @font-face does, and the twin is a fraction of the TTF (fonts-woff2 README, make-woff2.py).
 */
export function woff2UrlImport(source: string, woff2Dir = WOFF2_DIR): string | null {
  const name = TTF_URL_IMPORT.exec(source)?.[1]
  if (!name) return null
  const twin = resolve(woff2Dir, `${name}.woff2`)
  return existsSync(twin) ? `${twin}?url` : null
}

const SRC_DECL = /(\bsrc\s*:\s*)([^;}]*)/g
const WOFF2_URL = /url\(\s*(['"]?)[^'")]*\.woff2(?:[?#][^'")]*)?\1\s*\)/i

/**
 * In an @font-face `src` list that offers a WOFF2 file, drop the other formats (GO-B4: KaTeX ships
 * every face as woff2 + woff + ttf). Every browser the frames support reads WOFF2, so the
 * alternatives are never fetched; dropping them keeps Vite from emitting them (about two thirds
 * of the KaTeX font bytes). Lists without a WOFF2 entry are left alone.
 */
export function keepWoff2Only(css: string): string {
  return css.replace(SRC_DECL, (whole, head: string, list: string) => {
    const items = list.split(/,(?=\s*url\()/)
    if (items.length < 2 || !items.some((i) => WOFF2_URL.test(i))) return whole
    const kept = items.filter((i) => WOFF2_URL.test(i)).map((i) => i.trim())
    return `${head}${kept.join(',')}`
  })
}

export function woff2FontsPlugin(): Plugin {
  return {
    name: 'web-docs-woff2-fonts',
    enforce: 'pre',
    // `?url` TTF imports from JS (Sheets cell-font-fallback.ts): same twin, same never-inline rule
    resolveId(source) {
      return woff2UrlImport(source)
    },
    transform(code, id) {
      const file = id.split('?')[0]
      if (!file.endsWith('.css') || !/\.(ttf|woff)\b/.test(code)) return null
      const missing: string[] = []
      const out = keepWoff2Only(rewriteTtfUrls(code, file, { onMissing: (n) => missing.push(n) }))
      for (const n of missing)
        this.warn(`no WOFF2 twin for ${n}.ttf (run web/docs/fonts/make-woff2.py); shipping the TTF`)
      return out === code ? null : { code: out, map: null }
    },
  }
}
