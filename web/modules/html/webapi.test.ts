// @vitest-environment jsdom
// GO-B4 H-1/H-2 (UNI-1014): window.htmlApi over a mocked frame port (scripts preview over a
// MessagePort, static fallback).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installModuleBridge } from '../../docs/bridge/module-bridge'
import { createMockPort } from '../../docs/bridge/testing/mock-port'
import type { Capabilities } from '../../docs/protocol/types'
import {
  DRAFTS_DB,
  DRAFTS_STORE,
  createDraftRecovery,
  createIdbDraftStore,
} from '../../docs/bridge/draft-recovery'
import { createFakeIdb } from '../../docs/bridge/testing/fake-idb'
import { TEXT_MODULE_WEB_CAPABILITIES } from '../shared/capabilities'
import type { TextWebApiOptions } from '../shared/text-webapi'
import { PREVIEW_NS } from './preview-channel'
import { HTML_WEB_CAPABILITIES, createHtmlWebApi, htmlModuleGrants } from './webapi'

type Api = ReturnType<typeof createHtmlWebApi> & { capabilities: Record<string, unknown> }

const enc = (s: string) => new TextEncoder().encode(s)
const PAGE =
  '<!doctype html>\r\n<html><body>\r\n<h1>Hi</h1>\r\n<img src="assets/p.png">\r\n<script>alert(1)</script>\r\n</body></html>\r\n'
const FULL: Capabilities = {
  save: true,
  saveAs: true,
  print: true,
  exportPdf: true,
  exportHtml: true,
  images: true,
}

