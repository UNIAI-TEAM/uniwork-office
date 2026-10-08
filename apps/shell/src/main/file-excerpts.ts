import { existsSync, statSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { parseFileToText } from '@genoffice/file-parse'
import { readRecentFiles, readStarredFiles } from '../../../docs/src/main/docs-main'
import {
  FILE_EXCERPT_MAX_BYTES,
  FILE_EXCERPT_MAX_CHARS,
  FILE_EXCERPT_MAX_FILES,
  clipExcerpt,
  type FileExcerpt,
} from '../shared/file-excerpt'

function allowedPathSet(): Set<string> {
  const set = new Set<string>()
  for (const p of [...readRecentFiles(), ...readStarredFiles()]) {
    try {
      set.add(resolve(p))
    } catch {
      /* skip */
    }
  }
  return set
}

function uniquePaths(raw: unknown, limit: number): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string' || !item.trim()) continue
    const path = item.trim()
    if (seen.has(path)) continue
    seen.add(path)
    out.push(path)
    if (out.length >= limit) break
  }
  return out
}

export async function extractAllowedFileExcerpts(
  rawPaths: unknown,
  extraAllowed: readonly string[] = [],
): Promise<FileExcerpt[]> {
  const allowed = allowedPathSet()
  for (const p of extraAllowed) {
    try {
      allowed.add(resolve(p))
    } catch {
      /* skip */
    }
  }
  const paths = uniquePaths(rawPaths, FILE_EXCERPT_MAX_FILES)
  const results: FileExcerpt[] = []

  for (const path of paths) {
    const name = basename(path)
    const ext = extname(path).slice(1).toLowerCase()
    let resolved: string
    try {
      resolved = resolve(path)
    } catch {
      results.push({ path, name, ext, status: 'skipped', error: 'invalid-path' })
      continue
    }
    if (!allowed.has(resolved) || !existsSync(resolved)) {
      results.push({ path, name, ext, status: 'skipped', error: 'not-in-recents' })
      continue
    }

    let size = 0
    try {
      size = statSync(resolved).size
    } catch {
      results.push({ path, name, ext, status: 'error', error: 'stat-failed' })
      continue
    }
    if (size > FILE_EXCERPT_MAX_BYTES) {
      results.push({ path, name, ext, status: 'too_large' })
      continue
    }

    try {
      const parsed = await parseFileToText(resolved)
      if (!parsed.ok) {
        results.push({
          path,
          name,
          ext,
          status: parsed.kind === 'unsupported' ? 'unsupported' : 'error',
          error: parsed.error,
        })
        continue
      }
      if (parsed.kind !== 'text' || !parsed.text?.trim()) {
        results.push({
          path,
          name,
          ext,
          status: parsed.kind === 'image' ? 'unsupported' : 'error',
          error: parsed.kind === 'image' ? 'image' : 'empty',
        })
        continue
      }
      const excerpt = clipExcerpt(parsed.text, FILE_EXCERPT_MAX_CHARS)
      results.push({
        path,
        name,
        ext,
        status: 'ok',
        excerpt,
        charCount: excerpt.length,
      })
    } catch (err) {
      results.push({
        path,
        name,
        ext,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return results
}
