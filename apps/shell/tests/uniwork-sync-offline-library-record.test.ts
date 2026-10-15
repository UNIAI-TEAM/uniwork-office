import { describe, expect, it } from 'vitest'
import {
  PIN_RECORD_SCHEMA,
  S3_PRIORITY,
  decodePinRecord,
  effectiveRowState,
  encodePinRecord,
  isAssetPath,
  manifestBytes,
  manifestFromDetail,
  parseManifest,
  parsePinRecord,
  rowStateOf,
  sameSnapshot,
  verifyBytes,
  type PinManifest,
  type PinRecord,
  type PinRowState,
} from '../src/main/uniwork-sync/offline-library'
import { detailOf, leaseState, plaintext, sha } from './uniwork-sync-offline-library-fakes'

const BYTES = plaintext('record', 100)

const MANIFEST: PinManifest = {
  main: {
    version: 3,
    versionId: 'ver_3',
    sha256: sha(BYTES),
    sizeBytes: 100,
    filename: 'a.docx',
    mimeType: 'application/octet-stream',
  },
  assets: [],
}

function record(overrides: Partial<PinRecord> = {}): PinRecord {
  return {
    schema: PIN_RECORD_SCHEMA,
    documentId: 'doc_1',
    scope: { orgId: 'org_1', workspaceId: 'ws_1' },
    manifest: MANIFEST,
    readyManifest: MANIFEST,
    readyGeneration: '0000000a',
    readyVersion: 3,
    state: 'ready',
    progress: null,
    bytes: 100,
    pinnedAt: 1,
    lastVerifiedAt: 2,
    staging: null,
    updateAvailable: false,
    updateKept: false,
    archived: false,
    ...overrides,
  }
}

describe('S3 priority order table (EXPERIENCE › Offline library rows)', () => {
  // the spine's line, tier by tier: revoked/deleted > lease-expired/locked >
  // disk-full/corrupt > interrupted > downloading/verifying > lease-expiring >
  // update-available/update kept > waiting-network > archived/moved > ready/view-only
  const tiers: PinRowState[][] = [
    ['revoked', 'deleted'],
    ['lease-expired', 'locked'],
    ['disk-full', 'corrupt'],
    ['interrupted'],
    ['downloading', 'verifying'],
    ['lease-expiring'],
    ['update-available', 'update-kept'],
    ['waiting-network'],
    ['archived', 'moved'],
    ['view-only', 'ready'],
  ]

  it('lists every row state exactly once, in the spine order', () => {
    expect(S3_PRIORITY).toEqual(tiers.flat())
  })

  for (const [high, higherTier] of tiers.entries()) {
    for (const lowerTier of tiers.slice(high + 1)) {
      it(`${higherTier.join('/')} outranks ${lowerTier.join('/')}`, () => {
        for (const winner of higherTier) {
          for (const loser of lowerTier) {
            expect(effectiveRowState([loser, winner])).toBe(winner)
            expect(effectiveRowState([winner, loser])).toBe(winner)
          }
        }
      })
    }
  }

  it('a row whose copy is deleted but whose lease also expired shows deleted', () => {
    expect(rowStateOf(record({ state: 'deleted' }), leaseState('expired'))).toBe('deleted')
  })

  it('an archived ready row opens and shows archived; at lease end it shows lease-expired', () => {
    const archived = record({ archived: true })
    expect(rowStateOf(archived, leaseState('valid'))).toBe('archived')
    expect(rowStateOf(archived, leaseState('expiring_soon'))).toBe('lease-expiring')
    expect(rowStateOf(archived, leaseState('expired'))).toBe('lease-expired')
  })

  it('an update kept on a held copy shows update-kept; interrupted outranks it', () => {
    expect(rowStateOf(record({ updateKept: true }), leaseState('valid'))).toBe('update-kept')
    expect(
      rowStateOf(record({ state: 'interrupted', updateKept: true }), leaseState('valid')),
    ).toBe('interrupted')
  })

  it('a view lease on a ready copy shows view-only; a locked keystore shows locked', () => {
    expect(rowStateOf(record(), leaseState('valid', 'view'))).toBe('view-only')
    expect(rowStateOf(record(), leaseState('keystore_locked', null))).toBe('locked')
    expect(rowStateOf(record(), leaseState('none', null))).toBe('locked')
    expect(rowStateOf(record(), leaseState('revoked', null))).toBe('revoked')
  })

  it('a pin with no copy yet and no lease waits for the network', () => {
    const waiting = record({
      state: 'waiting-network',
      readyManifest: null,
      readyGeneration: null,
      readyVersion: null,
      bytes: 0,
    })
    expect(rowStateOf(waiting, leaseState('none', null))).toBe('waiting-network')
  })
})

