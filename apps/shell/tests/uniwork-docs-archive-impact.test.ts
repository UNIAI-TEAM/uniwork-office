import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { createUniworkDocsClient, type FetchLike } from '../src/main/uniwork-docs/client'
import { UniworkDocError, isTerminalRefusal } from '../src/main/uniwork-docs/errors'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import { UNIWORK_ERROR_KEYS } from '../src/renderer/src/uniwork-docs-model'
import { uniworkFolderStrings } from '../src/renderer/src/i18n/strings-uniwork-folders'

/**
 * UNI-2066 WS-A: the main-process half of the workspace-folder rules. The
 * archive-impact route (one more read the trash confirmation makes for a
 * folder), the 422 `folder_into_my_folder` refusal end to end (client error ->
 * action result -> the renderer's sentence key) and the lenient `is_empty`
 * flag on rows and tree nodes.
 */

const ORIGIN = 'https://uniwork.example'
const WS = 'ws_1'
const FOLDER = '01J8X4FOLDER0N1P2Q3R4S5T6'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const envelope = (status: number, code: string) => json(status, { error: { code, message: 'x' } })

function client(fetch: FetchLike) {
  return createUniworkDocsClient({
    apiOrigin: ORIGIN,
    authorized: <T>(call: (t: string) => Promise<T>) => call('tok'),
    isSignedIn: () => true,
    fetch,
  })
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return error instanceof UniworkDocError ? error.code : `other:${String(error)}`
  }
  return 'resolved'
}

describe('getArchiveImpact (client)', () => {
  it('GETs /documents/{id}/archive-impact and reads the counts and relocated_count', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      json(200, {
        folders: 3,
        documents: 12,
        total: 16,
        max_nodes: 1000,
        too_large: false,
        relocated_count: 2,
      }),
    )
    const impact = await client(fetch).getArchiveImpact(FOLDER)
    expect(impact).toEqual({ tooLarge: false, folders: 3, documents: 12, relocatedCount: 2 })
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(`${ORIGIN}/api/v1/documents/${FOLDER}/archive-impact`)
    expect(init.method).toBe('GET')
  })

  it('reads an absent relocated_count as 0 (an older server)', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, { folders: 0, documents: 4 }))
    expect(await client(fetch).getArchiveImpact(FOLDER)).toEqual({
      tooLarge: false,
      folders: 0,
      documents: 4,
      relocatedCount: 0,
    })
  })

  it.each([null, -1, 1.5, '2', {}, true])(
    'reads a relocated_count of %j as 0 and keeps the counts',
    async (bad) => {
      const fetch = vi.fn<FetchLike>(async () =>
        json(200, { folders: 1, documents: 4, too_large: false, relocated_count: bad }),
      )
      expect(await client(fetch).getArchiveImpact(FOLDER)).toEqual({
        tooLarge: false,
        folders: 1,
        documents: 4,
        relocatedCount: 0,
      })
    },
  )

  it('reads a subtree past the cap as too large, without counts', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, { too_large: true, max_nodes: 1000 }))
    expect(await client(fetch).getArchiveImpact(FOLDER)).toEqual({ tooLarge: true })
  })

  it.each([
    [{}],
    [{ folders: 1 }],
    [{ documents: 1 }],
    [{ folders: -1, documents: 2 }],
    [{ folders: 1.5, documents: 2 }],
    [{ folders: '1', documents: 2 }],
    [[]],
    ['x'],
    [null],
  ])('answers malformed_response for the body %j', async (body) => {
    const fetch = vi.fn<FetchLike>(async () => json(200, body))
    expect(await codeOf(client(fetch).getArchiveImpact(FOLDER))).toBe('malformed_response')
  })

  it('refuses an empty document id before any request', async () => {
    const fetch = vi.fn<FetchLike>(async () => json(200, {}))
    expect(await codeOf(client(fetch).getArchiveImpact(''))).not.toBe('resolved')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('maps a 403 and a 404 like every document read (permission_revoked / not_found)', async () => {
    expect(
      await codeOf(client(async () => envelope(403, 'forbidden')).getArchiveImpact(FOLDER)),
    ).toBe('permission_revoked')
    expect(
      await codeOf(client(async () => envelope(404, 'not_found')).getArchiveImpact(FOLDER)),
    ).toBe('not_found')
  })
})

