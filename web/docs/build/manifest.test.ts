import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import zlib from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildManifest, initialPaths, kindOf, MANIFEST_FILE, verifyManifest } from './manifest'
import type { VersionInfo } from './version'

const VERSION: VersionInfo = {
  version: '0.1.0-abc1234',
  packageVersion: '0.1.0',
  gitSha: 'abc1234',
  dirty: false,
}
const BUILT_AT = '2026-10-08T00:00:00.000Z'
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex')

let dir: string
function put(rel: string, content: string | Buffer): void {
  const abs = join(dir, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'web-docs-manifest-'))
  put(
    'index.html',
    '<!doctype html><script type="module" crossorigin src="./assets/app-1.js"></script><link rel="stylesheet" href="./assets/app-1.css">',
  )
  // static import of a sibling chunk (minified `from"./x.js"`) + a dynamic import that must stay deferred
  put(
    'assets/app-1.js',
    'import{a}from"./vendor-2.js";import"./side-3.js";const l=()=>import("./lazy-4.js");export{a,l}',
  )
  put('assets/vendor-2.js', 'export const a=1')
  put('assets/side-3.js', 'console.log(1)')
  put('assets/lazy-4.js', 'export const z=2')
  put('assets/app-1.css', '@font-face{font-family:X;src:url(../fonts/X-9.woff2)}')
  put('fonts/X-9.woff2', Buffer.alloc(5000, 7))
  put('csp.json', '{"value":"default-src \'none\'"}')
  put('headers.json', '{"rules":[]}')
  put(MANIFEST_FILE, 'stale manifest from a previous run')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('buildManifest', () => {
  it('lists every file with bytes + sha256 + gzip, posix paths, sorted, without manifest.json', () => {
    const m = buildManifest({ dir, version: VERSION, builtAt: BUILT_AT })
    expect(m.files.map((f) => f.path)).toEqual([
      'assets/app-1.css',
      'assets/app-1.js',
      'assets/lazy-4.js',
      'assets/side-3.js',
      'assets/vendor-2.js',
      'csp.json',
      'fonts/X-9.woff2',
      'headers.json',
      'index.html',
    ])
    for (const f of m.files) {
      const buf = readFileSync(join(dir, f.path))
      expect(f.bytes).toBe(buf.length)
      expect(f.sha256).toBe(sha(buf))
      expect(f.gzipBytes).toBe(zlib.gzipSync(buf, { level: 9 }).length)
    }
  })

  it('carries the consumer contract: version, gitSha, builtAt, entry, totals', () => {
    const m = buildManifest({ dir, version: VERSION, builtAt: BUILT_AT })
    expect(m).toMatchObject({
      schemaVersion: 1,
      version: '0.1.0-abc1234',
      gitSha: 'abc1234',
      builtAt: BUILT_AT,
      entry: 'index.html',
      csp: 'csp.json',
      headers: 'headers.json',
    })
    expect(m.totalBytes).toBe(m.files.reduce((n, f) => n + f.bytes, 0))
    expect(m.gzipBytes).toBe(m.files.reduce((n, f) => n + f.gzipBytes, 0))
  })

  it('splits initial (static closure from the entry) from deferred (lazy chunk, font)', () => {
    const m = buildManifest({ dir, version: VERSION, builtAt: BUILT_AT })
    const initial = m.files.filter((f) => f.initial).map((f) => f.path)
    expect(initial).toEqual([
      'assets/app-1.css',
      'assets/app-1.js',
      'assets/side-3.js',
      'assets/vendor-2.js',
      'index.html',
    ])
    // the dynamic import and the CSS url() font are NOT initial
    expect(m.files.find((f) => f.path === 'assets/lazy-4.js')?.initial).toBe(false)
    expect(m.files.find((f) => f.path === 'fonts/X-9.woff2')?.initial).toBe(false)
    expect(m.initial.files).toBe(5)
    expect(m.deferred).toMatchObject({ files: 2 })
    expect(m.deferred.bytes).toBe(5000 + 'export const z=2'.length)
    // csp.json / headers.json are metadata: in files[] but in neither bucket
    expect(m.initial.files + m.deferred.files + 2).toBe(m.files.length)
  })

  it('is deterministic for the same directory and builtAt', () => {
    expect(buildManifest({ dir, version: VERSION, builtAt: BUILT_AT })).toEqual(
      buildManifest({ dir, version: VERSION, builtAt: BUILT_AT }),
    )
  })

  it('records the module (default docs)', () => {
    expect(buildManifest({ dir, version: VERSION, builtAt: BUILT_AT }).module).toBe('docs')
    expect(buildManifest({ dir, version: VERSION, builtAt: BUILT_AT, module: 'pdf' }).module).toBe(
      'pdf',
    )
  })

  it('records a dirty tree', () => {
    const m = buildManifest({
      dir,
      version: { ...VERSION, version: '0.1.0-abc1234-dirty', dirty: true },
      builtAt: BUILT_AT,
    })
    expect(m.dirty).toBe(true)
    expect(m.version).toBe('0.1.0-abc1234-dirty')
  })

  it('throws when the entry is missing', () => {
    rmSync(join(dir, 'index.html'))
    expect(() => buildManifest({ dir, version: VERSION })).toThrow(/entry "index.html" not found/)
  })

  it('classifies kinds', () => {
    expect(kindOf('fonts/a.ttf')).toBe('font')
    expect(kindOf('fonts/a.WOFF2')).toBe('font')
    expect(kindOf('assets/a.js.map')).toBe('sourcemap')
    expect(kindOf('assets/a.png')).toBe('image')
    expect(kindOf('csp.json')).toBe('meta')
    expect(kindOf('x.bin')).toBe('other')
  })
})

