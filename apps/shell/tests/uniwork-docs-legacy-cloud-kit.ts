import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, vi } from 'vitest'
import type { UniworkDocStatus, UniworkLaunchEvent } from '../src/shared/home-api'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import { BINDING_FILE } from '../src/main/uniwork-docs/binding-store'
import type {
  CloudConvertOutcome,
  CloudLegacyConvertInput,
} from '../src/main/uniwork-docs/legacy-cloud-open'
import { INTENT_STORE_REGISTRATION, createIntentStore } from '../src/main/uniwork-sync/intent-store'
import { DRAFTS_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/drafts'
import { PAUSE_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/pause'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { createSyncStoreAccess } from '../src/main/uniwork-sync/session-store'
import { createStoreLayer, type StoreLayer } from '../src/main/uniwork-sync/store'
import { createLockableSafeStorage } from '../src/main/uniwork-sync/test-kit/compliance'

/**
 * UNI-2212 (C4) test kit: a small UniWork server that follows the c5 wire contract
 * (contracts/c5-wire.md - staged uploads, `conversion` on the commit, the 422
 * legacy_conversion_invalid reasons, the title suffix rewrite, `converted_version`) and the real
 * service wired to it. The flow tests drive the real service, binding store and save paths.
 */

const TOKEN = 'secret-access-token-0123456789'
const profile: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: 'https://uniwork.example',
  clientId: 'uniwork-office',
  channel: 'stable',
}
export const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
export const enc = (text: string) => new TextEncoder().encode(text)
export const hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export const OOXML_MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
} as const
export const LEGACY_MIME = {
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
} as const
const MAIN_PART = {
  docx: 'word/document.xml',
  xlsx: 'xl/workbook.xml',
  pptx: 'ppt/presentation.xml',
} as const
export type Ooxml = keyof typeof OOXML_MIME
export type Legacy = keyof typeof LEGACY_MIME
export const TARGET: Record<Legacy, Ooxml> = { doc: 'docx', xls: 'xlsx', ppt: 'pptx' }

/** a minimal valid OOXML package of one family (the shape the converter hands back) */
export async function ooxml(kind: Ooxml, marker = 'converted'): Promise<Uint8Array> {
  const zip = new JSZip()
  // a fixed date keeps two builds of the same package byte-identical
  const date = new Date('2000-01-01T00:00:00Z')
  zip.file('[Content_Types].xml', '<Types/>', { date })
  zip.file(MAIN_PART[kind], `<root>${marker}</root>`, { date })
  return zip.generateAsync({ type: 'uint8array' })
}

/** the real legacy fixtures: compound files the app recognises by their streams */
const FIXTURES = join(import.meta.dirname, 'fixtures', 'legacy')
export const legacyBytes: Record<Legacy, Uint8Array> = {
  xls: new Uint8Array(readFileSync(join(FIXTURES, 'vn-budget.xls'))),
  doc: new Uint8Array(readFileSync(join(FIXTURES, 'g0-legacy-sample.doc'))),
  ppt: new Uint8Array(readFileSync(join(FIXTURES, 'poi-WithMaster.ppt'))),
}

interface VersionRow {
  bytes: Uint8Array
  mime: string
  filename: string
  reason: string
}
interface Call {
  method: string
  path: string
  query: string
  headers: Record<string, string>
  body?: unknown
}

