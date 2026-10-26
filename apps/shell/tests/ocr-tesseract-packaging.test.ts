import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const shellRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(shellRoot, '../..')

interface Entry {
  from: string
  to: string
  filter?: string[]
}
interface ResourcesModule {
  REVIEWED_PACKAGES: string[]
  collectTesseractRuntime(o?: { from?: string }): {
    packages: { name: string; dest: string }[]
    missing: string[]
  }
  tesseractExtraResources(o?: { from?: string }): Entry[]
  assertTesseractResources(o?: { from?: string }): void
}
const resources = require(join(shellRoot, 'build/ocr-tesseract-resources.cjs')) as ResourcesModule

const scratch: string[] = []
const tmp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

describe('bundled Tesseract OCR resources', () => {
  it('ships exactly the reviewed runtime closure of the helper', () => {
    expect(() => resources.assertTesseractResources()).not.toThrow()
    const { packages, missing } = resources.collectTesseractRuntime()
    expect(missing).toEqual([])
    expect(packages.map((p) => p.name).sort()).toEqual([...resources.REVIEWED_PACKAGES].sort())
  })

  it('keeps node-fetch’s nested dependencies nested (electron-builder drops a root node_modules)', () => {
    const dests = resources.tesseractExtraResources().map((e) => e.to)
    for (const nested of ['tr46', 'webidl-conversions', 'whatwg-url']) {
      expect(dests).toContain(`ocr/tesseract/node_modules/node-fetch/node_modules/${nested}`)
    }
    expect(dests).not.toContain('ocr/tesseract/node_modules/opencollective-postinstall')
  })

  it('is part of the packaged config for every platform (global extraResources)', () => {
    const config = require(join(shellRoot, 'electron-builder.cjs')) as {
      extraResources: Entry[]
    }
    const to = config.extraResources.map((e) => e.to)
    for (const expected of [
      'ocr/tesseract/tess-ocr.cjs',
      'ocr/tesseract/tessdata/vie.traineddata',
      'ocr/tesseract/tessdata/LICENSE',
      'ocr/tesseract/node_modules/tesseract.js',
      'ocr/tesseract/node_modules/tesseract.js-core',
      'ocr/tesseract/node_modules/pngjs',
    ]) {
      expect(to).toContain(expected)
    }
    // the system helpers keep their own entries next to it
    expect(to).toContain('ocr/vision-ocr')
    expect(to).toContain('ocr/win-ocr.exe')
    for (const e of config.extraResources.filter((x) => x.to.startsWith('ocr/tesseract/'))) {
      expect(existsSync(resolve(shellRoot, e.from)), e.from).toBe(true)
    }
  })

  describe('closure guard', () => {
    const realDir = (dest: string) => join(repoRoot, dest.replace('ocr/tesseract/', ''))

    /** a node_modules skeleton: package.json only, manifests copied from the real tree */
    function writeTree(extra: Record<string, Record<string, unknown>> = {}, drop: string[] = []) {
      const root = tmp('tess-tree-')
      const { packages } = resources.collectTesseractRuntime()
      for (const p of packages) {
        if (drop.includes(p.name)) continue
        const real = JSON.parse(
          readFileSync(join(realDir(p.dest), 'package.json'), 'utf8'),
        ) as Record<string, unknown>
        const dir = join(root, p.dest.replace('ocr/tesseract/', ''))
        mkdirSync(dir, { recursive: true })
        const manifest = extra[p.name] ? { ...real, ...extra[p.name] } : real
        writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
      }
      return root
    }

    it('passes on a faithful copy of the tree', () => {
      expect(() => resources.assertTesseractResources({ from: writeTree() })).not.toThrow()
    })

    it('fails packaging when tesseract.js declares a dependency nobody reviewed', () => {
      const from = writeTree({
        'tesseract.js': {
          dependencies: {
            ...(JSON.parse(
              readFileSync(join(repoRoot, 'node_modules/tesseract.js/package.json'), 'utf8'),
            ).dependencies as object),
            'left-pad': '^1.0.0',
          },
        },
      })
      // the new dependency is also not installed: reported as missing
      expect(() => resources.assertTesseractResources({ from })).toThrow(/not installed: left-pad/)
      mkdirSync(join(from, 'node_modules/left-pad'), { recursive: true })
      writeFileSync(join(from, 'node_modules/left-pad/package.json'), '{"name":"left-pad"}')
      expect(() => resources.assertTesseractResources({ from })).toThrow(/new: left-pad/)
    })

    it('fails packaging when a reviewed package is no longer a dependency', () => {
      const real = JSON.parse(
        readFileSync(join(repoRoot, 'node_modules/tesseract.js/package.json'), 'utf8'),
      ) as { dependencies: Record<string, string> }
      const { 'is-url': _dropped, ...rest } = real.dependencies
      expect(() =>
        resources.assertTesseractResources({
          from: writeTree({ 'tesseract.js': { dependencies: rest } }),
        }),
      ).toThrow(/gone: is-url/)
    })

    it('fails packaging when the runtime is not installed', () => {
      expect(() => resources.assertTesseractResources({ from: tmp('tess-empty-') })).toThrow(
        /not installed: tesseract\.js, pngjs/,
      )
    })
  })

  describe('staged like electron-builder copies it', () => {
    /** copy the ocr/tesseract extraResources with electron-builder's own copier */
    async function stage(): Promise<string> {
      const { FileMatcher, copyFiles } = require('app-builder-lib/out/fileMatcher') as {
        FileMatcher: new (
          from: string,
          to: string,
          macroExpander: (s: string) => string,
          patterns?: string[],
        ) => unknown
        copyFiles: (matchers: unknown[]) => Promise<void>
      }
      const config = require(join(shellRoot, 'electron-builder.cjs')) as { extraResources: Entry[] }
      const out = tmp('tess-staged-')
      const matchers = config.extraResources
        .filter((e) => e.to.startsWith('ocr/tesseract/'))
        .map(
          (e) => new FileMatcher(resolve(shellRoot, e.from), join(out, e.to), (s) => s, e.filter),
        )
      await copyFiles(matchers)
      return out
    }

    const filesUnder = (dir: string): string[] =>
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => join(d.parentPath, d.name))

    it('runs the helper from the staged layout, no repo files involved', async () => {
      const out = await stage()
      const tess = join(out, 'ocr', 'tesseract')
      const files = filesUnder(tess).map((f) => f.slice(tess.length + 1).replace(/\\/g, '/'))

      // the three builds getCore picks from (relaxed-simd / simd / plain) with their
      // wasm; no *-lstm builds (tesseract.js 7 never loads them on Node), no .wasm.js twins
      const core = files.filter((f) => f.startsWith('node_modules/tesseract.js-core/')).sort()
      expect(core).toEqual(
        [
          'LICENSE',
          'package.json',
          'tesseract-core-relaxedsimd.js',
          'tesseract-core-relaxedsimd.wasm',
          'tesseract-core-simd.js',
          'tesseract-core-simd.wasm',
          'tesseract-core.js',
          'tesseract-core.wasm',
        ].map((f) => `node_modules/tesseract.js-core/${f}`),
      )
      expect(files).toContain('node_modules/node-fetch/node_modules/whatwg-url/package.json')
      expect(files).toContain('tessdata/vie.traineddata')
      expect(files.some((f) => f.startsWith('node_modules/tesseract.js/dist/'))).toBe(false)

      // a stripped environment: nothing but PATH-less node and the staged files
      const png = readFileSync(join(repoRoot, 'packages/pdf2docx/tests/fixtures/ocr/vi.png'))
      const res = spawnSync(
        process.execPath,
        [join(tess, 'tess-ocr.cjs'), join(tess, 'tessdata'), 'vie'],
        { input: png, maxBuffer: 64 << 20, env: { ELECTRON_RUN_AS_NODE: '1' }, cwd: out },
      )
      expect(res.stderr.toString()).not.toMatch(/Cannot find module/)
      expect(res.status).toBe(0)
      const parsed = JSON.parse(res.stdout.toString('utf8')) as { lines: { t: string }[] }
      const text = parsed.lines.map((l) => l.t).join('\n')
      expect(text).toContain('Cộng hòa xã hội chủ nghĩa Việt Nam')
      expect(text).toContain('Đà Nẵng')

      // the on-disk size this adds to every platform's installer
      const bytes = filesUnder(tess).reduce((a, f) => a + statSync(f).size, 0)
      expect(bytes).toBeGreaterThan(8 * 1024 * 1024)
      expect(bytes).toBeLessThan(18 * 1024 * 1024)
    }, 60_000)
  })
})
