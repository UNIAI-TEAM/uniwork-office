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

export function woff2FontsPlugin(): Plugin {
  return {
    name: 'web-docs-woff2-fonts',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0]
      if (!file.endsWith('.css') || !code.includes('.ttf')) return null
      const missing: string[] = []
      const out = rewriteTtfUrls(code, file, { onMissing: (n) => missing.push(n) })
      for (const n of missing)
        this.warn(`no WOFF2 twin for ${n}.ttf (run web/docs/fonts/make-woff2.py); shipping the TTF`)
      return out === code ? null : { code: out, map: null }
    },
  }
}