/** the c5 server rules, nothing else: enough to prove the app's side of the contract */
export function fakeServer(initial: {
  legacy?: Legacy
  title?: string
  filename?: string
  myLevel?: string
  /** the live version is already this OOXML (a converted document) */
  ooxml?: Ooxml
  /** the live version's MIME type, when it is none of the OOXML or legacy ones (a PDF, text ...) */
  mime?: string
  bytes?: Uint8Array
  /** a second version on top of the first: the document was converted and saved (title already rewritten) */
  converted?: { bytes: Uint8Array; kind: Ooxml }
}) {
  const kind = initial.legacy
  const versions: VersionRow[] = [
    kind
      ? {
          bytes: initial.bytes ?? legacyBytes[kind],
          mime: LEGACY_MIME[kind],
          filename: initial.filename ?? `budget.${kind}`,
          reason: 'upload',
        }
      : {
          bytes: initial.bytes ?? enc('ordinary'),
          mime: initial.mime ?? OOXML_MIME[initial.ooxml ?? 'docx'],
          filename: initial.filename ?? `plan.${initial.ooxml ?? 'docx'}`,
          reason: 'upload',
        },
  ]
  if (initial.converted) {
    const last = versions[0]!
    versions.push({
      bytes: initial.converted.bytes,
      mime: OOXML_MIME[initial.converted.kind],
      filename: last.filename.replace(/\.[^.]+$/, `.${initial.converted.kind}`),
      reason: 'converted_version',
    })
  }
  const state = {
    revision: versions.length,
    title: initial.title ?? (kind ? `Budget.${kind}` : 'Plan.docx'),
    myLevel: initial.myLevel ?? 'edit',
  }
  const calls: Call[] = []
  const faults: Array<{
    route: 'upload' | 'commit'
    status: number
    code: string
    reason?: string
  }> = []
  const uploads = new Map<string, { id: string; bytes: Uint8Array; mime: string | null }>()
  const commits = new Map<string, { fingerprint: string; result: unknown }>()
  let seq = 0

  const head = () => versions[versions.length - 1]!
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const refuse = (status: number, code: string, fields?: Record<string, unknown>) =>
    json(status, { error: { code, message: 'x', ...(fields ? { fields } : {}) } })
  const docJson = () => ({
    id: DOC,
    organization_id: 'org_a',
    workspace_id: 'ws_1',
    title: state.title,
    kind: 'file',
    revision: String(state.revision),
    current_version: versions.length,
    my_level: state.myLevel,
    file: {
      file_id: `f${versions.length}`,
      version_id: `ver_${versions.length}`,
      version: versions.length,
      filename: head().filename,
      mime_type: head().mime,
      size_bytes: head().bytes.byteLength,
      checksum_sha256: hex(head().bytes),
    },
  })

  /** the staged file's OOXML family from its package (null = not an OOXML package) */
  async function familyOf(bytes: Uint8Array): Promise<Ooxml | null> {
    try {
      const zip = await JSZip.loadAsync(bytes)
      if (!zip.file('[Content_Types].xml')) return null
      for (const [family, part] of Object.entries(MAIN_PART)) {
        if (zip.file(part)) return family as Ooxml
      }
    } catch {
      // not a zip
    }
    return null
  }

  const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url)
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [
        k.toLowerCase(),
        v,
      ]),
    )
    const call: Call = {
      method: init.method ?? 'GET',
      path: u.pathname,
      query: u.search,
      headers,
    }
    calls.push(call)
    const key = headers['idempotency-key'] ?? ''
    if (u.pathname === `/api/v1/documents/${DOC}` && call.method === 'GET') {
      return json(200, { document: docJson() })
    }
    const numbered = new RegExp(`^/api/v1/documents/${DOC}/versions/(\\d+)$`).exec(u.pathname)
    if (numbered && call.method === 'GET') {
      const no = Number(numbered[1])
      if (no < 1 || no > versions.length) return refuse(404, 'not_found')
      return json(200, { version: { id: `ver_${no}`, document_id: DOC, version: no } })
    }
    if (u.pathname === `/api/v1/documents/${DOC}/download`) {
      const no = Number(u.searchParams.get('version') ?? versions.length)
      const row = versions[no - 1]
      if (!row) return refuse(404, 'not_found')
      return new Response(row.bytes as BodyInit, { status: 200 })
    }
    if (u.pathname === `/api/v1/documents/${DOC}/uploads`) {
      const file = (init.body as FormData).get('file') as Blob
      const bytes = new Uint8Array(await file.arrayBuffer())
      call.body = { bytes, name: (file as File).name }
      const fault = faults.findIndex((f) => f.route === 'upload')
      if (fault >= 0) {
        const f = faults.splice(fault, 1)[0]!
        return refuse(f.status, f.code)
      }
      const family = await familyOf(bytes)
      const upload = uploads.get(key) ?? {
        id: `up_${++seq}`,
        bytes,
        mime: family ? OOXML_MIME[family] : null,
      }
      uploads.set(key, upload)
      return json(201, {
        upload_id: upload.id,
        checksum_sha256: hex(bytes),
        size_bytes: bytes.byteLength,
        claim_expires_at: '2026-10-30T00:00:00Z',
      })
    }
    if (u.pathname === `/api/v1/documents/${DOC}/versions/commit` && call.method === 'GET') {
      const stored = commits.get(key)
      return stored
        ? json(200, { outcome: 'committed', version_id: 'ver_2', version: 2, revision: '2' })
        : json(200, { outcome: 'not_committed' })
    }
    if (u.pathname === `/api/v1/documents/${DOC}/versions/commit`) {
      const body = JSON.parse(String(init.body)) as {
        upload_id: string
        base_revision: string
        conversion?: { from_format: string; to_format: string }
      }
      call.body = body
      const fault = faults.findIndex((f) => f.route === 'commit')
      if (fault >= 0) {
        const f = faults.splice(fault, 1)[0]!
        return refuse(f.status, f.code, f.reason ? { reason: f.reason } : undefined)
      }
      const conversion = body.conversion
      const fingerprint = `${body.upload_id}|${body.base_revision}|${
        conversion ? `${conversion.from_format}->${conversion.to_format}` : ''
      }`
      const replay = commits.get(key)
      if (replay) {
        return replay.fingerprint === fingerprint
          ? json(200, replay.result)
          : refuse(409, 'idempotency_payload_mismatch')
      }
      if (state.myLevel !== 'edit' && state.myLevel !== 'manage') {
        return json(403, {
          error: { code: 'forbidden', message: 'forbidden', error_class: 'permission' },
        })
      }
      if (conversion) {
        const okFrom = ['doc', 'xls', 'ppt'].includes(conversion.from_format)
        const okTo = ['docx', 'xlsx', 'pptx'].includes(conversion.to_format)
        if (!okFrom || !okTo) return refuse(400, 'invalid_request')
      }
      const upload = [...uploads.values()].find((x) => x.id === body.upload_id)
      if (!upload) return refuse(409, 'document_upload_invalid')
      if (conversion && upload.mime === null) {
        return refuse(422, 'legacy_conversion_invalid', { reason: 'not_ooxml' })
      }
      if (body.base_revision !== String(state.revision)) {
        return refuse(409, 'document_version_conflict', {
          current_revision: String(state.revision),
        })
      }
      const live = head()
      const liveLegacy = (Object.keys(LEGACY_MIME) as Legacy[]).find(
        (l) => LEGACY_MIME[l] === live.mime,
      )
      if (!conversion) {
        if (upload.mime !== live.mime) {
          return refuse(415, 'unsupported_media_type', { reason: 'format_changed' })
        }
      } else {
        if (!liveLegacy) return refuse(422, 'legacy_conversion_invalid', { reason: 'not_legacy' })
        const to = TARGET[conversion.from_format as Legacy]
        if (conversion.from_format !== liveLegacy || conversion.to_format !== to) {
          return refuse(422, 'legacy_conversion_invalid', { reason: 'target_mismatch' })
        }
        if (upload.mime !== OOXML_MIME[to]) {
          return refuse(422, 'legacy_conversion_invalid', { reason: 'not_ooxml' })
        }
      }
      const converted = conversion ? TARGET[liveLegacy!] : null
      versions.push({
        bytes: upload.bytes,
        mime: upload.mime!,
        filename: converted ? live.filename.replace(/\.[^.]+$/, `.${converted}`) : live.filename,
        reason: converted ? 'converted_version' : 'save',
      })
      state.revision += 1
      if (liveLegacy && converted && state.title.toLowerCase().endsWith(`.${liveLegacy}`)) {
        state.title = `${state.title.slice(0, -liveLegacy.length)}${converted}`
      }
      const result = {
        document: docJson(),
        version: {
          id: `ver_${versions.length}`,
          document_id: DOC,
          version: versions.length,
          kind: 'file',
          reason: head().reason,
          mime_type: head().mime,
          checksum_sha256: hex(upload.bytes),
          size_bytes: upload.bytes.byteLength,
        },
      }
      commits.set(key, { fingerprint, result })
      return json(200, result)
    }
    return refuse(404, 'not_found')
  })

  return { state, versions, calls, faults, fetch, uploads }
}

