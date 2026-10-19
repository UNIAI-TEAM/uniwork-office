import type { UniworkDocsClient } from '../uniwork-docs/client'
import { UniworkDocError } from '../uniwork-docs/errors'
import type { UniworkDocFormat } from '../../shared/home-api'
import type { DocumentLimits } from '../uniwork-docs/limits'
import {
  abortUploadSession,
  readLocalFileProbe,
  runChunkedUpload,
  shouldUseChunkedUpload,
  type ChunkedUploadPhase,
  type SavedUploadSession,
  type UploadSessionClient,
} from '../uniwork-docs/upload-session'

/** the session routes a NEW-VERSION upload drives (no workspace create) */
export type DocumentUploadSessionClient = Pick<
  UniworkDocsClient,
  | 'createDocumentUploadSession'
  | 'getUploadSession'
  | 'completeUploadSession'
  | 'deleteUploadSession'
  | 'putUploadPart'
>

/**
 * The client surface the shared new-version upload helper uses: the existing
 * single-request `upload` plus the optional session routes for payloads above
 * `limits.chunked_upload_threshold_bytes`.
 */
export interface VersionUploadClient {
  upload(input: {
    documentId: string
    bytes: Uint8Array
    filename: string
    format: UniworkDocFormat
    idempotencyKey: string
  }): Promise<{ uploadId: string; checksumSha256: string }>
  uploadSession?: DocumentUploadSessionClient
}

export interface VersionUploadInput {
  documentId: string
  filename: string
  format: string
  bytes: Uint8Array
  idempotencyKey: string
  limits: DocumentLimits
  /**
   * UNI-1918 (B69-lite): the attempt of the durable intent this upload serves.
   * The COMMIT key never changes, but the UPLOAD key must: FileService never
   * resurrects an expired staged session, so re-uploading under the key of a
   * dead claim answers `file_claim_expired` again. Attempt 0 keeps the bare
   * commit key (records written before this change stay replayable); every
   * later attempt stages under `${commitKey}:u${attempt}`.
   */
  attempt?: number
  resume?: SavedUploadSession
  signal?: AbortSignal
  onProgress?: (loaded: number, total: number) => void
  onPhase?: (phase: ChunkedUploadPhase) => void
  onSessionState?: (state: SavedUploadSession | undefined) => void | Promise<void>
}

/**
 * UNI-1918 (B69-lite): the upload key of one attempt of one commit intent.
 * Attempt 0 is the bare commit key (the shape every record written before this
 * change already carries); a later attempt gets its own key, so a new staged
 * upload is never sent under a claim the server has already retired.
 */
export function uploadKeyFor(commitKey: string, attempt: number): string {
  return attempt === 0 ? commitKey : `${commitKey}:u${attempt}`
}

/** how many derived session-create keys one version upload tries on a 409 payload mismatch */
const VERSION_SESSION_KEY_ATTEMPTS = 4

function toUploadSessionClient(session: DocumentUploadSessionClient): UploadSessionClient {
  return {
    ...session,
    createWorkspaceUploadSession: async () => {
      throw new UniworkDocError('malformed_response')
    },
  }
}

/**
 * Cancels one document-version upload session via `abortUploadSession` from
 * `upload-session.ts` without requiring `createWorkspaceUploadSession` on the
 * caller's client.
 */
export async function abortVersionUploadSession(
  client: DocumentUploadSessionClient,
  sessionId: string,
): Promise<void> {
  await abortUploadSession(toUploadSessionClient(client), sessionId)
}

/**
 * BIGUP-A1 (W2): upload one new version of an existing document, shared by
 * `SaveCoordinator.uploadAndCommit` and `QueueDispatcher.runOne`. Payloads at
 * or under `limits.chunked_upload_threshold_bytes` (or when no threshold /
 * session routes exist) take today's `client.upload` unchanged. Payloads above
 * the threshold build the local probe from `bytes`, run `runChunkedUpload` with
 * target `{ kind: 'document', documentId }` and `readRange = bytes.subarray`,
 * and return `{ uploadId, checksumSha256 }` matching `client.upload`.
 */
export async function uploadVersionBytes(
  client: VersionUploadClient,
  input: VersionUploadInput,
): Promise<{ uploadId: string; checksumSha256: string }> {
  const size = input.bytes.byteLength
  const session = client.uploadSession
  // UNI-1918 (B69-lite): the key this attempt stages its bytes under. The
  // commit key stays `input.idempotencyKey`; only the upload key moves with
  // the attempt (see `uploadKeyFor`).
  const uploadKey = uploadKeyFor(input.idempotencyKey, input.attempt ?? 0)
  if (!session || !shouldUseChunkedUpload(size, input.limits)) {
    if (input.resume && session) {
      await abortVersionUploadSession(session, input.resume.sessionId).catch(() => undefined)
    }
    if (input.resume) {
      await input.onSessionState?.(undefined)
    }
    return await client.upload({
      documentId: input.documentId,
      bytes: input.bytes,
      filename: input.filename,
      format: input.format as UniworkDocFormat,
      idempotencyKey: uploadKey,
    })
  }

  const probe = await readLocalFileProbe({ bytes: input.bytes }, size, input.filename)
  const sessionClient = toUploadSessionClient(session)
  let resume = input.resume
  // R2-BE-02: a call starting from a persisted `resume` namespaces its derived
  // restart/next keys by the resumed session id (`${K}:r:${sessionId}:s${n}`),
  // so a second call resuming a later dead session never replays the create key
  // an earlier call already committed to the server's idempotency ledger.
  const keyBase = resume ? `${uploadKey}:r:${resume.sessionId}` : uploadKey
  let keyIndex = 0
  const nextKey = (): string => `${keyBase}:s${(keyIndex += 1)}`
  for (let attempt = 0; attempt < VERSION_SESSION_KEY_ATTEMPTS; attempt += 1) {
    try {
      const result = await runChunkedUpload(sessionClient, {
        target: { kind: 'document', documentId: input.documentId },
        filename: input.filename,
        size,
        readRange: async (offset, length) => input.bytes.subarray(offset, offset + length),
        probe,
        idempotencyKey: `${keyBase}:s${keyIndex}`,
        freshIdempotencyKey: nextKey,
        ...(resume ? { resume } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.onProgress ? { onProgress: input.onProgress } : {}),
        ...(input.onPhase ? { onPhase: input.onPhase } : {}),
        ...(input.onSessionState ? { onSessionState: input.onSessionState } : {}),
      })
      if (result.kind !== 'upload') {
        throw new UniworkDocError('malformed_response')
      }
      return result.upload
    } catch (error) {
      if (error instanceof UniworkDocError && error.serverCode === 'upload_session_too_small') {
        return await client.upload({
          documentId: input.documentId,
          bytes: input.bytes,
          filename: input.filename,
          format: input.format as UniworkDocFormat,
          idempotencyKey: uploadKey,
        })
      }
      const mismatch =
        error instanceof UniworkDocError &&
        (error.serverCode === 'idempotency_payload_mismatch' ||
          error.code === 'idempotency_mismatch')
      if (mismatch && attempt + 1 < VERSION_SESSION_KEY_ATTEMPTS) {
        resume = undefined
        nextKey()
        continue
      }
      throw error
    }
  }
  throw new UniworkDocError('server_error')
}
