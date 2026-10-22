import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { createUniworkDocsClient, type FetchLike } from '../src/main/uniwork-docs/client'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import { UNIWORK_ERROR_KEYS } from '../src/renderer/src/uniwork-docs-model'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'

/**
 * UNI-2078 slice 2: delete forever from the Trash (the web's `POST /documents/{id}/purge`).
 * The client sends no body and no Idempotency-Key and accepts the empty 204 answer; the service
 * gate (trashed AND manage-or-admin_scope) refuses before any POST; the two purge refusals have
 * their own codes; a throttle is flagged retryable; a purge pushes tree-changed.
 */

const ORIGIN = 'https://uniwork.example'
const WS = 'ws_1'
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const TRASHED_AT = '2026-10-20T00:00:00Z'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const envelope = (status: number, code: string, fields?: Record<string, unknown>) =>
  json(status, { error: { code, message: 'x', ...(fields ? { fields } : {}) } })
const noContent = () => new Response(null, { status: 204 })

function client(fetch: FetchLike) {
  return createUniworkDocsClient({
    apiOrigin: ORIGIN,
    authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
    isSignedIn: () => true,
    fetch,
  })
}

describe('client.purgeDocument', () => {
  it('POSTs /documents/{id}/purge with no body, no Idempotency-Key and no Content-Type', async () => {
    const fetch = vi.fn<FetchLike>(async () => noContent())
    await client(fetch).purgeDocument(DOC)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(`${ORIGIN}/api/v1/documents/${DOC}/purge`)
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
    const headers = init.headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBeUndefined()
    expect(headers['Content-Type']).toBeUndefined()
    expect(headers.Authorization).toBe('Bearer tok')
  })

  it('accepts the empty 204 answer (there is no JSON to read)', async () => {
    const fetch = vi.fn<FetchLike>(async () => noContent())
    await expect(client(fetch).purgeDocument(DOC)).resolves.toBeUndefined()
  })

  it('also accepts a 200 whose body is not JSON', async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response('', { status: 200 }))
    await expect(client(fetch).purgeDocument(DOC)).resolves.toBeUndefined()
  })

  it('maps a 400 document_not_in_trash and folder_too_large to their own codes', async () => {
    for (const code of ['document_not_in_trash', 'folder_too_large']) {
      const fetch = vi.fn<FetchLike>(async () => envelope(400, code))
      await expect(client(fetch).purgeDocument(DOC)).rejects.toMatchObject({
        code,
        status: 400,
        serverCode: code,
      })
    }
  })
})

// ── the service half ──────────────────────────────────────────────────────────

const profile: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: ORIGIN,
  clientId: 'uniwork-office',
  channel: 'stable',
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uniwork-doc-purge-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

interface Seen {
  method: string
  path: string
  key: string
  body?: unknown
}

function serviceWith(
  options: {
    doc?: Record<string, unknown>
    /** the top-level of the GET answer (admin_scope rides next to `document`) */
    envelope?: Record<string, unknown>
    getAnswer?: Response
    adminSummary?: Response
    purgeAnswer?: Response
    signedIn?: boolean
  } = {},
) {
  const seen: Seen[] = []
  const treeChanged = vi.fn()
  const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url)
    const headers = (init.headers ?? {}) as Record<string, string>
    seen.push({
      method: init.method ?? 'GET',
      path: u.pathname,
      key: headers['Idempotency-Key'] ?? '',
      ...(init.body ? { body: JSON.parse(String(init.body)) } : {}),
    })
    if (u.pathname === `/api/v1/documents/${DOC}/purge`) {
      return options.purgeAnswer ?? noContent()
    }
    if (u.pathname === `/api/v1/documents/${DOC}/admin-summary` && options.adminSummary) {
      return options.adminSummary
    }
    if (u.pathname === `/api/v1/documents/${DOC}`) {
      return (
        options.getAnswer ??
        json(200, {
          document: {
            id: DOC,
            organization_id: 'org_a',
            workspace_id: WS,
            title: 'Plan.docx',
            kind: 'file',
            revision: '3',
            my_level: 'manage',
            archived_at: TRASHED_AT,
            file: {
              filename: 'Plan.docx',
              mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
            ...options.doc,
          },
          ...options.envelope,
        })
      )
    }
    return envelope(404, 'not_found')
  })
  const ui: ConflictUi = {
    chooseConflict: vi.fn(async () => 'later'),
    confirmDiscard: vi.fn(async () => false),
    pickCopyPath: vi.fn(async () => null),
    showOpenLatestFailed: vi.fn(),
    showCopyFailed: vi.fn(),
    chooseUnsavedClose: vi.fn(async () => 'cancel'),
  }
  const service = new UniworkDocsService({
    userDataDir: dir,
    appVersion: () => '0.0.0',
    profile: () => profile,
    channel: () => 'stable',
    applyProfile: async () => 'unchanged',
    identity: () =>
      options.signedIn === false
        ? null
        : { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' },
    keystoreLocked: () => false,
    selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
    authorized: <T>(call: (token: string) => Promise<T>) => call('tok'),
    fetch: (url, init) => fetch(url, init),
    openPath: () => true,
    isPathOpen: () => false,
    pickUploadFile: async () => null,
    pushUploadProgress: () => undefined,
    pushDocRenamed: () => undefined,
    pushTreeChanged: treeChanged,
    notifyPathRenamed: () => undefined,
    notifyTitleRenamed: () => undefined,
    requestModuleSave: () => true,
    reloadPath: () => undefined,
    activePath: () => undefined,
    stopRuntime: () => undefined,
    ui,
    pushStatus: () => undefined,
    pushLaunch: () => undefined,
    reveal: () => undefined,
  })
  const posts = () => seen.filter((s) => s.method === 'POST')
  return { service, seen, posts, treeChanged }
}