function setup(
  caps: Capabilities = FULL,
  drafts?: TextWebApiOptions['drafts'],
  assets: Record<string, string> = { 'assets/p.png': '/files/p' },
) {
  const mock = createMockPort()
  const file = mock.seed('Page.html', enc(PAGE))
  const print = vi.fn(async (_html: string) => ({ ok: true }))
  const target: Record<string, unknown> = {}
  installModuleBridge({
    module: 'html',
    frameCapabilities: FULL,
    capabilities: {
      defaults: { ...TEXT_MODULE_WEB_CAPABILITIES, ...HTML_WEB_CAPABILITIES },
      grants: htmlModuleGrants,
    },
    globals: { htmlApi: (ctx) => createHtmlWebApi(ctx, { print, drafts }) },
    client: mock.port,
    target,
  })
  const api = target.htmlApi as Api
  mock.init({
    documentId: file.fileId,
    capabilities: caps,
    open: { ...mock.openPayload(file.fileId), assets },
  })
  return { mock, file, api, print }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('htmlApi', () => {
  it('open -> save without edits writes the exact input bytes', async () => {
    const { api, mock, file } = setup()
    const path = (await api.consumePending())!
    const text = await api.readFile(path)
    expect(await api.save({ text, imageSources: [], mode: 'save' })).toMatchObject({ ok: true })
    expect(Array.from(mock.bytesOf(file.fileId)!)).toEqual(Array.from(enc(PAGE)))
  })

  it('the preview is a static copy: no script, mapped pictures, pushed to the renderer', async () => {
    const { api } = setup()
    await api.consumePending()
    const seen: string[] = []
    api.onStaticPreview((html) => seen.push(html))
    expect(seen).toEqual([])
    api.updatePreview(
      '<html><body><p onclick="x()">a</p><img src="assets/p.png"><script>1</script></body></html>',
    )
    expect(seen).toHaveLength(1)
    expect(seen[0]).not.toContain('<script')
    expect(seen[0]).not.toContain('onclick')
    expect(seen[0]).toContain('src="/files/p"')
    // a late subscriber gets the current copy at once
    const late = vi.fn()
    api.onStaticPreview(late)
    expect(late).toHaveBeenCalledWith(seen[0])
  })

  it('the scripts preview: preview.html next to the frame, the page over one MessagePort', async () => {
    const { api } = setup()
    await api.consumePending()
    expect((await api.getPreviewInfo()).url).toBe(new URL('preview.html', location.href).href)
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
      ),
    )
    const page =
      '<html><body><p onclick="x()">a</p><img src="assets/p.png"><script>1</script></body></html>'
    api.updatePreview(page)
    let sent: {
      data: { ns: string; type: string; html: string }
      origin: string
      ports: MessagePort[]
    } | null = null
    const target = {
      postMessage: (data: never, origin: string, ports: MessagePort[]) =>
        (sent = { data, origin, ports }),
    } as unknown as Window
    const onMessage = vi.fn()
    const onFailed = vi.fn()
    const channel = api.connectPreview(target, { onMessage, onFailed })
    await vi.waitFor(() => expect(sent).not.toBeNull())
    // the page as written (scripts, handlers), mapped pictures as data: URIs, one port
    expect(sent!.data).toEqual({
      ns: PREVIEW_NS,
      type: 'init',
      html: page.replace('assets/p.png', 'data:image/png;base64,AQID'),
    })
    expect(sent!.origin).toBe('*')
    expect(sent!.ports).toHaveLength(1)
    const preview = sent!.ports[0]
    const toPreview: unknown[] = []
    preview.onmessage = (e) => toPreview.push(e.data)
    // posts before the boot answer wait for it; nothing reaches the renderer before it
    channel.post({ type: 'gx:theme', dark: true })
    preview.postMessage({ type: 'gx:ready', version: 1, title: '', docHeight: 1 })
    preview.postMessage({ ns: PREVIEW_NS, type: 'booted' })
    preview.postMessage({ type: 'gx:hover', version: 1, sid: 2 })
    await vi.waitFor(() => expect(onMessage).toHaveBeenCalledTimes(1))
    expect(onMessage).toHaveBeenCalledWith({ type: 'gx:hover', version: 1, sid: 2 })
    await vi.waitFor(() => expect(toPreview).toEqual([{ type: 'gx:theme', dark: true }]))
    channel.close()
    preview.close()
    expect(onFailed).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('the scripts preview falls back when preview.html never answers', async () => {
    const { api } = setup()
    await api.consumePending()
    api.updatePreview('<p>a</p>')
    let ports: MessagePort[] = []
    const target = {
      postMessage: (_d: unknown, _o: string, p: MessagePort[]) => (ports = p),
    } as unknown as Window
    vi.useFakeTimers()
    const onFailed = vi.fn()
    const channel = api.connectPreview(target, { onMessage: vi.fn(), onFailed })
    await vi.waitFor(() => expect(ports).toHaveLength(1))
    vi.advanceTimersByTime(8_000)
    expect(onFailed).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
    channel.close()
    ports[0]!.close()
  })

  it('the scripts preview inlines mapped stylesheets, scripts and pictures (UNI-1232 A1)', async () => {
    const { api } = setup(FULL, undefined, {
      'assets/p.png': '/files/p',
      'style.css': '/files/css',
      'app.js': '/files/js',
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/files/css'
          ? new Response('p{color:red}', { headers: { 'content-type': 'text/css' } })
          : url === '/files/js'
            ? new Response('window.__x=1', { headers: { 'content-type': 'text/javascript' } })
            : new Response(new Uint8Array([1, 2, 3]), {
                headers: { 'content-type': 'image/webp' },
              }),
      ),
    )
    await api.consumePending()
    api.updatePreview(
      '<html><head><link rel="stylesheet" href="style.css"><script src="app.js"></script></head><body><img src="assets/p.png"></body></html>',
    )
    let sent: { html: string } | null = null
    const target = {
      postMessage: (data: { html: string }) => (sent = data),
    } as unknown as Window
    const channel = api.connectPreview(target, { onMessage: vi.fn(), onFailed: vi.fn() })
    await vi.waitFor(() => expect(sent).not.toBeNull())
    expect(sent!.html).toBe(
      '<html><head><style>p{color:red}</style><script>window.__x=1</script></head><body><img src="data:image/webp;base64,AQID"></body></html>',
    )
    channel.close()
    vi.unstubAllGlobals()
  })

  it('openInDesktopApp sends app.open only with the desktopOpen grant, without a request timeout', async () => {
    const granted = setup({ ...FULL, desktopOpen: true })
    granted.mock.override('app.open', () => ({ outcome: 'launched' }))
    await granted.api.consumePending()
    expect(await granted.api.openInDesktopApp('html.preview')).toBe('launched')
    const call = granted.mock.calls.find((c) => c.type === 'app.open')!
    expect(call.payload).toEqual({ feature: 'html.preview' })
    // 0 = wait for the host's own unsaved-changes dialog as long as the user takes
    expect(call.opts?.timeoutMs).toBe(0)
    expect(granted.api.capabilities.desktopOpen).toBe(true)

    const plain = setup()
    await plain.api.consumePending()
    expect(await plain.api.openInDesktopApp('html.preview')).toBe('unavailable')
    expect(plain.mock.calls.some((c) => c.type === 'app.open')).toBe(false)
    expect(plain.api.capabilities.desktopOpen).toBe(false)
  })

  it('a failed app.open is quiet: the host shows its own alert', async () => {
    const { api, mock } = setup({ ...FULL, desktopOpen: true })
    mock.override('app.open', () => Promise.reject(new Error('host gone')))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await api.consumePending()
    expect(await api.openInDesktopApp()).toBe('unavailable')
    warn.mockRestore()
  })

  it('print / export PDF prints the static copy of the document', async () => {
    const { api, mock, print } = setup()
    await api.consumePending()
    api.onExportRequest(() => void api.exportPdf({ html: PAGE, suggestedName: 'Page' }))
    expect(await mock.host.print({ mode: 'dialog' })).toEqual({ printed: true })
    const printed = print.mock.calls[0]![0]
    expect(printed).toContain('<h1>Hi</h1>')
    expect(printed).not.toContain('<script')
  })

  it('single-file HTML export inlines the mapped pictures', async () => {
    const { api } = setup()
    await api.consumePending()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
      ),
    )
    let blob: Blob | null = null
    Object.assign(URL, {
      createObjectURL: (b: Blob) => ((blob = b), 'blob:x'),
      revokeObjectURL: () => {},
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    expect(await api.exportHtml({ html: PAGE, suggestedName: 'Page' })).toEqual({
      ok: true,
      path: 'Page.html',
    })
    const out = await blob!.text()
    expect(out).toContain('src="data:image/png;base64,AQID"')
    expect(out).toContain('<script>alert(1)</script>')
    vi.unstubAllGlobals()
  })

  it('scripts + visual edit on (visual edit needs save); new-tab present, Word export and AI hidden', async () => {
    const { api } = setup()
    await api.consumePending()
    expect(api.capabilities).toMatchObject({
      htmlPreviewScripts: true,
      htmlVisualEdit: true,
      presentNewTab: false,
      exportDocx: false,
      ai: false,
      autoSave: false,
      save: true,
    })
    expect((await api.exportDocx()).ok).toBe(false)
    expect(await api.presentInNewTab()).toBe(false)
  })

  it('view only without the save grant', async () => {
    const { api, mock } = setup({ print: true })
    const path = (await api.consumePending())!
    expect(api.capabilities.save).toBe(false)
    expect(api.capabilities.htmlVisualEdit).toBe(false)
    const res = await api.save({ text: await api.readFile(path), imageSources: [], mode: 'save' })
    expect(res.ok).toBe(false)
    expect(mock.calls.some((c) => c.type === 'api.save')).toBe(false)
  })
})

describe('htmlApi: draft recovery (C18)', () => {
  it('a dirty draft written by one frame load is restored by the next as module html', async () => {
    const fake = createFakeIdb()
    const store = createIdbDraftStore(fake.idb)
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    const stops: Array<() => void> = []
    const flushers: Array<() => Promise<void>> = []
    const prompt = vi.fn(async () => 'restore' as const)
    const drafts: TextWebApiOptions['drafts'] = (host) => {
      const r = createDraftRecovery({
        module: 'html',
        host,
        prompt,
        store,
        recovery: () => ({ key, scope: 'u1:doc-1' }),
        target: new EventTarget() as unknown as Window,
        intervalMs: 3_600_000,
      })
      stops.push(() => r.dispose())
      flushers.push(() => r.flush())
      return r
    }

    const first = setup(FULL, drafts)
    const path = (await first.api.consumePending())!
    first.api.provideText(() => PAGE.replace('Hi', 'Edited'))
    first.api.setDirty(true)
    await flushers[0]()
    const records = fake.store(DRAFTS_DB, DRAFTS_STORE)!
    expect([...records.values()]).toMatchObject([{ module: 'html', name: 'Page.html' }])

    const second = setup(FULL, drafts)
    const restored = (await second.api.consumePending())!
    expect(prompt).toHaveBeenCalledOnce()
    expect(await second.api.readFile(restored)).toContain('<h1>Edited</h1>')
    expect(second.api.consumeRecovered()).toBe(PAGE)
    expect(path).toBe(restored)
    for (const stop of stops) stop()
  })
})
