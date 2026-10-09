// @vitest-environment jsdom
// GO-B4 P-2 golden test: the save core produces the SAME BYTES with the desktop seams
// (apps/pdf/src/main/node-env.ts: fs reads of pdfium.wasm / fonts) and with the web frame's
// seams (./core-env-web.ts: fetched assets, the frame's Buffer shim as the global Buffer).
// The request covers every stage of applySaveRequest except text edits/inserts (their font
// choice legitimately differs: OS fonts on the desktop, bundled Liberation on the web) and
// image insert/replace (decoded by Electron nativeImage vs canvas, neither exists in Node):
// pdfium annotation delete + image transform, markups, ink / shapes / notes + replies, note
// edits, form values, stamps, rotations, deletion, reorder, metadata.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber } from 'pdf-lib'
import type { SavePdfRequest } from '../../../apps/pdf/src/shared/ipc'
import { BufferShim } from './buffer-shim'

const repo = resolve(__dirname, '../../..')
const req = createRequire(join(repo, 'apps/pdf/package.json'))
const PDFIUM = req.resolve('@embedpdf/pdfium/pdfium.wasm')
const HB = join(dirname(req.resolve('harfbuzzjs/package.json')), 'hb-subset.wasm')
const FONT_DIR = join(repo, 'apps/docs/src/renderer/fonts')

/** 2x2 opaque PNG */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8DwnwEJMDKgAjQBAOFpBf1hkWQ5AAAAAElFTkSuQmCC'

const base = (over: Partial<SavePdfRequest>): SavePdfRequest => ({
  path: 'uniwork://files/f1/golden.pdf',
  markups: [],
  drawings: [],
  formValues: [],
  stamps: [],
  ...over,
})

/** three pages; page 1 has an image, a text field and a checkbox; a saved highlight + note */
async function sourcePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont('Helvetica')
  const png = await doc.embedPng(PNG)
  for (const n of [1, 2, 3]) {
    const page = doc.addPage([612, 792])
    page.drawText(`Golden page ${n}`, { x: 72, y: 700, size: 18, font })
    if (n === 1) page.drawImage(png, { x: 300, y: 400, width: 100, height: 100 })
  }
  const form = doc.getForm()
  form.createTextField('name').addToPage(doc.getPage(0), { x: 72, y: 600, width: 200, height: 20 })
  form.createCheckBox('agree').addToPage(doc.getPage(0), { x: 72, y: 560, width: 14, height: 14 })
  doc.setTitle('Golden source')
  return doc.save({ useObjectStreams: false })
}

type CoreEnvModule = typeof import('../../../apps/pdf/src/main/core-env')

/** a fresh module graph per run, so pdfium / hb are loaded through the given seams */
async function runCore(
  install: (coreEnv: CoreEnvModule) => Promise<void>,
  bytes: Uint8Array,
  request: SavePdfRequest,
): Promise<Uint8Array> {
  return (await runCoreFull(install, bytes, request)).bytes
}

async function runCoreFull(
  install: (coreEnv: CoreEnvModule) => Promise<void>,
  bytes: Uint8Array,
  request: SavePdfRequest,
) {
  vi.resetModules()
  const coreEnv = await import('../../../apps/pdf/src/main/core-env')
  await install(coreEnv)
  const save = await import('../../../apps/pdf/src/main/save-pdf')
  return save.applyAndVerifySaveRequest(bytes.slice(), request)
}

const desktop = async (coreEnv: CoreEnvModule) => {
  const { nodePdfEnv } = await import('../../../apps/pdf/src/main/node-env')
  coreEnv.resetPdfCoreEnv()
  coreEnv.setPdfCoreEnv(nodePdfEnv)
}

const fetched: string[] = []
const web = async (coreEnv: CoreEnvModule) => {
  const { createWebPdfEnv, WEB_FONT_FACES } = await import('./core-env-web')
  const urls: Record<string, string> = { '/pdfium.wasm': PDFIUM, '/hb-subset.wasm': HB }
  for (const f of WEB_FONT_FACES) urls[`/fonts/${f.file}`] = join(FONT_DIR, f.file)
  const env = createWebPdfEnv({
    pdfiumWasmUrl: '/pdfium.wasm',
    hbSubsetWasmUrl: '/hb-subset.wasm',
    fontUrls: Object.fromEntries(WEB_FONT_FACES.map((f) => [f.file, `/fonts/${f.file}`])),
    fetchBytes: async (url) => {
      fetched.push(url)
      const b = await readFile(urls[url]!)
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
    },
    covers: () => false,
  })
  await env.ensureFonts()
  coreEnv.resetPdfCoreEnv()
  coreEnv.setPdfCoreEnv(env.env)
}

const realBuffer = globalThis.Buffer
let source: Uint8Array
let request: SavePdfRequest

