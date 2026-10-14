import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultAiSettings,
  type AiStreamChunk,
  type StreamCallbacks,
  type UniworkChatTransport,
  type UniworkTurnRequest,
} from '@genoffice/ai-provider'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import {
  createUniworkAiChatTransport,
  createUniworkAiStreams,
  resolveUniworkAiScope,
} from '../src/main/uniwork-auth/ai-chat'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import { uniworkAiBinding } from '../src/main/uniwork-docs/wiring'
import { INTENT_STORE_REGISTRATION, createIntentStore } from '../src/main/uniwork-sync/intent-store'
import { DRAFTS_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/drafts'
import { PAUSE_STORE_REGISTRATION } from '../src/main/uniwork-sync/queue/pause'
import { createSafeStorageKeyProvider } from '../src/main/uniwork-sync/keys'
import { createSyncStoreAccess } from '../src/main/uniwork-sync/session-store'
import { createStoreLayer, type StoreLayer } from '../src/main/uniwork-sync/store'
import { createLockableSafeStorage } from '../src/main/uniwork-sync/test-kit/compliance'

/**
 * G6-A03 (owned here, desktop): a UniWork AI turn that edits the open
 * document makes no save, upload or commit request and records no save
 * intent; the tab stays dirty until the user presses Save. Real documents
 * service + durable store over a fake UniWork server that counts every
 * request; the chat route is the only one the turn may touch. The adapter is
 * a fake that posts through the real shell transport.
 */

const TOKEN = 'secret-access-token-0123456789'
const ORIGIN = 'https://uniwork.example'
const profile: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: ORIGIN,
  clientId: 'uniwork-office',
  channel: 'stable',
}
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const CHAT = `/api/v1/documents/${DOC}/ai/uniwork/chat/completions`
const enc = (text: string) => new TextEncoder().encode(text)
const hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function fakeServer(bytes: Uint8Array) {
  const calls: Array<{ method: string; path: string }> = []
  const docJson = () => ({
    id: DOC,
    organization_id: 'org_a',
    workspace_id: 'ws_1',
    title: 'Q4 plan.docx',
    kind: 'file',
    revision: '41',
    current_version: 3,
    my_level: 'edit',
    file: {
      file_id: 'f',
      version_id: 'v3',
      version: 3,
      filename: 'Q4 plan.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size_bytes: bytes.byteLength,
      checksum_sha256: hex(bytes),
    },
  })
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    })
  const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url)
    const method = init.method ?? 'GET'
    calls.push({ method, path: u.pathname })
    if (u.pathname === `/api/v1/documents/${DOC}` && method === 'GET') {
      return json(200, { document: docJson() })
    }
    if (u.pathname === `/api/v1/documents/${DOC}/download`) {
      return new Response(bytes as BodyInit, { status: 200 })
    }
    if (u.pathname === CHAT && method === 'POST') {
      return new Response(
        'data: {"choices":[{"delta":{"content":"Made it bold."}}],"x_uniwork":{"step":1,"limit":20}}\n\ndata: [DONE]\n\n',
        {
          status: 200,
          headers: {
            'Content-Type': 'text/event-stream',
            'X-UniWork-AI-Conversation': 'conv_1',
            'X-UniWork-AI-Run': 'run_1',
          },
        },
      )
    }
    return json(404, { error: { code: 'not_found', message: 'x' } })
  })
  return { calls, fetch }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-ai-no-save-'))
})
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 25))
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function setup(server: ReturnType<typeof fakeServer>) {
  const layer: StoreLayer = createStoreLayer({
    root: join(dir, 'uniwork-sync', 'store'),
    keys: createSafeStorageKeyProvider({
      safeStorage: createLockableSafeStorage(),
      dir: join(dir, 'uniwork-sync', 'keys'),
    }),
    budgetBytes: 1 << 20,
    clock: () => 1_700_000_000_000,
  })
  layer.register(INTENT_STORE_REGISTRATION)
  layer.register(DRAFTS_STORE_REGISTRATION)
  layer.register(PAUSE_STORE_REGISTRATION)
  const syncStore = createSyncStoreAccess({
    layer,
    scope: () => ({ deploymentId: 'default', accountId: 'acc_1' }),
  })
  const ui: ConflictUi = {
    chooseConflict: vi.fn(async () => 'later'),
    confirmDiscard: vi.fn(async () => true),
    pickCopyPath: vi.fn(async (stem: string, format: string) => join(dir, `${stem}.${format}`)),
    showOpenLatestFailed: vi.fn(),
    showCopyFailed: vi.fn(),
    chooseUnsavedClose: vi.fn(async () => 'cancel' as const),
  }
  const requestModuleSave = vi.fn(() => false)
  const authorized = <T>(call: (token: string) => Promise<T>) => call(TOKEN)
  const service = new UniworkDocsService({
    userDataDir: dir,
    syncStore,
    appVersion: () => '0.0.0',
    profile: () => profile,
    identity: () => ({ accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }),
    selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
    authorized,
    fetch: server.fetch,
    openPath: vi.fn(() => true),
    isPathOpen: vi.fn(() => true),
    requestModuleSave,
    reloadPath: vi.fn(),
    activePath: () => undefined,
    ui,
    pushStatus: vi.fn(),
    pushLaunch: vi.fn(),
    reveal: vi.fn(),
    sleep: async () => undefined,
    capability: {
      get: async () => ({
        kind: 'ok' as const,
        capabilities: { sync_write: true },
        source: 'fresh' as const,
      }),
    },
  } as unknown as ConstructorParameters<typeof UniworkDocsService>[0])
  const transport = createUniworkAiChatTransport({
    profile: () => profile,
    authorized,
    fetch: server.fetch,
  })
  return { service, layer, transport, requestModuleSave }
}

