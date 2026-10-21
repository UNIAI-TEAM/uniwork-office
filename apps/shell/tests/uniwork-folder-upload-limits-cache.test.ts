import { describe, expect, it } from 'vitest'
import { createUniworkDocsClient, type FetchLike } from '../src/main/uniwork-docs/client'
import { createFolderUploadWiring } from '../src/main/uniwork-docs/folder-upload/wire'
import { createDocumentLimitsCache } from '../src/main/uniwork-docs/limits'

/**
 * FU-V1 (UNI-2052): the cache re-parsed what `client.getDocumentLimits()` had
 * already parsed, and the second pass read the snake_case `folder_upload`
 * the first pass had turned into `folderUpload`: every folder entry point
 * stayed hidden. These tests run the real client + cache + wiring.
 */

const BLOCK = {
  max_files: 10,
  max_folders: 20,
  max_total_bytes: 5_000_000,
  max_depth: 6,
  parallel: 2,
  complete_batch: 25,
}

function wiringFor(limits: Record<string, unknown>) {
  const client = createUniworkDocsClient({
    apiOrigin: 'https://a.uniwork.example',
    authorized: (call) => call('tok'),
    isSignedIn: () => true,
    fetch: (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ documents: { limits } }),
    })) as unknown as FetchLike,
  })
  // the same shape the docs service hands the cache
  const cache = createDocumentLimitsCache({
    origin: () => 'https://a.uniwork.example',
    fetchLimits: async () => await client.getDocumentLimits!(),
  })
  const wiring = createFolderUploadWiring({
    limits: () => cache.get(),
    clientOptions: () => null,
    storageFetch: (async () => ({})) as unknown as FetchLike,
  })
  return { cache, wiring }
}

describe('folder_upload through the real limits cache', () => {
  it('keeps the block the server sent: folders are available end to end', async () => {
    const { cache, wiring } = wiringFor({
      upload_max_bytes: 120 * 1024 * 1024,
      save_warn_ratio: 0.8,
      chunked_upload_threshold_bytes: 8 * 1024 * 1024,
      upload_extensions: ['docx', 'pdf'],
      folder_upload: BLOCK,
    })
    const cached = await cache.get()
    expect(cached.folderUpload).toEqual(BLOCK)
    expect(await wiring.getLimits()).toEqual({
      maxFiles: 10,
      maxFolders: 20,
      maxTotalBytes: 5_000_000,
      maxDepth: 6,
      perFileMaxBytes: 120 * 1024 * 1024,
      uploadExtensions: ['docx', 'pdf'],
    })
  })

  it('leaves every other limit as the server sent it', async () => {
    const { cache } = wiringFor({
      upload_max_bytes: 120 * 1024 * 1024,
      save_warn_ratio: 0.8,
      chunked_upload_threshold_bytes: 8 * 1024 * 1024,
      upload_extensions: ['docx'],
      folder_upload: BLOCK,
    })
    const cached = await cache.get()
    expect(cached.max_bytes).toBe(120 * 1024 * 1024)
    expect(cached.warn_ratio).toBe(0.8)
    expect(cached.chunked_upload_threshold_bytes).toBe(8 * 1024 * 1024)
    expect(cached.upload_extensions).toEqual(['docx'])
  })

  it('is unavailable (null) when the server sends no block', async () => {
    const { cache, wiring } = wiringFor({ upload_max_bytes: 120 * 1024 * 1024 })
    expect((await cache.get()).folderUpload).toBeNull()
    expect(await wiring.getLimits()).toBeNull()
  })
})
