// @vitest-environment jsdom
// G6-A03 (owned by the fork, web side): a UniWork AI turn that edits sends no save, no save-as and no
// upload request from the frame. The host fake counts every frame protocol request, the fetch fake
// every HTTP request: the only things a UniWork AI turn sends are the chat completion on its own
// route and a read-only GET of the cloud status.
// The adapter is slice A: its `streamUniwork` is replaced by one that posts through the transport the
// frame hands it, then reports an editing tool call the way the real adapter does. The tool call is
// applied to the module's document (the real Markdown web API, so an edit marks the document dirty
// exactly as the app does), and EVERY frame message is then counted: an exact set, no allowlist.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installModuleBridge } from './module-bridge'
import { createMarkdownWebApi } from '../../modules/markdown/webapi'
import { createMockPort } from './testing/mock-port'

vi.mock('../../../packages/ai-provider/src/uniwork/protocol', () => ({
  streamUniwork: vi.fn(async (transport, request, cb) => {
    const res = await transport.post({
      scope: request.scope,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [], stream: true }),
      signal: cb.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    cb.onToolCall({ id: 'call-1', name: 'replace_text', args: { from: 'a', to: 'b' } })
    cb.onDelta('Edited.')
  }),
}))

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a UniWork AI turn never saves (G6-A03, web)', () => {
  it('sends no request but the chat completion, and the edit only marks the document dirty', async () => {
    const urls: Array<{ url: string; method: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        urls.push({ url: String(input), method: init?.method ?? 'GET' })
        return new Response(null, { status: 200, headers: { 'X-UniWork-AI-Run': 'run-1' } })
      }),
    )
    const mock = createMockPort({ documentId: 'doc-1' })
    const file = mock.seed('Notes.md', new TextEncoder().encode('a typo: a\n'))
    const target: Record<string, unknown> = {}
    // the AI run state events the frame reports to the host (the one event family a turn may send)
    const aiRun: Array<{ state: string }> = []
    installModuleBridge({
      module: 'markdown',
      frameCapabilities: { save: true, saveAs: true },
      client: {
        ...mock.port,
        getToken: vi.fn(async () => 'tok-1'),
        refreshToken: vi.fn(async () => 'tok-2'),
        reportAiRun: (payload: { state: string }) => void aiRun.push(payload),
      },
      target,
      // the module's own members (its real web API: save, setDirty, ...); the web AI bridge adds the
      // AI members over them while the grant is on
      globals: { markdownApi: (ctx) => createMarkdownWebApi(ctx) },
    })
    mock.init({
      apiBase: '/api/v1',
      capabilities: { uniworkAi: true, save: true, saveAs: true },
      open: mock.openPayload(file.fileId),
    })
    await flush()
    const api = target.markdownApi as {
      aiStream(request: unknown): Promise<void>
      onAiStream(handler: (chunk: { type: string; toolCall?: unknown }) => void): () => void
      setDirty(dirty: boolean): void
    }
    // the module's document: the tool call is applied to it, and an edit reports the document dirty
    let documentText = 'a typo: a'
    // the host handed the document over in `init`: nothing has been requested yet
    expect(mock.calls.map((c) => c.type)).toEqual([])
    // what the frame had reported by then (the title of the opened document): the turn adds to none of it
    const before = {
      titles: [...mock.titles],
      modals: [...mock.modals],
      saved: [...mock.saved],
      errors: [...mock.errors],
      dirty: [...mock.dirty],
    }
    const chunks: Array<{ type: string }> = []
    api.onAiStream((c) => {
      chunks.push(c)
      if (c.type === 'tool-call') {
        const { args } = c.toolCall as { args: { from: string; to: string } }
        documentText = documentText.replace(args.from, args.to)
        api.setDirty(true)
      }
    })
    await api.aiStream({
      requestId: 'a1',
      settings: { provider: 'uniwork', providers: {} },
      system: '',
      messages: [{ role: 'user', content: 'fix the typo' }],
    })
    expect(chunks.map((c) => c.type)).toEqual(['tool-call', 'delta', 'done'])
    expect(documentText).toBe('b typo: a')
    // every frame message of the turn, counted: no request of any kind (save, save-as, upload,
    // commit, draft, intent, ...), no saved / title / modal / error report, and the only dirty
    // report is the edit itself
    expect(mock.calls.map((c) => c.type)).toEqual([])
    expect(mock.saved).toEqual(before.saved)
    expect(mock.titles).toEqual(before.titles)
    expect(mock.modals).toEqual(before.modals)
    expect(mock.errors).toEqual(before.errors)
    expect(mock.saved).toEqual([])
    expect(mock.errors).toEqual([])
    expect(mock.dirty).toEqual([...before.dirty, true])
    // the run state report is the one event family a turn may add (the idle waits out its grace)
    expect(aiRun.length).toBeGreaterThan(0)
    expect(aiRun.every((r) => r.state === 'running' || r.state === 'idle')).toBe(true)
    // the frame's HTTP requests: the chat completion on the UniWork AI route, plus the one read-only
    // GET of the cloud status (the grant of the AI tools), each named by method and exact path. A
    // read is not a save; any other request (another URL, any non-GET, a save / upload / commit)
    // still fails here.
    const docRoute = '/api/v1/office-frame/documents/doc-1'
    const asRoute = (u: { url: string; method: string }) =>
      `${u.method} ${new URL(u.url, 'http://localhost').pathname}`
    expect(urls.map(asRoute).sort()).toEqual(
      [`GET ${docRoute}/ai/cloud`, `POST ${docRoute}/ai/uniwork/chat/completions`].sort(),
    )
  })
})
