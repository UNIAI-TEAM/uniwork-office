import { mkdtempSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  UNIWORK_CLOUD_SIGNED_OUT,
  setUniworkCloudStatus,
  setUniworkCloudTransport,
  type UniworkCloudStatus,
} from '@genoffice/ai-provider'

// spies on the real fs reads, so a test can prove how much of a file was read
const reads = vi.hoisted(() => ({ readFile: 0, readSync: [] as number[] }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      reads.readFile++
      return actual.readFileSync(...args)
    }) as typeof actual.readFileSync,
    readSync: ((...args: Parameters<typeof actual.readSync>) => {
      reads.readSync.push((args[1] as { byteLength: number }).byteLength)
      return actual.readSync(...args)
    }) as typeof actual.readSync,
  }
})

import {
  MEDIA_BUDGET,
  MediaBudgetExceededError,
  MediaTooLargeError,
  analyzeMediaTool,
  generateImageTool,
  loadMediaReferences,
} from '../src/media-tools'

/** A data URL whose decoded payload is `bytes` long. */
function dataUrl(bytes: number, mime = 'image/png'): string {
  return `data:${mime};base64,${'A'.repeat(Math.ceil((bytes * 4) / 3))}`
}

/** The production budget is 25 MiB per item and in total; most tests use a tiny one. */
const TINY = { maxItems: 3, maxItemBytes: 64, maxTotalBytes: 128, concurrency: 2 }

describe('loadMediaReferences budget', () => {
  it('pins the production ceilings', () => {
    expect(MEDIA_BUDGET).toEqual({
      maxItems: 12,
      maxItemBytes: 25 * 1024 * 1024,
      maxTotalBytes: 25 * 1024 * 1024,
      concurrency: 3,
    })
  })

  it('refuses a 30 MiB local file without reading more than the cap plus one byte', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'genoffice-media-big-'))
    const clip = join(dir, 'clip.mp4')
    writeFileSync(clip, '')
    truncateSync(clip, 30 * 1024 * 1024)
    reads.readFile = 0
    reads.readSync = []
    await expect(loadMediaReferences([clip])).rejects.toBeInstanceOf(MediaTooLargeError)
    await expect(loadMediaReferences([clip], undefined, [dir])).rejects.toBeInstanceOf(
      MediaTooLargeError,
    )
    expect(reads.readFile).toBe(0)
    expect(reads.readSync.reduce((n, len) => n + len, 0)).toBeLessThanOrEqual(25 * 1024 * 1024 + 1)
  })

  it('reads a local file that fits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'genoffice-media-fits-'))
    const clip = join(dir, 'clip.mp4')
    writeFileSync(clip, Buffer.alloc(1024, 7))
    const [blob] = await loadMediaReferences([clip], undefined, [dir])
    expect(blob?.bytes.byteLength).toBe(1024)
  })

  it('rejects too many items before loading anything', async () => {
    const refs = Array.from({ length: 4 }, () => dataUrl(8))
    await expect(loadMediaReferences(refs, TINY)).rejects.toThrow(/Too many media items/)
    await expect(loadMediaReferences(refs, TINY)).rejects.toBeInstanceOf(MediaTooLargeError)
  })

  it('rejects one data URL over the per-item cap from its encoded size alone', async () => {
    await expect(loadMediaReferences([dataUrl(65)], TINY)).rejects.toThrow(/too large/i)
  })

  it('rejects data URLs whose combined encoded size is over the total cap', async () => {
    await expect(
      loadMediaReferences([dataUrl(45), dataUrl(45), dataUrl(45)], TINY),
    ).rejects.toBeInstanceOf(MediaBudgetExceededError)
  })

  it('rejects a total that only crosses the cap once the bytes have landed', async () => {
    // local files declare no encoded size, so only the running total can catch this
    const dir = mkdtempSync(join(tmpdir(), 'genoffice-media-files-'))
    const refs = Array.from({ length: 3 }, (_, i) => {
      const path = join(dir, `shot-${i}.png`)
      writeFileSync(path, Buffer.alloc(50, 1))
      return path
    })
    await expect(
      loadMediaReferences(refs, { maxItems: 3, maxTotalBytes: 100 }),
    ).rejects.toBeInstanceOf(MediaBudgetExceededError)
  })

  it('loads a batch that fits, in the caller’s order', async () => {
    const blobs = await loadMediaReferences(
      [dataUrl(8, 'image/png'), dataUrl(8, 'image/jpeg')],
      TINY,
    )
    expect(blobs.map((b) => b.mime)).toEqual(['image/png', 'image/jpeg'])
    expect(blobs.every((b) => b.bytes.byteLength > 0)).toBe(true)
  })

  it('keeps loading bounded by the concurrency setting', async () => {
    const refs = Array.from({ length: 3 }, () => dataUrl(8, 'image/png'))
    const blobs = await loadMediaReferences(refs, { ...TINY, concurrency: 1 })
    expect(blobs).toHaveLength(3)
    expect(blobs.every((b) => b.mime === 'image/png')).toBe(true)
  })
})

const READY: UniworkCloudStatus = {
  state: 'ready',
  enabled: true,
  tools: {
    web_search: true,
    image_search: true,
    image_generate: true,
    media_analyze: true,
    transcribe: true,
  },
  credits: null,
}

describe('media tool aggregate budget', () => {
  afterEach(() => {
    setUniworkCloudStatus(UNIWORK_CLOUD_SIGNED_OUT)
    setUniworkCloudTransport(null)
  })

  it('analyze_media refuses too many items before reading any', async () => {
    setUniworkCloudStatus(READY)
    const result = await analyzeMediaTool('/nonexistent/ai-settings.json', {
      mediaUrls: Array.from({ length: 13 }, () => dataUrl(8)),
      requirements: 'describe these',
    })
    expect(result.error).toMatch(/Too many media items/)
  })

  it('generate_image refuses too many references', async () => {
    setUniworkCloudStatus(READY)
    const result = await generateImageTool('/nonexistent/ai-settings.json', {
      prompt: 'a logo',
      referenceImageUrls: Array.from({ length: 13 }, () => dataUrl(8)),
    })
    expect(result.error).toMatch(/Too many media items/)
  })
})
