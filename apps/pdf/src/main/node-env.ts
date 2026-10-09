import { readFileSync } from 'node:fs'
import { findFontCovering, findSystemFont } from './font-locate'
import { setPdfCoreEnv, type PdfCoreEnv } from './core-env'
import { hbSubsetWasmPath, pdfiumWasmPath } from './wasm-path'

/** Exact bytes of a file: Buffer.buffer may be a shared pool larger than the file */
function fileArrayBuffer(path: string): ArrayBuffer {
  const raw = readFileSync(path)
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer
}

/**
 * Desktop (Node) seams of the save core: wasm from node_modules / Resources/wasm, fonts from
 * the OS (absolute paths and the installed-font index). The image codec is Electron's
 * (electron-image.ts), passed in by pdf-main.ts so this module stays usable in plain Node tests.
 */
export const nodePdfEnv: Omit<PdfCoreEnv, 'image'> = {
  pdfiumWasm: async () => fileArrayBuffer(pdfiumWasmPath()),
  hbSubsetWasm: async () => fileArrayBuffer(hbSubsetWasmPath()),
  readFontFile: (path) => {
    try {
      return readFileSync(path)
    } catch {
      return null
    }
  },
  findSystemFont,
  findFontCovering,
}

export function installNodePdfEnv(extra: Partial<PdfCoreEnv> = {}): void {
  setPdfCoreEnv({ ...nodePdfEnv, ...extra })
}
