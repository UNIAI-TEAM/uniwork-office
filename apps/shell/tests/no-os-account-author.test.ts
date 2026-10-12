/**
 * G8-02 (UNI-1397): the OS account name is never a comment author. Every
 * author path in the editors resolves through the shell's single source
 * (see uniwork-module-comment-author.test.ts); this guard pins the textual
 * side: no non-test file under apps/<app>/src may read the OS account —
 * `userInfo()` from node:os, or the USERNAME / LOGNAME / USER environment
 * variables. Test files (`*.test.*`, `*.spec.*`, `__tests__/`) are exempt:
 * a harness may pin the OS account name to prove it is not used.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const APPS_DIR = join(REPO_ROOT, 'apps')

/** the OS account reads an author path must never make */
const OS_ACCOUNT_READS = /\buserInfo\s*\(|\bUSERNAME\b|\bLOGNAME\b|process\.env\.USER\b/g

const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage', '__snapshots__'])
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])
const isTestFile = (path: string): boolean =>
  /(^|[\\/])__tests__[\\/]/.test(path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)

function walk(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      found.push(...walk(path))
      continue
    }
    if (SOURCE_EXTS.has(extname(entry.name))) found.push(path)
  }
  return found
}

describe('no OS account name in an apps/*/src author path', () => {
  it('userInfo() / USERNAME / LOGNAME / process.env.USER appear only in test files', () => {
    const offenders: string[] = []
    for (const app of readdirSync(APPS_DIR, { withFileTypes: true })) {
      if (!app.isDirectory()) continue
      const src = join(APPS_DIR, app.name, 'src')
      if (!existsSync(src)) continue
      for (const path of walk(src)) {
        if (isTestFile(path)) continue
        const text = readFileSync(path, 'utf8')
        for (const match of text.matchAll(OS_ACCOUNT_READS)) {
          const line = text.slice(0, match.index).split('\n').length
          offenders.push(`${relative(REPO_ROOT, path)}:${line}: ${match[0]}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
