// UNI-1232 A1: what the scripts preview gets of a page whose pictures, stylesheets and scripts
// are files of the same UniWork folder (OpenPayload.assets).
import { describe, expect, it, vi } from 'vitest'
import type { ImageBytes } from '../shared/assets'
import { inlineAssetsForPreview } from './preview-copy'

const MAP: Record<string, string> = {
  'style.css': '/u/css',
  './css/theme.css': '/u/theme',
  'app.js': '/u/js',
  'late.js': '/u/late',
  'module.js': '/u/mod',
  'logo.svg': '/u/logo',
  'photo.webp': '/u/photo',
  'gone.js': '/u/gone',
}
const resolve = (src: string): string | null => MAP[src] ?? null
const TEXT: Record<string, string> = {
  'style.css': 'body{color:red}',
  './css/theme.css': '/* </style> */ p{margin:0}',
  'app.js': 'window.__app = 1',
  'late.js': 'document.title = "late"',
  'module.js': 'export const x = 1',
}
const IMG: Record<string, ImageBytes> = {
  'logo.svg': { mime: 'image/svg+xml', base64: 'PHN2Zy8+' },
  'photo.webp': { mime: 'image/webp', base64: 'AQID' },
}

function run(html: string) {
  const readText = vi.fn(async (src: string) => TEXT[src] ?? null)
  const readImage = vi.fn(async (src: string) => IMG[src] ?? null)
  const cache = new Map<string, string>()
  const textCache = new Map<string, string>()
  const out = inlineAssetsForPreview(html, resolve, readImage, cache, {
    read: readText,
    cache: textCache,
  })
  return { out, readText, readImage, cache, textCache }
}

describe('pictures', () => {
  it('SVG and WebP pictures become data: URIs, in src and in CSS url()', async () => {
    const { out } = run(
      '<img src="logo.svg"><div style="background:url(photo.webp)"></div><img src="https://x/y.png">',
    )
    expect(await out).toBe(
      '<img src="data:image/svg+xml;base64,PHN2Zy8+"><div style="background:url(data:image/webp;base64,AQID)"></div><img src="https://x/y.png">',
    )
  })

  it('works without the text-file reader (pictures only, as before)', async () => {
    const out = await inlineAssetsForPreview(
      '<link rel="stylesheet" href="style.css"><img src="logo.svg">',
      resolve,
      async (src) => IMG[src] ?? null,
      new Map(),
    )
    expect(out).toContain('<link rel="stylesheet" href="style.css">')
    expect(out).toContain('data:image/svg+xml;base64,PHN2Zy8+')
  })
})

describe('stylesheets', () => {
  it('a mapped <link rel=stylesheet> becomes an inline <style> keeping media and other attributes', async () => {
    const { out } = run(
      '<head><link rel="stylesheet" href="style.css" media="print" data-gx-sid="3"></head>',
    )
    expect(await out).toBe(
      '<head><style media="print" data-gx-sid="3">body{color:red}</style></head>',
    )
  })

  it('finds the link whatever the attribute order, quoting and ./ spelling, and escapes </style', async () => {
    const { out } = run("<link href='./css/theme.css' rel=stylesheet>")
    expect(await out).toBe('<style>/* <\\/style> */ p{margin:0}</style>')
  })

  it('leaves unmapped, remote, data: and non-stylesheet links as written', async () => {
    const html =
      '<link rel="stylesheet" href="other.css"><link rel="stylesheet" href="https://cdn.example/a.css">' +
      '<link rel="icon" href="style.css"><link rel="stylesheet" href="//cdn.example/b.css">'
    const { out, readText } = run(html)
    expect(await out).toBe(html)
    expect(readText).not.toHaveBeenCalled()
  })
})

describe('scripts', () => {
  it('a mapped <script src> becomes an inline script; type and other attributes stay', async () => {
    const { out } = run(
      '<script src="app.js"></script><script type="module" src="module.js"></script>',
    )
    expect(await out).toBe(
      '<script>window.__app = 1</script><script type="module">export const x = 1</script>',
    )
  })

  it('escapes a closing script tag inside the file', async () => {
    const readText = vi.fn(async () => 'var s = "</script><b>"')
    const out = await inlineAssetsForPreview(
      '<script src="app.js"></script>',
      resolve,
      async () => null,
      new Map(),
      { read: readText, cache: new Map() },
    )
    expect(out).toBe('<script>var s = "<\\/script><b>"</script>')
  })

  it('a classic defer script runs after parsing: its inline copy moves to the end of the body', async () => {
    const { out } = run(
      '<html><head><script defer src="late.js"></script></head><body><p>x</p></body></html>',
    )
    expect(await out).toBe(
      '<html><head></head><body><p>x</p><script>document.title = "late"</script></body></html>',
    )
  })

  it('a script the host does not serve (403, unmapped) keeps its tag as written', async () => {
    const html = '<script src="gone.js"></script><script src="https://cdn.example/x.js"></script>'
    const { out } = run(html)
    expect(await out).toBe(html)
  })

  it('inline scripts without src are untouched', async () => {
    const html = '<script>alert(1)</script>'
    const { out } = run(html)
    expect(await out).toBe(html)
  })
})

describe('caching', () => {
  it('reads each file once per document', async () => {
    const first = run('<link rel="stylesheet" href="style.css"><script src="app.js"></script>')
    await first.out
    expect(first.readText).toHaveBeenCalledTimes(2)
    const readText = vi.fn(async () => null)
    const again = await inlineAssetsForPreview(
      '<link rel="stylesheet" href="style.css">',
      resolve,
      async () => null,
      first.cache,
      { read: readText, cache: first.textCache },
    )
    expect(again).toBe('<style>body{color:red}</style>')
    expect(readText).not.toHaveBeenCalled()
  })
})
