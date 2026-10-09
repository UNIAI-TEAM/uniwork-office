// @vitest-environment node
/**
 * Import guard for the environment-neutral session core (apps/slides/src/session).
 *
 * The session module is bundled into the web frame as well as Electron main, so its
 * whole relative import closure must stay free of Electron and Node: no `electron`, no
 * `node:*` / Node builtin modules, no Buffer/process/__dirname/setImmediate/require.
 * Workspace engine packages are allowed by name only (their node:crypto/zlib/Buffer uses
 * are shimmed by the web build); type-only imports are not followed (they vanish at build).
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(here, '..', 'src')
const ENTRY = join(SRC, 'session', 'index.ts')

/** Bare packages the session core may import (the web build provides/shims them). */
const ALLOWED_PACKAGES = [
  '@genoffice/pptx-engine',
  '@genoffice/pptx-ops',
  '@genoffice/pptx-render',
  '@genoffice/i18n',
]

const NODE_BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]))

/** Strip comments and string/template contents so text scans only see code. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
}

interface ImportRef {
  spec: string
  typeOnly: boolean
}

function importsOf(source: string): ImportRef[] {
  const refs: ImportRef[] = []
  const re =
    /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const m of source.matchAll(re)) {
    if (m[4]) refs.push({ spec: m[4], typeOnly: false })
    else refs.push({ spec: m[3]!, typeOnly: !!m[2] })
  }
  return refs
}

function resolveRelative(from: string, spec: string): string {
  const base = resolve(dirname(from), spec)
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')])
    if (existsSync(candidate)) return candidate
  throw new Error(`cannot resolve ${spec} from ${relative(SRC, from)}`)
}

function closure(): { files: string[]; packages: Map<string, string[]> } {
  const seen = new Set<string>()
  const packages = new Map<string, string[]>()
  const queue = [ENTRY]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const ref of importsOf(readFileSync(file, 'utf8'))) {
      if (ref.typeOnly) continue
      if (ref.spec.startsWith('.')) queue.push(resolveRelative(file, ref.spec))
      else packages.set(ref.spec, [...(packages.get(ref.spec) ?? []), relative(SRC, file)])
    }
  }
  return { files: [...seen].sort(), packages }
}

describe('session core import guard', () => {
  const { files, packages } = closure()

  it('reaches the whole session module', () => {
    const rel = files.map((f) => relative(SRC, f))
    expect(rel).toContain('session/registry.ts')
    expect(rel).toContain('session/handlers/history-save.ts')
  })

  it('stays inside the slides source tree and outside Electron main-only code', () => {
    for (const file of files) {
      const rel = relative(SRC, file)
      expect(rel.startsWith('..'), rel).toBe(false)
      // Only the pure leaf helpers of main/ may be shared (strings, media sniffers)
      if (rel.startsWith('main/'))
        expect(
          [
            'main/i18n-main.ts',
            'main/media-mime.ts',
            'main/jpeg-orientation.ts',
            'main/mp4-audio-sniff.ts',
          ],
          rel,
        ).toContain(rel)
    }
  })

  it('imports no electron, no Node builtin and only allowed packages', () => {
    for (const [spec, importers] of packages) {
      const where = `${spec} (imported by ${importers.join(', ')})`
      expect(spec, where).not.toBe('electron')
      expect(NODE_BUILTINS.has(spec), where).toBe(false)
      expect(
        ALLOWED_PACKAGES.some((p) => spec === p || spec.startsWith(`${p}/`)),
        where,
      ).toBe(true)
    }
  })

  it('uses no Node globals', () => {
    for (const file of files) {
      const code = codeOnly(readFileSync(file, 'utf8'))
      for (const token of [
        /\bBuffer\b/,
        /\bprocess\./,
        /\b__dirname\b/,
        /\b__filename\b/,
        /\bsetImmediate\b/,
        /\brequire\(/,
      ])
        expect(token.test(code), `${relative(SRC, file)} uses ${token}`).toBe(false)
    }
  })
})
