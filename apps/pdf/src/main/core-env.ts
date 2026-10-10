/**
 * Platform seams of the PDF save core (GO-B4 / UNI-1014).
 *
 * The save pipeline (save-pdf.ts applySaveRequest, annot-delete.ts, text-edit.ts, image-edit.ts,
 * font-subset.ts) is bytes in / bytes out. The only things it needs from the platform are listed
 * here: the pdfium and hb-subset wasm binaries, font files, and an image codec. This module imports
 * nothing platform specific, so the same core runs in the Electron main process (node-env.ts +
 * electron-image.ts, installed by pdf-main.ts) and in the web frame (web/modules/pdf/core-env-web.ts).
 *
 * Every consumer reads the environment at call time through `pdfCoreEnv()`; a missing install is a
 * programming error and throws with the name of the missing seam.
 */

/** A font file: Node Buffer on desktop, the Buffer shim of the web frame on the web */
export type FontBytes = Buffer

export interface PdfImageCodec {
  /** Decode a base64 PNG/JPEG into straight-alpha BGRA */
  decode(b64: string): Promise<{ width: number; height: number; bgra: Uint8Array }>
  /** Encode tightly packed BGRA pixels as a base64 PNG */
  encodePng(bgra: Uint8Array, width: number, height: number): Promise<string>
}

export interface PdfCoreEnv {
  /** pdfium.wasm (@embedpdf/pdfium) bytes */
  pdfiumWasm(): Promise<ArrayBuffer>
  /** hb-subset.wasm (harfbuzzjs) bytes */
  hbSubsetWasm(): Promise<ArrayBuffer>
  /**
   * A font file by path, null when it does not exist. Synchronous: the font checks run inside
   * synchronous code paths. The web frame answers from fonts it fetched beforehand (by file name).
   */
  readFontFile(path: string): FontBytes | null
  /** An installed font by PostScript name / family (desktop font index); null when unknown */
  findSystemFont(psName: string, family: string): FontBytes | null
  /** Any installed font whose cmap covers `text`; null when none does */
  findFontCovering(text: string): FontBytes | null
  /** PNG/JPEG decode and PNG encode (Electron nativeImage on desktop, canvas on the web) */
  image?: PdfImageCodec
}

let current: Partial<PdfCoreEnv> = {}

/** Install (or extend) the platform seams; later calls override the given members only */
export function setPdfCoreEnv(env: Partial<PdfCoreEnv>): void {
  current = { ...current, ...env }
}

/** test hook */
export function resetPdfCoreEnv(): void {
  current = {}
}

function missing(name: string): never {
  throw new Error(`pdf core: no platform seam "${name}" installed (setPdfCoreEnv)`)
}

/** The installed seams; a member nobody installed throws when it is used */
export function pdfCoreEnv(): PdfCoreEnv {
  const env = current
  return {
    pdfiumWasm: () => (env.pdfiumWasm ?? missing('pdfiumWasm'))(),
    hbSubsetWasm: () => (env.hbSubsetWasm ?? missing('hbSubsetWasm'))(),
    readFontFile: (path) => (env.readFontFile ?? missing('readFontFile'))(path),
    findSystemFont: (ps, family) => (env.findSystemFont ?? missing('findSystemFont'))(ps, family),
    findFontCovering: (text) => (env.findFontCovering ?? missing('findFontCovering'))(text),
    image: env.image,
  }
}

export function pdfImageCodec(): PdfImageCodec {
  return current.image ?? missing('image')
}

/** sfnt magic check (same as @genoffice/font-metrics isTruetype, without its fs import) */
const OTTO_TAG = 0x4f54544f
export const isTruetype = (b: FontBytes): boolean => b.length >= 4 && b.readUInt32BE(0) !== OTTO_TAG
