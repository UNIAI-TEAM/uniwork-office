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
 * UNI-2078 slice 1: make a plain copy of a document (the web's
 * `POST /documents/{id}/copies`). The client body and headers, the service gate
 * that refuses before any POST, the error mapping of the three copy codes and
 * the 404/501 -> endpointMissing flag. The conflict dialog's "Save as a copy"
 * keeps calling the client with a title and a parent, exactly as before.
 */

const ORIGIN = 'https://uniwork.example'
const WS = 'ws_1'
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const COPY = '01J8X4C0PY0N1P2Q3R4S5T6U7'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const envelope = (status: number, code: string, fields?: Record<string, unknown>) =>
  json(status, { error: { code, message: 'x', ...(fields ? { fields } : {}) } })

function client(fetch: FetchLike) {
  return createUniworkDocsClient({
    apiOrigin: ORIGIN,
    authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
    isSignedIn: () => true,
    fetch,
  })
}

const copyAnswer = (title = 'Plan (bản sao).docx') =>
  json(201, {
    document: {
      id: COPY,
      kind: 'file',
      title,
      workspace_id: WS,
      revision: '1',
      my_level: 'manage',
      parent_id: null,
      updated_at: '2026-10-22T09:00:00Z',
      file: {
        filename: title,
        mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    },
  })

describe('client.copyDocument', () => {
  it('POSTs {consent:"copy", title} to /documents/{id}/copies with the Idempotency-Key', async () => {
    const fetch = vi.fn<FetchLike>(async () => copyAnswer())
    const made = await client(fetch).copyDocument({
      documentId: DOC,
      title: 'Plan v2',
      parentId: null,
      idempotencyKey: 'key-1',
    })
    expect(made.summary.id).toBe(COPY)
    expect(made.revision).toBe('1')
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(`${ORIGIN}/api/v1/documents/${DOC}/copies`)
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('key-1')
    expect(JSON.parse(String(init.body))).toEqual({ consent: 'copy', title: 'Plan v2' })
  })

  it.each([undefined, '', '   '])('omits the title field when it is %j', async (title) => {
    const fetch = vi.fn<FetchLike>(async () => copyAnswer())
    await client(fetch).copyDocument({
      documentId: DOC,
      ...(title === undefined ? {} : { title }),
      parentId: null,
      idempotencyKey: 'key-2',
    })
    const body = JSON.parse(String(fetch.mock.calls[0]![1].body)) as Record<string, unknown>
    expect(body).toEqual({ consent: 'copy' })
    expect('title' in body).toBe(false)
  })

  it('the conflict flow still sends its title and its parent_id, unchanged', async () => {
    const fetch = vi.fn<FetchLike>(async () => copyAnswer())
    await client(fetch).copyDocument({
      documentId: DOC,
      title: 'Plan (bản của tôi)',
      parentId: 'fold_9',
      idempotencyKey: 'key-3',
    })
    expect(JSON.parse(String(fetch.mock.calls[0]![1].body))).toEqual({
      consent: 'copy',
      title: 'Plan (bản của tôi)',
      parent_id: 'fold_9',
    })
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
  dir = mkdtempSync(join(tmpdir(), 'uniwork-doc-copy-'))
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
    getAnswer?: Response
    copyAnswer?: Response
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
    if (u.pathname === `/api/v1/documents/${DOC}/copies`) return options.copyAnswer ?? copyAnswer()
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
            my_level: 'edit',
            file: {
              filename: 'Plan.docx',
              mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            },
            ...options.doc,
          },
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

describe('service.copyDocument: the happy path', () => {
  it('re-reads the document, POSTs the copy with no parent_id, and pushes tree-changed', async () => {
    const { service, seen, posts, treeChanged } = serviceWith()
    const res = await service.copyDocument({ documentId: DOC, title: '  Plan v2  ' })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.id).toBe(COPY)
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      `GET /api/v1/documents/${DOC}`,
      `POST /api/v1/documents/${DOC}/copies`,
    ])
    expect(posts()[0]!.body).toEqual({ consent: 'copy', title: 'Plan v2' })
    expect('parent_id' in (posts()[0]!.body as object)).toBe(false)
    expect(posts()[0]!.key).toBeTruthy()
    expect(treeChanged).toHaveBeenCalledWith({ workspaceId: WS })
  })

  it.each([undefined, '', '   ', 7, null])(
    'omits a blank or non-string title (%j)',
    async (title) => {
      const { service, posts } = serviceWith()
      expect((await service.copyDocument({ documentId: DOC, title: title as never })).ok).toBe(true)
      expect(posts()[0]!.body).toEqual({ consent: 'copy' })
    },
  )

  it('a manage-level document may be copied too', async () => {
    const { service, posts } = serviceWith({ doc: { my_level: 'manage' } })
    expect((await service.copyDocument({ documentId: DOC })).ok).toBe(true)
    expect(posts()).toHaveLength(1)
  })
})

describe('service.copyDocument: the Idempotency-Key', () => {
  it('forwards the dialog-open key, so a retry of the same open sends the same key', async () => {
    const { service, posts } = serviceWith()
    await service.copyDocument({ documentId: DOC, idempotencyKey: 'dialog-open-key-0001' })
    await service.copyDocument({ documentId: DOC, idempotencyKey: 'dialog-open-key-0001' })
    const keys = posts().map((p) => p.key)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
    expect(keys[0]).toContain('dialog-open-key-0001')
  })

  it('a different open (a different key) sends a different key', async () => {
    const { service, posts } = serviceWith()
    await service.copyDocument({ documentId: DOC, idempotencyKey: 'dialog-open-key-0001' })
    await service.copyDocument({ documentId: DOC, idempotencyKey: 'dialog-open-key-0002' })
    expect(posts()[0]!.key).not.toBe(posts()[1]!.key)
  })

  it.each([undefined, '', 'x', 'has space in it 123456', 'a'.repeat(200), 42, {}])(
    'main keys the call itself when the renderer key is %j (never trusted)',
    async (bad) => {
      const { service, posts } = serviceWith()
      await service.copyDocument({ documentId: DOC, idempotencyKey: bad as never })
      await service.copyDocument({ documentId: DOC, idempotencyKey: bad as never })
      const [a, b] = posts().map((p) => p.key)
      expect(a).toBeTruthy()
      expect(b).toBeTruthy()
      expect(a).not.toBe(b)
      expect(String(a).length).toBeLessThanOrEqual(160)
    },
  )
})

describe('service.copyDocument: refusals send no POST', () => {
  const refused = async (
    doc: Record<string, unknown>,
    error: string,
    input: Record<string, unknown> = {},
  ) => {
    const { service, posts } = serviceWith({ doc })
    expect(await service.copyDocument({ documentId: DOC, ...input })).toEqual({
      ok: false,
      error,
    })
    expect(posts()).toHaveLength(0)
  }

  it('a view-level document', () => refused({ my_level: 'view' }, 'forbidden'))
  it('a document with no known level', () => refused({ my_level: undefined }, 'forbidden'))
  it('a folder', () => refused({ kind: 'folder', file: undefined }, 'unsupported_format'))
  it('a page (UniNote)', () =>
    refused({ kind: 'page', file: undefined }, 'page_copy_not_supported'))
  it('an owned (work product) document', () =>
    refused({ owner_kind: 'work_product' }, 'owner_requires_copy'))
  it('a trashed document', () =>
    refused({ archived_at: '2026-10-20T00:00:00Z' }, 'document_deleted'))
  it('a shelved (archived) document', () =>
    refused({ shelved_at: '2026-10-20T00:00:00Z' }, 'document_archived'))
  it('a title longer than 500 characters', () =>
    refused({}, 'name_too_long', { title: 'x'.repeat(501) }))

  it('a missing or non-string document id', async () => {
    const { service, seen } = serviceWith()
    expect(await service.copyDocument({ documentId: '' })).toEqual({
      ok: false,
      error: 'not_found',
    })
    expect(await service.copyDocument({ documentId: 7 as never })).toEqual({
      ok: false,
      error: 'not_found',
    })
    expect(await service.copyDocument(undefined as never)).toEqual({
      ok: false,
      error: 'not_found',
    })
    expect(seen).toHaveLength(0)
  })

  it('signed out: before any request', async () => {
    const { service, seen } = serviceWith({ signedIn: false })
    expect(await service.copyDocument({ documentId: DOC })).toEqual({
      ok: false,
      error: 'not_signed_in',
    })
    expect(seen).toHaveLength(0)
  })

  it('a document that is gone (404 on the re-read) is not_found and does NOT hide the action', async () => {
    const { service, posts } = serviceWith({ getAnswer: envelope(404, 'not_found') })
    const res = await service.copyDocument({ documentId: DOC })
    expect(res).toEqual({ ok: false, error: 'not_found' })
    expect(posts()).toHaveLength(0)
  })

  it('accepts exactly 500 characters', async () => {
    const { service, posts } = serviceWith()
    expect((await service.copyDocument({ documentId: DOC, title: 'x'.repeat(500) })).ok).toBe(true)
    expect(posts()).toHaveLength(1)
  })
})

describe('service.copyDocument: server refusals', () => {
  const failWith = async (answer: Response) => {
    const { service, posts } = serviceWith({ copyAnswer: answer })
    const res = await service.copyDocument({ documentId: DOC })
    expect(posts()).toHaveLength(1)
    return res
  }

  it('409 owner_requires_copy -> owner_requires_copy', async () => {
    expect(await failWith(envelope(409, 'owner_requires_copy'))).toEqual({
      ok: false,
      error: 'owner_requires_copy',
    })
  })

  it('409 copy_consent_required -> copy_consent_required', async () => {
    expect(await failWith(envelope(409, 'copy_consent_required'))).toEqual({
      ok: false,
      error: 'copy_consent_required',
    })
  })

  it('400 invalid_request with reason page_copy_not_supported -> page_copy_not_supported', async () => {
    expect(
      await failWith(envelope(400, 'invalid_request', { reason: 'page_copy_not_supported' })),
    ).toEqual({ ok: false, error: 'page_copy_not_supported' })
  })

  it('a bare 400 invalid_request (another reason) stays a plain failure', async () => {
    const res = await failWith(envelope(400, 'invalid_request', { reason: 'other' }))
    expect(res).toMatchObject({ ok: false })
    expect(res.ok === false && res.error).not.toBe('page_copy_not_supported')
  })

  it('403 workspace_seat_required keeps its mapping (forbidden, never endpointMissing)', async () => {
    const res = await failWith(envelope(403, 'workspace_seat_required'))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error).toBe('forbidden')
    expect(res.endpointMissing).toBeUndefined()
  })

  it('410 document_deleted comes back as the app’s code', async () => {
    expect(await failWith(envelope(410, 'document_deleted'))).toEqual({
      ok: false,
      error: 'document_deleted',
    })
  })

  // the server router has no custom NotFound handler: a missing route answers a plain, envelope-less
  // 404 (or a gateway's 501), never `{error:{code}}`
  it.each([404, 501])('an uncoded %i on the copy route -> endpointMissing', async (status) => {
    const res = await failWith(new Response('404 page not found', { status }))
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.endpointMissing).toBe(true)
  })

  it('a coded 404 not_found (the source went between the re-read and the POST) is a plain failure', async () => {
    const res = await failWith(envelope(404, 'not_found'))
    expect(res).toEqual({ ok: false, error: 'not_found' })
    expect(res.ok === false && res.endpointMissing).toBeUndefined()
  })

  it('a coded 501 is a plain failure too', async () => {
    const res = await failWith(envelope(501, 'unsupported_operation'))
    expect(res.ok === false && res.endpointMissing).toBeUndefined()
  })

  it('a plain 500 is a failure, not endpointMissing', async () => {
    const res = await failWith(envelope(500, 'internal'))
    expect(res).toEqual({ ok: false, error: 'server_error' })
  })

  it('a throttle is flagged retryable and not endpointMissing', async () => {
    const res = await failWith(envelope(429, 'rate_limited'))
    expect(res).toMatchObject({ ok: false, retryable: true })
    expect(res.ok === false && res.endpointMissing).toBeUndefined()
  })

  it('pushes no tree-changed after a failure', async () => {
    const { service, treeChanged } = serviceWith({ copyAnswer: envelope(500, 'internal') })
    await service.copyDocument({ documentId: DOC })
    expect(treeChanged).not.toHaveBeenCalled()
  })
})

