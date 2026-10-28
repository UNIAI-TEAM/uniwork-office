// @vitest-environment jsdom
// An edited bookmark tree rides the ordinary SavePdfRequest into the web frame's save core
// (applyAndVerifySaveRequest on the web seams, the frame's Buffer shim): the written /Outlines graph
// must round-trip, a request without `outline` must leave the file's own bookmarks alone, and an
// empty tree is a deliberate "no bookmarks". save-core.golden.test.ts keeps pinning the bytes of the
// requests that carry no outline.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber } from 'pdf-lib'
import type { SavePdfRequest } from '../../../apps/pdf/src/shared/ipc'
import { BufferShim } from './buffer-shim'

const repo = resolve(__dirname, '../../..')
const req = createRequire(join(repo, 'apps/pdf/package.json'))
const PDFIUM = req.resolve('@embedpdf/pdfium/pdfium.wasm')
const HB = join(dirname(req.resolve('harfbuzzjs/package.json')), 'hb-subset.wasm')
const FONT_DIR = join(repo, 'apps/docs/src/renderer/fonts')

const base = (over: Partial<SavePdfRequest>): SavePdfRequest => ({
  path: 'uniwork://files/f1/outline.pdf',
  markups: [],
  drawings: [],
  formValues: [],
  stamps: [],
  ...over,
})

async function sourcePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let n = 0; n < 3; n++) doc.addPage([612, 792])
  return doc.save({ useObjectStreams: false })
}

/** the save core on the web seams, as the browser runs it */
async function runWeb(bytes: Uint8Array, request: SavePdfRequest): Promise<Uint8Array> {
  const realBuffer = globalThis.Buffer
  globalThis.Buffer = BufferShim as unknown as typeof Buffer
  try {
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
    return (await save.applyAndVerifySaveRequest(bytes.slice(), request)).bytes
  } finally {
    globalThis.Buffer = realBuffer
  }
}

interface FlatItem {
  title: string
  page: number
  depth: number
}

/** the /Outlines graph as written: title, 0-based page index and depth of every item in reading order */
async function readOutline(bytes: Uint8Array): Promise<FlatItem[] | null> {
  const doc = await PDFDocument.load(bytes)
  const root = doc.catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict)
  if (!root) return null
  const pages = doc.getPages().map((p) => p.ref)
  const out: FlatItem[] = []
  const walk = (parent: PDFDict, depth: number): void => {
    let ref = parent.get(PDFName.of('First'))
    while (ref) {
      const item = doc.context.lookup(ref, PDFDict)
      const title = (item.lookup(PDFName.of('Title')) as PDFHexString).decodeText()
      const dest = item.lookup(PDFName.of('Dest'), PDFArray)
      out.push({ title, page: pages.findIndex((r) => r === dest.get(0)), depth })
      if (item.get(PDFName.of('First'))) walk(item, depth + 1)
      ref = item.get(PDFName.of('Next'))
    }
  }
  walk(root, 0)
  return out
}

afterAll(() => {
  vi.useRealTimers()
})

describe('web save core: editable bookmarks', () => {
  it('writes the edited tree: titles, nesting and page targets round-trip', async () => {
    const out = await runWeb(
      await sourcePdf(),
      base({
        outline: [
          { title: 'Intro', pageIndex: 0 },
          {
            title: 'Part two',
            pageIndex: 1,
            top: 700,
            children: [{ title: 'Detail', pageIndex: 2 }],
          },
        ],
      }),
    )
    expect(await readOutline(out)).toEqual([
      { title: 'Intro', page: 0, depth: 0 },
      { title: 'Part two', page: 1, depth: 0 },
      { title: 'Detail', page: 2, depth: 1 },
    ])
    const doc = await PDFDocument.load(out)
    const root = doc.catalog.lookup(PDFName.of('Outlines'), PDFDict)
    // /Count is the visible-descendant tally of the root: three items in all
    expect(root.lookup(PDFName.of('Count'), PDFNumber).asNumber()).toBe(3)
  })

  it('a bookmark follows its page through a reorder in the same save', async () => {
    const out = await runWeb(
      await sourcePdf(),
      base({
        pageOrder: [2, 1, 0],
        outline: [{ title: 'First page', pageIndex: 0 }],
      }),
    )
    // the /Dest is a page reference, so it names the original first page, now last
    expect(await readOutline(out)).toEqual([{ title: 'First page', page: 2, depth: 0 }])
  })

  it('a request without `outline` writes no outline; an empty tree writes an empty root', async () => {
    const source = await sourcePdf()
    expect(await readOutline(await runWeb(source, base({})))).toBeNull()
    expect(await readOutline(await runWeb(source, base({ outline: [] })))).toEqual([])
  })

  it('refuses a bookmark past the last page: the save fails, nothing is written', async () => {
    await expect(
      runWeb(await sourcePdf(), base({ outline: [{ title: 'Gone', pageIndex: 9 }] })),
    ).rejects.toThrow(/points at page 9/)
  })
})
