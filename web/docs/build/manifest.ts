import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, posix, relative, resolve, sep } from 'node:path'
import zlib from 'node:zlib'
import type { VersionInfo } from './version'

export type FileKind = 'html' | 'js' | 'css' | 'font' | 'image' | 'sourcemap' | 'meta' | 'other'

export interface ManifestFile {
  /** posix path relative to the version directory */
  path: string
  bytes: number
  sha256: string
  /** gzip level 9 of this file alone (what a host serving gzip sends) */
  gzipBytes: number
  kind: FileKind
  /** on the static load path from `entry` (html + script/link targets + static JS imports); the host should preload/warm these */
  initial: boolean
}

export interface SizeTotals {
  files: number
  bytes: number
  gzipBytes: number
}

export interface Manifest {
  schemaVersion: 1
  /** the genoffice editor this bundle runs (GO-B4/B5/B6): docs, pdf, markdown, html, slides, sheets */
  module: string
  version: string
  packageVersion: string
  gitSha: string
  dirty: boolean
  builtAt: string
  /** document to load, relative to the version directory (all asset URLs in it are relative: base './') */
  entry: string
  /** policy files next to this one */
  csp: string
  headers: string
  files: ManifestFile[]
  totalBytes: number
  gzipBytes: number
  /** fetched before the app starts */
  initial: SizeTotals
  /** everything else except metadata: fonts (loaded per face, on demand), sourcemaps, lazily imported chunks */
  deferred: SizeTotals
}

/** files that describe the build and are generated after it; manifest.json itself is never listed (it would hash itself) */
export const META_FILES = ['csp.json', 'headers.json']
export const MANIFEST_FILE = 'manifest.json'

const FONT_EXT = new Set(['.ttf', '.otf', '.woff', '.woff2'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.avif'])

export function kindOf(path: string): FileKind {
  if (META_FILES.includes(path)) return 'meta'
  const ext = extname(path).toLowerCase()
  if (ext === '.map') return 'sourcemap'
  if (ext === '.html') return 'html'
  if (ext === '.js' || ext === '.mjs') return 'js'
  if (ext === '.css') return 'css'
  if (FONT_EXT.has(ext)) return 'font'
  if (IMAGE_EXT.has(ext)) return 'image'
  return 'other'
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
    .sort()
}

const REF_RE = /(?:src|href)=["']([^"']+\.(?:js|mjs|css))["']/g
// `from"./x.js"` / `import"./x.js"` (static); a dynamic `import("./x.js")` has a paren and does not match
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*)["'](\.{1,2}\/[^"']+\.(?:js|mjs|css))["']/g

/** The static closure from `entry`: what the browser must fetch before anything runs. */
export function initialPaths(
  readText: (path: string) => string | null,
  known: Set<string>,
  entry: string,
): Set<string> {
  const initial = new Set<string>([entry])
  const queue = [entry]
  while (queue.length) {
    const cur = queue.pop() as string
    const text = readText(cur)
    if (text == null) continue
    const refs: string[] = []
    if (cur.endsWith('.html')) for (const m of text.matchAll(REF_RE)) refs.push(m[1])
    else if (!cur.endsWith('.css')) for (const m of text.matchAll(IMPORT_RE)) refs.push(m[1])
    for (const ref of refs) {
      if (/^([a-z]+:)?\/\//i.test(ref) || ref.startsWith('/')) continue
      const target = posix.normalize(posix.join(posix.dirname(cur), ref))
      if (known.has(target) && !initial.has(target)) {
        initial.add(target)
        queue.push(target)
      }
    }
  }
  return initial
}

const sum = (files: ManifestFile[]): SizeTotals => ({
  files: files.length,
  bytes: files.reduce((n, f) => n + f.bytes, 0),
  gzipBytes: files.reduce((n, f) => n + f.gzipBytes, 0),
})

export interface BuildManifestInput {
  /** version directory (the build output) */
  dir: string
  version: VersionInfo
  /** default 'docs' */
  module?: string
  entry?: string
  /** injectable for tests */
  builtAt?: string
}

/** Describe a finished build directory. Pure with respect to the directory contents + `builtAt`. */
export function buildManifest({
  dir,
  version,
  module = 'docs',
  entry = 'index.html',
  builtAt = new Date().toISOString(),
}: BuildManifestInput): Manifest {
  const root = resolve(dir)
  const rels = walk(root)
    .map((abs) => relative(root, abs).split(sep).join('/'))
    .filter((p) => p !== MANIFEST_FILE)
  const known = new Set(rels)
  if (!known.has(entry)) throw new Error(`manifest: entry "${entry}" not found in ${root}`)
  const initial = initialPaths(
    (p) => (/\.(html|js|mjs|css)$/.test(p) ? readFileSync(join(root, p), 'utf8') : null),
    known,
    entry,
  )
  const files: ManifestFile[] = rels.map((path) => {
    const buf = readFileSync(join(root, path))
    return {
      path,
      bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
      gzipBytes: zlib.gzipSync(buf, { level: 9 }).length,
      kind: kindOf(path),
      initial: initial.has(path),
    }
  })
  const totals = sum(files)
  return {
    schemaVersion: 1,
    module,
    version: version.version,
    packageVersion: version.packageVersion,
    gitSha: version.gitSha,
    dirty: version.dirty,
    builtAt,
    entry,
    csp: 'csp.json',
    headers: 'headers.json',
    files,
    totalBytes: totals.bytes,
    gzipBytes: totals.gzipBytes,
    initial: sum(files.filter((f) => f.initial)),
    deferred: sum(files.filter((f) => !f.initial && f.kind !== 'meta')),
  }
}

/**
 * For the host sync script: re-hash a synced directory against its manifest, and report any file
 * the manifest does not list (a stale or injected file would be served same-origin with UniWork).
 * Returns the problems (empty = identical).
 */
export function verifyManifest(dir: string, manifest: Pick<Manifest, 'files'>): string[] {
  const problems: string[] = []
  const root = resolve(dir)
  const listed = new Set(manifest.files.map((f) => f.path))
  let present: string[] = []
  try {
    present = walk(root).map((abs) => relative(root, abs).split(sep).join('/'))
  } catch {
    // a missing directory shows up below as every listed file missing
  }
  for (const path of present) {
    if (path !== MANIFEST_FILE && !listed.has(path)) problems.push(`${path}: not in the manifest`)
  }
  for (const f of manifest.files) {
    const abs = resolve(root, f.path)
    if (abs !== root && !abs.startsWith(root + sep)) {
      problems.push(`${f.path}: escapes the version directory`)
      continue
    }
    let buf: Buffer
    try {
      buf = readFileSync(abs)
    } catch {
      problems.push(`${f.path}: missing`)
      continue
    }
    if (buf.length !== f.bytes)
      problems.push(`${f.path}: ${buf.length} bytes, manifest says ${f.bytes}`)
    else if (createHash('sha256').update(buf).digest('hex') !== f.sha256)
      problems.push(`${f.path}: sha256 mismatch`)
  }
  return problems
}
