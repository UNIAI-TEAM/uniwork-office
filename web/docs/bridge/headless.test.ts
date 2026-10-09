// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenFileResult } from '../../../apps/docs/src/shared/ipc'
import {
  HEADLESS_EVENT,
  HEADLESS_OUT_PATH,
  HEADLESS_PART,
  createHeadless,
  createHeadlessPort,
  isTopLevel,
  parseHeadlessEntry,
  type HeadlessStatus,
} from './headless'
import { createWebApi } from './webapi'
import { bytesAt, installBlobUrls } from './testing/blob-urls'

const PAGE = 'https://office.example.com/office-frame/docs/v1/index.html'
const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])

const entry = (query: string, topLevel = true) => parseHeadlessEntry(`${PAGE}?${query}`, topLevel)
const open = (target: string) => `headless=1&open=${encodeURIComponent(target)}`

const status = () => (window as unknown as { __docsWebHeadless?: HeadlessStatus }).__docsWebHeadless

beforeEach(() => {
  installBlobUrls()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as unknown as { __docsWebHeadless?: unknown }).__docsWebHeadless
  delete document.documentElement.dataset.docsHeadless
})

describe('parseHeadlessEntry (the gate)', () => {
  it('accepts a top-level page with headless=1 and a same-origin path', () => {
    expect(entry(open('/__input.docx'))).toEqual({
      url: 'https://office.example.com/__input.docx',
      name: '__input.docx',
    })
  })

  it('resolves relative and same-origin absolute URLs against the page', () => {
    expect(entry(open('files/My%20Report.docx'))).toEqual({
      url: 'https://office.example.com/office-frame/docs/v1/files/My%20Report.docx',
      name: 'My Report.docx',
    })
    expect(entry(open('https://office.example.com/x/a.docx?v=2'))?.url).toBe(
      'https://office.example.com/x/a.docx?v=2',
    )
  })

  it('is inert in a frame: ?open= is ignored whatever the URL says', () => {
    expect(entry(open('/__input.docx'), false)).toBeNull()
  })

  it('needs the explicit opt-in', () => {
    expect(entry(`open=${encodeURIComponent('/__input.docx')}`)).toBeNull()
    expect(entry(`headless=true&open=/a.docx`)).toBeNull()
    expect(entry(`headless=0&open=/a.docx`)).toBeNull()
    expect(entry(`headless=1`)).toBeNull()
    expect(entry(`headless=1&open=`)).toBeNull()
  })

  it.each([
    ['cross-origin absolute', 'https://evil.example.net/a.docx'],
    ['other port', 'https://office.example.com:8443/a.docx'],
    ['other scheme, same host', 'http://office.example.com/a.docx'],
    ['protocol-relative', '//evil.example.net/a.docx'],
    ['protocol-relative, same host', '//office.example.com/a.docx'],
    ['backslash protocol-relative', '/\\evil.example.net/a.docx'],
    ['double backslash', '\\\\evil.example.net\\a.docx'],
    ['data:', 'data:application/octet-stream;base64,UEsDBA=='],
    ['blob: of the same origin', 'blob:https://office.example.com/0f6b2c4e'],
    ['javascript:', 'javascript:alert(1)'],
    ['credentials', 'https://user:pw@office.example.com/a.docx'],
  ])('rejects %s', (_label, target) => {
    expect(entry(open(target))).toBeNull()
  })

  it('rejects pages that are not http(s) and unparsable URLs', () => {
    expect(parseHeadlessEntry('file:///tmp/index.html?headless=1&open=/a.docx', true)).toBeNull()
    expect(parseHeadlessEntry('not a url', true)).toBeNull()
  })
})

describe('isTopLevel', () => {
  it('is true for an unframed window and false for a framed one', () => {
    expect(isTopLevel(window)).toBe(true)
    const framed = { top: {}, parent: {} } as unknown as Window
    expect(isTopLevel(framed)).toBe(false)
  })

  it('fails closed when the parent cannot be read', () => {
    const opaque = {
      get parent(): Window {
        throw new Error('SecurityError')
      },
    } as unknown as Window
    expect(isTopLevel(opaque)).toBe(false)
  })
})

describe('createHeadlessPort', () => {
  it('synthesizes init: the document as init.open, light theme, print/export-only grants', async () => {
    const port = createHeadlessPort({ url: 'https://o.example/a.docx', name: 'a.docx' })
    const session = await port.whenInitialized()
    expect(session.open).toEqual({
      file: { fileId: 'headless', name: 'a.docx' },
      source: { kind: 'url', url: 'https://o.example/a.docx' },
    })
    expect(session.theme).toBe('light')
    expect(session.capabilities).toMatchObject({
      save: false,
      saveAs: false,
      recents: false,
      filePick: false,
      print: true,
      exportPdf: true,
    })
  })

  it('refuses every api.* request', async () => {
    const port = createHeadlessPort({ url: 'https://o.example/a.docx', name: 'a.docx' })
    await expect(port.request('api.recents', { limit: 1 })).rejects.toMatchObject({
      code: 'unsupported',
    })
  })
})

