import { createHash } from 'node:crypto'
import { CredentialStoreError } from '../src/main/uniwork-auth/credentials'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import type { DocumentDetail } from '../src/main/uniwork-docs/parse'
import type { StoreScope } from '../src/main/uniwork-sync/keys'
import type { LeaseEffectiveState } from '../src/main/uniwork-sync/lease/manager'
import {
  OFFLINE_LIBRARY_STORE_REGISTRATION,
  createOfflineLibraryManager,
  createOfflineLibraryStore,
  type FetchAssetPort,
  type LibraryDocsPort,
  type LibraryLeasePort,
  type OfflineLibraryManager,
  type OfflineLibraryManagerOptions,
  type OfflineLibraryStore,
} from '../src/main/uniwork-sync/offline-library'
import {
  createStoreLayer,
  recordFileName,
  type StoreFs,
  type StoreLayer,
} from '../src/main/uniwork-sync/store'

/**
 * Fakes of the G5-05 offline library tests: an in-memory filesystem under the
 * real encrypted store layer (so "bytes on disk" is a listing of the fake
 * store root), a documents client that streams in chunks, and a lease port.
 */

export const SCOPE: StoreScope = { deploymentId: 'dep_1', accountId: 'user_1' }
export const ROOT = '/library'
export const ORG = 'org_1'
export const WS = 'ws_1'

const norm = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')
const parentOf = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'

function errno(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException
  error.code = code
  return error
}

export interface MemoryFs extends StoreFs {
  files: Map<string, Uint8Array>
  /** every file path under `prefix` (default: the whole fake disk) */
  listFiles(prefix?: string): string[]
  /** the next writes of a record file fail with ENOSPC while this returns true */
  failWrite: ((path: string, data: Uint8Array) => boolean) | null
}

export function createMemoryFs(): MemoryFs {
  const files = new Map<string, Uint8Array>()
  const dirs = new Set<string>(['/'])
  const addDir = (path: string) => {
    let current = norm(path)
    while (current && current !== '/' && !dirs.has(current)) {
      dirs.add(current)
      current = parentOf(current)
    }
  }
  const fs: MemoryFs = {
    files,
    failWrite: null,
    listFiles(prefix = '/') {
      const base = norm(prefix)
      return [...files.keys()].filter((path) => path === base || path.startsWith(`${base}/`)).sort()
    },
    async mkdir(path) {
      addDir(path)
    },
    async writeFile(path, data) {
      const at = norm(path)
      if (!dirs.has(parentOf(at))) throw errno('ENOENT')
      if (fs.failWrite?.(at, data)) {
        // a full disk leaves a torn (encrypted) temp file behind
        files.set(at, data.slice(0, Math.floor(data.length / 2)))
        throw errno('ENOSPC')
      }
      files.set(at, new Uint8Array(data))
    },
    async syncFile() {},
    renameSync(from, to) {
      const source = files.get(norm(from))
      if (!source) throw errno('ENOENT')
      if (!dirs.has(parentOf(norm(to)))) throw errno('ENOENT')
      files.set(norm(to), source)
      files.delete(norm(from))
    },
    async rm(path) {
      const at = norm(path)
      for (const file of [...files.keys()]) {
        if (file === at || file.startsWith(`${at}/`)) files.delete(file)
      }
      for (const dir of [...dirs]) {
        if (dir === at || dir.startsWith(`${at}/`)) dirs.delete(dir)
      }
    },
    async readFile(path) {
      const found = files.get(norm(path))
      if (!found) throw errno('ENOENT')
      return new Uint8Array(found)
    },
    async list(path) {
      const at = norm(path)
      if (!dirs.has(at)) throw errno('ENOENT')
      const names = new Map<string, boolean>()
      for (const dir of dirs) {
        if (parentOf(dir) === at && dir !== at) names.set(dir.slice(at.length + 1), true)
      }
      for (const file of files.keys()) {
        if (parentOf(file) === at) names.set(file.slice(at.length + 1), false)
      }
      return [...names].map(([name, directory]) => ({ name, directory }))
    },
    async size(path) {
      return files.get(norm(path))?.byteLength ?? null
    },
  }
  return fs
}

