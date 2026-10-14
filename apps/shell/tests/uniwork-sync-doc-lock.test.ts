import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDocLock, type DocLock, type DocLockFs } from '../src/main/uniwork-sync/doc-lock'
import { QUEUE_LIMITS } from '../src/main/uniwork-sync/queue/limits'
import { scopeDir } from '../src/main/uniwork-sync/store/paths'

const SCOPE = { deploymentId: 'dep_1', accountId: 'acc_1' }
const DOC = 'document-key-1'
const WINDOW_A = '100:win-a'
const WINDOW_B = '200:win-b'
const ROOT = 'C:/lock-root'
const START = 1_700_000_000_000

/** a deterministic in-memory filesystem with the same shape the layer's default has */
function memoryFs(): DocLockFs & { files: Map<string, string> } {
  const files = new Map<string, string>()
  const dirs = new Set<string>()
  return {
    files,
    async mkdir(path) {
      dirs.add(path)
    },
    async readFile(path) {
      const value = files.get(path)
      if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return value
    },
    async writeFile(path, data) {
      files.set(path, data)
    },
    async writeFileExclusive(path, data) {
      if (files.has(path)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' })
      files.set(path, data)
    },
    async syncFile() {},
    async rename(from, to) {
      const value = files.get(from)
      if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      files.delete(from)
      files.set(to, value)
    },
    async unlink(path) {
      if (!files.delete(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    },
  }
}

/** one machine: a shared fs and clock, plus a lock per window over them */
function world(): {
  fs: ReturnType<typeof memoryFs>
  now: { value: number }
  window: (owner: string) => DocLock
} {
  const fs = memoryFs()
  const now = { value: START }
  return {
    fs,
    now,
    window: (owner) =>
      createDocLock({ root: ROOT, scope: SCOPE, clock: () => now.value, fs, owner }),
  }
}

const lockDir = (root = ROOT) => join(scopeDir(root, SCOPE), 'doc-locks')
const leaseName = (docKey = DOC) =>
  `${createHash('sha256').update(docKey, 'utf8').digest('hex')}.lock`
const leasePath = (root = ROOT, docKey = DOC) => join(lockDir(root), leaseName(docKey))

describe('uniwork sync per-document lock', () => {
  it('grants the first window generation 1 and writes the lease atomically', async () => {
    const { fs, window } = world()
    const lock = window(WINDOW_A)
    expect(await lock.acquire(DOC)).toEqual({ kind: 'held', generation: 1 })
    const raw = fs.files.get(leasePath())
    expect(raw).toBeDefined()
    expect(JSON.parse(raw ?? '{}')).toEqual({ owner: WINDOW_A, generation: 1, heartbeatAt: START })
    expect(await lock.check(DOC, 1)).toBe(true)
    // no temp file survived the atomic publish
    expect([...fs.files.keys()].filter((path) => path.endsWith('.tmp'))).toEqual([])
  })

  it('refuses a second window while the first holds a fresh lease', async () => {
    const { window } = world()
    const windowA = window(WINDOW_A)
    const windowB = window(WINDOW_B)
    expect(await windowA.acquire(DOC)).toEqual({ kind: 'held', generation: 1 })
    expect(await windowB.acquire(DOC)).toEqual({ kind: 'other_window' })
    // the refused window never touches the holder's lease
    expect(await windowA.check(DOC, 1)).toBe(true)
  })

  it('lets another owner take over generation 2 after the holder stops beating for goneMs', async () => {
    const { fs, now, window } = world()
    const windowA = window(WINDOW_A)
    const windowB = window(WINDOW_B)
    expect(await windowA.acquire(DOC)).toEqual({ kind: 'held', generation: 1 })
    // the holder crashes: no heartbeat, time moves past the gone window
    now.value += QUEUE_LIMITS.goneMs + 1
    expect(await windowB.acquire(DOC)).toEqual({ kind: 'held', generation: 2 })
    // the dead window's check fails on the new generation, and its release is a no-op
    expect(await windowA.check(DOC, 1)).toBe(false)
    expect(await windowA.heartbeat(DOC, 1)).toBe(false)
    await windowA.release(DOC, 1)
    expect(JSON.parse(fs.files.get(leasePath()) ?? '{}')).toMatchObject({
      owner: WINDOW_B,
      generation: 2,
    })
  })

  it('keeps the generation when the same owner re-acquires', async () => {
    const { now, window } = world()
    const lock = window(WINDOW_A)
    expect(await lock.acquire(DOC)).toEqual({ kind: 'held', generation: 1 })
    expect(await lock.acquire(DOC)).toEqual({ kind: 'held', generation: 1 })
    now.value += 60_000
    expect(await lock.acquire(DOC)).toEqual({ kind: 'held', generation: 1 })
    expect(await lock.check(DOC, 1)).toBe(true)
  })

  it('leaves exactly one winner when two owners race the same acquire', async () => {
    const { fs, window } = world()
    const windowA = window(WINDOW_A)
    const windowB = window(WINDOW_B)
    const [a, b] = await Promise.all([windowA.acquire(DOC), windowB.acquire(DOC)])
    const held = [a, b].filter((result) => result.kind === 'held')
    expect(held).toHaveLength(1)
    expect([a, b].filter((result) => result.kind === 'other_window')).toHaveLength(1)
    const winner = held[0]
    const loser = winner === a ? windowB : windowA
    const generation = winner?.kind === 'held' ? winner.generation : 0
    expect(await loser.check(DOC, generation)).toBe(false)
    // exactly one lock file, holding the winner's lease
    expect([...fs.files.keys()]).toEqual([leasePath()])
  })

  it('names the lease by a hash and never writes the document key in plaintext', async () => {
    const { fs, window } = world()
    await window(WINDOW_A).acquire(DOC)
    const paths = [...fs.files.keys()]
    expect(paths).toEqual([leasePath()])
    expect(leaseName()).toHaveLength(64 + '.lock'.length)
    expect(leaseName()).not.toContain(DOC)
    expect(paths.join('\n')).not.toContain(DOC)
    for (const value of fs.files.values()) expect(value).not.toContain(DOC)
  })

  it('keeps a beating lease fresh past goneMs while another window is refused', async () => {
    const { now, window } = world()
    const windowA = window(WINDOW_A)
    const windowB = window(WINDOW_B)
    expect(await windowA.acquire(DOC)).toEqual({ kind: 'held', generation: 1 })
    for (let beat = 0; beat < 6; beat += 1) {
      now.value += QUEUE_LIMITS.heartbeatMs
      expect(await windowA.heartbeat(DOC, 1)).toBe(true)
    }
    expect(now.value).toBeGreaterThan(START + QUEUE_LIMITS.goneMs)
    expect(await windowB.acquire(DOC)).toEqual({ kind: 'other_window' })
  })

  it('goes read-only when a stalled holder resumes after a take-over', async () => {
    const { fs, now, window } = world()
    const windowA = window(WINDOW_A)
    const windowB = window(WINDOW_B)
    expect(await windowA.acquire(DOC)).toEqual({ kind: 'held', generation: 1 })
    // A stalls past the gone window; B takes over with a new generation
    now.value += QUEUE_LIMITS.goneMs + 1
    expect(await windowB.acquire(DOC)).toEqual({ kind: 'held', generation: 2 })
    // A resumes: every operation it tries sees the new generation and refuses
    expect(await windowA.check(DOC, 1)).toBe(false)
    expect(await windowA.heartbeat(DOC, 1)).toBe(false)
    expect(await windowA.acquire(DOC)).toEqual({ kind: 'other_window' })
    await windowA.release(DOC, 1)
    expect(JSON.parse(fs.files.get(leasePath()) ?? '{}')).toMatchObject({
      owner: WINDOW_B,
      generation: 2,
    })
    expect(await windowB.check(DOC, 2)).toBe(true)
  })

  it('releases only its own generation and deletes the lease when it holds it', async () => {
    const { fs, window } = world()
    const lock = window(WINDOW_A)
    expect(await lock.acquire(DOC)).toEqual({ kind: 'held', generation: 1 })
    // a wrong generation is not ours to delete
    await lock.release(DOC, 2)
    expect(fs.files.has(leasePath())).toBe(true)
    await lock.release(DOC, 1)
    expect(fs.files.has(leasePath())).toBe(false)
    expect(await lock.check(DOC, 1)).toBe(false)
    // releasing an already-released lock is harmless
    await lock.release(DOC, 1)
    // a new acquire starts at generation 1 again
    expect(await lock.acquire(DOC)).toEqual({ kind: 'held', generation: 1 })
  })

  it('reads a heartbeat/check of a missing lease as false', async () => {
    const { window } = world()
    const lock = window(WINDOW_A)
    expect(await lock.heartbeat(DOC, 1)).toBe(false)
    expect(await lock.check(DOC, 1)).toBe(false)
    await lock.release(DOC, 1)
  })

  it('treats a corrupt lease as stale and takes it over', async () => {
    const { fs, window } = world()
    fs.files.set(leasePath(), '{not json')
    expect(await window(WINDOW_A).acquire(DOC)).toEqual({ kind: 'held', generation: 1 })
    expect(JSON.parse(fs.files.get(leasePath()) ?? '{}')).toMatchObject({ generation: 1 })
  })

  it('leaves no lock behind on the real filesystem', async () => {
    const base = mkdtempSync(join(tmpdir(), 'uw-doc-lock-'))
    try {
      const now = { value: START }
      const lock = createDocLock({
        root: base,
        scope: SCOPE,
        clock: () => now.value,
        owner: WINDOW_A,
      })
      expect(await lock.acquire(DOC)).toEqual({ kind: 'held', generation: 1 })
      const entries = readdirSync(lockDir(base))
      expect(entries).toEqual([leaseName()])
      expect(entries.join('')).not.toContain(DOC)
      const written = JSON.parse(readFileSync(leasePath(base, DOC), 'utf8'))
      expect(written).toEqual({ owner: WINDOW_A, generation: 1, heartbeatAt: now.value })
      expect(await lock.heartbeat(DOC, 1)).toBe(true)
      await lock.release(DOC, 1)
      expect(readdirSync(lockDir(base))).toEqual([])
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
})