describe('service.purgeDocument: the happy path', () => {
  it('re-reads the document, POSTs the purge without key or body, and pushes tree-changed', async () => {
    const { service, seen, posts, treeChanged } = serviceWith()
    const res = await service.purgeDocument(DOC)
    expect(res).toEqual({ ok: true, value: { id: DOC } })
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      `GET /api/v1/documents/${DOC}`,
      `POST /api/v1/documents/${DOC}/purge`,
    ])
    expect(posts()[0]!.key).toBe('')
    expect('body' in posts()[0]!).toBe(false)
    expect(treeChanged).toHaveBeenCalledWith({ workspaceId: WS })
  })

  it('a trashed folder is purged too (the gate reads no file block)', async () => {
    const { service, posts } = serviceWith({ doc: { kind: 'folder', file: undefined } })
    expect((await service.purgeDocument(DOC)).ok).toBe(true)
    expect(posts()).toHaveLength(1)
  })

  it('admin_scope without a level may purge (decision Q4), also on the document level', async () => {
    const level = serviceWith({ doc: { my_level: 'view', admin_scope: true } })
    expect((await level.service.purgeDocument(DOC)).ok).toBe(true)
    expect(level.posts()).toHaveLength(1)
    const top = serviceWith({ doc: { my_level: undefined }, envelope: { admin_scope: true } })
    expect((await top.service.purgeDocument(DOC)).ok).toBe(true)
    expect(top.posts()).toHaveLength(1)
  })

  it('a restricted trashed document is read through the admin summary (its archived_at counts)', async () => {
    const { service, seen, posts } = serviceWith({
      getAnswer: envelope(403, 'document_restricted'),
      adminSummary: json(200, {
        document: { id: DOC, workspace_id: WS, kind: 'file', archived_at: TRASHED_AT },
        my_level: '',
        admin_scope: true,
      }),
    })
    expect((await service.purgeDocument(DOC)).ok).toBe(true)
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      `GET /api/v1/documents/${DOC}`,
      `GET /api/v1/documents/${DOC}/admin-summary`,
      `POST /api/v1/documents/${DOC}/purge`,
    ])
    expect(posts()).toHaveLength(1)
  })

  it('a restricted LIVE document is refused through the admin summary too', async () => {
    const { service, posts } = serviceWith({
      getAnswer: envelope(403, 'document_restricted'),
      adminSummary: json(200, {
        document: { id: DOC, workspace_id: WS, kind: 'file' },
        my_level: '',
        admin_scope: true,
      }),
    })
    expect(await service.purgeDocument(DOC)).toEqual({ ok: false, error: 'document_not_in_trash' })
    expect(posts()).toHaveLength(0)
  })
})

