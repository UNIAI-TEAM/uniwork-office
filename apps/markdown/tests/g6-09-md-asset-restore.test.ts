// @vitest-environment node
// Redo of an AI run that saved a picture (G6-09 visual r1 F4): the file the undo discarded is put
// back under the SAME name with the same bytes, so the redone markup never points at nothing.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ASSET_MANIFEST_FILENAME,
  discardPendingOwnedAssetNames,
  discardPendingOwnedAssets,
  readOwnedAssetManifest,
  renameOwnedAssetDocument,
  restoreOwnedAssetFiles,
  writeImageIntoOwnedAssets,
} from '../src/main/asset-lifecycle'

const dirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'markdown-assets-restore-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})
const b64 = (text: string): string => Buffer.from(text).toString('base64')
const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

describe('restoring the pictures of a redone AI run', () => {
  it('discard then restore: same name, same bytes, pending again (so a later discard can drop it)', async () => {
    const dir = await tempDir()
    const doc = join(dir, 'note.md')
    const rel = await writeImageIntoOwnedAssets(doc, 'pic.png', Buffer.from('bytes-1'))
    expect(rel).toBe('assets/pic.png')
    await discardPendingOwnedAssetNames(doc, ['pic.png'])
    expect(existsSync(join(dir, rel))).toBe(false)

    const result = await restoreOwnedAssetFiles(doc, [{ name: 'pic.png', base64: b64('bytes-1') }])

    expect(result.errors).toEqual([])
    expect(result.restored).toEqual(['pic.png'])
    expect(await readFile(join(dir, rel), 'utf8')).toBe('bytes-1')
    expect((await readOwnedAssetManifest(doc)).pending).toMatchObject({ 'note.md': ['pic.png'] })
    const again = await discardPendingOwnedAssetNames(doc, ['pic.png'])
    expect(again.deleted).toEqual(['pic.png'])
  })

  it('a file that is still there with the same bytes counts as restored', async () => {
    const dir = await tempDir()
    const doc = join(dir, 'note.md')
    await writeImageIntoOwnedAssets(doc, 'pic.png', Buffer.from('bytes-1'))
    const result = await restoreOwnedAssetFiles(doc, [{ name: 'pic.png', base64: b64('bytes-1') }])
    expect(result).toEqual({ restored: ['pic.png'], errors: [] })
  })

  it('never overwrites a different file that took the name', async () => {
    const dir = await tempDir()
    const doc = join(dir, 'note.md')
    await writeImageIntoOwnedAssets(doc, 'pic.png', Buffer.from('bytes-1'))
    await discardPendingOwnedAssetNames(doc, ['pic.png'])
    await writeFile(join(dir, 'assets', 'pic.png'), 'someone else')
    const result = await restoreOwnedAssetFiles(doc, [{ name: 'pic.png', base64: b64('bytes-1') }])
    expect(result.restored).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(await readFile(join(dir, 'assets', 'pic.png'), 'utf8')).toBe('someone else')
  })

  it('refuses anything that is not a plain file name', async () => {
    const dir = await tempDir()
    const doc = join(dir, 'note.md')
    const result = await restoreOwnedAssetFiles(doc, [
      { name: '../escape.png', base64: b64('x') },
      { name: 'sub/pic.png', base64: b64('x') },
    ])
    expect(result.restored).toEqual([])
    expect(result.errors).toHaveLength(2)
    expect(existsSync(join(dir, 'escape.png'))).toBe(false)
  })

  it('refuses a name this window never discarded and never owned', async () => {
    const dir = await tempDir()
    const doc = join(dir, 'note.md')
    const result = await restoreOwnedAssetFiles(doc, [
      { name: 'never-owned.png', base64: b64('bytes-1') },
    ])
    expect(result.restored).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(existsSync(join(dir, 'assets', 'never-owned.png'))).toBe(false)
  })

  it('refuses a name only a sibling document in the same folder discarded', async () => {
    const dir = await tempDir()
    const other = join(dir, 'other.md')
    const doc = join(dir, 'note.md')
    await writeImageIntoOwnedAssets(other, 'pic.png', Buffer.from('bytes-1'))
    await discardPendingOwnedAssetNames(other, ['pic.png'])

    const result = await restoreOwnedAssetFiles(doc, [{ name: 'pic.png', base64: b64('bytes-1') }])

    expect(result.restored).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(existsSync(join(dir, 'assets', 'pic.png'))).toBe(false)
  })

  it('still restores after a same-folder rename between the undo and the redo', async () => {
    const dir = await tempDir()
    const doc = join(dir, 'note.md')
    const renamed = join(dir, 'note renamed.md')
    await writeImageIntoOwnedAssets(doc, 'pic.png', Buffer.from('bytes-1'))
    await discardPendingOwnedAssetNames(doc, ['pic.png'])
    await renameOwnedAssetDocument(doc, renamed)

    const result = await restoreOwnedAssetFiles(renamed, [
      { name: 'pic.png', base64: b64('bytes-1') },
    ])

    expect(result).toEqual({ restored: ['pic.png'], errors: [] })
    expect(existsSync(join(dir, 'assets', 'pic.png'))).toBe(true)
  })

  it('refuses a file type an AI run cannot have saved, even when the name was discarded', async () => {
    const dir = await tempDir()
    const doc = join(dir, 'note.md')
    await writeImageIntoOwnedAssets(doc, 'note2.md', Buffer.from('bytes-1'))
    await discardPendingOwnedAssetNames(doc, ['note2.md'])

    const result = await restoreOwnedAssetFiles(doc, [
      { name: 'note2.md', base64: b64('bytes-1') },
      { name: 'pic.webp', base64: b64('bytes-1') },
    ])

    expect(result.restored).toEqual([])
    expect(result.errors).toHaveLength(2)
    expect(existsSync(join(dir, 'assets', 'note2.md'))).toBe(false)
  })

  it('puts back the picture types an AI run can save (png, jpg, gif)', async () => {
    for (const name of ['photo.png', 'photo.jpg', 'photo.gif']) {
      const dir = await tempDir()
      const doc = join(dir, 'note.md')
      await writeImageIntoOwnedAssets(doc, name, Buffer.from('bytes-1'))
      await discardPendingOwnedAssetNames(doc, [name])

      const result = await restoreOwnedAssetFiles(doc, [{ name, base64: b64('bytes-1') }])

      expect(result).toEqual({ restored: [name], errors: [] })
    }
  })

  it('removes the file it just wrote when the manifest record is refused', async () => {
    const dir = await tempDir()
    const doc = join(dir, 'note.md')
    const asset = join(dir, 'assets', 'pic.png')
    await writeImageIntoOwnedAssets(doc, 'pic.png', Buffer.from('original'))
    // the file vanishes outside the app; the manifest still owns the name with the old bytes
    await rm(asset)

    const result = await restoreOwnedAssetFiles(doc, [
      { name: 'pic.png', base64: b64('different') },
    ])

    expect(result.restored).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(existsSync(asset)).toBe(false)
  })
})

