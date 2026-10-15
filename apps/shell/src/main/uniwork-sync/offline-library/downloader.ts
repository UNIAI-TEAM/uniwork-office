import type { DownloadStreamOptions } from '../../uniwork-docs/client'
import { UniworkDocError } from '../../uniwork-docs/errors'
import type { DocumentDetail } from '../../uniwork-docs/parse'
import {
  MAX_PIN_FILE_BYTES,
  largestFileBytes,
  manifestBytes,
  verifyBytes,
  type ManifestAsset,
  type PinManifest,
} from './manifest'
import type { PinProgress } from './record'
import { blobKey, type LibraryStoreUnavailable, type OfflineLibraryStore } from './store'

/**
 * One snapshot download into staging (G5-05). The main file streams through
 * `downloadStream` (progress + cancel), each declared asset through the
 * `fetchAsset` port; every file is checked against the manifest (size and
 * SHA-256) before it is written, and read back from the store and checked
 * again before the snapshot is reported staged. Bytes only ever exist in
 * memory and as encrypted store records - never a plaintext file.
 *
 * Nothing here commits: the staged generation is invisible until the manager
 * writes the pin row that names it. On any other outcome every staging record
 * this call may have written is deleted before it returns.
 */

/** what the engine needs from the documents client */
export interface LibraryDocsPort {
  getDocument(documentId: string): Promise<DocumentDetail>
  downloadStream(
    documentId: string,
    version: number | undefined,
    options?: DownloadStreamOptions,
  ): Promise<{ bytes: Uint8Array }>
}

/**
 * The bytes of one declared asset. No production implementation: the server
 * has no asset route yet (D residual, see the W5 report).
 */
export type FetchAssetPort = (input: {
  documentId: string
  version: number
  versionId?: string
  asset: ManifestAsset
  signal: AbortSignal
}) => Promise<Uint8Array>

export type CorruptReason =
  | 'size_mismatch'
  | 'checksum_mismatch'
  | 'asset_missing'
  | 'asset_mismatch'
  /** the store did not give back what was written */
  | 'store_mismatch'

export type StageOutcome =
  | { kind: 'staged'; keys: string[]; bytes: number }
  | { kind: 'interrupted'; reason: 'cancelled' | 'network' | 'boundary' }
  | { kind: 'store_full' }
  | { kind: 'corrupt'; reason: CorruptReason }
  | { kind: 'too_large' }
  /** the server refused the download (deleted, forbidden, ...): the docs error code */
  | { kind: 'failed'; code: string }
  | Exclude<LibraryStoreUnavailable, { kind: 'interrupted' }>

export interface StageInput {
  store: OfflineLibraryStore
  docs: LibraryDocsPort
  fetchAsset?: FetchAssetPort
  documentId: string
  manifest: PinManifest
  generation: string
  signal: AbortSignal
  onProgress?(progress: PinProgress): void
  /** every byte received: the read-back check starts */
  onVerifying?(): void | Promise<void>
  /** false once the account boundary moved: nothing may be staged any more */
  live(): boolean
}

/** delete every staging record a download may have written (best effort) */
export async function wipeKeys(store: OfflineLibraryStore, keys: Iterable<string>): Promise<void> {
  for (const key of keys) {
    await store.deleteBlob(key).catch(() => undefined)
  }
}

function stopped(input: StageInput): StageOutcome | null {
  if (!input.live()) return { kind: 'interrupted', reason: 'boundary' }
  if (input.signal.aborted) return { kind: 'interrupted', reason: 'cancelled' }
  return null
}

function fromDownloadError(error: unknown, input: StageInput): StageOutcome {
  const halted = stopped(input)
  if (halted) return halted
  if (error instanceof UniworkDocError) {
    if (error.code === 'too_large') return { kind: 'too_large' }
    if (error.code === 'network' || error.code === 'timeout') {
      return { kind: 'interrupted', reason: 'network' }
    }
    return { kind: 'failed', code: error.code }
  }
  return { kind: 'interrupted', reason: 'network' }
}