describe('pin record codec (schema-versioned, malformed -> refused)', () => {
  it('round-trips a valid row', () => {
    const row = record({ progress: { receivedBytes: 5, totalBytes: 100 }, failure: 'store_full' })
    expect(decodePinRecord(encodePinRecord(row))).toEqual(row)
  })

  it('refuses a newer schema, a bad id, a torn copy and a bad state', () => {
    expect(parsePinRecord({ ...record(), schema: 2 })).toBeNull()
    expect(parsePinRecord({ ...record(), documentId: '../x' })).toBeNull()
    expect(parsePinRecord({ ...record(), readyGeneration: null })).toBeNull()
    expect(parsePinRecord({ ...record(), state: 'pinned' })).toBeNull()
    expect(parsePinRecord({ ...record(), staging: { generation: 'zz', keys: [] } })).toBeNull()
    expect(decodePinRecord(new TextEncoder().encode('{not json'))).toBeNull()
    expect(() => encodePinRecord({ ...record(), bytes: -1 })).toThrow()
  })
})

describe('manifest', () => {
  it('v1 builds the main file from GET /documents/{id} with no asset', () => {
    const detail = detailOf('doc_1', { bytes: BYTES, version: 3 })
    const manifest = manifestFromDetail(detail)
    expect(manifest).toEqual({
      ...MANIFEST,
      main: { ...MANIFEST.main, filename: 'doc_1.docx', mimeType: detail.file.mimeType },
    })
    expect(manifest.assets).toEqual([])
  })

  it('parses declared assets and refuses a traversal, an absolute path or a duplicate', () => {
    const asset = { path: 'media/image1.png', sha256: sha(BYTES), sizeBytes: 100 }
    const parsed = parseManifest({ ...MANIFEST, assets: [asset] })
    expect(parsed?.assets).toEqual([asset])
    expect(manifestBytes(parsed!)).toBe(200)
    expect(parseManifest({ ...MANIFEST, assets: [{ ...asset, path: '../x' }] })).toBeNull()
    expect(parseManifest({ ...MANIFEST, assets: [{ ...asset, path: '/etc/x' }] })).toBeNull()
    expect(parseManifest({ ...MANIFEST, assets: [asset, asset] })).toBeNull()
    expect(parseManifest({ ...MANIFEST, assets: [{ ...asset, sha256: 'nope' }] })).toBeNull()
    expect(isAssetPath('a\\b')).toBe(false)
    expect(isAssetPath('C:/x')).toBe(false)
  })

  it('verifies size first, then the checksum', () => {
    expect(verifyBytes(MANIFEST.main, BYTES)).toBe('ok')
    expect(verifyBytes(MANIFEST.main, BYTES.slice(0, 99))).toBe('size_mismatch')
    const flipped = new Uint8Array(BYTES)
    flipped[0] ^= 1
    expect(verifyBytes(MANIFEST.main, flipped)).toBe('checksum_mismatch')
  })

  it('a different version or asset list is a different snapshot', () => {
    expect(sameSnapshot(MANIFEST, { ...MANIFEST })).toBe(true)
    expect(sameSnapshot(MANIFEST, { ...MANIFEST, main: { ...MANIFEST.main, version: 4 } })).toBe(
      false,
    )
    expect(
      sameSnapshot(MANIFEST, {
        ...MANIFEST,
        assets: [{ path: 'a.png', sha256: sha(BYTES), sizeBytes: 100 }],
      }),
    ).toBe(false)
  })
})
