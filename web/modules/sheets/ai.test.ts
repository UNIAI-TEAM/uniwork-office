// @vitest-environment jsdom
// UNI-1016 (SH4): AI in the Sheets web frame = the shared web AI bridge (CONTRACT C16) on the
// Sheets globals. Off: no AI keys, no request. On (the UniWork AI grant, UNI-2289): the frame-token
// routes, UniWork AI only. The four desktop-only members stay hidden and answer typed "unavailable".
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Capabilities } from '../../docs/protocol/types'
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
    if (url.endsWith('/cloud')) return json(200, CLOUD)
    return json(404, { code: 'not_found' })
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
  it('maps the UniWork AI grant and the cloud tools; each tool needs the UniWork AI grant too', () => {
    expect(
      sheetsHostGrants({
        uniworkAi: true,
        webSearch: true,
        imageSearch: true,
        imageGeneration: false,
      }),
    ).toEqual(
      expect.objectContaining({
        ai: true,
        uniworkAi: true,
        webSearch: true,
        imageSearch: true,
        imageGeneration: false,
      }),
    )
    expect(sheetsHostGrants({ webSearch: true, imageSearch: true, imageGeneration: true })).toEqual(
      expect.objectContaining({
        ai: false,
        uniworkAi: false,
        webSearch: false,
        imageSearch: false,
        imageGeneration: false,
      }),
    )
    expect(sheetsHostGrants(undefined).ai).toBe(false)
  })

  it('has no key settings entry, and an old `ai` grant alone opens nothing', () => {
    expect(sheetsHostGrants({ uniworkAi: true })).not.toHaveProperty('aiCredentials')
    expect(sheetsHostGrants({ ai: true, webSearch: true } as Capabilities)).toEqual(
      expect.objectContaining({ ai: false, uniworkAi: false, webSearch: false }),
    )
  })

  it('still maps the file grants', () => {
    expect(sheetsHostGrants({ filePick: true, recents: true, save: true, saveAs: true })).toEqual(
      expect.objectContaining({ open: true, recents: true, save: true, saveAs: true }),
    )
  })
})

describe('without the UniWork AI grant', () => {
  it('shows no AI UI: every key false, the members answer as the stubs, no AI request', async () => {
    const t = setup({ filePick: true, save: true })
    await t.boot()
    expect(t.caps).toMatchObject({
      ai: false,
      webSearch: false,
      imageSearch: false,
      imageGeneration: false,
      createDocument: false,
      autoRename: false,
      mergeWorkbooks: false,
    })
    expect(t.caps).not.toHaveProperty('aiCredentials')
    const r = await t.desktop.aiChat({ settings: {}, system: 's', user: 'u' })
    expect(r).toMatchObject({ ok: false })
    expect(String(r.error)).toMatch(/^ai-unavailable:/)
    expect(await t.desktop.webSearch('q')).toMatchObject({ method: 'error', results: [] })
    expect(t.fetch).not.toHaveBeenCalled()
  })

  it('the cloud tool grants and an old `ai` grant change nothing', async () => {
    const t = setup({ ai: true, webSearch: true, imageSearch: true, imageGeneration: true })
    await t.boot()
    expect(t.caps).toMatchObject({ ai: false, webSearch: false, imageSearch: false })
    expect(t.fetch).not.toHaveBeenCalled()
  })
})

describe('with the UniWork AI grant', () => {
  it('turns the AI keys on, narrowed by the server tool switches', async () => {
    const t = setup({ uniworkAi: true, webSearch: true, imageSearch: true, imageGeneration: true })
    await t.boot()
    await vi.waitFor(() => expect(t.urls.some((u) => u.endsWith('/cloud'))).toBe(true))
    await vi.waitFor(() => expect(t.caps.imageSearch).toBe(false))
    expect(t.caps).toMatchObject({
      ai: true,
      uniworkAi: true,
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

  it('the settings name UniWork AI only; nothing reads or uses a provider key', async () => {
    const t = setup({ uniworkAi: true })
    await t.boot()
    const settings = await t.desktop.getAiSettings()
    expect(settings.provider).toBe('uniwork')
    expect(Object.keys(settings.providers)).toEqual(['uniwork'])
    // a one-shot has no UniWork AI route: it answers the failure text and sends nothing
    const r = await t.desktop.aiChat({ settings, system: 's', user: 'hello' })
    expect(r.ok).toBe(false)
    for (const url of t.urls) {
      expect(url).toMatch(/\/office-frame\/documents\/doc-1\/ai\/cloud$/)
    }
  })

  it('a typed server failure comes back in the member shape (and as an in-frame card)', async () => {
    const t = setup({ uniworkAi: true, webSearch: true }, (url) =>
      url.endsWith('/cloud') ? json(200, CLOUD) : json(402, { code: 'credits_exhausted' }),
    )
    await t.boot()
    const r = await t.desktop.webSearch('cats')
    expect(r).toMatchObject({ method: 'error', results: [] })
    expect(document.querySelector('[data-ai-state="credits_exhausted"]')).not.toBeNull()
  })
})

describe('desktop-only members stay unavailable (typed answers)', () => {
  it('createDocument, readLocalImage, openWorkbooksForMerge, autoRenameWorkbook', async () => {
    const t = setup({ uniworkAi: true, webSearch: true, imageSearch: true, imageGeneration: true })
    await t.boot()
    expect(await t.desktop.createDocument({ type: 'md', title: 'x' })).toMatchObject({ ok: false })
    await expect(t.desktop.readLocalImage({ path: '/etc/x.png' })).rejects.toThrow(/Not available/)
    expect(await t.desktop.openWorkbooksForMerge(['/x.xlsx'])).toBeNull()
    expect(await t.desktop.autoRenameWorkbook('s', 'x')).toEqual({ renamed: false })
  })
})

describe('fetchImage (AI image tools)', () => {
  it('decodes data: URLs locally, proxies https through the host, refuses the rest', async () => {
    const t = setup({ uniworkAi: true })
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