async function intentFor(layer: StoreLayer, path: string) {
  const opened = await layer.open({ deploymentId: 'default', accountId: 'acc_1' })
  if (opened.kind !== 'ok') return null
  return createIntentStore(opened.store.records(INTENT_STORE_REGISTRATION.name)).get(
    basename(dirname(path)),
  )
}

describe('G6-A03 desktop: AI never saves', () => {
  it('a UniWork AI turn that edits makes no save/upload/commit request and no intent', async () => {
    const server = fakeServer(enc('v3'))
    const ctx = setup(server)
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    const path = opened.value.path
    // the user's own unsaved edit: the tab is dirty before the AI turn
    writeFileSync(path, 'v3 + my edit')
    const before = await ctx.service.docStatus(path)
    expect(before).toMatchObject({ documentId: DOC })
    const callsBefore = server.calls.length

    // the adapter double: one request through the shell transport, then an
    // edit tool call the renderer applies to the open document
    const stream = async (
      transport: UniworkChatTransport,
      request: UniworkTurnRequest,
      cb: StreamCallbacks,
    ) => {
      const response = await transport.post({
        scope: request.scope,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'bold' }], stream: true }),
        signal: cb.signal,
      })
      expect(response.status).toBe(200)
      await response.text()
      cb.onDelta('Made it bold.')
      cb.onToolCall({ id: 'call_1', name: 'format_text', input: { bold: true } })
    }
    const streams = createUniworkAiStreams({
      transport: () => ctx.transport,
      scope: (senderId) =>
        resolveUniworkAiScope(senderId, {
          describe: () => ({ kind: 'docs', filePath: path }),
          binding: (p) => uniworkAiBinding(ctx.service, p),
          orgId: () => 'org_a',
        }),
      available: async () => true,
      toolPolicy: () => ({ cloudTools: false }),
      stream,
    })
    const chunks: AiStreamChunk[] = []
    await streams.run({
      senderId: 7,
      request: {
        requestId: 'req-1',
        sessionId: 'sess-1',
        settings: { ...defaultAiSettings(), provider: 'uniwork' },
        system: '',
        messages: [{ role: 'user', content: 'bold' }],
      },
      send: (chunk) => {
        chunks.push(chunk)
        // the renderer applies the edit to the open document (unsaved)
        if (chunk.type === 'tool-call') writeFileSync(path, 'v3 + my edit + **bold**')
      },
      signal: new AbortController().signal,
    })
    expect(chunks.map((c) => c.type)).toEqual(['delta', 'tool-call', 'done'])

    // only the chat route was touched by the turn
    const during = server.calls.slice(callsBefore)
    expect(during).toEqual([{ method: 'POST', path: CHAT }])
    expect(server.calls.filter((c) => c.path !== CHAT && c.method !== 'GET')).toEqual([])
    expect(server.calls.filter((c) => /\/uploads$|\/versions\/commit$/.test(c.path))).toEqual([])
    // no module save was requested and no save intent was recorded
    expect(ctx.requestModuleSave).not.toHaveBeenCalled()
    expect(await intentFor(ctx.layer, path)).toBeNull()
    // the document is still what the user left it: dirty, not saved
    const after = await ctx.service.docStatus(path)
    expect(after).toEqual(before)
  })
})
