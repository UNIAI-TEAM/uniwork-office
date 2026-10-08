import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  WorkbenchDb,
  isAllowedWbKey,
  resetWorkbenchDbForTests,
} from '../src/main/workbench-db'

function sqliteAvailable(): boolean {
  try {
    // Prefer the same loader the app uses (CJS require of the built-in).
    // Node < 22 does not ship node:sqlite.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('node:sqlite') as typeof import('node:sqlite')
    return typeof mod.DatabaseSync === 'function'
  } catch {
    return false
  }
}

const describeSqlite = sqliteAvailable() ? describe : describe.skip

describeSqlite('workbench-db', () => {
  const dirs: string[] = []

  afterEach(() => {
    resetWorkbenchDbForTests()
    for (const d of dirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  })

  function tempDb(): WorkbenchDb {
    const dir = mkdtempSync(join(tmpdir(), 'uw-wb-db-'))
    dirs.push(dir)
    return new WorkbenchDb(dir)
  }

  it('round-trips kv and persists across reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'uw-wb-db-'))
    dirs.push(dir)
    const a = new WorkbenchDb(dir)
    a.set('uniwork.wb.tasks.teacher', JSON.stringify([{ id: '1' }]))
    a.set('uniwork.wb.calendar.view', 'month')
    expect(a.keyCount()).toBe(2)
    a.close()
    resetWorkbenchDbForTests()

    const b = new WorkbenchDb(dir)
    expect(b.get('uniwork.wb.calendar.view')).toBe('month')
    expect(JSON.parse(b.get('uniwork.wb.tasks.teacher')!)).toEqual([{ id: '1' }])
    b.close()
  })

  it('importKeys skips disallowed keys and replaceAll clears previous', () => {
    const db = tempDb()
    db.set('uniwork.wb.keep', 'old')
    const n = db.importKeys({
      'uniwork.wb.a': '1',
      'not.allowed': 'x',
      'uniwork.wb.b': '2',
    })
    expect(n).toBe(2)
    expect(db.get('uniwork.wb.a')).toBe('1')
    expect(db.get('not.allowed')).toBeNull()

    const replaced = db.replaceAll({ 'uniwork.wb.only': 'yes' })
    expect(replaced).toBe(1)
    expect(db.get('uniwork.wb.a')).toBeNull()
    expect(db.get('uniwork.wb.only')).toBe('yes')
    expect(db.loadAll()).toEqual({ 'uniwork.wb.only': 'yes' })
  })

  it('remove deletes a key', () => {
    const db = tempDb()
    db.set('uniwork.wb.x', '1')
    db.remove('uniwork.wb.x')
    expect(db.get('uniwork.wb.x')).toBeNull()
    expect(db.keyCount()).toBe(0)
  })
})

describe('workbench-db allowlist', () => {
  it('allows workbench / my-ai key prefixes', () => {
    expect(isAllowedWbKey('uniwork.wb.calendar.teacher')).toBe(true)
    expect(isAllowedWbKey('uniwork.my-ai.history.teacher')).toBe(true)
    expect(isAllowedWbKey('uniwork.ai.usage.v1')).toBe(true)
    expect(isAllowedWbKey('uniwork.activePracticeId')).toBe(true)
    expect(isAllowedWbKey('evil.other')).toBe(false)
  })
})
