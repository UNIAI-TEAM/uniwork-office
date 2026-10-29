// @vitest-environment jsdom
// The squiggly / caret / polygon annotations are written by pdf-lib alone (no pdfium call), so the
// web save core produces them with the frame's own seams. save-core.golden.test.ts stays as is.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import type { SavePdfRequest } from '../../../apps/pdf/src/shared/ipc'
import { BufferShim } from './buffer-shim'

const repo = resolve(__dirname, '../../..')
const req = createRequire(join(repo, 'apps/pdf/package.json'))
const PDFIUM = req.resolve('@embedpdf/pdfium/pdfium.wasm')
const HB = join(dirname(req.resolve('harfbuzzjs/package.json')), 'hb-subset.wasm')
const FONT_DIR = join(repo, 'apps/docs/src/renderer/fonts')

const realBuffer = globalThis.Buffer
afterAll(() => {
  globalThis.Buffer = realBuffer
})

async function onePage(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792]).drawText('Annotated page', { x: 72, y: 700, size: 18 })
  return doc.save({ useObjectStreams: false })
}

describe('save core on the web seams: squiggly, caret and polygon', () => {
  it('round-trips the three annotation kinds into the saved file', async () => {
    vi.resetModules()
    const coreEnv = await import('../../../apps/pdf/src/main/core-env')
    const { createWebPdfEnv, WEB_FONT_FACES } = await import('./core-env-web')
    const urls: Record<string, string> = { '/pdfium.wasm': PDFIUM, '/hb-subset.wasm': HB }
    for (const f of WEB_FONT_FACES) urls[`/fonts/${f.file}`] = join(FONT_DIR, f.file)
    const env = createWebPdfEnv({
      pdfiumWasmUrl: '/pdfium.wasm',
      hbSubsetWasmUrl: '/hb-subset.wasm',
      fontUrls: Object.fromEntries(WEB_FONT_FACES.map((f) => [f.file, `/fonts/${f.file}`])),
      fetchBytes: async (url) => {
        const b = await readFile(urls[url]!)
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
      },
      covers: () => false,
    })
    await env.ensureFonts()
    coreEnv.resetPdfCoreEnv()
    coreEnv.setPdfCoreEnv(env.env)
    const save = await import('../../../apps/pdf/src/main/save-pdf')

    const request: SavePdfRequest = {
      path: 'uniwork://files/f1/annots.pdf',
      markups: [
        {
          pageIndex: 0,
          type: 'squiggly',
          color: [1, 0, 0],
          quads: [[72, 718, 260, 718, 72, 698, 260, 698]],
        },
      ],
      drawings: [
        { kind: 'caret', pageIndex: 0, color: [0, 0, 1], point: [300, 700] },
        {
          kind: 'polygon',
          pageIndex: 0,
          color: [0, 0.5, 0],
          width: 2,
          vertices: [
            [100, 400],
            [200, 400],
            [150, 480],
          ],
        },
      ],
      formValues: [],
      stamps: [],
    }
    let out: Uint8Array
    try {
      // the frame has no Node Buffer: run the core on the shim, as the browser does
      globalThis.Buffer = BufferShim as unknown as typeof Buffer
      const result = await save.applyAndVerifySaveRequest((await onePage()).slice(), request)
      out = result.bytes
    } finally {
      globalThis.Buffer = realBuffer
    }
    const text = new TextDecoder('latin1').decode(out)
    expect(text).toMatch(/\/Subtype\s*\/Squiggly/)
    expect(text).toMatch(/\/Subtype\s*\/Caret/)
    expect(text).toMatch(/\/Subtype\s*\/Polygon/)
    // the file still loads and keeps its page
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1)
  })
})
