// G6-12 (UNI-1366): pdf insert_image / replace_image download a URL the MODEL
// chose (prompt-injectable via search results). The download goes through the
// shared main-process `ai:fetch-image` handler, which must keep its SSRF guard
// (private / loopback / link-local / metadata targets refused at every redirect
// hop) and its 50 MB body cap. This pins the whole chain: the tools only hand
// http(s) (insert_image also the BYOK file: store) URLs to fetchImage, the
// preload routes it to the guarded channel, the channel's handler uses the
// guard and the cap, and the guard itself refuses what it must.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_REMOTE_IMAGE_BYTES,
  ResponseTooLargeError,
  fetchRemoteImage,
  readBodyCapped,
} from '../../../packages/electron-utils/src/remote-image'
import { executePdfTool, type PdfAiDeps } from '../src/renderer/ai/tools'

const root = join(__dirname, '..', '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

function makeDeps(fetchImage: PdfAiDeps['fetchImage']): PdfAiDeps {
  const target: Record<string, unknown> = {
    readOnly: () => false,
    pageCount: () => 1,
    pageGeom: () => ({ pw: 600, ph: 800, rot: 0 }),
    listImages: async () => [{ pageIndex: 0, rect: [10, 10, 110, 110], aboveText: true }],
    isImageClaimed: () => false,
    isDeleted: () => false,
    insertImage: vi.fn(),
    replaceImage: vi.fn(),
    gotoPage: vi.fn(() => true),
    fetchImage,
    // no image URL rule here: this file pins the SSRF guard behind fetchImage
    imageUrls: undefined,
  }
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop]
      return () => {
        throw new Error(`unexpected deps call: ${prop}`)
      }
    },
  }) as unknown as PdfAiDeps
}

const call = (name: string, input: Record<string, unknown>) => ({ id: 'c1', name, input })
const HOSTILE = [
  'ftp://img.example/a.png',
  'data:image/png;base64,AAAA',
  'javascript:alert(1)',
  '/etc/passwd',
  'C:\\Users\\me\\secret.png',
  '//169.254.169.254/latest',
]

describe('renderer tools only hand fetchable URLs to the guarded fetch', () => {
  it.each(HOSTILE)('insert_image refuses %s before any fetch', async (url) => {
    const fetchImage = vi.fn(async () => null)
    const r = await executePdfTool(makeDeps(fetchImage), call('insert_image', { page: 1, url }))
    expect(r.isError).toBe(true)
    expect(fetchImage).not.toHaveBeenCalled()
  })

  it.each([...HOSTILE, 'file:///etc/passwd'])(
    'replace_image refuses %s before any fetch',
    async (url) => {
      const fetchImage = vi.fn(async () => null)
      const r = await executePdfTool(
        makeDeps(fetchImage),
        call('replace_image', { page: 1, image_number: 1, url }),
      )
      expect(r.isError).toBe(true)
      expect(fetchImage).not.toHaveBeenCalled()
    },
  )

  it('hands an http(s) URL to fetchImage verbatim, and a failed download inserts nothing', async () => {
    const fetchImage = vi.fn(async () => null)
    const deps = makeDeps(fetchImage)
    const r = await executePdfTool(
      deps,
      call('insert_image', { page: 1, url: 'http://169.254.169.254/latest/meta-data' }),
    )
    // the renderer does not pre-judge hosts: the main-process guard decides
    expect(fetchImage).toHaveBeenCalledWith('http://169.254.169.254/latest/meta-data')
    expect(r.isError).toBe(true)
    expect((deps as unknown as { insertImage: () => void }).insertImage).not.toHaveBeenCalled()
  })
})

describe('the ai:fetch-image channel stays guarded and capped', () => {
  it('is wired from the pdf preload to the shared channel, which pdf-main does not shadow', () => {
    expect(read('apps/pdf/src/shared/ipc.ts')).toMatch(/fetchImage:\s*'ai:fetch-image'/)
    expect(read('apps/pdf/src/preload/index.ts')).toMatch(
      /fetchImage:\s*\(url\)\s*=>\s*ipcRenderer\.invoke\(AI_CHANNELS\.fetchImage,\s*url\)/,
    )
    expect(read('apps/pdf/src/main/pdf-main.ts')).not.toMatch(
      /ipcMain\.handle\(\s*['"]ai:fetch-image/,
    )
  })

  it('handler fetches through fetchRemoteImage (SSRF guard) and caps the body', () => {
    const src = read('apps/docs/src/main/docs-main.ts')
    const start = src.indexOf("'ai:fetch-image'")
    expect(start).toBeGreaterThan(-1)
    const handler = src.slice(start, start + 1400)
    expect(handler).toMatch(/fetchRemoteImage\(String\(url\)\)/)
    expect(handler).toMatch(/readBodyCapped\(resp,\s*MAX_REMOTE_IMAGE_BYTES\)/)
    expect(handler).not.toMatch(/\bfetch\(/)
    expect(MAX_REMOTE_IMAGE_BYTES).toBe(50 * 1024 * 1024)
  })
})

describe('the guard behind it', () => {
  const never = () => vi.fn(async () => new Response('x', { status: 200 }))

  it.each([
    'http://127.0.0.1/a.png',
    'http://localhost/a.png',
    'http://10.0.0.5/a.png',
    'http://192.168.1.1/a.png',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/a.png',
    'http://[::ffff:127.0.0.1]/a.png',
    'http://metadata.internal/a.png',
    'ftp://example.com/a.png',
  ])('refuses %s without making a request', async (url) => {
    const fetchImpl = never()
    expect(await fetchRemoteImage(url, { fetchImpl, retryDelaysMs: [] })).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a public URL that redirects to a private address', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/x' } }),
    )
    expect(
      await fetchRemoteImage('http://93.184.216.34/a.png', { fetchImpl, retryDelaysMs: [] }),
    ).toBeNull()
    // the first hop was public and fetched; the private hop never was
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('serves no local file outside the generated-image store', async () => {
    const fetchImpl = never()
    expect(
      await fetchRemoteImage('file:///etc/passwd', { fetchImpl, retryDelaysMs: [] }),
    ).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('stops reading a body that exceeds the cap', async () => {
    const big = new Response(new Uint8Array(2048))
    await expect(readBodyCapped(big, 1024)).rejects.toBeInstanceOf(ResponseTooLargeError)
    const ok = await readBodyCapped(new Response(new Uint8Array(512)), 1024)
    expect(ok.byteLength).toBe(512)
  })
})
