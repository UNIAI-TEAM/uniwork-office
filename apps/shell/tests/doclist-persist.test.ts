import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DOCLIST_GROUPS_KEY,
  DOCLIST_SORT_KEY,
  readCollapsedGroups,
  readSort,
  toggleGroup,
  writeCollapsedGroups,
  writeSort,
} from '../src/renderer/src/doclist/persist'
import { setCurrentWorkbenchBucket } from '../src/renderer/src/workbench-bucket'

// runs against the real Workbench store client in its no-main-process mode
// (localStorage under the bucket name), like the other renderer store tests

let map: Map<string, string>
let failing: { get: boolean; set: boolean }

function installStorage(): void {
  map = new Map()
  failing = { get: false, set: false }
  const ls = {
    getItem: (k: string) => {
      if (failing.get) throw new Error('blocked')
      return map.has(k) ? map.get(k)! : null
    },
    setItem: (k: string, v: string) => {
      if (failing.set) throw new Error('quota')
      map.set(k, String(v))
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true })
}

beforeEach(() => {
  setCurrentWorkbenchBucket('')
  installStorage()
})
afterEach(() => {
  setCurrentWorkbenchBucket('')
})

describe('store keys', () => {
  it('are the Workbench keys uniwork.wb.doclist.{sort,groups}', () => {
    expect(DOCLIST_SORT_KEY).toBe('uniwork.wb.doclist.sort')
    expect(DOCLIST_GROUPS_KEY).toBe('uniwork.wb.doclist.groups')
  })
})

describe('sort per screen', () => {
  it('has nothing stored by default, so the screen falls back to its default sort', () => {
    expect(readSort('recent')).toBeNull()
  })

  it('round-trips one screen without touching another', () => {
    writeSort('recent', { column: 'name', dir: 'asc' })
    writeSort('trash', { column: 'updated', dir: 'desc' })
    expect(readSort('recent')).toEqual({ column: 'name', dir: 'asc' })
    expect(readSort('trash')).toEqual({ column: 'updated', dir: 'desc' })
    expect(readSort('workspace')).toBeNull()
    expect(JSON.parse(map.get(DOCLIST_SORT_KEY)!)).toEqual({
      recent: { column: 'name', dir: 'asc' },
      trash: { column: 'updated', dir: 'desc' },
    })
  })

  it('is kept per account: another bucket sees its own sort', () => {
    setCurrentWorkbenchBucket('acct-a')
    writeSort('recent', { column: 'size', dir: 'desc' })
    setCurrentWorkbenchBucket('acct-b')
    expect(readSort('recent')).toBeNull()
    setCurrentWorkbenchBucket('acct-a')
    expect(readSort('recent')).toEqual({ column: 'size', dir: 'desc' })
  })

  it('drops values it does not know: a column the screen cannot sort, a direction, a screen', () => {
    map.set(
      DOCLIST_SORT_KEY,
      JSON.stringify({
        recent: { column: 'access', dir: 'asc' },
        shared: { column: 'shared', dir: 'sideways' },
        trash: { column: 'deleted', dir: 'asc' },
        workspace: { column: 'activity', dir: 'desc' },
        mystery: { column: 'name', dir: 'asc' },
        starred: 'name',
      }),
    )
    expect(readSort('recent')).toBeNull()
    expect(readSort('shared')).toBeNull()
    expect(readSort('trash')).toEqual({ column: 'deleted', dir: 'asc' })
    expect(readSort('workspace')).toBeNull()
    expect(readSort('starred')).toBeNull()
  })

  it('a write cleans the stored unknowns away', () => {
    map.set(DOCLIST_SORT_KEY, JSON.stringify({ mystery: { column: 'name', dir: 'asc' } }))
    writeSort('recent', { column: 'name', dir: 'asc' })
    expect(JSON.parse(map.get(DOCLIST_SORT_KEY)!)).toEqual({
      recent: { column: 'name', dir: 'asc' },
    })
  })

  it.each(['not json', '[]', '"x"', '7', 'null', '{"recent":null}'])(
    'a broken value (%s) reads as nothing and a write replaces it',
    (raw) => {
      map.set(DOCLIST_SORT_KEY, raw)
      expect(readSort('recent')).toBeNull()
      writeSort('recent', { column: 'name', dir: 'asc' })
      expect(readSort('recent')).toEqual({ column: 'name', dir: 'asc' })
    },
  )
})

describe('collapsed groups per screen', () => {
  it('has none collapsed by default', () => {
    expect(readCollapsedGroups('recent')).toEqual([])
  })

  it('round-trips and toggles', () => {
    writeCollapsedGroups('recent', ['earlier'])
    expect(readCollapsedGroups('recent')).toEqual(['earlier'])
    expect(toggleGroup('recent', 'today')).toEqual(['earlier', 'today'])
    expect(toggleGroup('recent', 'earlier')).toEqual(['today'])
    expect(readCollapsedGroups('recent')).toEqual(['today'])
    expect(readCollapsedGroups('trash')).toEqual([])
  })

  it('stores the web shape {"<screen>":["<groupId>"]}', () => {
    writeCollapsedGroups('trash', ['more_than_7_days'])
    expect(JSON.parse(map.get(DOCLIST_GROUPS_KEY)!)).toEqual({ trash: ['more_than_7_days'] })
  })

  it('drops group ids the screen does not have, and repeats', () => {
    map.set(
      DOCLIST_GROUPS_KEY,
      JSON.stringify({
        recent: ['today', 'deleting_soon', 'today', 7, null, 'yesterday'],
        workspace: ['today'],
        shared: 'earlier',
      }),
    )
    expect(readCollapsedGroups('recent')).toEqual(['today', 'yesterday'])
    expect(readCollapsedGroups('workspace')).toEqual([])
    expect(readCollapsedGroups('shared')).toEqual([])
  })

  it('an empty list is stored as no entry for the screen', () => {
    writeCollapsedGroups('recent', ['today'])
    writeCollapsedGroups('recent', [])
    expect(JSON.parse(map.get(DOCLIST_GROUPS_KEY)!)).toEqual({})
  })
})

describe('a broken store still renders', () => {
  it('reads as defaults when the store throws on read', () => {
    writeSort('recent', { column: 'name', dir: 'asc' })
    failing.get = true
    expect(readSort('recent')).toBeNull()
    expect(readCollapsedGroups('recent')).toEqual([])
    expect(toggleGroup('recent', 'today')).toEqual(['today'])
  })

  it('a write that fails does not throw', () => {
    failing.set = true
    expect(() => writeSort('recent', { column: 'name', dir: 'asc' })).not.toThrow()
    expect(() => writeCollapsedGroups('recent', ['today'])).not.toThrow()
    expect(() => toggleGroup('recent', 'today')).not.toThrow()
  })
})