describe('the 422 folder_into_my_folder refusal', () => {
  it('keeps its own code on the client error, neither terminal nor retried', async () => {
    const fetch = vi.fn<FetchLike>(async () => envelope(422, 'folder_into_my_folder'))
    let caught: unknown
    try {
      await client(fetch).createFolder({
        workspaceId: WS,
        parentId: null,
        title: 'x',
        idempotencyKey: 'k',
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(UniworkDocError)
    expect(caught).toMatchObject({ code: 'folder_into_my_folder', status: 422 })
    expect(isTerminalRefusal(caught as UniworkDocError)).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('has a sentence key in the renderer map, defined in every folders shard', () => {
    const key = (UNIWORK_ERROR_KEYS as Record<string, string>).folder_into_my_folder
    expect(key).toBeTruthy()
    for (const table of Object.values(uniworkFolderStrings)) {
      expect((table as Record<string, string>)[key!]?.trim()).toBeTruthy()
    }
  })
})

describe('is_empty on rows, answers and tree nodes', () => {
  const fetchWith = (body: unknown) => vi.fn<FetchLike>(async () => json(200, body))

  it('keeps a real boolean on list rows and drops everything else', async () => {
    const row = (id: string, extra: Record<string, unknown>) => ({
      id,
      kind: 'folder',
      title: id,
      workspace_id: WS,
      updated_at: '2026-10-13T09:00:00Z',
      ...extra,
    })
    const api = client(
      fetchWith({
        documents: [
          row('a', { is_empty: true }),
          row('b', { is_empty: false }),
          row('c', {}),
          row('d', { is_empty: 'true' }),
          row('e', { is_empty: 1 }),
          row('f', { is_empty: null }),
        ],
        next_cursor: null,
      }),
    )
    const page = await api.listChildren({ workspaceId: WS, parentId: null })
    const flags = page.documents.map((d) => d.isEmpty)
    expect(flags).toEqual([true, false, undefined, undefined, undefined, undefined])
    // absent means unknown: the key is not even present on the row
    expect('isEmpty' in page.documents[2]!).toBe(false)
  })

  it('keeps a real boolean on tree nodes at every depth', async () => {
    const node = (id: string, extra: Record<string, unknown>, children: unknown[] = []) => ({
      id,
      kind: 'folder',
      title: id,
      position: 0,
      children,
      ...extra,
    })
    const api = client(
      fetchWith({
        documents: [
          node('a', { is_empty: true }, [node('a1', { is_empty: false }), node('a2', {})]),
          node('b', { is_empty: 'yes' }),
        ],
      }),
    )
    const tree = await api.folderTree(WS)
    expect(tree[0]!.isEmpty).toBe(true)
    expect(tree[0]!.children[0]!.isEmpty).toBe(false)
    expect(tree[0]!.children[1]!.isEmpty).toBeUndefined()
    expect('isEmpty' in tree[0]!.children[1]!).toBe(false)
    expect(tree[1]!.isEmpty).toBeUndefined()
  })

  it('keeps it on the create answer (a new folder is empty for its viewer)', async () => {
    const api = client(
      fetchWith({
        document: {
          id: 'fold_new',
          kind: 'folder',
          title: 'x',
          workspace_id: WS,
          revision: '1',
          is_empty: true,
        },
      }),
    )
    const created = await api.createFolder({
      workspaceId: WS,
      parentId: null,
      title: 'x',
      idempotencyKey: 'k',
    })
    expect(created.isEmpty).toBe(true)
  })
})

// ── the service half: the manage gate and the 422 as an action result ─────────

const profile: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: ORIGIN,
  clientId: 'uniwork-office',
  channel: 'stable',
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uniwork-archive-impact-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

interface Seen {
  method: string
  path: string
}

function serviceWith(options: {
  myLevel?: 'view' | 'edit' | 'manage'
  impact?: Response
  moveRefusal?: Response
}) {
  const seen: Seen[] = []
  const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url)
    seen.push({ method: init.method ?? 'GET', path: u.pathname })
    if (u.pathname === `/api/v1/documents/${FOLDER}/archive-impact`) {
      return options.impact ?? json(200, { folders: 1, documents: 2, relocated_count: 1 })
    }
    if (u.pathname === `/api/v1/documents/${FOLDER}/move`) {
      return options.moveRefusal ?? envelope(500, 'unexpected')
    }
    if (u.pathname === `/api/v1/documents/${FOLDER}`) {
      return json(200, {
        document: {
          id: FOLDER,
          organization_id: 'org_a',
          workspace_id: WS,
          title: 'Contracts',
          kind: 'folder',
          revision: '3',
          my_level: options.myLevel ?? 'manage',
        },
      })
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
    identity: () => ({ accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }),
    keystoreLocked: () => false,
    selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
    authorized: <T>(call: (token: string) => Promise<T>) => call('tok'),
    fetch: (url, init) => fetch(url, init),
    openPath: () => true,
    isPathOpen: () => false,
    pickUploadFile: async () => null,
    pushUploadProgress: () => undefined,
    pushDocRenamed: () => undefined,
    pushTreeChanged: () => undefined,
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
  return { service, seen }
}

describe('service.getArchiveImpact', () => {
  it('reads the impact of a folder the caller manages (kind-agnostic gate)', async () => {
    const { service, seen } = serviceWith({})
    expect(await service.getArchiveImpact(FOLDER)).toEqual({
      ok: true,
      value: { tooLarge: false, folders: 1, documents: 2, relocatedCount: 1 },
    })
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      `GET /api/v1/documents/${FOLDER}`,
      `GET /api/v1/documents/${FOLDER}/archive-impact`,
    ])
  })

  it('refuses a view-level folder without reading the impact', async () => {
    const { service, seen } = serviceWith({ myLevel: 'view' })
    expect(await service.getArchiveImpact(FOLDER)).toEqual({ ok: false, error: 'forbidden' })
    expect(seen.some((s) => s.path.endsWith('/archive-impact'))).toBe(false)
  })

  it('refuses a missing id without a request', async () => {
    const { service, seen } = serviceWith({})
    expect(await service.getArchiveImpact('')).toEqual({ ok: false, error: 'not_found' })
    expect(await service.getArchiveImpact(undefined as unknown as string)).toEqual({
      ok: false,
      error: 'not_found',
    })
    expect(seen).toHaveLength(0)
  })

  it('answers malformed_response for an unreadable impact', async () => {
    const { service } = serviceWith({ impact: json(200, { folders: 'x' }) })
    expect(await service.getArchiveImpact(FOLDER)).toEqual({
      ok: false,
      error: 'malformed_response',
    })
  })
})

describe('service.moveDocument with a 422 folder_into_my_folder', () => {
  it('answers the app code folder_into_my_folder, which the renderer maps to a sentence', async () => {
    const { service } = serviceWith({ moveRefusal: envelope(422, 'folder_into_my_folder') })
    const moved = await service.moveDocument({ documentId: FOLDER, parentId: 'fold_my' })
    expect(moved).toEqual({ ok: false, error: 'folder_into_my_folder' })
    if (moved.ok) return
    const key = (UNIWORK_ERROR_KEYS as Record<string, string>)[moved.error]
    expect(key).toBeTruthy()
    expect((uniworkFolderStrings.vi as Record<string, string>)[key!]).toBe(
      'Thư mục của workspace không thể chuyển vào Thư mục của tôi. Hãy tải lại danh sách rồi thử lại.',
    )
    expect((uniworkFolderStrings.en as Record<string, string>)[key!]).toBe(
      "A workspace folder can't be moved into My Folder. Refresh the list and try again.",
    )
  })
})
