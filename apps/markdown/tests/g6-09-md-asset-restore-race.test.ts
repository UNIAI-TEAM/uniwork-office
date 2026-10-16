// @vitest-environment node
// RBG3-1: a redo that lands while the undo's discard is still running must never report a picture
// as restored while leaving it deleted — the redone markup would point at a file that is gone.
// The discard holds the manifest lock for its whole body (its unlink included), so the restore has
// to run inside that same lock/queue: either fully before or fully after the unlink.
// The interleaving below is driven by an fs stub, never by timing: the discard's unlink waits at a
// gate, and the gate opens once the restore has read the asset for its own "same bytes" checks —
// the exact window the reviewer reproduced by hand.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  discardPendingOwnedAssetNames,
  readOwnedAssetManifest,
  restoreOwnedAssetFiles,
  writeImageIntoOwnedAssets,
} from '../src/main/asset-lifecycle'

const race = vi.hoisted(() => {
  const gate = (): { promise: Promise<void>; resolve: () => void } => {
    let resolve!: () => void
    const promise = new Promise<void>((opened) => {
      resolve = opened
    })
    return { promise, resolve }
  }
  return {
    /** absolute path whose unlink waits until `openUnlink` is resolved (empty = nothing held) */
    heldUnlink: '',
    unlinkReached: gate(),
    openUnlink: gate(),
    /** absolute path whose `readsToWait`-th read resolves `readsSeen` (empty = nothing watched) */
    watchedRead: '',
    readsToWait: 0,
    readsSeen: gate(),
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rm: async (path: Parameters<typeof actual.rm>[0], options?: Parameters<typeof actual.rm>[1]) => {
      if (race.heldUnlink !== '' && String(path) === race.heldUnlink) {
        race.heldUnlink = ''
        race.unlinkReached.resolve()
        await race.openUnlink.promise
      }
      return actual.rm(path, options)
    },
    readFile: async (
      path: Parameters<typeof actual.readFile>[0],
      options?: Parameters<typeof actual.readFile>[1],
    ) => {
      const content = await actual.readFile(path, options)
      if (race.watchedRead !== '' && String(path) === race.watchedRead) {
        race.readsToWait -= 1
        if (race.readsToWait <= 0) {
          race.watchedRead = ''
          race.readsSeen.resolve()
        }
      }
      return content
    },
  }
})

const dirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'markdown-assets-restore-race-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})
const b64 = (text: string): string => Buffer.from(text).toString('base64')
const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

/**
 * Bounded event-loop turns (no wall-clock sleep): enough for an unblocked operation to reach its
 * own waiting point, while an operation queued behind the held manifest lock stays put.
 */
async function eventLoopTurns(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

describe('a redo while the undo’s discard is still running', () => {
  it('never reports a picture restored while leaving it deleted', async () => {
    const dir = await tempDir()
    const doc = join(dir, 'note.md')
    const asset = join(dir, 'assets', 'pic.png')
    await writeImageIntoOwnedAssets(doc, 'pic.png', Buffer.from('bytes-1'))

    race.heldUnlink = asset
    const discard = discardPendingOwnedAssetNames(doc, ['pic.png'])
    // the discard is now inside the manifest lock, held just before its unlink
    await race.unlinkReached.promise
    expect(existsSync(asset)).toBe(true)

    // the restore's two reads of the asset: its "same bytes" check and the hash it records
    race.watchedRead = asset
    race.readsToWait = 2
    const restore = restoreOwnedAssetFiles(doc, [{ name: 'pic.png', base64: b64('bytes-1') }])
    // pre-fix the restore reads outside the lock, so this resolves at its second read; the fixed
    // restore queues behind the discard's lock and the bounded turns release the unlink instead
    await Promise.race([race.readsSeen.promise, eventLoopTurns(1000)])
    race.openUnlink.resolve()

    const [discarded, restored] = await Promise.all([discard, restore])

    expect(discarded.deleted).toEqual(['pic.png'])
    expect(restored.restored).toEqual(['pic.png'])
    expect(restored.errors).toEqual([])
    // whatever the redo just re-applied its markup to must really be on disk with the run's bytes
    expect(existsSync(asset)).toBe(true)
    expect(await readFile(asset, 'utf8')).toBe('bytes-1')
    const manifest = await readOwnedAssetManifest(doc)
    expect(manifest?.files).toContainEqual({ name: 'pic.png', sha256: sha('bytes-1') })
    expect(manifest?.pending).toMatchObject({ 'note.md': ['pic.png'] })
  })
})
