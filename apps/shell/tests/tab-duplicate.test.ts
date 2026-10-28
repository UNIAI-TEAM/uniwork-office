import { existsSync, writeFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { duplicateDocumentFile } from '../src/main/tab-duplicate'

vi.mock('node:fs', async (importOriginal) => {
  const actual: typeof import('node:fs') = await importOriginal()
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
  }
})

let directory: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tab-duplicate-'))
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function callbacks() {
  return { copySuffix: 'Copy', recordRecentFile: vi.fn(), onError: vi.fn() }
}

describe('shared document duplication', () => {
  it('copies through the existing atomic helper and records the new file', async () => {
    const source = join(directory, 'report.docx')
    await writeFile(source, 'saved content')
    const deps = callbacks()
    const target = await duplicateDocumentFile(source, deps)
    expect(target).toBe(join(directory, 'report Copy.docx'))
    expect(await readFile(target!, 'utf8')).toBe('saved content')
    expect(deps.recordRecentFile).toHaveBeenCalledWith(target)
    expect(deps.onError).not.toHaveBeenCalled()
  })

  it('keeps existing copies and uses the localized suffix for the next name', async () => {
    const source = join(directory, 'report.docx')
    const existing = join(directory, 'report Kopie.docx')
    await writeFile(source, 'source')
    await writeFile(existing, 'existing copy')
    const deps = { ...callbacks(), copySuffix: 'Kopie' }
    expect(await duplicateDocumentFile(source, deps)).toBe(join(directory, 'report Kopie 2.docx'))
    expect(await readFile(existing, 'utf8')).toBe('existing copy')
  })

  it('reports a copy failure to the shared user-facing error handler without recording a file', async () => {
    const deps = callbacks()
    expect(await duplicateDocumentFile(join(directory, 'missing.docx'), deps)).toBeUndefined()
    expect(deps.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'ENOENT' }))
    expect(deps.recordRecentFile).not.toHaveBeenCalled()
  })

  it('does not overwrite a target created between candidate selection and publication, and uses the next suffix', async () => {
    const source = join(directory, 'report.docx')
    const firstCandidate = join(directory, 'report Copy.docx')
    await writeFile(source, 'source content')
    const deps = callbacks()
    // Two concurrent duplicates of the same file race for 'report Copy.docx';
    // if publication replaces instead of failing with EEXIST, both return the same path
    // or overwrite a file created after the initial check.
    const [first, second] = await Promise.all([
      duplicateDocumentFile(source, deps),
      duplicateDocumentFile(source, deps),
    ])
    expect(new Set([first, second])).toEqual(
      new Set([join(directory, 'report Copy.docx'), join(directory, 'report Copy 2.docx')]),
    )
    expect(await readFile(firstCandidate, 'utf8')).toBe('source content')
    expect(await readFile(join(directory, 'report Copy 2.docx'), 'utf8')).toBe('source content')
  })

  it('does not overwrite a destination file injected right before publish and advances to the next suffix', async () => {
    const actualFs: typeof import('node:fs') = await vi.importActual('node:fs')
    const source = join(directory, 'budget.xlsx')
    const racedTarget = join(directory, 'budget Copy.xlsx')
    await writeFile(source, 'duplicated bytes')
    vi.mocked(existsSync).mockImplementationOnce((p) => {
      const res = actualFs.existsSync(p)
      if (p === racedTarget && !res) {
        writeFileSync(racedTarget, 'competing writer bytes')
      }
      return res
    })
    const deps = callbacks()
    const target = await duplicateDocumentFile(source, deps)
    expect(target).toBe(join(directory, 'budget Copy 2.xlsx'))
    expect(await readFile(racedTarget, 'utf8')).toBe('competing writer bytes')
    expect(await readFile(target!, 'utf8')).toBe('duplicated bytes')
  })
})
