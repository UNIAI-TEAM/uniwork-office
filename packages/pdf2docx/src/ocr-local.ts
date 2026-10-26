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
import { chainOcrEngines, chainOcrEnginesAsync, type AsyncOcrEngine } from './ocr-chain'
import { createTesseractOcrEngine, createTesseractOcrEngineAsync } from './ocr-tesseract'
import {
  createVisionOcrEngine,
  createVisionOcrEngineAsync,
  createWindowsOcrEngine,
  createWindowsOcrEngineAsync,
} from './ocr-vision'

export interface LocalOcrOptions {
  /** `process.resourcesPath` of a packaged app (undefined: dev / tests) */
  resourcesPath?: string
  /** this repo's packages/pdf2docx directory (the dev fallback location) */
  devPackageDir?: string
  /** Node-compatible binary for the Tesseract helper; default process.execPath */
  nodePath?: string
}

/** engine constructors of one flavor (sync or async): the layout walk is shared */
interface EngineFactories<E> {
  tesseract: (o: { nodePath: string; helperScript: string; tessdataDir: string }) => E | null
  vision: (helperPath: string) => E | null
  windows: (helperPath: string) => E | null
  chain: (primary: E, fallback: E | null) => E
}

function resolveWith<E>(options: LocalOcrOptions, make: EngineFactories<E>): E | null {
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
  let tesseract: E | null = null
  let system: E | null = null
  for (const l of layouts) {
    tesseract ??= make.tesseract({
      nodePath,
      helperScript: join(l.tesseractDir, 'tess-ocr.cjs'),
      tessdataDir: join(l.tesseractDir, 'tessdata'),
    })
    if (process.platform === 'darwin') system ??= make.vision(join(l.systemDir, 'vision-ocr'))
    else if (process.platform === 'win32') system ??= make.windows(join(l.systemDir, 'win-ocr.exe'))
  }
  return tesseract ? make.chain(tesseract, system) : system
}

/**
 * Resolve the local OCR engine chain, or null when this build has no engine
 * at all (callers keep today's behavior: scanned pages stay bitmaps).
 */
export function resolveLocalOcrEngine(options: LocalOcrOptions): OcrEngine | null {
  return resolveWith<OcrEngine>(options, {
    tesseract: createTesseractOcrEngine,
    vision: createVisionOcrEngine,
    windows: createWindowsOcrEngine,
    chain: chainOcrEngines,
  })
}

/**
 * The same chain on async engines, for callers that must not block the event
 * loop (the PDF viewer's OCR bridge). Same layouts, same gate.
 */
export function resolveLocalOcrEngineAsync(options: LocalOcrOptions): AsyncOcrEngine | null {
  return resolveWith<AsyncOcrEngine>(options, {
    tesseract: createTesseractOcrEngineAsync,
    vision: createVisionOcrEngineAsync,
    windows: createWindowsOcrEngineAsync,
    chain: chainOcrEnginesAsync,
  })
}
