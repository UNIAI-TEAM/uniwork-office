// @vitest-environment jsdom
// G6-A03 (owned by the fork, web side): a UniWork AI turn that edits sends no save, no save-as and no
// upload request from the frame. The host fake counts every frame protocol request, the fetch fake
// every HTTP request: the only thing a UniWork AI turn sends is the chat completion on its own route.
// The adapter is slice A: its `streamUniwork` is replaced by one that posts through the transport the
// frame hands it, then reports an editing tool call the way the real adapter does.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installModuleBridge } from './module-bridge'
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
  it('sends no api.save / api.saveAs and no upload request', async () => {
    const urls: Array<{ url: string; method: string }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        urls.push({ url: String(input), method: init?.method ?? 'GET' })
        return new Response(null, { status: 200, headers: { 'X-UniWork-AI-Run': 'run-1' } })
      }),
    )
    const mock = createMockPort({ documentId: 'doc-1' })
    const target: Record<string, unknown> = {}
    installModuleBridge({
      module: 'markdown',
      frameCapabilities: { save: true, saveAs: true },
      client: {
        ...mock.port,
        getToken: vi.fn(async () => 'tok-1'),
        refreshToken: vi.fn(async () => 'tok-2'),
      },
      target,
      // the module's own (off) stubs: the web AI bridge replaces them while the grant is on
      globals: { markdownApi: () => ({ aiStream: async () => {}, onAiStream: () => () => {} }) },
    })
    mock.init({ apiBase: '/api/v1', capabilities: { uniworkAi: true, save: true, saveAs: true } })
    await flush()
    const api = target.markdownApi as {
      aiStream(request: unknown): Promise<void>
      onAiStream(handler: (chunk: { type: string }) => void): () => void
    }
    const chunks: Array<{ type: string }> = []
    api.onAiStream((c) => chunks.push(c))
    await api.aiStream({
      requestId: 'a1',
      settings: { provider: 'uniwork', providers: {} },
      system: '',
      messages: [{ role: 'user', content: 'fix the typo' }],
    })
    expect(chunks.map((c) => c.type)).toEqual(['tool-call', 'delta', 'done'])
    const saved = mock.calls.filter((c) => /^api\.(save|saveAs|upload|create)/.test(c.type))
    expect(saved).toEqual([])
    // the frame's only HTTP request is the chat completion on the UniWork AI route
    expect(urls).toHaveLength(1)
    expect(urls[0]!.method).toBe('POST')
    expect(urls[0]!.url).toMatch(
      /\/office-frame\/documents\/doc-1\/ai\/uniwork\/chat\/completions$/,
    )
  })
})
