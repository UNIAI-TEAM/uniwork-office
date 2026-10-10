// @vitest-environment jsdom
// UNI-1016 (SH4): AI in the Sheets web frame = the shared web AI bridge (CONTRACT C16) on the
// Sheets globals. Off: no AI keys, no request. On: the frame-token routes. The four desktop-only
// members stay hidden and answer typed "unavailable".
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installModuleBridge } from '../../docs/bridge/module-bridge'
import { createMockPort } from '../../docs/bridge/testing/mock-port'
import { createSheetsWebApi } from './bridge'
import { sheetsHostGrants, sheetsWebCapabilities } from './capabilities'
import { createUnavailableTransport } from './engine/unavailable'

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const CREDENTIALS = {
  items: [
    {
      provider: 'openai',
      label: '',
      base_url: '',
      key_hint: '…abcd',
      created_at: '2026-10-09T00:00:00Z',
      updated_at: '2026-10-09T00:00:00Z',
    },
  ],
  providers: [
    { id: 'openai', protocol: 'openai-compatible', requires_base_url: false, default_base_url: '' },
  ],
}

const CLOUD = {
  enabled: true,
  tools: {
    web_search: true,
    image_search: false,
    image_generate: true,
    media_analyze: true,
    transcribe: true,
  },
  credits: { unit: 'ai.tokens', used: 10, limit: 100, remaining: 90, period_end: null },
}

const FRAME = { save: true, saveAs: true, filePick: true, print: true, exportPdf: true }

function setup(grants: Record<string, boolean>, answer?: (url: string) => Response) {
  const urls: string[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    urls.push(url)
    if (answer) return answer(url)
    if (url.endsWith('/credentials')) return json(200, CREDENTIALS)
    if (url.endsWith('/cloud')) return json(200, CLOUD)
    if (url.endsWith('/byok/openai/chat/completions'))
      return json(200, { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })
    return json(404, { code: 'credential_missing' })
  })
  vi.stubGlobal('fetch', fetch)
  const mock = createMockPort({ documentId: 'doc-1' })
  const transport = createUnavailableTransport()
  const target: Record<string, unknown> = {}
  const installed = installModuleBridge({
    module: 'sheets',
    frameCapabilities: FRAME,
    capabilities: { defaults: sheetsWebCapabilities(transport), grants: sheetsHostGrants },
    client: {
      ...mock.port,
      getToken: vi.fn(async () => 'tok-1'),
      refreshToken: vi.fn(async () => 'tok-2'),
    },
    target,
    globals: {
      desktopApi: (ctx) =>
        createSheetsWebApi(ctx.client, { transport, capabilities: ctx.capabilities }).desktopApi,
    },
  })
  const desktop = target.desktopApi as Record<string, (...args: unknown[]) => Promise<any>>
  return {
    mock,
    urls,
    fetch,
    desktop,
    caps: installed.capabilities,
    async boot() {
      mock.init({ apiBase: '/api/v1', capabilities: grants })
      await flush()
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
  try {
    localStorage.clear()
  } catch {
    // no storage here
  }
})

describe('sheetsHostGrants (AI family)', () => {
  it('maps ai / aiCredentials / the cloud tools; each tool needs ai too', () => {
    expect(
      sheetsHostGrants({ ai: true, webSearch: true, imageSearch: true, imageGeneration: false }),
    ).toMatchObject({
      ai: true,
      aiCredentials: true,
      webSearch: true,
      imageSearch: true,
      imageGeneration: false,
    })
    expect(sheetsHostGrants({ webSearch: true, imageSearch: true, imageGeneration: true })).toEqual(
      expect.objectContaining({
        ai: false,
        aiCredentials: false,
        webSearch: false,
        imageSearch: false,
        imageGeneration: false,
      }),
    )
    expect(sheetsHostGrants(undefined).ai).toBe(false)
  })

  it('still maps the file grants', () => {
    expect(sheetsHostGrants({ filePick: true, recents: true, save: true, saveAs: true })).toEqual(
      expect.objectContaining({ open: true, recents: true, save: true, saveAs: true }),
    )
  })
})

