import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LOCAL_BUCKET,
  WorkbenchAccounts,
  loadWorkbenchSnapshot,
  workbenchBucketOf,
  type WorkbenchLoadSource,
  type WorkbenchOwner,
} from '../src/main/workbench-accounts'
import { WorkbenchDb, resetWorkbenchDbForTests } from '../src/main/workbench-db'

function sqliteAvailable(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('node:sqlite') as typeof import('node:sqlite')
    return typeof mod.DatabaseSync === 'function'
  } catch {
    return false
  }
}

const describeSqlite = sqliteAvailable() ? describe : describe.skip

const OWNER: WorkbenchOwner = { deploymentId: 'default', accountId: 'acc-owner' }
const MEMBER: WorkbenchOwner = { deploymentId: 'default', accountId: 'acc-member' }
const CHAT = 'uniwork.my-ai.chat.v1:teacher'
const TASKS = 'uniwork.wb.tasks.teacher'

describeSqlite('workbench data per UniWork account', () => {
  const dirs: string[] = []
  const stores: WorkbenchAccounts[] = []

  afterEach(() => {
    for (const s of stores.splice(0)) s.close()
    resetWorkbenchDbForTests()
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  function userData(): string {
    const dir = mkdtempSync(join(tmpdir(), 'uw-wb-acc-'))
    dirs.push(dir)
    return dir
  }

  function open(dir: string, log: string[] = []): WorkbenchAccounts {
    const store = new WorkbenchAccounts({ userDataDir: dir, log: (line) => log.push(line) })
    stores.push(store)
    return store
  }

  /** a pre-upgrade install: the one shared database every account used */
  function seedLegacy(dir: string, keys: Record<string, string>): void {
    const legacy = new WorkbenchDb(dir)
    legacy.importKeys(keys)
    legacy.close()
  }

  it('starts on the signed-out bucket, and every account gets its own', () => {
    const store = open(userData())
    expect(store.bucket()).toBe(LOCAL_BUCKET)
    expect(workbenchBucketOf(OWNER)).not.toBe(workbenchBucketOf(MEMBER))
    expect(workbenchBucketOf(OWNER)).not.toBe(workbenchBucketOf(null))
    // same account id on another deployment is another account
    expect(workbenchBucketOf({ ...OWNER, deploymentId: 'other' })).not.toBe(
      workbenchBucketOf(OWNER),
    )
    // no account id in the bucket (it names a folder)
    expect(workbenchBucketOf(OWNER)).not.toContain('acc-owner')
  })

  it('account switch, sign-out, sign-in again: each account sees only its own data', () => {
    const dir = userData()
    const store = open(dir)

    store.setOwner(OWNER)
    const ownerBucket = store.bucket()
    store.activeDb()!.set(CHAT, '[{"id":"1","role":"user","text":"owner secret"}]')

    // sign-out: the signed-out bucket, which has none of it
    expect(store.setOwner(null)).toBe(true)
    expect(store.bucket()).toBe(LOCAL_BUCKET)
    expect(store.activeDb()!.get(CHAT)).toBeNull()
    store.activeDb()!.set(CHAT, '[{"id":"2","role":"user","text":"signed-out note"}]')

    // another account: nothing of the owner, nothing of signed-out use
    store.setOwner(MEMBER)
    expect(store.activeDb()!.loadAll()).toEqual({})
    store.activeDb()!.set(TASKS, '[{"id":"m"}]')

    // the owner signs in again: the chat is back, the member's tasks are not there
    store.setOwner(OWNER)
    expect(store.bucket()).toBe(ownerBucket)
    expect(store.activeDb()!.get(CHAT)).toContain('owner secret')
    expect(store.activeDb()!.get(TASKS)).toBeNull()

    // and the signed-out bucket kept its own data
    store.setOwner(null)
    expect(store.activeDb()!.get(CHAT)).toContain('signed-out note')

    // a restart of the app reads the same buckets
    store.close()
    const again = open(dir)
    again.setOwner(OWNER)
    expect(again.activeDb()!.get(CHAT)).toContain('owner secret')
  })

  it('refuses a call that names another bucket than the active one', () => {
    const store = open(userData())
    store.setOwner(OWNER)
    const ownerBucket = store.bucket()
    expect(store.dbFor(ownerBucket)).not.toBeNull()

    // the member signs in; a late write of the owner's renderer names the owner's bucket
    store.setOwner(MEMBER)
    expect(store.dbFor(ownerBucket)).toBeNull()
    expect(store.dbFor(LOCAL_BUCKET)).toBeNull()
    expect(store.dbFor(undefined)).toBeNull()
    expect(store.dbFor({ bucket: store.bucket() })).toBeNull()
    expect(store.dbFor(store.bucket())).not.toBeNull()
  })

  it('setOwner with the same account changes nothing and keeps the database open', () => {
    const store = open(userData())
    store.setOwner(OWNER)
    const db = store.activeDb()
    expect(store.setOwner({ ...OWNER })).toBe(false)
    expect(store.activeDb()).toBe(db)
  })

  it('pre-upgrade data goes to the first account that signs in, once, and is logged', () => {
    const dir = userData()
    seedLegacy(dir, { [CHAT]: '[{"id":"1","role":"user","text":"before upgrade"}]', [TASKS]: '[]' })
    const log: string[] = []
    const store = open(dir, log)

    // signed-out use first: the pre-upgrade data is not shown there
    expect(store.activeDb()!.get(CHAT)).toBeNull()
    expect(store.legacyPending()).toBe(false)
    expect(log).toEqual([])

    store.setOwner(OWNER)
    expect(store.activeDb()!.get(CHAT)).toContain('before upgrade')
    expect(store.activeDb()!.get(TASKS)).toBe('[]')
    expect(store.legacyPending()).toBe(true)
    expect(log).toEqual([
      '[workbench] pre-upgrade My AI and workbench data moved to account acc-owner',
    ])
    // the shared file is gone: no other account can be handed it
    expect(existsSync(join(dir, 'workbench', 'workbench.sqlite'))).toBe(false)

    // a second account gets nothing, and nothing is logged again
    store.setOwner(MEMBER)
    expect(store.activeDb()!.loadAll()).toEqual({})
    expect(store.legacyPending()).toBe(false)
    expect(log).toHaveLength(1)

    // the owner again (also after a restart): still there, not moved twice
    store.close()
    const again = open(dir, log)
    again.setOwner(OWNER)
    expect(again.activeDb()!.get(CHAT)).toContain('before upgrade')
    expect(log).toHaveLength(1)
  })

  it('the log line carries the account id only', () => {
    const dir = userData()
    seedLegacy(dir, { [CHAT]: '[{"id":"1","role":"user","text":"private words"}]' })
    const log: string[] = []
    const store = open(dir, log)
    store.setOwner({ deploymentId: 'default', accountId: 'acc-42' })
    store.activeDb()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatch(/acc-42$/)
    expect(log[0]).not.toMatch(/private|@|default/)
  })

  it('the renderer copies are pending for that account until it confirms', () => {
    const dir = userData()
    const store = open(dir)
    // a fresh install has no shared database, but the renderer may still hold copies
    store.setOwner(OWNER)
    const ownerBucket = store.bucket()
    expect(store.legacyPending(ownerBucket)).toBe(true)

    // another bucket cannot confirm (or read) it
    store.markLegacyRendererDone(LOCAL_BUCKET)
    expect(store.legacyPending(ownerBucket)).toBe(true)
    store.setOwner(MEMBER)
    store.markLegacyRendererDone(ownerBucket)
    expect(store.legacyPending()).toBe(false)

    store.setOwner(OWNER)
    expect(store.legacyPending(ownerBucket)).toBe(true)
    store.markLegacyRendererDone(ownerBucket)
    expect(store.legacyPending(ownerBucket)).toBe(false)
    const marker = JSON.parse(readFileSync(join(dir, 'workbench', 'legacy-migration.json'), 'utf8'))
    expect(marker).toMatchObject({ version: 1, to: ownerBucket, rendererDone: true })
  })

  it('keeps account folders free of account ids', () => {
    const dir = userData()
    const store = open(dir)
    store.setOwner(OWNER)
    store.activeDb()
    expect(readdirSync(join(dir, 'workbench', 'accounts'))).toEqual([workbenchBucketOf(OWNER)])
  })

  it('a fresh install logs no move: nothing was there to move', () => {
    const dir = userData()
    const log: string[] = []
    const store = open(dir, log)
    store.setOwner(OWNER)
    store.activeDb()
    // the marker still records the first account (the renderer may hold copies)
    expect(store.legacyPending()).toBe(true)
    expect(log).toEqual([])
  })

  it('logs a shared pre-upgrade file that could not be removed', () => {
    const dir = userData()
    seedLegacy(dir, { [CHAT]: '[]' })
    const log: string[] = []
    const store = new WorkbenchAccounts({
      userDataDir: dir,
      log: (line) => log.push(line),
      unlink: (path) => {
        // the -wal / -shm side files may simply not exist
        if (path.endsWith('workbench.sqlite')) {
          // a real fs error message carries the absolute path (and the OS user name)
          const busy = new Error(
            `EBUSY: resource busy or locked, unlink '${path}'`,
          ) as NodeJS.ErrnoException
          busy.code = 'EBUSY'
          throw busy
        }
        const err = new Error('ENOENT') as NodeJS.ErrnoException
        err.code = 'ENOENT'
        throw err
      },
    })
    stores.push(store)
    store.setOwner(OWNER)
    expect(store.activeDb()!.get(CHAT)).toBe('[]')
    expect(log).toHaveLength(2)
    expect(log[0]).toMatch(
      /could not remove the pre-upgrade database file workbench\.sqlite: EBUSY$/,
    )
    expect(log[0]).not.toContain(dir)
    expect(log[0]).not.toContain('resource busy')
    expect(log[1]).toMatch(/moved to account acc-owner$/)
  })
})

describe('first account status after start', () => {
  it('holds loads until the first owner is applied, so a signed-in launch never opens the signed-out bucket', async () => {
    const store = new WorkbenchAccounts({ userDataDir: join(tmpdir(), 'uw-wb-settle-unused') })
    let released = false
    const waiting = store.whenSettled().then(() => (released = true))
    await Promise.resolve()
    expect(released).toBe(false)
    expect(store.bucket()).toBe(LOCAL_BUCKET)

    // the restore applied the stored session's account
    store.setOwner(OWNER)
    await waiting
    expect(store.bucket()).toBe(workbenchBucketOf(OWNER))
    // later calls do not wait
    await store.whenSettled()
  })

  it('a signed-out first owner settles too, and a stuck start is not waited for forever', async () => {
    const signedOut = new WorkbenchAccounts({ userDataDir: join(tmpdir(), 'uw-wb-settle-unused') })
    signedOut.setOwner(null)
    await signedOut.whenSettled(60_000)

    const stuck = new WorkbenchAccounts({ userDataDir: join(tmpdir(), 'uw-wb-settle-unused') })
    const started = Date.now()
    await stuck.whenSettled(20)
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(stuck.bucket()).toBe(LOCAL_BUCKET)
  })
})

describe('wbLoadAll: the first read waits for the first account status', () => {
  /** a store whose bucket only becomes the account's once the owner is applied */
  function fakeSource(): {
    source: WorkbenchLoadSource
    settle: () => void
    calls: string[]
  } {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const calls: string[] = []
    let bucket = LOCAL_BUCKET
    const source: WorkbenchLoadSource = {
      whenSettled: () => gate.then(() => void calls.push('settled')),
      bucket: () => bucket,
      activeDb: () => {
        calls.push(`open:${bucket}`)
        return { dbPath: `/db/${bucket}`, loadAll: () => ({ k: bucket }) }
      },
      legacyPending: () => false,
    }
    return {
      source,
      calls,
      settle: () => {
        bucket = 'a-owner'
        release()
      },
    }
  }

  it('does not apply the owner, read the bucket or open a database before it settled', async () => {
    const { source, settle, calls } = fakeSource()
    const syncOwner = vi.fn(() => void calls.push('sync'))
    const load = loadWorkbenchSnapshot(source, syncOwner)
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(syncOwner).not.toHaveBeenCalled()
    expect(calls).toEqual([])

    settle()
    const snap = await load
    expect(calls).toEqual(['settled', 'sync', 'open:a-owner'])
    expect(snap).toMatchObject({ bucket: 'a-owner', keys: { k: 'a-owner' }, keyCount: 1 })
    // never the signed-out bucket on the way
    expect(calls).not.toContain(`open:${LOCAL_BUCKET}`)
  })

  it('reports an unavailable store and a failed read as unavailable, with the bucket that was asked for', async () => {
    const none: WorkbenchLoadSource = {
      whenSettled: async () => undefined,
      bucket: () => 'a-owner',
      activeDb: () => null,
      legacyPending: () => true,
    }
    expect(await loadWorkbenchSnapshot(none, () => undefined)).toEqual({
      keys: {},
      keyCount: 0,
      dbPath: '',
      bucket: 'a-owner',
      legacyPending: true,
      unavailable: true,
    })

    const broken: WorkbenchLoadSource = {
      ...none,
      activeDb: () => ({
        dbPath: '',
        loadAll: () => {
          throw Object.assign(new Error('disk error at C:\\Users\\someone\\wb.sqlite'), {
            code: 'ERR_SQLITE_ERROR',
          })
        },
      }),
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(await loadWorkbenchSnapshot(broken, () => undefined)).toMatchObject({
        bucket: 'a-owner',
        legacyPending: false,
        unavailable: true,
      })
      // the error code is logged; the message (with its path) and the error object are not
      expect(error).toHaveBeenCalledTimes(1)
      expect(error.mock.calls[0]).toEqual(['[workbench-db] loadAll failed: ERR_SQLITE_ERROR'])
    } finally {
      error.mockRestore()
    }
  })
})