export async function stageSnapshot(input: StageInput): Promise<StageOutcome> {
  const { store, documentId, manifest, generation } = input
  if (largestFileBytes(manifest) > MAX_PIN_FILE_BYTES) return { kind: 'too_large' }
  const totalBytes = manifestBytes(manifest)
  const written: string[] = []
  let done = 0

  const fail = async (outcome: StageOutcome): Promise<StageOutcome> => {
    // a moved boundary means the scope is locked and wiped (or about to be): a
    // delete here would re-open it and re-create its empty folder. The staging
    // keys are on the row, so the wipe or the next recover() takes them.
    if (input.live()) await wipeKeys(store, written)
    return outcome
  }

  /** a verified file, written as one staging record */
  const stage = async (key: string, bytes: Uint8Array): Promise<StageOutcome | null> => {
    const halted = stopped(input)
    if (halted) return halted
    written.push(key)
    const result = await store.putBlob(key, bytes)
    if (result.kind === 'ok') return stopped(input)
    if (result.kind === 'store_full') return { kind: 'store_full' }
    if (result.kind === 'interrupted') return { kind: 'interrupted', reason: 'boundary' }
    // a write this build's store refuses (level window): never staged
    if (result.kind === 'refused') return { kind: 'failed', code: 'refused' }
    return result
  }

  // the main file
  const halted = stopped(input)
  if (halted) return halted
  let main: Uint8Array
  try {
    main = (
      await input.docs.downloadStream(documentId, manifest.main.version, {
        signal: input.signal,
        onProgress: ({ receivedBytes }) =>
          input.onProgress?.({ receivedBytes: Math.min(receivedBytes, totalBytes), totalBytes }),
      })
    ).bytes
  } catch (error) {
    return fail(fromDownloadError(error, input))
  }
  const afterMain = stopped(input)
  if (afterMain) return fail(afterMain)
  const mainCheck = verifyBytes(manifest.main, main)
  if (mainCheck !== 'ok') return fail({ kind: 'corrupt', reason: mainCheck })
  const mainKey = blobKey(documentId, generation, 'main')
  const mainStaged = await stage(mainKey, main)
  if (mainStaged) return fail(mainStaged)
  done += main.byteLength

  // every declared asset: missing or mismatched -> the snapshot is not ready
  for (const [index, asset] of manifest.assets.entries()) {
    if (!input.fetchAsset) return fail({ kind: 'corrupt', reason: 'asset_missing' })
    let bytes: Uint8Array
    try {
      bytes = await input.fetchAsset({
        documentId,
        version: manifest.main.version,
        ...(manifest.main.versionId ? { versionId: manifest.main.versionId } : {}),
        asset,
        signal: input.signal,
      })
    } catch (error) {
      const outcome = fromDownloadError(error, input)
      // an asset the server does not have is a missing asset, not a network blip
      if (outcome.kind === 'failed' && outcome.code === 'not_found') {
        return fail({ kind: 'corrupt', reason: 'asset_missing' })
      }
      return fail(outcome)
    }
    const afterAsset = stopped(input)
    if (afterAsset) return fail(afterAsset)
    if (bytes.byteLength > MAX_PIN_FILE_BYTES) return fail({ kind: 'too_large' })
    if (verifyBytes(asset, bytes) !== 'ok')
      return fail({ kind: 'corrupt', reason: 'asset_mismatch' })
    const staged = await stage(blobKey(documentId, generation, index), bytes)
    if (staged) return fail(staged)
    done += bytes.byteLength
    input.onProgress?.({ receivedBytes: done, totalBytes })
  }

  // read back what the store holds: only bytes that verify from disk are staged
  await input.onVerifying?.()
  const files: Array<{ key: string; expected: { sha256: string; sizeBytes: number } }> = [
    { key: mainKey, expected: manifest.main },
    ...manifest.assets.map((asset, index) => ({
      key: blobKey(documentId, generation, index),
      expected: asset,
    })),
  ]
  for (const file of files) {
    const haltedRead = stopped(input)
    if (haltedRead) return fail(haltedRead)
    const read = await store.getBlob(file.key)
    if (read.kind === 'interrupted') return fail({ kind: 'interrupted', reason: 'boundary' })
    if (
      read.kind === 'keystore_locked' ||
      read.kind === 'keyring_unavailable' ||
      read.kind === 'no_session'
    ) {
      return fail(read)
    }
    if (read.kind !== 'ok' || verifyBytes(file.expected, read.bytes) !== 'ok') {
      return fail({ kind: 'corrupt', reason: 'store_mismatch' })
    }
  }
  const final = stopped(input)
  if (final) return fail(final)
  return { kind: 'staged', keys: [...written], bytes: done }
}
