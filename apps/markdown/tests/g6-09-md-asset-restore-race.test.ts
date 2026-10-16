// @vitest-environment node
// RBG3-1: a redo that lands while the undo's discard is still running must never report a picture
// as restored while leaving it deleted — the redone markup would point at a file that is gone.
// The discard holds the manifest lock for its whole body (its unlink included), so the restore has
// to run inside that same lock/queue: either fully before or fully after the unlink.
// RBG4-1: one restore call carries several pictures, so the lock has to be held for the whole
// CALL, not per name: a discard slipping in between two names would delete a picture the call had
// already put back and still be answered with `restored: [a, b], errors: []`.
// The interleavings below are driven by an fs stub, never by timing: a read or an unlink waits at
// a gate, and the gate opens on a bounded event-loop turn — the exact windows the reviewer
// reproduced by hand.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ASSET_MANIFEST_FILENAME,
  discardPendingOwnedAssetNames,
  discardPendingOwnedAssets,
  readOwnedAssetManifest,
  restoreOwnedAssetFiles,
  writeImageIntoOwnedAssets,
} from '../src/main/asset-lifecycle'

const race = vi.hoisted(() => {
  type Gate = { promise: Promise<void>; resolve: () => void }
  type Race = {
    heldUnlink: string
    unlinkReached: Gate
    openUnlink: Gate
    watchedRead: string
    readsToWait: number
    readsSeen: Gate
    heldRead: string
    readReached: Gate
    openRead: Gate
    reset: () => void
  }
  const gate = (): Gate => {
    let resolve!: () => void
    const promise = new Promise<void>((opened) => {
      resolve = opened
    })
    return { promise, resolve }
  }
  const state: Race = {
    /** absolute path whose unlink waits until `openUnlink` is resolved (empty = nothing held) */
    heldUnlink: '',
    unlinkReached: gate(),
    openUnlink: gate(),
    /** absolute path whose `readsToWait`-th read resolves `readsSeen` (empty = nothing watched) */
    watchedRead: '',
    readsToWait: 0,
    readsSeen: gate(),
    /** absolute path whose read waits until `openRead` is resolved (empty = nothing held) */
    heldRead: '',
    readReached: gate(),
    openRead: gate(),
    /** fresh gates and cleared paths, so each test drives its own interleaving */
    reset: () => {
      state.heldUnlink = ''
      state.watchedRead = ''
      state.readsToWait = 0
      state.heldRead = ''
      state.unlinkReached = gate()
      state.openUnlink = gate()
      state.readsSeen = gate()
      state.readReached = gate()
      state.openRead = gate()
    },
  }
  return state
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rm: async (
      path: Parameters<typeof actual.rm>[0],
      options?: Parameters<typeof actual.rm>[1],
    ) => {
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
      if (race.heldRead !== '' && String(path) === race.heldRead) {
        race.heldRead = ''
        race.readReached.resolve()
        await race.openRead.promise
      }
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
beforeEach(() => race.reset())
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

// RBG4-1: the renderer sends every picture of one redo as ONE restore call, so a discard of the
// same document that is issued while that call runs must not land in the middle of it. The
// restore's first manifest read is held, the discard is issued right there, and the restore's own
// resolution is the signal: fixed, the whole call finishes first — and only then does the user's
// discard delete what it was asked to delete.
describe('a discard issued while a multi-picture restore is in flight', () => {
  async function restoreOfTwoPicturesRacingDiscard(mode: 'named' | 'document') {
    const dir = await tempDir()
    const doc = join(dir, 'note.md')
    const assetA = join(dir, 'assets', 'a.png')
    const assetB = join(dir, 'assets', 'b.png')
    await writeImageIntoOwnedAssets(doc, 'a.png', Buffer.from('bytes-a'))
    await writeImageIntoOwnedAssets(doc, 'b.png', Buffer.from('bytes-b'))
    // the undo's discard: both pictures leave the folder, so the redo has both to put back
    expect((await discardPendingOwnedAssets(doc)).deleted).toEqual(['a.png', 'b.png'])

    race.heldRead = join(dir, 'assets', ASSET_MANIFEST_FILENAME)
    const restore = restoreOwnedAssetFiles(doc, [
      { name: 'a.png', base64: b64('bytes-a') },
      { name: 'b.png', base64: b64('bytes-b') },
    ])
    const onDiskWhenDone = restore.then(() => ({ a: existsSync(assetA), b: existsSync(assetB) }))
    await race.readReached.promise

    // the discard's own unlink is held too, so reaching it is observable before it takes effect
    race.heldUnlink = assetA
    const discard =
      mode === 'named'
        ? discardPendingOwnedAssetNames(doc, ['a.png'])
        : discardPendingOwnedAssets(doc)
    race.openRead.resolve()

    // pre-fix the restore owns the manifest lock per picture, so the discard slips in between the
    // two names and reaches its unlink while the restore still has a picture to write; fixed, the
    // restore owns the lock for the whole call and resolves first
    const first = await Promise.race([
      restore.then(() => 'restore' as const),
      race.unlinkReached.promise.then(() => 'discard-unlink' as const),
    ])
    race.openUnlink.resolve()
    const [restored, discarded] = await Promise.all([restore, discard])
    return {
      first,
      restored,
      discarded,
      onDiskWhenDone: await onDiskWhenDone,
      manifest: await readOwnedAssetManifest(doc),
    }
  }

  it('puts back both pictures before a named discard of the same run deletes one', async () => {
    const run = await restoreOfTwoPicturesRacingDiscard('named')

    expect(run.first).toBe('restore')
    expect(run.restored).toEqual({ restored: ['a.png', 'b.png'], errors: [] })
    // every name the call reported as restored was on disk with the run's bytes when it returned
    expect(run.onDiskWhenDone).toEqual({ a: true, b: true })
    // the discard still deletes the name it was asked to, after the restore, leaving no record
    // behind for a file that is gone
    expect(run.discarded.deleted).toEqual(['a.png'])
    expect(run.manifest).toMatchObject({
      files: [{ name: 'b.png' }],
      pending: { 'note.md': ['b.png'] },
    })
  })

  it('puts back both pictures before a full-document discard of the same run deletes them', async () => {
    const run = await restoreOfTwoPicturesRacingDiscard('document')

    expect(run.first).toBe('restore')
    expect(run.restored).toEqual({ restored: ['a.png', 'b.png'], errors: [] })
    expect(run.onDiskWhenDone).toEqual({ a: true, b: true })
    expect(run.discarded.deleted).toEqual(['a.png', 'b.png'])
    expect(run.manifest?.files).toEqual([])
    expect(run.manifest?.pending).toEqual({})
  })
})
