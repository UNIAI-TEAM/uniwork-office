// UNI-1232 F-1: Insert text on the web asks canDrawText, which resolves the bundled Liberation
// faces through the web seams. The faces must be real sfnt TTFs: a WOFF2 twin has no readable
// cmap, so every text was refused ("No installed font can draw this text").
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const repo = resolve(__dirname, '../../..')
const TTF_DIR = join(repo, 'apps/docs/src/renderer/fonts')
const WOFF2_DIR = join(repo, 'web/docs/fonts')

async function canDraw(
  dir: string,
  ext: string,
  text: string,
  font?: string,
): Promise<{ ok: boolean; listed: string[] }> {
  vi.resetModules()
  const coreEnv = await import('../../../apps/pdf/src/main/core-env')
  const { createWebPdfEnv, WEB_FONT_FACES } = await import('./core-env-web')
  const files = new Map(
    WEB_FONT_FACES.map((f) => [`/fonts/${f.file}`, f.file.replace('.ttf', ext)]),
  )
  const web = createWebPdfEnv({
    pdfiumWasmUrl: '/pdfium.wasm',
    hbSubsetWasmUrl: '/hb-subset.wasm',
    fontUrls: Object.fromEntries(WEB_FONT_FACES.map((f) => [f.file, `/fonts/${f.file}`])),
    fetchBytes: async (url) => {
      const b = await readFile(join(dir, files.get(url)!))
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
    },
    // the core's real cmap reader, as installWebPdfEnv wires it
    covers: (await import('../../../apps/pdf/src/main/font-cmap')).fontCoversText,
  })
  await web.ensureFonts()
  coreEnv.resetPdfCoreEnv()
  coreEnv.setPdfCoreEnv(web.env)
  const edit = await import('../../../apps/pdf/src/main/text-edit')
  return { ok: edit.canDrawText(text, font), listed: edit.listEditFonts() }
}

describe('web PDF fonts: canDrawText', () => {
  it('draws plain Latin and Vietnamese text from the bundled TTF faces', async () => {
    for (const text of ['Hello', 'Xin chào', 'Tiếng Việt: ặ ữ ỳ Đ']) {
      for (const font of [undefined, 'arial', 'times', 'courier']) {
        const r = await canDraw(TTF_DIR, '.ttf', text, font)
        expect(r.ok, `${text} / ${font}`).toBe(true)
      }
    }
    expect((await canDraw(TTF_DIR, '.ttf', 'Hello', 'arial')).listed).toEqual([
      'arial',
      'times',
      'courier',
    ])
  })

  it('cannot draw from WOFF2 twins (what the web build shipped before the fix)', async () => {
    const r = await canDraw(WOFF2_DIR, '.woff2', 'Hello', 'arial')
    expect(r.ok).toBe(false)
  })
})
