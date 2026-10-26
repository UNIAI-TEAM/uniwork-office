/**
 * The one place that decides which local OCR engines a process has: the
 * bundled Tesseract `vie` engine first, the platform system engine (macOS
 * Vision / Windows.Media.Ocr) behind it under the hand-over gate in
 * ocr-chain.ts. Shared by the PDF viewer's OCR layer and the shell's
 * scanned-page pdf2docx path so the two never drift.
 *
 * Packaged layout (electron-builder extraResources, apps/shell):
 *   Resources/ocr/tesseract/{tess-ocr.cjs, tessdata/, node_modules/}
 *   Resources/ocr/{vision-ocr | win-ocr.exe}
 * Dev layout (repo): packages/pdf2docx/ocr-tesseract/ and ocr-helper/, with
 * tesseract.js resolved from the repo's node_modules.
 *
 * Node-only like ocr-vision.ts; not exported from src/index.ts.
 */
import { join } from 'node:path'
import type { OcrEngine } from './ocr'
import { chainOcrEngines } from './ocr-chain'
import { createTesseractOcrEngine } from './ocr-tesseract'
import { createVisionOcrEngine, createWindowsOcrEngine } from './ocr-vision'

export interface LocalOcrOptions {
  /** `process.resourcesPath` of a packaged app (undefined: dev / tests) */
  resourcesPath?: string
  /** this repo's packages/pdf2docx directory (the dev fallback location) */
  devPackageDir?: string
  /** Node-compatible binary for the Tesseract helper; default process.execPath */
  nodePath?: string
}

/**
 * Resolve the local OCR engine chain, or null when this build has no engine
 * at all (callers keep today's behavior: scanned pages stay bitmaps).
 */
export function resolveLocalOcrEngine(options: LocalOcrOptions): OcrEngine | null {
  const nodePath = options.nodePath ?? process.execPath
  const layouts = [
    ...(options.resourcesPath
      ? [
          {
            tesseractDir: join(options.resourcesPath, 'ocr', 'tesseract'),
            systemDir: join(options.resourcesPath, 'ocr'),
          },
        ]
      : []),
    ...(options.devPackageDir
      ? [
          {
            tesseractDir: join(options.devPackageDir, 'ocr-tesseract'),
            systemDir: join(options.devPackageDir, 'ocr-helper'),
          },
        ]
      : []),
  ]
  let tesseract: OcrEngine | null = null
  let system: OcrEngine | null = null
  for (const l of layouts) {
    tesseract ??= createTesseractOcrEngine({
      nodePath,
      helperScript: join(l.tesseractDir, 'tess-ocr.cjs'),
      tessdataDir: join(l.tesseractDir, 'tessdata'),
    })
    if (process.platform === 'darwin')
      system ??= createVisionOcrEngine(join(l.systemDir, 'vision-ocr'))
    else if (process.platform === 'win32')
      system ??= createWindowsOcrEngine(join(l.systemDir, 'win-ocr.exe'))
  }
  return tesseract ? chainOcrEngines(tesseract, system) : system
}