describe('the three copy codes have a sentence in every language', () => {
  const CODES = ['owner_requires_copy', 'page_copy_not_supported', 'copy_consent_required']

  it.each(CODES)('%s maps to a documents-shard key with copy', (code) => {
    const key = (UNIWORK_ERROR_KEYS as Record<string, string>)[code]
    expect(key).toBeTruthy()
    for (const lang of Object.keys(uniworkDocumentStrings)) {
      const table = (uniworkDocumentStrings as Record<string, Record<string, string>>)[lang]!
      expect(table[key!]?.trim(), `${lang}.${key}`).toBeTruthy()
    }
  })

  it('vi and en are the web wording, verbatim', () => {
    const vi = uniworkDocumentStrings.vi as Record<string, string>
    const en = uniworkDocumentStrings.en as Record<string, string>
    const k = UNIWORK_ERROR_KEYS as Record<string, string>
    expect(vi[k.owner_requires_copy!]).toBe(
      'Tài liệu thuộc Kết quả công việc: bản sao đi qua màn hình sở hữu.',
    )
    expect(en[k.owner_requires_copy!]).toBe(
      'This document belongs to a Work Product: copy it through the owning screen.',
    )
    expect(vi[k.page_copy_not_supported!]).toBe(
      'Chỉ tài liệu tệp có bản sao ở bước này. UniNote sao chép ở giai đoạn sau.',
    )
    expect(en[k.page_copy_not_supported!]).toBe(
      'Only file documents can be copied at this step. UniNote copies come later.',
    )
    expect(vi[k.copy_consent_required!]).toBe('Cần xác nhận rõ trước khi tạo bản sao.')
    expect(en[k.copy_consent_required!]).toBe(
      'An explicit confirmation is required before copying.',
    )
  })
})