describe('service.purgeDocument: refusals send no POST', () => {
  const refused = async (
    options: Parameters<typeof serviceWith>[0],
    error: string,
    documentId: unknown = DOC,
  ) => {
    const { service, posts } = serviceWith(options)
    expect(await service.purgeDocument(documentId as string)).toEqual({ ok: false, error })
    expect(posts()).toHaveLength(0)
  }

  it('a live document (not in the trash)', () =>
    refused({ doc: { archived_at: undefined } }, 'document_not_in_trash'))
  it('an edit-level document', () => refused({ doc: { my_level: 'edit' } }, 'forbidden'))
  it('a view-level document', () => refused({ doc: { my_level: 'view' } }, 'forbidden'))
  it('a document with no known level and no admin scope', () =>
    refused({ doc: { my_level: undefined } }, 'forbidden'))
  it('admin_scope false is no scope', () =>
    refused({ doc: { my_level: 'edit', admin_scope: false } }, 'forbidden'))
  it('a missing, empty or non-string document id', async () => {
    for (const bad of [undefined, '', 7, null, {}]) {
      const { service, seen } = serviceWith()
      expect(await service.purgeDocument(bad as never)).toEqual({ ok: false, error: 'not_found' })
      expect(seen).toHaveLength(0)
    }
  })

  it('signed out: before any request', async () => {
    const { service, seen } = serviceWith({ signedIn: false })
    expect(await service.purgeDocument(DOC)).toEqual({ ok: false, error: 'not_signed_in' })
    expect(seen).toHaveLength(0)
  })

  it('a document that is gone (404 on the re-read) is not_found', async () => {
    const { service, posts } = serviceWith({ getAnswer: envelope(404, 'not_found') })
    expect(await service.purgeDocument(DOC)).toEqual({ ok: false, error: 'not_found' })
    expect(posts()).toHaveLength(0)
  })

  it('Restore keeps its own gate: manage only on the document, admin_scope still passes the shared read', async () => {
    // the purge gate is the wider one; it must not leak into the sibling calls
    const { service, posts } = serviceWith({ doc: { my_level: 'edit' } })
    expect((await service.restoreDocument(DOC)).ok).toBe(false)
    expect(posts()).toHaveLength(0)
  })
})

describe('service.purgeDocument: server refusals', () => {
  const failWith = async (answer: Response) => {
    const { service, posts, treeChanged } = serviceWith({ purgeAnswer: answer })
    const res = await service.purgeDocument(DOC)
    expect(posts()).toHaveLength(1)
    expect(treeChanged).not.toHaveBeenCalled()
    return res
  }

  it('400 document_not_in_trash -> document_not_in_trash', async () => {
    expect(await failWith(envelope(400, 'document_not_in_trash'))).toEqual({
      ok: false,
      error: 'document_not_in_trash',
    })
  })

  it('400 folder_too_large -> folder_too_large', async () => {
    expect(await failWith(envelope(400, 'folder_too_large'))).toEqual({
      ok: false,
      error: 'folder_too_large',
    })
  })

  it('403 -> forbidden, 404 -> not_found (never endpointMissing: the route exists)', async () => {
    const forbidden = await failWith(envelope(403, 'insufficient_level'))
    expect(forbidden).toEqual({ ok: false, error: 'forbidden' })
    const gone = await failWith(envelope(404, 'not_found'))
    expect(gone).toEqual({ ok: false, error: 'not_found' })
  })

  it.each([429, 503])('a %i is flagged retryable', async (status) => {
    const res = await failWith(envelope(status, status === 429 ? 'rate_limited' : 'unavailable'))
    expect(res).toMatchObject({ ok: false, retryable: true })
  })

  it('a plain 500 is a failure, not retryable', async () => {
    expect(await failWith(envelope(500, 'internal'))).toEqual({ ok: false, error: 'server_error' })
  })
})

describe('the purge refusal sentences', () => {
  it('both codes have an app key and a sentence in every documents shard', () => {
    const codes = ['document_not_in_trash', 'folder_too_large'] as const
    for (const code of codes) {
      const key = UNIWORK_ERROR_KEYS[code]
      expect(key).toBeTruthy()
      for (const [lang, dict] of Object.entries(uniworkDocumentStrings)) {
        expect(dict[key as keyof typeof dict], `${lang}.${key}`).toBeTruthy()
      }
    }
  })

  it('vi and en are the web wording, verbatim', () => {
    const vi = uniworkDocumentStrings.vi as Record<string, string>
    const en = uniworkDocumentStrings.en as Record<string, string>
    const k = UNIWORK_ERROR_KEYS as Record<string, string>
    expect(vi[k.document_not_in_trash!]).toBe('Mục này không còn trong thùng rác.')
    expect(en[k.document_not_in_trash!]).toBe('This item is no longer in the trash.')
    expect(vi[k.folder_too_large!]).toBe(
      'Thư mục có quá nhiều mục nên chưa xóa hết được một lần. Hãy xóa từng phần bên trong trước.',
    )
    expect(en[k.folder_too_large!]).toBe(
      "The folder holds too many items to delete in one go. Delete what's inside in parts first.",
    )
  })
})
