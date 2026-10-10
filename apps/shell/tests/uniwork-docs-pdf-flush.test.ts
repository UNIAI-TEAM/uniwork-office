import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { flushPdfForExport } from '../src/main/pdf-flush'

describe('internal PDF flushes never count as a user Save', () => {
  it('marks an export flush of a bound PDF as not explicit, so no UniWork save intent fires', async () => {
    const flush = vi.fn().mockResolvedValue(true)
    const contents = { id: 7 } as unknown as WebContents
    await expect(flushPdfForExport(flush, contents)).resolves.toBe(true)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledWith(contents, { explicit: false })
  })

  it('passes a failed flush through so an export still aborts', async () => {
    const flush = vi.fn().mockResolvedValue(false)
    await expect(flushPdfForExport(flush, {} as WebContents)).resolves.toBe(false)
  })

  it('leaves File > Save as the only direct flushPdfSave call in the shell', () => {
    const source = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    const direct = source.match(/flushPdfSave\(/g) ?? []
    expect(direct).toHaveLength(1)
    expect(source).toMatch(
      /click: \(\) => \{\s*const tab = activePdfTarget\(\)\s*if \(tab\) void flushPdfSave\(tab\.webContents\)/,
    )
    expect(source.match(/flushPdfForExport\(flushPdfSave,/g)).toHaveLength(3)
  })
})
