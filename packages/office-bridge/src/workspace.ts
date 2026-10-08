import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { OfficeFileDescriptor } from '@uniwork/office-bridge-contracts'

export interface BridgeSessionMeta {
  sessionId: string
  workProductId: string
  workProductTitle: string
  versionId: string
  versionNumber: number
  baseVersion: number
  fileName: string
  extension: string
  sourceChecksumSha256: string
  localPath: string
  openedAt: string
  saveOperationId: string | null
  idempotencyKey: string | null
}

export function sha256Hex(bytes: Uint8Array | Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function newOpaqueToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`
}

export function newSaveOperationId(): string {
  return randomUUID()
}

export function newIdempotencyKey(): string {
  return randomUUID()
}

export function sessionWorkspaceDir(userDataDir: string, sessionId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error('invalid_session_id')
  return join(userDataDir, 'bridge-sessions', sessionId)
}

function safeFileName(fileName: string): string {
  const base = basename(fileName.replace(/\\/g, '/'))
  if (!base || base === '.' || base === '..') throw new Error('invalid_file_name')
  return base
}

export function writeSessionWorkspace(opts: {
  userDataDir: string
  descriptor: OfficeFileDescriptor
  bytes: Uint8Array
}): BridgeSessionMeta {
  const dir = sessionWorkspaceDir(opts.userDataDir, opts.descriptor.sessionId)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const fileName = safeFileName(opts.descriptor.fileName)
  const localPath = join(dir, fileName)
  writeFileSync(localPath, opts.bytes, { mode: 0o600 })
  const checksum = opts.descriptor.checksumSha256 || sha256Hex(opts.bytes)
  const meta: BridgeSessionMeta = {
    sessionId: opts.descriptor.sessionId,
    workProductId: opts.descriptor.workProductId,
    workProductTitle: opts.descriptor.workProductTitle,
    versionId: opts.descriptor.versionId,
    versionNumber: opts.descriptor.versionNumber,
    baseVersion: opts.descriptor.versionNumber,
    fileName,
    extension: opts.descriptor.extension,
    sourceChecksumSha256: checksum,
    localPath,
    openedAt: new Date().toISOString(),
    saveOperationId: null,
    idempotencyKey: null,
  }
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), { mode: 0o600 })
  return meta
}

export function readSessionMeta(userDataDir: string, sessionId: string): BridgeSessionMeta | null {
  try {
    const raw = readFileSync(join(sessionWorkspaceDir(userDataDir, sessionId), 'meta.json'), 'utf8')
    const parsed = JSON.parse(raw) as BridgeSessionMeta
    return parsed
  } catch {
    return null
  }
}

export function persistSessionMeta(userDataDir: string, meta: BridgeSessionMeta): void {
  const dir = sessionWorkspaceDir(userDataDir, meta.sessionId)
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), { mode: 0o600 })
}

/** Remove a closed session workspace. Never called after a failed save. */
export function removeSessionWorkspace(userDataDir: string, sessionId: string): void {
  rmSync(sessionWorkspaceDir(userDataDir, sessionId), { recursive: true, force: true })
}
