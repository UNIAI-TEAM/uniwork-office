import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openFileBlob } from '../src/main/uniwork-docs/folder-upload/file-source'

describe('openFileBlob', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fu-file-source-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('is a file-backed Blob of the file: size and bytes match, slices read the right range', async () => {
    const path = join(dir, 'a.txt')
    writeFileSync(path, 'hello world')
    const blob = await openFileBlob(path)
    expect(blob.size).toBe(11)
    expect(await blob.text()).toBe('hello world')
    expect(await blob.slice(6, 11).text()).toBe('world')
  })

  it('rejects when the file is gone', async () => {
    await expect(openFileBlob(join(dir, 'missing.txt'))).rejects.toThrow()
  })

  it('refuses a directory', async () => {
    await expect(openFileBlob(dir)).rejects.toThrow()
  })
})
