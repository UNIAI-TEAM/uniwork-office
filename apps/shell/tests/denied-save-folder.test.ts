import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isUsableSaveDir, mkdirDirs, resolveDefaultSaveDir } from '@genoffice/electron-utils'
import { describeRoot } from '../src/main/folder-tree'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'genoffice-denied-save-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('denied save folder on launch', () => {
  it('mkdirDirs creates missing ancestor and leaf directories one level at a time', () => {
    const nested = join(root, 'a', 'b', 'c')
    mkdirDirs(nested)
    expect(existsSync(nested)).toBe(true)
    mkdirDirs(nested)
    expect(existsSync(nested)).toBe(true)
  })

  it('survives a denied leaf save folder when the parent already exists', () => {
    // Simulates a leaf creation refusal under an existing parent directory:
    // plain per-level mkdir throws immediately instead of spinning in recursive mkdir,
    // and both isUsableSaveDir and describeRoot degrade cleanly.
    const parentAsFile = join(root, 'Documents')
    writeFileSync(parentAsFile, 'blocked')
    const deniedLeaf = join(parentAsFile, 'UniWork Office')
    const fallback = join(root, 'fallback', 'UniWork Office')

    expect(() => mkdirDirs(deniedLeaf)).toThrow()
    expect(isUsableSaveDir(deniedLeaf)).toBe(false)
    expect(isUsableSaveDir(parentAsFile)).toBe(false)
    expect(resolveDefaultSaveDir(deniedLeaf, fallback)).toBe(fallback)
    expect(existsSync(fallback)).toBe(true)
    expect(describeRoot(deniedLeaf)).toEqual({
      path: deniedLeaf,
      name: 'UniWork Office',
      usable: false,
      readable: false,
      removable: false,
    })

    const existingDir = join(root, 'ExistingDocs')
    mkdirSync(existingDir)
    const fileAtLeaf = join(existingDir, 'UniWork Office')
    writeFileSync(fileAtLeaf, 'not a directory')
    expect(isUsableSaveDir(fileAtLeaf)).toBe(false)
    expect(describeRoot(fileAtLeaf).usable).toBe(false)
  })
})
