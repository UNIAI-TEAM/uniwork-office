import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DOCUMENT_LIMITS,
  FOLDER_UPLOAD_DEFAULTS,
  folderUploadRunLimits,
  parseDocumentLimits,
} from '../src/main/uniwork-docs/limits'

const config = (limits: Record<string, unknown>) => ({ documents: { limits } })

describe('documents.limits.folder_upload', () => {
  it('reads the whole block, plus upload_extensions', () => {
    const parsed = parseDocumentLimits(
      config({
        upload_max_bytes: 100 * 1024 * 1024,
        chunked_upload_threshold_bytes: 20 * 1024 * 1024,
        folder_upload: {
          max_files: 300,
          max_folders: 200,
          max_total_bytes: 1_000_000,
          max_depth: 12,
          parallel: 4,
          complete_batch: 25,
        },
        upload_extensions: ['pdf', '.DOCX', ' xlsx ', '', 7, null],
      }),
    )
    expect(parsed.folderUpload).toEqual({
      max_files: 300,
      max_folders: 200,
      max_total_bytes: 1_000_000,
      max_depth: 12,
      parallel: 4,
      complete_batch: 25,
    })
    expect(parsed.upload_extensions).toEqual(['pdf', 'docx', 'xlsx'])
    // the older fields are untouched
    expect(parsed.max_bytes).toBe(100 * 1024 * 1024)
    expect(parsed.chunked_upload_threshold_bytes).toBe(20 * 1024 * 1024)
  })

  it('a block that is absent (an older server) is folderUpload: null', () => {
    for (const raw of [
      null,
      {},
      config({}),
      config({ upload_max_bytes: 5 }),
      config({ folder_upload: null }),
    ]) {
      expect(parseDocumentLimits(raw).folderUpload).toBeNull()
    }
    expect(DEFAULT_DOCUMENT_LIMITS.folderUpload).toBeNull()
    // a block that is not an object is absent too, never half-guessed
    for (const bad of ['x', 7, [], true]) {
      expect(parseDocumentLimits(config({ folder_upload: bad })).folderUpload).toBeNull()
    }
  })

  it('a field that is missing or drifted takes the web default on its own', () => {
    const parsed = parseDocumentLimits(
      config({
        folder_upload: {
          max_files: 10,
          max_folders: -1,
          max_total_bytes: 'x',
          max_depth: 1.5,
          parallel: 0,
        },
      }),
    )
    expect(parsed.folderUpload).toEqual({
      max_files: 10,
      max_folders: FOLDER_UPLOAD_DEFAULTS.max_folders,
      max_total_bytes: FOLDER_UPLOAD_DEFAULTS.max_total_bytes,
      max_depth: FOLDER_UPLOAD_DEFAULTS.max_depth,
      parallel: FOLDER_UPLOAD_DEFAULTS.parallel,
      complete_batch: FOLDER_UPLOAD_DEFAULTS.complete_batch,
    })
    expect(FOLDER_UPLOAD_DEFAULTS).toEqual({
      max_files: 500,
      max_folders: 500,
      max_total_bytes: 2 * 1024 * 1024 * 1024,
      max_depth: 20,
      parallel: 6,
      complete_batch: 50,
    })
  })

  it('an empty block is the defaults (the server has the feature, every number drifted)', () => {
    expect(parseDocumentLimits(config({ folder_upload: {} })).folderUpload).toEqual(
      FOLDER_UPLOAD_DEFAULTS,
    )
  })

  it('an empty or non-array upload_extensions is absent (an empty allow-list would refuse everything)', () => {
    for (const bad of [[], 'pdf', {}, [1, 2], null]) {
      expect(
        parseDocumentLimits(config({ upload_extensions: bad })).upload_extensions,
      ).toBeUndefined()
    }
  })

  it('also reads the bare {limits} and the limits object itself', () => {
    const block = { folder_upload: { max_files: 7 } }
    expect(parseDocumentLimits({ limits: block }).folderUpload?.max_files).toBe(7)
    expect(parseDocumentLimits(block).folderUpload?.max_files).toBe(7)
  })
})

describe('folderUploadRunLimits', () => {
  it('clamps parallel to 1-6 and the complete lot to 1-50, and carries the planner limits', () => {
    const limits = parseDocumentLimits(
      config({
        upload_max_bytes: 5000,
        chunked_upload_threshold_bytes: 1000,
        upload_extensions: ['pdf'],
        folder_upload: { parallel: 99, complete_batch: 500, max_files: 40 },
      }),
    )
    expect(folderUploadRunLimits(limits)).toEqual({
      maxFiles: 40,
      maxFolders: 500,
      maxTotalBytes: 2 * 1024 * 1024 * 1024,
      maxDepth: 20,
      perFileMaxBytes: 5000,
      parallel: 6,
      completeBatch: 50,
      chunkedThresholdBytes: 1000,
      uploadExtensions: ['pdf'],
    })
    const small = parseDocumentLimits(config({ folder_upload: { parallel: 1, complete_batch: 1 } }))
    expect(folderUploadRunLimits(small)).toMatchObject({ parallel: 1, completeBatch: 1 })
  })

  it('is null when the server has no folder uploads, and leaves optional fields out when absent', () => {
    expect(folderUploadRunLimits(DEFAULT_DOCUMENT_LIMITS)).toBeNull()
    const run = folderUploadRunLimits(parseDocumentLimits(config({ folder_upload: {} })))
    expect(run).not.toBeNull()
    expect(run).not.toHaveProperty('chunkedThresholdBytes')
    expect(run).not.toHaveProperty('uploadExtensions')
  })
})