// RBG5-1/RBG5-2: one redo carries every picture of the run in a single call, and the whole call
// shares one manifest lock — so the per-file handling inside it is the only thing that keeps the
// rest of the batch going. A name that cannot come back (here a foreign file took it) must not
// stop the pictures after it; an early abort would leave their markup pointing at nothing while
// the redo still looked like it ran.
describe('a restore call that cannot put back one picture of several', () => {
  it('keeps going and restores the pictures after the failed name', async () => {
    const dir = await tempDir()
    const doc = join(dir, 'note.md')
    const assets = join(dir, 'assets')
    const runBytes = { 'a.png': 'run-a', 'b.png': 'run-b', 'c.png': 'run-c' }
    for (const [name, bytes] of Object.entries(runBytes)) {
      await writeImageIntoOwnedAssets(doc, name, Buffer.from(bytes))
    }
    // the undo's discard: every picture leaves the folder, so the redo has all three to put back
    const discarded = await discardPendingOwnedAssets(doc)
    expect([...discarded.deleted].sort()).toEqual(['a.png', 'b.png', 'c.png'])
    // while they were gone a different file took the middle name
    await writeFile(join(assets, 'b.png'), 'someone else')

    const result = await restoreOwnedAssetFiles(
      doc,
      Object.entries(runBytes).map(([name, bytes]) => ({ name, base64: b64(bytes) })),
    )

    expect(result.restored).toEqual(['a.png', 'c.png'])
    // the collision is the only complaint, and it names the picture it refused
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/^b\.png: /)
    expect(await readFile(join(assets, 'b.png'), 'utf8')).toBe('someone else')
    // the pictures on both sides of the failed one are on disk with the run's own bytes
    expect(await readFile(join(assets, 'a.png'), 'utf8')).toBe('run-a')
    expect(await readFile(join(assets, 'c.png'), 'utf8')).toBe('run-c')
    expect((await readOwnedAssetManifest(doc)).pending).toMatchObject({
      'note.md': ['a.png', 'c.png'],
    })
  })
})

// RBG-MDb-2: the restore refuses a leading-dot name, so a named discard must refuse it too.
// Otherwise a name that can never come back is deleted for good by that very run's Roll back.
describe('names a named discard refuses', () => {
  it('refuses a leading-dot name the restore could never put back', async () => {
    const dir = await tempDir()
    const doc = join(dir, 'note.md')
    const assetsDir = join(dir, 'assets')
    const asset = join(assetsDir, '.hidden.png')
    // No app path produces a dot-named asset (sanitizeAssetName strips the leading dot), so the
    // manifest is written by hand: the guard is what keeps an imported or hand-edited one
    // symmetric, and the file must survive rather than be dropped by the run that owns it.
    await mkdir(assetsDir, { recursive: true })
    await writeFile(asset, 'bytes-1')
    await writeFile(
      join(assetsDir, ASSET_MANIFEST_FILENAME),
      `${JSON.stringify(
        {
          version: 1,
          files: [{ name: '.hidden.png', sha256: sha('bytes-1') }],
          documents: {},
          pending: { 'note.md': ['.hidden.png'] },
        },
        null,
        2,
      )}\n`,
    )

    const discarded = await discardPendingOwnedAssetNames(doc, ['.hidden.png'])
    const restored = await restoreOwnedAssetFiles(doc, [
      { name: '.hidden.png', base64: b64('bytes-1') },
    ])

    expect(discarded).toMatchObject({ deleted: [], preserved: [], errors: [] })
    expect(existsSync(asset)).toBe(true)
    expect(await readOwnedAssetManifest(doc)).toMatchObject({
      files: [{ name: '.hidden.png', sha256: sha('bytes-1') }],
      pending: { 'note.md': ['.hidden.png'] },
    })
    expect(restored).toMatchObject({ restored: [] })
    expect(restored.errors).toHaveLength(1)
    // the document-wide discard still takes it, so the refused name cannot strand the file for good
    expect((await discardPendingOwnedAssets(doc)).deleted).toEqual(['.hidden.png'])
    expect(existsSync(asset)).toBe(false)
  })
})