describe('createHeadless + webapi', () => {
  function boot(url = 'https://o.example/docs/Report.docx') {
    const events: HeadlessStatus[] = []
    window.addEventListener(HEADLESS_EVENT, (e) =>
      events.push((e as CustomEvent<HeadlessStatus>).detail),
    )
    const headless = createHeadless({ url, name: 'Report.docx' })
    const webapi = createWebApi(headless.port, { session: { pollMs: 0 } })
    return { headless, desktop: headless.desktopFor(webapi), events }
  }

  it('opens the document with credentials omitted and signals opened -> done', async () => {
    const fetchMock = vi.fn(async () => new Response(DOCX.slice(), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { desktop, events } = boot()
    expect(status()?.state).toBe('opening')
    expect(document.documentElement.dataset.docsHeadless).toBe('opening')

    const opened = (await desktop.consumePendingOpenDocx()) as OpenFileResult
    expect(fetchMock).toHaveBeenCalledWith('https://o.example/docs/Report.docx', {
      credentials: 'omit',
      headers: undefined,
    })
    expect(opened.path).toBe('uniwork://files/headless/Report.docx')
    expect(await bytesAt(opened.dataUrl)).toEqual(DOCX)
    expect(status()?.state).toBe('opened')

    // the renderer's headless-export path: one target, prints, then the report
    expect(await desktop.consumeHeadlessExport()).toEqual({
      outPath: HEADLESS_OUT_PATH,
      format: 'pdf',
    })
    expect(await desktop.consumeHeadlessExport()).toBeNull()
    expect(await desktop.printPdfBuffer(11906, 16838, 1)).toEqual({
      ok: true,
      base64: HEADLESS_PART,
    })
    expect((await desktop.saveMergedPdf('Report', [HEADLESS_PART])).ok).toBe(true)
    desktop.headlessExportDone({ ok: true })

    expect(status()).toMatchObject({
      state: 'done',
      prints: [{ kind: 'part', w: 11906, h: 16838, scale: 1 }, { kind: 'merge' }],
    })
    expect(document.documentElement.dataset.docsHeadless).toBe('done')
    expect(events.map((e) => e.state)).toEqual(['opening', 'opened', 'done'])
  })

  it('is read-only: every save path is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(DOCX.slice(), { status: 200 })),
    )
    const { desktop } = boot()
    await desktop.consumePendingOpenDocx()
    expect((await desktop.saveDocx()).ok).toBe(false)
    expect((await desktop.saveDocxAs()).ok).toBe(false)
    expect((await desktop.saveDocxNew()).ok).toBe(false)
  })

  it('signals failed when the document cannot be fetched, and stays failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    )
    const { desktop } = boot()
    expect(await desktop.consumePendingOpenDocx()).toBeNull()
    expect(status()?.state).toBe('failed')
    expect(status()?.error).toMatch(/404/)
    desktop.headlessExportDone({ ok: true })
    expect(status()?.state).toBe('failed')
  })

  it('reports a failed renderer export', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(DOCX.slice(), { status: 200 })),
    )
    const { desktop } = boot()
    await desktop.consumePendingOpenDocx()
    desktop.headlessExportDone({ ok: false, error: 'pagination produced no pages' })
    expect(status()).toMatchObject({ state: 'failed', error: 'pagination produced no pages' })
  })
})

describe('install.ts', () => {
  async function install(query: string, framed = false) {
    vi.resetModules()
    history.replaceState(null, '', `/office-frame/docs/v1/index.html?${query}`)
    if (framed) vi.spyOn(window, 'parent', 'get').mockReturnValue({} as Window)
    const fetchMock = vi.fn(async () => new Response(DOCX.slice(), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const postMessage = vi.spyOn(window, 'postMessage')
    await import('./install')
    const desktop = (window as unknown as { desktop: Record<string, (...a: unknown[]) => unknown> })
      .desktop
    return { desktop, fetchMock, postMessage }
  }

  afterEach(() => history.replaceState(null, '', '/'))

  it('top-level + opt-in: opens the same-origin document without a handshake', async () => {
    const { desktop, fetchMock, postMessage } = await install(open('/__input.docx'))
    const opened = (await desktop.consumePendingOpenDocx()) as OpenFileResult
    expect(opened.name).toBe('__input.docx')
    expect(fetchMock).toHaveBeenCalledWith(`${location.origin}/__input.docx`, {
      credentials: 'omit',
      headers: undefined,
    })
    expect(postMessage).not.toHaveBeenCalled()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(await desktop.consumeHeadlessExport()).toMatchObject({ format: 'pdf' })
  })

  it('framed: ?headless=1&open= is ignored entirely', async () => {
    const { desktop, fetchMock } = await install(open('/__input.docx'), true)
    expect(status()).toBeUndefined()
    expect(document.documentElement.dataset.docsHeadless).toBeUndefined()
    expect(await desktop.consumeHeadlessExport()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('top-level without the opt-in: ?open= alone does nothing', async () => {
    const { desktop, fetchMock } = await install(`open=${encodeURIComponent('/__input.docx')}`)
    expect(status()).toBeUndefined()
    expect(await desktop.consumeHeadlessExport()).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
