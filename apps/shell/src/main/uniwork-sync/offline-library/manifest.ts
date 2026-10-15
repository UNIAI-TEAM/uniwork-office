import type { DocumentDetail } from '../../uniwork-docs/parse'
import { sha256Hex } from '../../uniwork-docs/formats'

/**
 * The pin manifest (G5-05, G5-A04): the main file of one document version and
 * every asset the snapshot declares, each with its SHA-256 and size. A pin is
 * ready only when every declared file was received and matched.
 *
 * v1 builds it from `GET /documents/{id}` with `assets: []` (Advisor Q1): the
 * server has no asset manifest or asset route yet. The engine still verifies
 * declared assets, so a later route plugs in through the `fetchAsset` port.
 */

/** the 256 MiB cap of one download (U-01, `uniwork-docs/client.ts` MAX_DOWNLOAD_BYTES) */
export const MAX_PIN_FILE_BYTES = 256 * 1024 * 1024

export interface ManifestFile {
  version: number
  versionId?: string
  /** lowercase hex */
  sha256: string
  sizeBytes: number
  filename: string
  mimeType: string
}

export interface ManifestAsset {
  /** relative path inside the snapshot, `/`-separated, never absolute or `..` */
  path: string
  sha256: string
  sizeBytes: number
}

export interface PinManifest {
  main: ManifestFile
  assets: ManifestAsset[]
}

export type VerifyResult = 'ok' | 'size_mismatch' | 'checksum_mismatch'

const SHA256 = /^[0-9a-f]{64}$/
const MAX_ASSETS = 512
const MAX_PATH = 512

function isSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** a relative, `/`-separated path with no traversal, drive or control character */
export function isAssetPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_PATH) return false
  if (value.startsWith('/') || value.includes('\\') || value.includes(':')) return false
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(value)) return false
  return value.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
}

/** the manifest of the document's current version; v1 declares no asset */
export function manifestFromDetail(detail: DocumentDetail): PinManifest {
  return {
    main: {
      version: detail.file.version,
      ...(detail.file.versionId ? { versionId: detail.file.versionId } : {}),
      sha256: detail.file.checksumSha256.toLowerCase(),
      sizeBytes: detail.file.sizeBytes,
      filename: detail.file.filename,
      mimeType: detail.file.mimeType,
    },
    assets: [],
  }
}

/** a stored or received manifest, or null when any field is malformed */
export function parseManifest(raw: unknown): PinManifest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const main = r.main
  if (!main || typeof main !== 'object' || Array.isArray(main)) return null
  const m = main as Record<string, unknown>
  if (!isSize(m.version)) return null
  if (m.versionId !== undefined && (typeof m.versionId !== 'string' || m.versionId.length === 0))
    return null
  if (typeof m.sha256 !== 'string' || !SHA256.test(m.sha256)) return null
  if (!isSize(m.sizeBytes)) return null
  if (typeof m.filename !== 'string' || typeof m.mimeType !== 'string') return null
  if (!Array.isArray(r.assets) || r.assets.length > MAX_ASSETS) return null
  const assets: ManifestAsset[] = []
  const seen = new Set<string>()
  for (const entry of r.assets as unknown[]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
    const a = entry as Record<string, unknown>
    if (!isAssetPath(a.path) || seen.has(a.path)) return null
    if (typeof a.sha256 !== 'string' || !SHA256.test(a.sha256)) return null
    if (!isSize(a.sizeBytes)) return null
    seen.add(a.path)
    assets.push({ path: a.path, sha256: a.sha256, sizeBytes: a.sizeBytes })
  }
  return {
    main: {
      version: m.version,
      ...(m.versionId !== undefined ? { versionId: m.versionId as string } : {}),
      sha256: m.sha256,
      sizeBytes: m.sizeBytes,
      filename: m.filename,
      mimeType: m.mimeType,
    },
    assets,
  }
}

/** every byte the manifest declares: the quota counts this */
export function manifestBytes(manifest: PinManifest): number {
  return manifest.assets.reduce((sum, asset) => sum + asset.sizeBytes, manifest.main.sizeBytes)
}

/** the largest single file the manifest declares (the 256 MiB cap applies per file) */
export function largestFileBytes(manifest: PinManifest): number {
  return manifest.assets.reduce(
    (largest, asset) => Math.max(largest, asset.sizeBytes),
    manifest.main.sizeBytes,
  )
}

/** the same snapshot: version, checksum and every asset */
export function sameSnapshot(a: PinManifest, b: PinManifest): boolean {
  if (a.main.version !== b.main.version || a.main.sha256 !== b.main.sha256) return false
  if (a.main.sizeBytes !== b.main.sizeBytes || a.assets.length !== b.assets.length) return false
  return a.assets.every((asset, index) => {
    const other = b.assets[index]
    return (
      other !== undefined &&
      other.path === asset.path &&
      other.sha256 === asset.sha256 &&
      other.sizeBytes === asset.sizeBytes
    )
  })
}

/** received or stored bytes against what the manifest declares */
export function verifyBytes(
  expected: { sha256: string; sizeBytes: number },
  bytes: Uint8Array,
): VerifyResult {
  if (bytes.byteLength !== expected.sizeBytes) return 'size_mismatch'
  return sha256Hex(bytes) === expected.sha256 ? 'ok' : 'checksum_mismatch'
}