export interface FakeKeys {
  key(scope: StoreScope): Promise<Buffer>
  locked: boolean
}

export function createFakeKeys(): FakeKeys {
  const keys: FakeKeys = {
    locked: false,
    async key(scope) {
      if (keys.locked) throw new CredentialStoreError('keystore_locked')
      return createHash('sha256').update(`${scope.deploymentId}/${scope.accountId}`).digest()
    },
  }
  return keys
}

export function createLibraryLayer(
  fs: MemoryFs,
  keys: FakeKeys,
  budgetBytes = 64 * 1024 * 1024,
): StoreLayer {
  let tick = 0
  const layer = createStoreLayer({
    root: ROOT,
    keys,
    budgetBytes,
    clock: () => 1_700_000_000_000 + tick++,
    fs,
  })
  layer.register(OFFLINE_LIBRARY_STORE_REGISTRATION)
  return layer
}

/** the on-disk file name of a library record key (`.rec` under the store folder) */
export function recordFile(key: string): string {
  return `${ROOT}/${SCOPE.deploymentId}/${SCOPE.accountId}/${OFFLINE_LIBRARY_STORE_REGISTRATION.name}/${recordFileName(key)}`
}

export const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** bytes with a marker no encrypted record could contain by chance */
export function plaintext(label: string, size = 4096): Uint8Array {
  const marker = Buffer.from(`PLAINTEXT-${label}-`, 'utf8')
  const out = Buffer.alloc(size)
  for (let offset = 0; offset < size; offset += marker.length) marker.copy(out, offset)
  return new Uint8Array(out)
}

export interface FakeDoc {
  bytes: Uint8Array
  version: number
  archivedAt?: string | null
  /** the checksum/size the server declares (default: of `bytes`) */
  declaredSha?: string
  declaredSize?: number
  error?: UniworkDocError
}

export interface FakeDocs extends LibraryDocsPort {
  docs: Map<string, FakeDoc>
  chunkSize: number
  /** awaited before every chunk is delivered; throw to break the stream */
  beforeChunk: ((documentId: string, index: number) => Promise<void> | void) | null
  downloads: string[]
}

