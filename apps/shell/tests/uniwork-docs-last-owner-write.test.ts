import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BindingStore } from '../src/main/uniwork-docs/binding-store'

/**
 * EL-1(b) fix10 (EL1B-BE-R3-8/9/10/11/12): the synchronous last-account.json
 * writer keeps the old atomicWriteFile guarantees - bounded retry of a
 * transient Windows rename error, file fsync before the rename, directory
 * fsync (non-Windows) after it with the old tolerated-error policy, the
 * previous destination intact and no temp file on a permanent failure - and
 * reports whether the owner reached the disk so a failed write stays retryable.
 */
const hooks = vi.hoisted(() => ({
  renameErrors: [] as NodeJS.ErrnoException[],
  renames: 0,
  fsyncErrors: [] as NodeJS.ErrnoException[],
  events: [] as string[],
  /** Windows cannot open a directory: stand a plain file in for it when a POSIX host is simulated */
  dir: '',
}))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      hooks.renames += 1
      hooks.events.push('rename')
      const error = hooks.renameErrors.shift()
      if (error) throw error
      return actual.renameSync(...args)
    },
    fsyncSync: (fd: number) => {
      hooks.events.push('fsync')
      const error = hooks.fsyncErrors.shift()
      if (error) throw error
      return actual.fsyncSync(fd)
    },
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      hooks.events.push(`open:${String(args[1])}`)
      if (hooks.dir && String(args[0]) === hooks.dir) {
        return actual.openSync(join(hooks.dir, 'last-account.json'), 'r')
      }
      return actual.openSync(...args)
    },
  }
})

const errno = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(code), { code }) as NodeJS.ErrnoException

const OLD = { accountId: 'acc_1', deploymentId: 'default' }
const NEW = { accountId: 'acc_2', deploymentId: 'default' }

let root: string
let store: BindingStore
const platform = process.platform
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'uw-last-owner-'))
  store = new BindingStore(root)
  writeFileSync(join(root, 'last-account.json'), `${JSON.stringify(OLD)}\n`)
  hooks.renameErrors = []
  hooks.fsyncErrors = []
  hooks.renames = 0
  hooks.events = []
  hooks.dir = ''
})
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: platform })
  rmSync(root, { recursive: true, force: true })
})

const leftovers = () => readdirSync(root).filter((name) => name.endsWith('.tmp'))

describe('BindingStore.writeLastOwner (EL-1(b) fix10)', () => {
  it('one transient rename failure is retried and the new owner persists', () => {
    hooks.renameErrors = [errno('EPERM')]
    expect(store.writeLastOwner(NEW)).toBe(true)
    expect(hooks.renames).toBe(2)
    expect(store.readLastOwner()).toEqual(NEW)
    expect(leftovers()).toEqual([])
  })

  it('a permanent transient-class failure gives up after a bounded number of attempts and keeps the old file', () => {
    hooks.renameErrors = Array.from({ length: 20 }, () => errno('EBUSY'))
    expect(store.writeLastOwner(NEW)).toBe(false)
    expect(hooks.renames).toBe(5)
    expect(store.readLastOwner()).toEqual(OLD)
    expect(leftovers()).toEqual([])
  })

  it('a non-retryable rename error is not retried, keeps the old file and removes the temp file', () => {
    hooks.renameErrors = [errno('ENOSPC')]
    expect(store.writeLastOwner(NEW)).toBe(false)
    expect(hooks.renames).toBe(1)
    expect(store.readLastOwner()).toEqual(OLD)
    expect(leftovers()).toEqual([])
  })

  it('flushes the file before the rename and, off Windows, the directory after it', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    hooks.dir = root
    expect(store.writeLastOwner(NEW)).toBe(true)
    const rename = hooks.events.indexOf('rename')
    expect(hooks.events.slice(0, rename)).toContain('fsync')
    expect(hooks.events.slice(rename)).toEqual(['rename', 'open:r', 'fsync'])
  })

  it('does not open the directory on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    expect(store.writeLastOwner(NEW)).toBe(true)
    expect(hooks.events.slice(hooks.events.indexOf('rename'))).toEqual(['rename'])
  })

  it('tolerates a refused flush (cloud-sync folder) but fails on a real I/O error, keeping the old file', () => {
    hooks.fsyncErrors = [errno('EINVAL')]
    expect(store.writeLastOwner(NEW)).toBe(true)
    expect(store.readLastOwner()).toEqual(NEW)

    hooks.fsyncErrors = [errno('EIO')]
    expect(store.writeLastOwner(OLD)).toBe(false)
    expect(store.readLastOwner()).toEqual(NEW)
    expect(existsSync(join(root, 'last-account.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(root, 'last-account.json'), 'utf8'))).toEqual(NEW)
    expect(leftovers()).toEqual([])
  })
})
