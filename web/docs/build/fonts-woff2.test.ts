import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { keepWoff2Only, rewriteTtfUrls, WOFF2_DIR, woff2UrlImport } from './fonts-woff2'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const FONTS_CSS = join(repoRoot, 'apps/docs/src/renderer/fonts/fonts.css')

describe('rewriteTtfUrls', () => {
  it('points ttf url()s at the woff2 twins, keeps quotes, leaves other urls and missing twins alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'woff2-'))
    try {
      mkdirSync(join(dir, 'w'))
      writeFileSync(join(dir, 'w/A-Reg.woff2'), 'x')
      writeFileSync(join(dir, 'w/B.woff2'), 'x')
      const css = [
        "src: url('./A-Reg.ttf');",
        'src: url("@genoffice/ui/fonts/B.ttf");',
        "src: url('./C-missing.ttf');",
        "src: url('./Keep.woff2');",
      ].join('\n')
      const missing: string[] = []
      const out = rewriteTtfUrls(css, join(dir, 'css/fonts.css'), {
        woff2Dir: join(dir, 'w'),
        onMissing: (n) => missing.push(n),
      })
      expect(out.split('\n')).toEqual([
        "src: url('../w/A-Reg.woff2');",
        'src: url("../w/B.woff2");',
        "src: url('./C-missing.ttf');",
        "src: url('./Keep.woff2');",
      ])
      expect(missing).toEqual(['C-missing'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('woff2UrlImport', () => {
  it('maps a TTF ?url import to the WOFF2 twin, leaves everything else to Vite', () => {
    expect(woff2UrlImport('@genoffice/ui/fonts/Carlito-Regular.ttf?url')).toBe(
      `${join(WOFF2_DIR, 'Carlito-Regular.woff2')}?url`,
    )
    expect(woff2UrlImport('../fonts/Carlito-Bold.ttf?url')).toBe(
      `${join(WOFF2_DIR, 'Carlito-Bold.woff2')}?url`,
    )
    // no twin, not a URL import, not a TTF: untouched
    expect(woff2UrlImport('@genoffice/ui/fonts/Unknown-Face.ttf?url')).toBeNull()
    expect(woff2UrlImport('@genoffice/ui/fonts/Carlito-Regular.ttf')).toBeNull()
    expect(woff2UrlImport('@genoffice/ui/fonts/Carlito-Regular.woff2?url')).toBeNull()
    expect(woff2UrlImport('react')).toBeNull()
  })
})

describe('web/docs/fonts is in sync with fonts.css', () => {
  const sources = JSON.parse(readFileSync(join(WOFF2_DIR, 'woff2-sources.json'), 'utf8')) as Record<
    string,
    { source: string; sourceSha256: string; woff2Bytes: number }
  >

  it('every ttf the desktop css references has a woff2 twin', () => {
    const css = readFileSync(FONTS_CSS, 'utf8')
    const names = [
      ...css.matchAll(/url\('(?:@genoffice\/ui\/fonts\/|\.\/)([A-Za-z0-9-]+)\.ttf'\)/g),
    ].map((m) => `${m[1]}.woff2`)
    expect(names.length).toBeGreaterThan(0)
    expect([...new Set(names)].filter((n) => !(n in sources))).toEqual([])
  })

  it('each twin was made from the current TTF (re-run make-woff2.py when a TTF changes)', () => {
    for (const [twin, info] of Object.entries(sources)) {
      const ttf = readFileSync(join(repoRoot, info.source))
      expect(createHash('sha256').update(ttf).digest('hex'), `${twin} is stale`).toBe(
        info.sourceSha256,
      )
      expect(readFileSync(join(WOFF2_DIR, twin)).length).toBe(info.woff2Bytes)
    }
  })
})

describe('keepWoff2Only (KaTeX)', () => {
  it('drops woff/ttf alternatives when a woff2 is offered', () => {
    const katex =
      '@font-face{font-family:KaTeX_AMS;src:url(fonts/KaTeX_AMS-Regular.woff2) format("woff2"),url(fonts/KaTeX_AMS-Regular.woff) format("woff"),url(fonts/KaTeX_AMS-Regular.ttf) format("truetype");font-weight:400}'
    expect(keepWoff2Only(katex)).toBe(
      '@font-face{font-family:KaTeX_AMS;src:url(fonts/KaTeX_AMS-Regular.woff2) format("woff2");font-weight:400}',
    )
  })

  it('leaves single-url and woff2-less lists alone', () => {
    const css = [
      "src: url('./A.woff2') format('woff2');",
      "src: url('./B.woff') format('woff'), url('./B.ttf') format('truetype');",
      "src: url('./C.ttf');",
    ].join('\n')
    expect(keepWoff2Only(css)).toBe(css)
  })

  it('is a no-op on the Docs fonts.css (its build stays unchanged)', () => {
    const css = readFileSync(FONTS_CSS, 'utf8')
    expect(keepWoff2Only(css)).toBe(css)
  })
})