export function detailOf(documentId: string, doc: FakeDoc): DocumentDetail {
  return {
    id: documentId,
    organizationId: ORG,
    workspaceId: WS,
    title: `${documentId}.docx`,
    revision: '7',
    currentVersion: doc.version,
    myLevel: 'edit',
    archivedAt: doc.archivedAt ?? null,
    file: {
      filename: `${documentId}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      version: doc.version,
      versionId: `ver_${doc.version}`,
      checksumSha256: doc.declaredSha ?? sha(doc.bytes),
      sizeBytes: doc.declaredSize ?? doc.bytes.byteLength,
    },
  }
}

export function createFakeDocs(): FakeDocs {
  const fake: FakeDocs = {
    docs: new Map(),
    chunkSize: 1024,
    beforeChunk: null,
    downloads: [],
    async getDocument(documentId) {
      const doc = fake.docs.get(documentId)
      if (!doc) throw new UniworkDocError('not_found')
      if (doc.error) throw doc.error
      return detailOf(documentId, doc)
    },
    async downloadStream(documentId, version, options = {}) {
      fake.downloads.push(`${documentId}@${version}`)
      const doc = fake.docs.get(documentId)
      if (!doc) throw new UniworkDocError('not_found')
      const total = doc.bytes.byteLength
      let received = 0
      let index = 0
      while (received < total) {
        if (options.signal?.aborted) throw new UniworkDocError('network')
        await fake.beforeChunk?.(documentId, index)
        if (options.signal?.aborted) throw new UniworkDocError('network')
        received = Math.min(total, received + fake.chunkSize)
        index += 1
        options.onProgress?.({ receivedBytes: received, totalBytes: total })
      }
      return { bytes: new Uint8Array(doc.bytes) }
    },
  }
  return fake
}

export function leaseState(
  state: LeaseEffectiveState['state'],
  level: 'view' | 'edit' | null = 'edit',
): LeaseEffectiveState {
  const usable = state === 'valid' || state === 'expiring_soon'
  return {
    state,
    kind: state,
    level,
    usable,
    locked: !usable && state !== 'none',
  }
}

export interface FakeLeases extends LibraryLeasePort {
  states: Map<string, LeaseEffectiveState>
  grants: string[]
  releases: string[]
  grantResult: 'renewed' | 'capability_off' | 'revoked'
}

export function createFakeLeases(): FakeLeases {
  const fake: FakeLeases = {
    states: new Map(),
    grants: [],
    releases: [],
    grantResult: 'renewed',
    async effectiveState(documentId) {
      return fake.states.get(documentId) ?? leaseState('none', null)
    },
    async grant(documentId) {
      fake.grants.push(documentId)
      if (fake.grantResult === 'renewed') fake.states.set(documentId, leaseState('valid'))
      const state = await fake.effectiveState(documentId)
      return { kind: fake.grantResult, state } as Awaited<ReturnType<LibraryLeasePort['grant']>>
    },
    async release(documentId) {
      fake.releases.push(documentId)
      fake.states.delete(documentId)
    },
  }
  return fake
}

export interface Harness {
  fs: MemoryFs
  keys: FakeKeys
  layer: StoreLayer
  store: OfflineLibraryStore
  docs: FakeDocs
  leases: FakeLeases
  manager: OfflineLibraryManager
  capability: { on: boolean }
  online: { on: boolean }
  session: { scope: StoreScope | null; id: string }
  localWork: Set<string>
  /** every record file of the library store on the fake disk */
  storeFiles(): string[]
}

export function createHarness(
  overrides: Partial<OfflineLibraryManagerOptions> & {
    budgetBytes?: number
    fetchAsset?: FetchAssetPort
  } = {},
): Harness {
  const fs = createMemoryFs()
  const keys = createFakeKeys()
  const layer = createLibraryLayer(fs, keys, overrides.budgetBytes)
  const session = { scope: SCOPE as StoreScope | null, id: 'sess_1' }
  const store = createOfflineLibraryStore({ layer, scope: () => session.scope })
  const docs = createFakeDocs()
  const leases = createFakeLeases()
  const capability = { on: true }
  const online = { on: true }
  const localWork = new Set<string>()
  let generation = 0
  const manager = createOfflineLibraryManager({
    store,
    scope: () => session.scope,
    session: () => (session.scope ? session.id : null),
    docs: () => (online.on ? docs : null),
    leases,
    capability: async () => capability.on,
    hasLocalWork: async (documentId) => localWork.has(documentId),
    clock: { now: () => 1_760_000_000_000 },
    newGeneration: () => `${(++generation).toString(16).padStart(8, '0')}`,
    ...overrides,
  })
  return {
    fs,
    keys,
    layer,
    store,
    docs,
    leases,
    manager,
    capability,
    online,
    session,
    localWork,
    storeFiles: () => fs.listFiles(ROOT),
  }
}

/** a fake document with distinctive plaintext bytes */
export function addDoc(
  h: Pick<Harness, 'docs'>,
  documentId: string,
  version = 1,
  size = 4096,
): FakeDoc {
  const doc: FakeDoc = { bytes: plaintext(`${documentId}-v${version}`, size), version }
  h.docs.docs.set(documentId, doc)
  return doc
}

/** every file on the fake disk whose bytes contain `needle` */
export function filesContaining(fs: MemoryFs, needle: Uint8Array): string[] {
  const probe = Buffer.from(needle.slice(0, 64))
  return [...fs.files].filter(([, bytes]) => Buffer.from(bytes).includes(probe)).map(([p]) => p)
}