/** the per-test user-data dir; call once at the top of a test file */
export const work = { dir: '' }
export function useWorkDir(): void {
  beforeEach(() => {
    work.dir = mkdtempSync(join(tmpdir(), 'uw-legacy-cloud-'))
  })
  afterEach(() => {
    rmSync(work.dir, { recursive: true, force: true })
  })
}

export interface Converter {
  calls: CloudLegacyConvertInput[]
  fn: (input: CloudLegacyConvertInput) => Promise<CloudConvertOutcome>
}

/** a converter that answers a valid OOXML of the family (or a scripted refusal) */
export function fakeConverter(
  answer?: () => CloudConvertOutcome | Promise<CloudConvertOutcome>,
): Converter {
  const calls: CloudLegacyConvertInput[] = []
  return {
    calls,
    fn: async (input) => {
      calls.push(input)
      if (answer) return answer()
      return {
        ok: true,
        bytes: await ooxml(TARGET[input.from], 'converted'),
        to: TARGET[input.from],
      }
    },
  }
}

export function setup(
  server: ReturnType<typeof fakeServer>,
  opts: { converter?: Converter | null; queue?: boolean } = {},
) {
  const statuses: UniworkDocStatus[] = []
  const launches: UniworkLaunchEvent[] = []
  let capabilityOffline = false
  const safeStorage = createLockableSafeStorage()
  const layer: StoreLayer = createStoreLayer({
    root: join(work.dir, 'uniwork-sync', 'store'),
    keys: createSafeStorageKeyProvider({
      safeStorage,
      dir: join(work.dir, 'uniwork-sync', 'keys'),
    }),
    budgetBytes: 1 << 22,
    clock: () => 1_700_000_000_000,
  })
  layer.register(INTENT_STORE_REGISTRATION)
  if (opts.queue) {
    layer.register(DRAFTS_STORE_REGISTRATION)
    layer.register(PAUSE_STORE_REGISTRATION)
  }
  const syncStore = createSyncStoreAccess({
    layer,
    scope: () => ({ deploymentId: 'default', accountId: 'acc_1' }),
  })
  const converter = opts.converter === undefined ? fakeConverter() : opts.converter
  const isPathOpen = vi.fn((_path: string) => false)
  const ui: ConflictUi = { chooseUnsavedClose: vi.fn(async () => 'cancel' as const) }
  const service = new UniworkDocsService({
    userDataDir: work.dir,
    syncStore,
    appVersion: () => '0.0.0',
    keystoreLocked: () => false,
    profile: () => profile,
    identity: () => ({ accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }),
    selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
    authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
    fetch: server.fetch,
    openPath: vi.fn(() => true),
    isPathOpen,
    requestModuleSave: vi.fn(() => false),
    reloadPath: vi.fn(),
    activePath: () => undefined,
    ui,
    pushStatus: (s: UniworkDocStatus) => statuses.push(s),
    pushLaunch: (e: UniworkLaunchEvent) => launches.push(e),
    reveal: vi.fn(),
    sleep: async () => undefined,
    capability: {
      get: async () => {
        if (capabilityOffline) throw new Error('offline')
        return { kind: 'ok', capabilities: { sync_write: true }, source: 'fresh' }
      },
    },
    ...(converter ? { convertLegacy: converter.fn } : {}),
  })
  return {
    service,
    layer,
    converter,
    statuses,
    isPathOpen,
    setCapabilityOffline: (value: boolean) => {
      capabilityOffline = value
    },
  }
}
export type Ctx = ReturnType<typeof setup>

export async function openDoc(ctx: Ctx): Promise<string> {
  const opened = await ctx.service.openDocument(DOC)
  if (!opened.ok) throw new Error(opened.error)
  return opened.value.path
}
export const binding = (path: string) =>
  JSON.parse(readFileSync(join(path, '..', BINDING_FILE), 'utf8'))
export const commitCalls = (server: ReturnType<typeof fakeServer>) =>
  server.calls.filter((c) => c.path.endsWith('/versions/commit') && c.method === 'POST')
export const uploadCalls = (server: ReturnType<typeof fakeServer>) =>
  server.calls.filter((c) => c.path.endsWith('/uploads'))

export async function storedIntent(ctx: Ctx, path: string) {
  const opened = await ctx.layer.open({ deploymentId: 'default', accountId: 'acc_1' })
  if (opened.kind !== 'ok') return null
  return createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name)).get(
    basename(dirname(path)),
  )
}
