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
  /** one entry per low-level write: the most bytes it accepts, or the error it throws */
  writePlan: [] as Array<number | NodeJS.ErrnoException>,
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
    writeSync: (...args: Parameters<typeof actual.writeSync>) => {
      const step = hooks.writePlan.shift()
      if (step instanceof Error) throw step
      if (step === undefined) return actual.writeSync(...args)
      const [fd, raw, offset, length] = args as [
        number,
        Buffer | string,
        number | undefined,
        number | undefined,
      ]
      // a string payload is one write of its whole encoding, as a caller that ignores the count sees it
      const data = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw
      const start = typeof raw === 'string' ? 0 : (offset ?? 0)
      const wanted = typeof raw === 'string' ? data.byteLength : (length ?? data.byteLength - start)
      return actual.writeSync(fd, data, start, Math.min(step, wanted))
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
  hooks.writePlan = []
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

  // EL-1(b) fix11 (EL1B-BE-R3C-3/4/5/6): a short write is completed before the flush and the rename
  it('completes a short write: the published owner is the whole record', () => {
    hooks.writePlan = [7, 5]
    expect(store.writeLastOwner(NEW)).toBe(true)
    expect(readFileSync(join(root, 'last-account.json'), 'utf8')).toBe(`${JSON.stringify(NEW)}
`)
    expect(store.readLastOwner()).toEqual(NEW)
    expect(leftovers()).toEqual([])
  })

  it('a short write followed by a failure keeps the old file, removes the temp file and stays retryable', () => {
    hooks.writePlan = [7, errno('ENOSPC')]
    expect(store.writeLastOwner(NEW)).toBe(false)
    expect(hooks.renames).toBe(0)
    expect(store.readLastOwner()).toEqual(OLD)
    expect(leftovers()).toEqual([])
    // the next attempt, on a recovered disk, publishes it
    expect(store.writeLastOwner(NEW)).toBe(true)
    expect(store.readLastOwner()).toEqual(NEW)
  })

  it('a write that makes no progress fails instead of spinning or publishing a prefix', () => {
    hooks.writePlan = [7, 0]
    expect(store.writeLastOwner(NEW)).toBe(false)
    expect(hooks.renames).toBe(0)
    expect(store.readLastOwner()).toEqual(OLD)
    expect(leftovers()).toEqual([])
  })
})
