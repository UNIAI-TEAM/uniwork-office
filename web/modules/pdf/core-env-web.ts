/**
 * Web seams of the PDF save core (apps/pdf/src/main/core-env.ts), GO-B4 / UNI-1014.
 *
 * | seam            | desktop (node-env.ts / electron-image.ts) | web frame (here)                                      |
 * |-----------------|-------------------------------------------|-------------------------------------------------------|
 * | pdfiumWasm      | fs read of @embedpdf/pdfium/pdfium.wasm   | same-origin asset fetch (needs 'wasm-unsafe-eval')    |
 * | hbSubsetWasm    | fs read of harfbuzzjs hb-subset.wasm      | same-origin asset fetch                               |
 * | readFontFile    | fs read of an absolute OS font path       | bundled Liberation TTFs, matched by file name         |
 * | findSystemFont  | installed-font index                      | Liberation family/PostScript names only, else null    |
 * | findFontCovering| installed-font index scan                 | first bundled face whose cmap covers the text         |
 * | image           | Electron nativeImage                      | createImageBitmap + OffscreenCanvas / canvas          |
 *
 * The font seams are synchronous (the core checks fonts inside synchronous code), so the frame
 * fetches the bundled fonts first: `ensureWebFonts()` runs before every core call that may touch a
 * font (text edit, insert, validation, the font list). Fonts are document data that pdf-lib /
 * pdfium embed into the file, so they stay TTF (WOFF2 cannot be embedded); they are fetched on
 * first text-edit use only.
 */
import {
  setPdfCoreEnv,
  type FontBytes,
  type PdfCoreEnv,
  type PdfImageCodec,
} from '../../../apps/pdf/src/main/core-env'
import { installBufferShim } from './buffer-shim'

/** bundled font file name -> PostScript name / family (EDIT_FONT_PATHS use the same file names) */
export const WEB_FONT_FACES: ReadonlyArray<{ file: string; ps: string; family: string }> = [
  { file: 'LiberationSans-Regular.ttf', ps: 'LiberationSans', family: 'Liberation Sans' },
  { file: 'LiberationSans-Bold.ttf', ps: 'LiberationSans-Bold', family: 'Liberation Sans' },
  { file: 'LiberationSans-Italic.ttf', ps: 'LiberationSans-Italic', family: 'Liberation Sans' },
  {
    file: 'LiberationSans-BoldItalic.ttf',
    ps: 'LiberationSans-BoldItalic',
    family: 'Liberation Sans',
  },
  { file: 'LiberationSerif-Regular.ttf', ps: 'LiberationSerif', family: 'Liberation Serif' },
  { file: 'LiberationSerif-Bold.ttf', ps: 'LiberationSerif-Bold', family: 'Liberation Serif' },
  { file: 'LiberationSerif-Italic.ttf', ps: 'LiberationSerif-Italic', family: 'Liberation Serif' },
  {
    file: 'LiberationSerif-BoldItalic.ttf',
    ps: 'LiberationSerif-BoldItalic',
    family: 'Liberation Serif',
  },
  { file: 'LiberationMono-Regular.ttf', ps: 'LiberationMono', family: 'Liberation Mono' },
  { file: 'LiberationMono-Bold.ttf', ps: 'LiberationMono-Bold', family: 'Liberation Mono' },
  { file: 'LiberationMono-Italic.ttf', ps: 'LiberationMono-Italic', family: 'Liberation Mono' },
  {
    file: 'LiberationMono-BoldItalic.ttf',
    ps: 'LiberationMono-BoldItalic',
    family: 'Liberation Mono',
  },
]

/** metric-compatible stand-ins: a PDF font named Arial/Helvetica/Times/Courier resolves to Liberation */
const FAMILY_ALIASES: Record<string, string> = {
  arial: 'Liberation Sans',
  arialmt: 'Liberation Sans',
  helvetica: 'Liberation Sans',
  'liberation sans': 'Liberation Sans',
  'times new roman': 'Liberation Serif',
  timesnewromanpsmt: 'Liberation Serif',
  times: 'Liberation Serif',
  'liberation serif': 'Liberation Serif',
  'courier new': 'Liberation Mono',
  couriernewpsmt: 'Liberation Mono',
  courier: 'Liberation Mono',
  'liberation mono': 'Liberation Mono',
}

export interface WebEnvOptions {
  /** url of pdfium.wasm / hb-subset.wasm (same-origin build assets) */
  pdfiumWasmUrl: string
  hbSubsetWasmUrl: string
  /** font file name -> url (same-origin build assets) */
  fontUrls: Readonly<Record<string, string>>
  /** test seam: how bytes are fetched (default: fetch, same origin, no cookies needed) */
  fetchBytes?: (url: string) => Promise<ArrayBuffer>
  /** test seam: image codec (default: canvas codec) */
  image?: PdfImageCodec
  /** test seam: does a font cover a text (default: the core's cmap reader) */
  covers?: (font: FontBytes, text: string) => boolean
}