beforeAll(async () => {
  // a saved highlight + note to delete / reply to / edit (written by the desktop seams)
  const first = await runCore(
    desktop,
    await sourcePdf(),
    base({
      markups: [
        {
          pageIndex: 0,
          type: 'highlight',
          color: [1, 0.9, 0.3],
          quads: [[72, 718, 260, 718, 72, 698, 260, 698]],
        },
      ],
      drawings: [
        {
          kind: 'note',
          pageIndex: 1,
          color: [1, 0.8, 0],
          at: [500, 700],
          contents: 'root note',
          author: 'A',
          createdMs: 1_700_000_000_000,
        },
      ],
    }),
  )
  source = first
  const doc = await PDFDocument.load(source)
  const annots = (page: number) => doc.getPage(page).node.lookup(PDFName.of('Annots'), PDFArray)
  const refOf = (page: number, i: number) =>
    (annots(page).get(i) as unknown as { objectNumber: number }).objectNumber
  const rectOf = (page: number, i: number) => {
    const r = annots(page).lookup(i, PDFDict).lookup(PDFName.of('Rect'), PDFArray)
    return [0, 1, 2, 3].map((j) => r.lookup(j, PDFNumber).asNumber()) as [
      number,
      number,
      number,
      number,
    ]
  }
  const hl = annots(0).size() - 1
  request = base({
    annotDeletes: [
      { pageIndex: 0, objNum: refOf(0, hl), subtype: 'highlight', rect: rectOf(0, hl) },
    ],
    imageEdits: [
      {
        kind: 'transformImage',
        pageIndex: 0,
        oldRect: [300, 400, 400, 500],
        rect: [320, 380, 440, 500],
        quarterTurns: 1,
      },
    ],
    markups: [
      {
        pageIndex: 1,
        type: 'underline',
        color: [0.2, 0.4, 1],
        quads: [[72, 718, 260, 718, 72, 698, 260, 698]],
      },
      {
        pageIndex: 2,
        type: 'strikeout',
        color: [1, 0, 0],
        quads: [[72, 718, 260, 718, 72, 698, 260, 698]],
      },
    ],
    drawings: [
      {
        kind: 'ink',
        pageIndex: 0,
        color: [0, 0, 1],
        width: 2,
        paths: [[100, 100, 150, 160, 200, 120]],
      },
      { kind: 'rect', pageIndex: 1, color: [1, 0, 0], width: 1, rect: [100, 100, 200, 150] },
      { kind: 'ellipse', pageIndex: 1, color: [0, 1, 0], width: 1, rect: [220, 100, 320, 150] },
      { kind: 'arrow', pageIndex: 2, color: [0, 0, 0], width: 3, from: [100, 300], to: [300, 320] },
      { kind: 'image', pageIndex: 2, image: PNG, rect: [400, 100, 480, 140] },
      {
        kind: 'note',
        pageIndex: 1,
        color: [1, 0.8, 0],
        at: [500, 700],
        contents: 'a reply',
        author: 'Test User',
        createdMs: 1_700_000_100_000,
        replyToSaved: { objNum: refOf(1, 0), rect: rectOf(1, 0), contents: 'root note' },
      },
    ],
    noteEdits: [
      {
        pageIndex: 1,
        objNum: refOf(1, 0),
        rect: rectOf(1, 0),
        oldContents: 'root note',
        contents: 'edited root',
      },
    ],
    formValues: [
      { name: 'name', kind: 'text', value: 'Nguyễn Văn A' },
      { name: 'agree', kind: 'checkbox', checked: true },
    ],
    stamps: [{ pageIndex: 0, image: PNG, rect: [500, 20, 590, 50], opacity: 0.5 }],
    rotations: [{ pageIndex: 1, delta: 90 }],
    deletedPages: [2],
    pageOrder: [1, 0],
    metadata: { title: 'Golden out', author: 'Test User', subject: '', keywords: 'web' },
  })
})

afterAll(() => {
  globalThis.Buffer = realBuffer
  vi.useRealTimers()
})

describe('save core: desktop seams vs web seams', () => {
  it('same input + request -> identical bytes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-09T03:00:00Z'))
    const desk = await runCoreFull(desktop, source, request)
    // every pdfium stage applied (nothing skipped), so the comparison covers them
    expect(desk.skippedImageEdits).toEqual([])
    const a = desk.bytes
    let b: Uint8Array
    try {
      // the frame has no Node Buffer: run the core on the shim, as the browser does
      globalThis.Buffer = BufferShim as unknown as typeof Buffer
      b = await runCore(web, source, request)
    } finally {
      globalThis.Buffer = realBuffer
    }
    expect(fetched).toContain('/pdfium.wasm')
    expect(b.byteLength).toBe(a.byteLength)
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0)

    // and the request really landed: 2 pages in the new order, annots, form, metadata
    const out = await PDFDocument.load(a)
    expect(out.getPageCount()).toBe(2)
    expect(out.getTitle()).toBe('Golden out')
    expect(new TextDecoder('latin1').decode(a)).toMatch(/\/Annots/)
    expect(out.getForm().getTextField('name').getText()).toBe('Nguyễn Văn A')
    // the saved highlight was deleted by the pdfium stage
    expect(new TextDecoder('latin1').decode(a)).not.toMatch(/\/Subtype\s*\/Highlight/)
  })
})
