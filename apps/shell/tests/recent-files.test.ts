import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  capStatPaths,
  enrichWithUniwork,
  matchesExtFamily,
  normalizeRecentQuery,
  pageStarredPaths,
  type RecentUniworkLookup,
  STAT_PATHS_MAX,
} from '../src/main/recent-files'

describe('matchesExtFamily', () => {
  it('maps sidebar filter keys onto their extension families', () => {
    expect(matchesExtFamily('doc', 'docx')).toBe(true)
    expect(matchesExtFamily('docx', 'docx')).toBe(true)
    expect(matchesExtFamily('ppt', 'pptx')).toBe(true)
    expect(matchesExtFamily('pptx', 'pptx')).toBe(true)
    expect(matchesExtFamily('markdown', 'md')).toBe(true)
    expect(matchesExtFamily('md', 'md')).toBe(true)
    // the text app opens txt/json as source, so the sidebar "md" filter has to
    // page them in the way Home's own filter families already do
    expect(matchesExtFamily('txt', 'md')).toBe(true)
    expect(matchesExtFamily('json', 'md')).toBe(true)
    expect(matchesExtFamily('csv', 'xlsx')).toBe(true)
    expect(matchesExtFamily('htm', 'html')).toBe(true)
  })

  it('still matches exact extensions and rejects outsiders', () => {
    expect(matchesExtFamily('pdf', 'pdf')).toBe(true)
    expect(matchesExtFamily('xlsx', 'docx')).toBe(false)
    expect(matchesExtFamily('png', 'xlsx')).toBe(false)
    expect(matchesExtFamily('png', 'md')).toBe(false)
  })
})

/**
 * The three filter-family tables — the sidebar's EXT_FAMILY here, Home's
 * FILTER_FAMILY and the shell's SEARCH_EXT_FAMILY — are three copies of one
 * list. They drifted once already (the sidebar's "md" filter was still
 * markdown-only after Home's and the search side had learned .txt/.json), and
 * a filter that means different things in two views of the same file list is
 * its own bug, so the agreement is pinned rather than left to review.
 */
describe('sidebar filter families agree with the other two', () => {
  const FAMILIES: ReadonlyArray<readonly [string, Record<string, readonly string[]>]> = [
    ['Home', { md: ['md', 'markdown', 'txt', 'json'] }],
    ['search', { md: ['md', 'markdown', 'txt', 'json'] }],
  ]

  it.each(FAMILIES)('matches the %s family for the text app', (_name, family) => {
    for (const ext of family.md!) expect(matchesExtFamily(ext, 'md')).toBe(true)
  })
})

describe('normalizeRecentQuery', () => {
  it('defaults offset/limit and normalizes the extension key', () => {
    expect(normalizeRecentQuery({ ext: '.XLSX ' })).toEqual({ offset: 0, limit: 50, ext: 'xlsx' })
    expect(normalizeRecentQuery({ offset: 3, limit: 500 })).toEqual({
      offset: 3,
      limit: 200,
    })
  })
})

describe('capStatPaths', () => {
  const paths = (n: number) => Array.from({ length: n }, (_, i) => `/f${i}.docx`)

  it('leaves a list at the cap untouched', () => {
    expect(capStatPaths(paths(0))).toEqual([])
    expect(capStatPaths(paths(STAT_PATHS_MAX - 1))).toHaveLength(STAT_PATHS_MAX - 1)
    expect(capStatPaths(paths(STAT_PATHS_MAX))).toHaveLength(STAT_PATHS_MAX)
  })

  it('truncates past the cap, keeping the first paths in order', () => {
    const capped = capStatPaths(paths(STAT_PATHS_MAX + 500))
    expect(capped).toHaveLength(STAT_PATHS_MAX)
    expect(capped[0]).toBe('/f0.docx')
    expect(capped.at(-1)).toBe(`/f${STAT_PATHS_MAX - 1}.docx`)
  })
})

describe('starred and search lists follow the UniWork lookup like recents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recent-uniwork-'))
  const make = (name: string, mtime: number): string => {
    const path = join(dir, name)
    writeFileSync(path, 'x')
    utimesSync(path, mtime, mtime)
    return path
  }
  const local = make('local.docx', 300)
  const mine = make('mine.docx', 200)
  const other = make('other.docx', 100)
  const source = {
    documentId: 'doc-1',
    workspaceId: 'ws-1',
    title: 'Mine',
    access: 'edit' as const,
  }
  const lookup: RecentUniworkLookup = (p) => (p === mine ? source : p === other ? 'hidden' : null)

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('hides another account copy and enriches a bound one in starred', () => {
    const page = pageStarredPaths([other, mine, local], {}, lookup)
    expect(page.entries.map((e) => e.path)).toEqual([local, mine])
    expect(page.entries.find((e) => e.path === mine)?.uniwork).toEqual(source)
    expect(page.entries.find((e) => e.path === local)?.uniwork).toBeUndefined()
    expect(page.total).toBe(2)
    expect(page.totalAll).toBe(2)
  })

  it('keeps starred untouched without a lookup', () => {
    const page = pageStarredPaths([other, mine, local], {})
    expect(page.entries).toHaveLength(3)
    expect(page.entries.every((e) => e.uniwork === undefined)).toBe(true)
  })

  it('filters and enriches search hits', () => {
    const hit = (path: string) => ({ path, name: path, snippet: null, needles: [] })
    const out = enrichWithUniwork([hit(other), hit(mine), hit(local)], lookup)
    expect(out.map((h) => h.path)).toEqual([mine, local])
    expect(out[0].uniwork).toEqual(source)
    expect(out[1].uniwork).toBeUndefined()
  })
})