async function defaultFetchBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`)
  return res.arrayBuffer()
}

// ---------------------------------------------------------------- image codec

function bgraToRgba(px: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(px.length))
  for (let i = 0; i < px.length; i += 4) {
    out[i] = px[i + 2]!
    out[i + 1] = px[i + 1]!
    out[i + 2] = px[i]!
    out[i + 3] = px[i + 3]!
  }
  return out
}

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

/** PNG/JPEG <-> BGRA through the browser's decoders (createImageBitmap + 2D canvas) */
export const canvasImageCodec: PdfImageCodec = {
  async decode(b64) {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    let bitmap: ImageBitmap
    try {
      // straight alpha, like the desktop's un-premultiplied nativeImage bitmap
      bitmap = await createImageBitmap(new Blob([bytes]), { premultiplyAlpha: 'none' })
    } catch {
      throw new Error('could not decode the image data')
    }
    const { width, height } = bitmap
    const canvas = makeCanvas(width, height)
    const ctx = canvas.getContext('2d') as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const rgba = ctx.getImageData(0, 0, width, height).data
    const bgra = new Uint8Array(rgba.length)
    for (let i = 0; i < rgba.length; i += 4) {
      bgra[i] = rgba[i + 2]!
      bgra[i + 1] = rgba[i + 1]!
      bgra[i + 2] = rgba[i]!
      bgra[i + 3] = rgba[i + 3]!
    }
    return { width, height, bgra }
  },
  async encodePng(bgra, width, height) {
    const canvas = makeCanvas(width, height)
    const ctx = canvas.getContext('2d') as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
    ctx.putImageData(new ImageData(bgraToRgba(bgra), width, height), 0, 0)
    const blob =
      'convertToBlob' in canvas
        ? await canvas.convertToBlob({ type: 'image/png' })
        : await new Promise<Blob>((resolve, reject) =>
            (canvas as HTMLCanvasElement).toBlob(
              (b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))),
              'image/png',
            ),
          )
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    }
    return btoa(bin)
  },
}

// ---------------------------------------------------------------- env

export interface WebPdfEnv {
  /** the seams handed to setPdfCoreEnv */
  env: PdfCoreEnv
  /** fetch the bundled fonts (once); the font seams answer null until this resolved */
  ensureFonts(): Promise<void>
  /** fetch + compile check of pdfium (once); rejects when wasm is blocked or the asset is missing */
  ensurePdfium(): Promise<void>
}

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p

export function createWebPdfEnv(opts: WebEnvOptions): WebPdfEnv {
  const fetchBytes = opts.fetchBytes ?? defaultFetchBytes
  const fonts = new Map<string, FontBytes>()
  let fontsReady: Promise<void> | null = null
  let pdfiumBytes: Promise<ArrayBuffer> | null = null

  const pdfiumWasm = (): Promise<ArrayBuffer> => {
    // keep the bytes once fetched; a failed fetch may be retried
    pdfiumBytes ??= fetchBytes(opts.pdfiumWasmUrl).catch((err: unknown) => {
      pdfiumBytes = null
      throw err
    })
    return pdfiumBytes.then((b) => b.slice(0))
  }

  const faceBytes = (file: string): FontBytes | null => fonts.get(file) ?? null

  const covers = (font: FontBytes, text: string): boolean => {
    if (opts.covers) return opts.covers(font, text)
    return coversText(font, text)
  }

  const env: PdfCoreEnv = {
    pdfiumWasm,
    hbSubsetWasm: () => fetchBytes(opts.hbSubsetWasmUrl),
    readFontFile: (path) => faceBytes(basename(path)),
    findSystemFont(psName, family) {
      const ps = psName.toLowerCase()
      const byPs = WEB_FONT_FACES.find((f) => f.ps.toLowerCase() === ps)
      if (byPs) return faceBytes(byPs.file)
      const fam = FAMILY_ALIASES[family.toLowerCase()] ?? FAMILY_ALIASES[ps.split('-')[0] ?? '']
      if (!fam) return null
      // the style suffix of the PostScript name picks the face, as the desktop index does
      const style = /bold.*italic|bolditalic|boldoblique/i.test(psName)
        ? 'BoldItalic'
        : /bold/i.test(psName)
          ? 'Bold'
          : /italic|oblique/i.test(psName)
            ? 'Italic'
            : 'Regular'
      const face = WEB_FONT_FACES.find((f) => f.family === fam && f.file.endsWith(`-${style}.ttf`))
      return face ? faceBytes(face.file) : null
    },
    findFontCovering(text) {
      for (const f of WEB_FONT_FACES) {
        const bytes = faceBytes(f.file)
        if (bytes && covers(bytes, text)) return bytes
      }
      return null
    },
    image: opts.image ?? canvasImageCodec,
  }

  return {
    env,
    ensureFonts() {
      fontsReady ??= Promise.all(
        Object.entries(opts.fontUrls).map(async ([file, url]) => {
          fonts.set(file, Buffer.from(await fetchBytes(url)))
        }),
      ).then(
        () => undefined,
        (err: unknown) => {
          fontsReady = null
          throw err
        },
      )
      return fontsReady
    },
    async ensurePdfium() {
      const bytes = await pdfiumWasm()
      // compile only: proves the bytes are wasm and the CSP allows compiling it
      await WebAssembly.compile(bytes)
    },
  }
}

/** cmap coverage of the core (font-cmap.ts), loaded with the core */
let coversText: (font: FontBytes, text: string) => boolean = () => false

/** Install the Buffer shim + the web seams; returns the env for the bridge */
export async function installWebPdfEnv(opts: WebEnvOptions): Promise<WebPdfEnv> {
  installBufferShim()
  const web = createWebPdfEnv(opts)
  setPdfCoreEnv(web.env)
  if (!opts.covers)
    coversText = (await import('../../../apps/pdf/src/main/font-cmap')).fontCoversText
  return web
}