describe('initialPaths', () => {
  it('ignores absolute / remote references and files that are not in the build', () => {
    const files = new Set(['index.html', 'a.js'])
    const texts: Record<string, string> = {
      'index.html':
        '<script src="./a.js"></script><script src="https://cdn.example/x.js"></script><script src="/root.js"></script><script src="./gone.js"></script>',
      'a.js': 'export{}',
    }
    expect([...initialPaths((p) => texts[p] ?? null, files, 'index.html')].sort()).toEqual([
      'a.js',
      'index.html',
    ])
  })

  it('follows ../ imports between directories', () => {
    const files = new Set(['index.html', 'assets/a.js', 'shared/b.js'])
    const texts: Record<string, string> = {
      'index.html': '<script src="./assets/a.js"></script>',
      'assets/a.js': 'import"../shared/b.js"',
      'shared/b.js': '',
    }
    expect(initialPaths((p) => texts[p] ?? null, files, 'index.html').has('shared/b.js')).toBe(true)
  })
})

describe('verifyManifest (host sync check)', () => {
  it('passes on an identical copy and reports tampering / missing files / traversal', () => {
    const m = buildManifest({ dir, version: VERSION, builtAt: BUILT_AT })
    expect(verifyManifest(dir, m)).toEqual([])

    put('assets/vendor-2.js', 'export const a=2') // same size, different bytes
    rmSync(join(dir, 'fonts/X-9.woff2'))
    put('index.html', 'short')
    const problems = verifyManifest(dir, m)
    expect(problems).toEqual(
      expect.arrayContaining([
        'assets/vendor-2.js: sha256 mismatch',
        'fonts/X-9.woff2: missing',
        expect.stringMatching(/^index\.html: 5 bytes, manifest says/),
      ]),
    )
    expect(
      verifyManifest(dir, { files: [{ path: '../etc/passwd', bytes: 0, sha256: '' } as never] }),
    ).toContain('../etc/passwd: escapes the version directory')
  })

  it('reports files the manifest does not list (stale or injected), ignoring manifest.json', () => {
    const m = buildManifest({ dir, version: VERSION, builtAt: BUILT_AT })
    put(MANIFEST_FILE, JSON.stringify(m))
    expect(verifyManifest(dir, m)).toEqual([])
    put('assets/injected.js', 'alert(1)')
    put('old/app-0.js', 'stale')
    expect(verifyManifest(dir, m)).toEqual([
      'assets/injected.js: not in the manifest',
      'old/app-0.js: not in the manifest',
    ])
  })
})
