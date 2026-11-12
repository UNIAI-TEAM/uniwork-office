import { describe, expect, it } from 'vitest'

import { csvGridShape, type CsvImportProgress } from '../src/gateway/csv-import'
import { csvToXlsxBufferForOpen } from '../src/gateway/csv-import-xlsx'

/**
 * A delimited import reports how far it is and can be stopped: a 250 MB file
 * takes a while, and the user should see the bar move and be able to walk
 * away.
 */

const CSV = 'name,qty\nwidget,3\ngadget,5\n'

describe('the delimited import progress', () => {
  it('reports the read and the write phase', async () => {
    const seen: CsvImportProgress[] = []
    await csvToXlsxBufferForOpen(CSV, 'Sheet1', ',', {
      onProgress: (progress) => seen.push(progress),
    })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.some((progress) => progress.phase === 'read')).toBe(true)
    expect(seen.some((progress) => progress.phase === 'write')).toBe(true)
    // both phases end at the end of their work
    const last = seen[seen.length - 1]!
    expect(last.phase).toBe('write')
    expect(last.fraction).toBeGreaterThan(0)
  })

  it('reports a fraction that only grows', async () => {
    const seen: CsvImportProgress[] = []
    await csvToXlsxBufferForOpen(CSV, 'Sheet1', ',', {
      onProgress: (progress) => seen.push(progress),
    })
    const fractions = seen.map((progress) =>
      progress.phase === 'read' ? progress.fraction : 1 + progress.fraction,
    )
    for (let index = 1; index < fractions.length; index += 1) {
      expect(fractions[index]!).toBeGreaterThanOrEqual(fractions[index - 1]!)
    }
  })

  it('a large delimited import emits progress events in order through to completion', async () => {
    // > 512 KiB so csvRows crosses the 256 KiB PROGRESS_INTERVAL checkpoint
    // multiple times during the read phase before streaming rows in the write phase
    const rowCount = 12_000
    const lines = ['id,category,description,amount']
    for (let i = 1; i <= rowCount; i += 1) {
      lines.push(`${i},cat-${i % 17},item-description-row-${i}-payload,${(i * 1.25).toFixed(2)}`)
    }
    const largeCsv = `${lines.join('\n')}\n`
    expect(largeCsv.length).toBeGreaterThan(2 * 256 * 1024)

    const seen: CsvImportProgress[] = []
    const result = await csvToXlsxBufferForOpen(largeCsv, 'Sheet1', ',', {
      onProgress: (progress) => seen.push(progress),
    })

    expect(result.empty).toBe(false)
    expect(result.buffer.byteLength).toBeGreaterThan(0)

    const firstWriteIndex = seen.findIndex((p) => p.phase === 'write')
    expect(firstWriteIndex).toBeGreaterThan(1)
    const readEvents = seen.slice(0, firstWriteIndex)
    const writeEvents = seen.slice(firstWriteIndex)

    // Read phase emits intermediate checkpoints (0 < fraction < 1) and finishes at 1
    expect(readEvents.every((p) => p.phase === 'read')).toBe(true)
    expect(readEvents.some((p) => p.fraction > 0 && p.fraction < 1)).toBe(true)
    expect(readEvents[readEvents.length - 1]).toEqual({ phase: 'read', fraction: 1 })
    for (let i = 1; i < readEvents.length; i += 1) {
      expect(readEvents[i]!.fraction).toBeGreaterThanOrEqual(readEvents[i - 1]!.fraction)
    }

    // Write phase follows read, never regresses, and finishes at fraction 1
    expect(writeEvents.length).toBe(rowCount + 1)
    expect(writeEvents.every((p) => p.phase === 'write')).toBe(true)
    for (let i = 1; i < writeEvents.length; i += 1) {
      expect(writeEvents[i]!.fraction).toBeGreaterThanOrEqual(writeEvents[i - 1]!.fraction)
    }
    expect(writeEvents[writeEvents.length - 1]).toEqual({ phase: 'write', fraction: 1 })
  })

  it('stops when the import is aborted', async () => {
    const controller = new AbortController()
    const promise = csvToXlsxBufferForOpen(CSV, 'Sheet1', ',', {
      onProgress: () => controller.abort(),
      signal: controller.signal,
    })
    await expect(promise).rejects.toThrow(/abort/i)
  })

  it('stops during the write phase, where the time goes', async () => {
    // The read is a pass over the text; the write is the archive, and the
    // archive is the seconds (0.7 s against 12 s on a 39 MB file). An abort
    // that only works during the read leaves the user waiting out the
    // compression, which is the part they wanted to skip.
    const controller = new AbortController()
    const promise = csvToXlsxBufferForOpen(CSV, 'Sheet1', ',', {
      onProgress: (progress) => {
        if (progress.phase === 'write') controller.abort()
      },
      signal: controller.signal,
    })
    await expect(promise).rejects.toThrow(/abort/i)
  })

  it('aborts the read phase too', () => {
    const controller = new AbortController()
    controller.abort()
    expect(() => csvGridShape(CSV, ',', { signal: controller.signal })).toThrow(/abort/i)
  })
})