describe('without the ai grant', () => {
  it('shows no AI UI: every key false, the members answer as the stubs, no AI request', async () => {
    const t = setup({ filePick: true, save: true })
    await t.boot()
    expect(t.caps).toMatchObject({
      ai: false,
      aiCredentials: false,
      webSearch: false,
      imageSearch: false,
      imageGeneration: false,
      createDocument: false,
      autoRename: false,
      mergeWorkbooks: false,
    })
    const r = await t.desktop.aiChat({ settings: {}, system: 's', user: 'u' })
    expect(r).toMatchObject({ ok: false })
    expect(String(r.error)).toMatch(/^ai-unavailable:/)
    expect(await t.desktop.webSearch('q')).toMatchObject({ method: 'error', results: [] })
    expect(t.fetch).not.toHaveBeenCalled()
  })

  it('a webSearch grant alone changes nothing', async () => {
    const t = setup({ webSearch: true, imageSearch: true, imageGeneration: true })
    await t.boot()
    expect(t.caps).toMatchObject({ ai: false, webSearch: false, imageSearch: false })
    expect(t.fetch).not.toHaveBeenCalled()
  })
})

describe('with the ai grant', () => {
  it('turns the AI keys on, narrowed by the server tool switches', async () => {
    const t = setup({ ai: true, webSearch: true, imageSearch: true, imageGeneration: true })
    await t.boot()
    await vi.waitFor(() => expect(t.urls.some((u) => u.endsWith('/cloud'))).toBe(true))
    await vi.waitFor(() => expect(t.caps.imageSearch).toBe(false))
    expect(t.caps).toMatchObject({
      ai: true,
      aiCredentials: true,
      webSearch: true,
      imageGeneration: true,
    })
    // the four desktop-only members stay hidden whatever the host grants
    expect(t.caps).toMatchObject({
      createDocument: false,
      autoRename: false,
      mergeWorkbooks: false,
    })
  })

  it('chat runs on the frame-token BYOK route, never on a stub', async () => {
    const t = setup({ ai: true })
    await t.boot()
    const settings = await t.desktop.getAiSettings()
    expect(settings.provider).toBe('openai')
    expect(settings.providers.openai.apiKey).toBe('')
    const r = await t.desktop.aiChat({ settings, system: 's', user: 'hello' })
    expect(r).toMatchObject({ ok: true, content: 'ok' })
    expect(t.urls.some((u) => u.endsWith('/documents/doc-1/ai/byok/openai/chat/completions'))).toBe(
      true,
    )
    const headers = new Headers((t.fetch.mock.calls.at(-1)![1] as RequestInit).headers)
    expect(headers.get('authorization')).toBe('Bearer tok-1')
  })

  it('a typed server failure comes back in the member shape (and as an in-frame card)', async () => {
    const t = setup({ ai: true }, (url) =>
      url.endsWith('/credentials')
        ? json(200, CREDENTIALS)
        : url.endsWith('/cloud')
          ? json(200, CLOUD)
          : json(402, { code: 'credits_exhausted' }),
    )
    await t.boot()
    const settings = await t.desktop.getAiSettings()
    const r = await t.desktop.aiChat({ settings, system: 's', user: 'hello' })
    expect(r.ok).toBe(false)
    expect(document.querySelector('[data-ai-state]')).not.toBeNull()
  })
})

describe('desktop-only members stay unavailable (typed answers)', () => {
  it('createDocument, readLocalImage, openWorkbooksForMerge, autoRenameWorkbook', async () => {
    const t = setup({ ai: true, webSearch: true, imageSearch: true, imageGeneration: true })
    await t.boot()
    expect(await t.desktop.createDocument({ type: 'md', title: 'x' })).toMatchObject({ ok: false })
    await expect(t.desktop.readLocalImage({ path: '/etc/x.png' })).rejects.toThrow(/Not available/)
    expect(await t.desktop.openWorkbooksForMerge(['/x.xlsx'])).toBeNull()
    expect(await t.desktop.autoRenameWorkbook('s', 'x')).toEqual({ renamed: false })
  })
})

describe('fetchImage (AI image tools)', () => {
  it('decodes data: URLs locally, proxies https through the host, refuses the rest', async () => {
    const t = setup({ ai: true })
    await t.boot()
    expect(await t.desktop.fetchImage('data:image/png;base64,AAEC')).toEqual({
      base64: 'AAEC',
      mime: 'image/png',
    })
    expect(await t.desktop.fetchImage('https://example.com/a.png')).toEqual({
      base64: 'iVBORw0KGgo=',
      mime: 'image/png',
    })
    expect(t.mock.calls.filter((c) => c.type === 'image.fetch')).toHaveLength(1)
    expect(await t.desktop.fetchImage('file:///etc/passwd')).toBeNull()
    expect(await t.desktop.fetchImage('')).toBeNull()
    t.mock.override('image.fetch', () => {
      throw new Error('boom')
    })
    expect(await t.desktop.fetchImage('https://example.com/b.png')).toBeNull()
  })
})
