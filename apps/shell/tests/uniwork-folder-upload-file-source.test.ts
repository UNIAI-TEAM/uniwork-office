import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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

  it.skipIf(process.platform !== 'win32')(
    'reads a file whose Windows path is past MAX_PATH (260 chars)',
    async () => {
      const segment = 'Tài liệu kế toán năm 2022 - bản đã ký và đóng dấu của công ty'
      const folder = join(dir, segment, segment, segment, segment)
      mkdirSync(folder, { recursive: true })
      const path = join(folder, 'Báo cáo tài chính hợp nhất quý IV.txt')
      expect(path.length).toBeGreaterThan(260)
      writeFileSync(path, 'hello long world')
      const blob = await openFileBlob(path)
      expect(blob.size).toBe(16)
      expect(await blob.text()).toBe('hello long world')
      expect(await blob.slice(6, 10).text()).toBe('long')
    },
  )

  it('rejects when the file is gone', async () => {
    await expect(openFileBlob(join(dir, 'missing.txt'))).rejects.toThrow()
  })

  it('refuses a symlink to a file: a link is never followed at upload time', async () => {
    const target = join(dir, 'secret.txt')
    writeFileSync(target, 'not in the plan')
    const link = join(dir, 'report.docx')
    symlinkSync(target, link)
    await expect(openFileBlob(link)).rejects.toMatchObject({ code: 'unreadable' })
  })

  it('a missing file keeps its native error (the runner reads it as retryable unreadable)', async () => {
    await expect(openFileBlob(join(dir, 'missing.txt'))).rejects.not.toMatchObject({
      code: 'unreadable',
    })
  })

  it('refuses a directory', async () => {
    await expect(openFileBlob(dir)).rejects.toThrow()
  })
})
