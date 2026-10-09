// @vitest-environment jsdom
// GO-B4 H-1/H-2 (UNI-1014): window.htmlApi over a mocked frame port (static preview, P1).
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
import { TEXT_MODULE_WEB_CAPABILITIES, textModuleGrants } from '../shared/capabilities'
import type { TextWebApiOptions } from '../shared/text-webapi'
import { HTML_WEB_CAPABILITIES, createHtmlWebApi } from './webapi'

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

function setup(caps: Capabilities = FULL, drafts?: TextWebApiOptions['drafts']) {
  const mock = createMockPort()
  const file = mock.seed('Page.html', enc(PAGE))
  const print = vi.fn(async (_html: string) => ({ ok: true }))
  const target: Record<string, unknown> = {}
  installModuleBridge({
    module: 'html',
    frameCapabilities: FULL,
    capabilities: {
      defaults: { ...TEXT_MODULE_WEB_CAPABILITIES, ...HTML_WEB_CAPABILITIES },
      grants: textModuleGrants,
    },
    globals: { htmlApi: (ctx) => createHtmlWebApi(ctx, { print, drafts }) },
    client: mock.port,
    target,
  })
  const api = target.htmlApi as Api
  mock.init({
    documentId: file.fileId,
    capabilities: caps,
    open: { ...mock.openPayload(file.fileId), assets: { 'assets/p.png': '/files/p' } },
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
    expect(await api.getPreviewInfo()).toEqual({ url: '' })
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

  it('hides scripts, visual edit, new-tab present, Word export and AI on the web', async () => {
    const { api } = setup()
    await api.consumePending()
    expect(api.capabilities).toMatchObject({
      htmlPreviewScripts: false,
      htmlVisualEdit: false,
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
