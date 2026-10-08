import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { rewriteTtfUrls, WOFF2_DIR } from './fonts-woff2'

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
