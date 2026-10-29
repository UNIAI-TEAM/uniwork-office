import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { forgetConvertedDocument, registerConvertedDocument } from '@genoffice/electron-utils'
import {
  isOdfFormat,
  LegacyConvertError,
  legacyFormatForPath,
  preflightOdfBytes,
  readLegacyInput,
  suggestedOoxmlPathForLegacy,
  type ConvertLegacyResult,
  type LegacyConvertErrorCode,
  type LegacySourceFormat,
  type LegacyTargetFormat,
  LEGACY_TARGET_FOR_SOURCE as LEGACY_TARGET,
} from './legacy-converter'
import type { LegacyOpenStringKey } from './legacy-open-strings'
import type { CloudConvertOutcome, CloudLegacyConvertInput } from './uniwork-docs/legacy-cloud-open'
import type { OdfWorkerKind, OdfWorkerRequest, OdfWorkerResponse } from './odf-fallback-worker'

const FOLDING_FS = process.platform === 'win32' || process.platform === 'darwin'
const sameDir = (a: string, b: string): boolean =>
  FOLDING_FS ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)

/** the editor a converted document opens in */
export type ConvertedKind = 'docs' | 'sheets' | 'slides'

const KIND_FOR_TARGET: Readonly<Record<LegacyTargetFormat, ConvertedKind>> = {
  docx: 'docs',
  xlsx: 'sheets',
  pptx: 'slides',
}

/**
 * One legacy file that was converted and is open as an unsaved OOXML document.
 * `tempPath` is the tab's exact identity (never match a converted tab by file
 * name: a sibling `budget.xlsx` is a different document); the original is only
 * ever read.
 */
export interface ConvertedDocument {
  readonly kind: ConvertedKind
  readonly originalPath: string
  readonly tempPath: string
  readonly tempDir: string
  /** where the first Save asks to write: `<original name>.docx|.xlsx|.pptx` next to the original */
  readonly suggestSaveAs: string
}

export type OdfFallbackSourceFormat = 'odt' | 'ott' | 'odp' | 'otp'

export interface OdfDroppedItem {
  readonly what: string
  readonly count: number
}

export interface OdfFallbackCallOptions {
  readonly signal?: AbortSignal
}

export interface OdfFallbackEngine {
  convertOdtToDocx(
    bytes: Uint8Array,
    options?: OdfFallbackCallOptions,
  ): Promise<{
    docx: Uint8Array
    blocks: number
    dropped: OdfDroppedItem[]
  }>
  convertOdpToPptx(
    bytes: Uint8Array,
    options?: OdfFallbackCallOptions,
  ): Promise<{
    pptx: Uint8Array
    slides: number
    dropped: OdfDroppedItem[]
  }>
}

/**
 * Default deadline for one pure-JS ODF fallback worker job (60 s, matching the
 * bundled LibreOffice subprocess job timeout in `legacy-converter.ts`).
 */
export const DEFAULT_ODF_FALLBACK_TIMEOUT_MS = 60_000

/**
 * Old-generation heap limit for each ODF fallback worker (512 MiB).
 * Why 512 MiB: preflight caps declared ODF parts at 64 MiB, and valid rich
 * documents / presentations stay well below 512 MiB during DOM + JSZip
 * assembly, whereas hostile XML or span amplification that would otherwise
 * trigger a fatal process-wide V8 OOM in the Electron main process is confined
 * to the worker (`ERR_WORKER_OUT_OF_MEMORY`) so every open tab survives.
 */
export const DEFAULT_ODF_FALLBACK_HEAP_LIMIT_MB = 512

export interface OdfFallbackWorkerOptions {
  readonly workerPath?: string
  readonly timeoutMs?: number
  readonly maxOldGenerationSizeMb?: number
}

export function defaultOdfFallbackWorkerPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  const sibling = join(here, 'odf-fallback-worker.js')
  if (existsSync(sibling)) return sibling
  const built = resolve(here, '../../out/main/odf-fallback-worker.js')
  if (existsSync(built)) return built
  return sibling
}

/**
 * Create an `OdfFallbackEngine` that runs each conversion in a dedicated
 * `node:worker_threads` Worker with `resourceLimits`, a per-job timeout, and
 * immediate `worker.terminate()` on cancel/dispose.
 */
export function createWorkerOdfFallbackEngine(
  options: OdfFallbackWorkerOptions = {},
): OdfFallbackEngine {
  const workerPath = options.workerPath ?? defaultOdfFallbackWorkerPath()
  const timeoutMs = options.timeoutMs ?? DEFAULT_ODF_FALLBACK_TIMEOUT_MS
  const maxOldGenerationSizeMb =
    options.maxOldGenerationSizeMb ?? DEFAULT_ODF_FALLBACK_HEAP_LIMIT_MB

  function runJob(
    kind: OdfWorkerKind,
    bytes: Uint8Array,
    callOptions?: OdfFallbackCallOptions,
  ): Promise<Extract<OdfWorkerResponse, { ok: true }>> {
    const signal = callOptions?.signal
    if (signal?.aborted) {
      return Promise.reject(new LegacyConvertError('cancelled', 'cancelled'))
    }
    return new Promise((resolveJob, rejectJob) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | null = null
      let worker: Worker | null = null

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        if (signal) {
          signal.removeEventListener('abort', onAbort)
        }
      }

      const finishReject = (err: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        rejectJob(err)
      }

      const finishResolve = (res: Extract<OdfWorkerResponse, { ok: true }>) => {
        if (settled) return
        settled = true
        cleanup()
        resolveJob(res)
      }

      const onAbort = () => {
        if (settled) return
        const w = worker
        worker = null
        if (w) void w.terminate()
        finishReject(new LegacyConvertError('cancelled', 'cancelled'))
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true })
      }

      try {
        worker = new Worker(workerPath, {
          resourceLimits: { maxOldGenerationSizeMb },
        })
      } catch (err) {
        finishReject(
          new LegacyConvertError('failed', err instanceof Error ? err.message : String(err), {
            cause: err,
          }),
        )
        return
      }

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          const w = worker
          worker = null
          if (w) void w.terminate()
          finishReject(
            new LegacyConvertError(
              'timeout',
              `ODF fallback worker timed out after ${timeoutMs} ms`,
            ),
          )
        }, timeoutMs)
      }

      worker.on('message', (msg: OdfWorkerResponse) => {
        const w = worker
        worker = null
        if (w) void w.terminate()
        if (!msg || typeof msg !== 'object' || !('ok' in msg)) {
          finishReject(new LegacyConvertError('failed', 'Invalid ODF worker response'))
          return
        }
        if (msg.ok) {
          const copy =
            msg.bytes instanceof Uint8Array
              ? new Uint8Array(msg.bytes.buffer, msg.bytes.byteOffset, msg.bytes.byteLength)
              : new Uint8Array(msg.bytes)
          finishResolve({ ...msg, bytes: copy })
          return
        }
        const err = Object.assign(new Error(msg.message), {
          name: msg.name,
          ...(msg.code ? { code: msg.code } : {}),
        })
        finishReject(err)
      })

      worker.on('error', (err) => {
        const w = worker
        worker = null
        if (w) void w.terminate()
        finishReject(
          new LegacyConvertError('failed', err instanceof Error ? err.message : String(err), {
            cause: err,
          }),
        )
      })

      worker.on('exit', (exitCode) => {
        worker = null
        if (!settled) {
          finishReject(
            new LegacyConvertError(
              'failed',
              `ODF fallback worker exited before answering (code ${exitCode})`,
            ),
          )
        }
      })

      const req: OdfWorkerRequest = { kind, bytes }
      try {
        worker.postMessage(req)
      } catch (err) {
        const w = worker
        worker = null
        if (w) void w.terminate()
        finishReject(
          new LegacyConvertError('failed', err instanceof Error ? err.message : String(err), {
            cause: err,
          }),
        )
      }
    })
  }

  return {
    async convertOdtToDocx(bytes, callOptions) {
      const res = await runJob('odt', bytes, callOptions)
      return {
        docx: res.bytes,
        blocks: res.kind === 'odt' ? res.blocks : 0,
        dropped: res.dropped,
      }
    },
    async convertOdpToPptx(bytes, callOptions) {
      const res = await runJob('odp', bytes, callOptions)
      return {
        pptx: res.bytes,
        slides: res.kind === 'odp' ? res.slides : 0,
        dropped: res.dropped,
      }
    },
  }
}

export function isOdfFallbackFormat(source: LegacySourceFormat): source is OdfFallbackSourceFormat {
  return source === 'odt' || source === 'ott' || source === 'odp' || source === 'otp'
}

export interface LegacyOpenDeps {
  convert(
    path: string,
    options: { signal: AbortSignal; sourceFormat: LegacySourceFormat },
  ): Promise<ConvertLegacyResult>
  /** `<temp>/genoffice-imports`: the root the editors' own temp cleanup recognises */
  importRoot(): string
  /** open the converted file in its editor as an unsaved document */
  openConverted(doc: ConvertedDocument): void
  /** the tab already showing this converted file, activated; false when it is gone */
  activateConverted(doc: ConvertedDocument): boolean
  /** does any tab or window still show this path */
  isPathOpen(path: string): boolean
  /** the calamine route for an .xls when the converter is not installed; false = nothing opened */
  openXlsValuesOnly(path: string): boolean
  recordRecent(path: string): void
  /** the pure-JS odf2ooxml fallback for .odt/.ott/.odp/.otp when LibreOffice is missing */
  odfFallback?: OdfFallbackEngine
  /**
   * How long a sweep waits before it judges ownership (default 1000 ms). A tab that moves
   * between the strip and a detached window is owned by neither for a moment, and a sweep
   * in that gap would delete the live file.
   */
  sweepDelayMs?: number
  /** show the progress box; the returned function ends it */
  beginProgress(fileName: string, cancel: () => void): () => void
  /** a typed notice box */
  notice(message: string): void
  t(key: LegacyOpenStringKey, params?: Record<string, string | number>): string
}

const ERROR_COPY: Readonly<Partial<Record<LegacyConvertErrorCode, LegacyOpenStringKey>>> = {
  encrypted: 'legacyEncrypted',
  corrupt: 'legacyCorrupt',
  timeout: 'legacyTimeout',
  converter_missing: 'legacyMissing',
}

/** the progress-box detail line: OpenDocument files say "OpenDocument file", legacy binaries say "older Office file" */
export function legacyProgressDetailKey(fileName: string): LegacyOpenStringKey {
  const ext = extname(fileName).slice(1).toLowerCase()
  return isOdfFormat(ext) ? 'legacyOdfDetail' : 'legacyConvertingDetail'
}

/** the user-facing text of a conversion failure (unmapped codes read as a plain failure) */
export function legacyErrorMessage(
  err: LegacyConvertError,
  fileName: string,
  t: LegacyOpenDeps['t'],
): string {
  const key = ERROR_COPY[err.code] ?? 'legacyFailed'
  return t(key, { name: fileName, ext: extname(fileName) })
}
const ODF_DROPPED_LABEL_KEYS: Readonly<Record<string, LegacyOpenStringKey>> = {
  footnotes: 'legacyOdfDropFootnotes',
  comments: 'legacyOdfDropComments',
  'textboxes-flattened': 'legacyOdfDropTextboxesFlattened',
  shapes: 'legacyOdfDropShapes',
  images: 'legacyOdfDropImages',
  objects: 'legacyOdfDropObjects',
  tables: 'legacyOdfDropTables',
  'nested-tables': 'legacyOdfDropNestedTables',
  notes: 'legacyOdfDropNotes',
  'frames-without-geometry': 'legacyOdfDropFramesWithoutGeometry',
  'stale-indexes': 'legacyOdfDropStaleIndexes',
  'unhandled-blocks': 'legacyOdfDropUnhandledBlocks',
  'headers-footers': 'legacyOdfDropHeadersFooters',
  'tracked-changes': 'legacyOdfDropTrackedChanges',
}

/**
 * Format the post-open notice when an ODF document was converted by the pure-JS
 * fallback engine: lists every dropped construct with its count in the user's
 * language (unknown keys folded into the localized "other items" bucket, never
 * shown raw), or tells the user once that a simpler converter was used when
 * `dropped` is empty.
 */
const MAX_LISTED_DROPS = 6

export function formatOdfFallbackNotice(
  fileName: string,
  dropped: readonly OdfDroppedItem[],
  t: LegacyOpenDeps['t'],
): string {
  const parts: string[] = []
  let otherCount = 0
  for (const item of dropped) {
    if (!Number.isFinite(item.count) || item.count <= 0) continue
    const key = Object.hasOwn(ODF_DROPPED_LABEL_KEYS, item.what)
      ? ODF_DROPPED_LABEL_KEYS[item.what]
      : undefined
    if (key && parts.length < MAX_LISTED_DROPS) {
      parts.push(t(key, { count: item.count }))
    } else {
      otherCount += item.count
    }
  }
  if (otherCount > 0) {
    parts.push(t('legacyOdfDropOther', { count: otherCount }))
  }
  if (parts.length === 0) {
    return t('legacyOdfSimplified', { name: fileName })
  }
  const sep = t('legacyOdfListSep')
  return t('legacyOdfDropped', { name: fileName, items: parts.join(sep) })
}

function mapOdfFallbackError(err: unknown, source: OdfFallbackSourceFormat): LegacyConvertError {
  if (err instanceof LegacyConvertError) return err
  const code = typeof err === 'object' && err !== null && 'code' in err ? err.code : undefined
  if (code === 'unreadable' || code === 'not-a-text-document' || code === 'not-a-presentation') {
    return new LegacyConvertError('corrupt', code, { format: source, cause: err })
  }
  return new LegacyConvertError('failed', err instanceof Error ? err.message : String(err), {
    format: source,
    cause: err,
  })
}

/**
 * Open a local .doc / .xls / .ppt: convert it in the background (progress box
 * with Cancel), then open the OOXML result in docs / sheets / slides as an
 * unsaved document whose first Save is a Save As next to the original. The
 * legacy file itself is never written. One conversion per path at a time; a
 * path whose converted tab is still open just activates that tab.
 */
export function createLegacyOpener(deps: LegacyOpenDeps) {
  const inFlight = new Set<string>()
  const documents = new Map<string, ConvertedDocument>()
  /** the conversions this opener started: dispose aborts them */
  const controllers = new Set<AbortController>()
  let sweepTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const byOriginal = (originalPath: string): ConvertedDocument | undefined =>
    [...documents.values()].find((doc) => doc.originalPath === originalPath)

  /**
   * A sheets session streams from its backing workbook for as long as it lives
   * (even after Save As) and removes that directory itself when it closes, so
   * its temp dir is never deleted from here.
   */
  async function removeTempDir(doc: ConvertedDocument): Promise<void> {
    documents.delete(doc.tempPath)
    forgetConvertedDocument(doc.tempPath)
    if (doc.kind === 'sheets') return
    await rm(doc.tempDir, { recursive: true, force: true }).catch(() => undefined)
  }

  /** a cancel or a quit that lands during the staging awaits must not open the tab */
  function throwIfStopped(signal: AbortSignal): void {
    if (signal.aborted || disposed) throw new LegacyConvertError('cancelled', 'cancelled')
  }

  function sweepNow(): void {
    for (const doc of [...documents.values()]) {
      if (!deps.isPathOpen(doc.tempPath)) void removeTempDir(doc)
    }
  }

  async function stageAndOpenConverted(opts: {
    filePath: string
    fileName: string
    result: ConvertLegacyResult
    signal: AbortSignal
    endProgress: () => void
    afterOpenNotice?: string
  }): Promise<void> {
    const { filePath, fileName, result, signal, endProgress, afterOpenNotice } = opts
    let tempDir: string | null = null
    try {
      const kind = KIND_FOR_TARGET[result.targetFormat]
      throwIfStopped(signal)
      // the shared root keeps the default mode; the document's own dir and file are private
      // (a shared temp dir is traversable by other local users)
      const importRoot = deps.importRoot()
      await mkdir(importRoot, { recursive: true })
      tempDir = join(importRoot, randomUUID())
      await mkdir(tempDir, { mode: 0o700 })
      const stem = fileName.replace(/\.[^.]+$/, '')
      const tempPath = join(tempDir, `${stem}.${result.targetFormat}`)
      await writeFile(tempPath, result.bytes, { mode: 0o600 })
      throwIfStopped(signal)
      const doc: ConvertedDocument = {
        kind,
        originalPath: filePath,
        tempPath,
        tempDir,
        suggestSaveAs: result.suggestedSaveAsPath,
      }
      documents.set(tempPath, doc)
      // the editors read this table to turn Save into a Save As next to the original
      registerConvertedDocument(tempPath, {
        originalPath: filePath,
        suggestSaveAs: doc.suggestSaveAs,
        tempDir,
      })
      endProgress()
      try {
        deps.openConverted(doc)
      } catch (err) {
        documents.delete(tempPath)
        forgetConvertedDocument(tempPath)
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
        throw err
      }
      // the tab owns the temp dir from here on: a later failure must not delete it
      tempDir = null
      // the recents entry is the file the user picked: reopening it converts again
      try {
        deps.recordRecent(filePath)
      } catch {
        // a lost recents entry does not undo an open tab
      }
      if (afterOpenNotice) {
        deps.notice(afterOpenNotice)
      }
    } catch (err) {
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
      throw err
    }
  }

  async function runOdfFallback(
    filePath: string,
    fileName: string,
    source: OdfFallbackSourceFormat,
    signal: AbortSignal,
    endProgress: () => void,
  ): Promise<void> {
    const engine = deps.odfFallback!
    throwIfStopped(signal)
    const resolvedPath = resolve(filePath)
    const inputBytes = await readLegacyInput(resolvedPath, source)
    throwIfStopped(signal)
    // Run the slice 1 ODF pre-check (encrypted, damaged, >64 MiB part, wrong family)
    // before the fallback engine ever sees the bytes, even when `deps.convert`
    // raised `converter_missing` without preflighting.
    const preflight = preflightOdfBytes(inputBytes, source)
    if (preflight.kind === 'ooxml_misnamed') {
      const suggestedSaveAsPath = resolvedPath.replace(/\.[^.]+$/, `.${preflight.detectedFormat}`)
      await stageAndOpenConverted({
        filePath,
        fileName,
        result: {
          kind: 'ooxml_misnamed',
          sourceFormat: source,
          targetFormat: preflight.detectedFormat,
          bytes: inputBytes,
          suggestedSaveAsPath,
        },
        signal,
        endProgress,
      })
      return
    }
    let bytes: Uint8Array
    let targetFormat: LegacyTargetFormat
    let dropped: OdfDroppedItem[]
    try {
      if (source === 'odt' || source === 'ott') {
        const converted = await engine.convertOdtToDocx(inputBytes, { signal })
        bytes = converted.docx
        targetFormat = 'docx'
        dropped = converted.dropped
      } else {
        const converted = await engine.convertOdpToPptx(inputBytes, { signal })
        bytes = converted.pptx
        targetFormat = 'pptx'
        dropped = converted.dropped
      }
    } catch (err) {
      throw mapOdfFallbackError(err, source)
    }
    const afterOpenNotice = formatOdfFallbackNotice(fileName, dropped, deps.t)
    await stageAndOpenConverted({
      filePath,
      fileName,
      result: {
        kind: 'converted',
        sourceFormat: source,
        targetFormat,
        bytes,
        suggestedSaveAsPath: suggestedOoxmlPathForLegacy(resolvedPath),
      },
      signal,
      endProgress,
      afterOpenNotice,
    })
  }

  async function runConversion(filePath: string, source: LegacySourceFormat): Promise<void> {
    const fileName = basename(filePath)
    const controller = new AbortController()
    controllers.add(controller)
    const endProgress = deps.beginProgress(fileName, () => controller.abort())
    try {
      const result = await deps.convert(filePath, {
        signal: controller.signal,
        sourceFormat: source,
      })
      await stageAndOpenConverted({
        filePath,
        fileName,
        result,
        signal: controller.signal,
        endProgress,
      })
    } catch (caughtErr) {
      let err: unknown = caughtErr
      if (
        !(controller.signal.aborted || disposed) &&
        err instanceof LegacyConvertError &&
        err.code === 'converter_missing' &&
        isOdfFallbackFormat(source) &&
        deps.odfFallback
      ) {
        try {
          await runOdfFallback(filePath, fileName, source, controller.signal, endProgress)
          return
        } catch (fallbackErr) {
          // an engine failure keeps the actionable "converter is missing" notice
          err =
            fallbackErr instanceof LegacyConvertError && fallbackErr.code === 'failed'
              ? caughtErr
              : fallbackErr
        }
      }
      endProgress()
      // a cancelled or disposed job ends silently, whatever error the converter raised after
      // the stop (a missing converter must not open the values-only fallback or show a notice)
      if (controller.signal.aborted || disposed) return
      if (err instanceof LegacyConvertError) {
        if (err.code === 'cancelled') return
        if (err.code === 'converter_missing' && source === 'xls') {
          // the values-only reader still opens the cached cell values; say what it drops
          if (deps.openXlsValuesOnly(filePath)) {
            deps.notice(deps.t('legacyXlsValuesOnly', { name: fileName, ext: extname(fileName) }))
            return
          }
        }
        deps.notice(legacyErrorMessage(err, fileName, deps.t))
        return
      }
      deps.notice(
        legacyErrorMessage(new LegacyConvertError('failed', String(err)), fileName, deps.t),
      )
    } finally {
      controllers.delete(controller)
    }
  }
  return {
    /** true = accepted (the conversion runs in the background and opens the tab when done) */
    open(filePath: string): boolean {
      const source = legacyFormatForPath(filePath)
      if (!source) return false
      if (disposed) return true
      const existing = byOriginal(filePath)
      if (existing) {
        if (deps.activateConverted(existing)) return true
        void removeTempDir(existing)
      }
      if (inFlight.has(filePath)) return true
      inFlight.add(filePath)
      void runConversion(filePath, source).finally(() => {
        inFlight.delete(filePath)
      })
      return true
    },
    /** the converted document whose tab shows exactly this path, if any */
    documentForPath(tempPath: string): ConvertedDocument | undefined {
      return documents.get(tempPath)
    },
    /**
     * A converted file was renamed or moved. Inside its own staging dir (a tab rename) it is the
     * same document under a new name: the opener entry and the shared registry follow it. Any other
     * move (Save As, the UniWork first save) ends the conversion's registry entry; the staging
     * dir is swept once no tab shows the old path. False = not a converted document.
     */
    fileMoved(oldPath: string, newPath: string): boolean {
      const doc = documents.get(oldPath)
      if (!doc) return false
      if (!sameDir(dirname(newPath), doc.tempDir)) {
        forgetConvertedDocument(oldPath)
        return true
      }
      const moved: ConvertedDocument = { ...doc, tempPath: newPath }
      documents.delete(oldPath)
      documents.set(newPath, moved)
      forgetConvertedDocument(oldPath)
      registerConvertedDocument(newPath, {
        originalPath: moved.originalPath,
        suggestSaveAs: moved.suggestSaveAs,
        tempDir: moved.tempDir,
      })
      return true
    },
    /**
     * Drop the temp copy of every converted document no tab or window shows any more. Deferred and
     * coalesced: a tab that moves between the strip and a detached window briefly has no owner, and
     * ownership is judged only once that transfer has finished.
     */
    sweep(): void {
      if (sweepTimer || disposed) return
      sweepTimer = setTimeout(() => {
        sweepTimer = null
        sweepNow()
      }, deps.sweepDelayMs ?? 1000)
      sweepTimer.unref?.()
    },
    /** app quit: pending conversions stop, no new staging starts, every temp copy goes */
    async dispose(): Promise<void> {
      disposed = true
      if (sweepTimer) clearTimeout(sweepTimer)
      sweepTimer = null
      for (const controller of controllers) controller.abort()
      await Promise.all([...documents.values()].map((doc) => removeTempDir(doc)))
    },
  }
}

export type LegacyOpener = ReturnType<typeof createLegacyOpener>

export interface CloudLegacyConverterDeps {
  convert: LegacyOpenDeps['convert']
  /** where the downloaded legacy bytes are staged for the converter (default: the OS temp dir) */
  stagingRoot?(): string
  beginProgress: LegacyOpenDeps['beginProgress']
  notice: LegacyOpenDeps['notice']
  t: LegacyOpenDeps['t']
}

/**
 * UNI-2212: the converter the UniWork open flow uses for a cloud .doc / .xls / .ppt whose bytes it
 * just downloaded. The same progress box with Cancel and the same typed notices as a local open
 * (`createLegacyOpener`); there is no values-only fallback here (a cloud copy must not be bound as
 * a lossy one). The downloaded bytes are staged in a private temp dir that is always removed, and
 * nothing is opened or written beyond that: the caller owns the converted bytes.
 */
export function createCloudLegacyConverter(deps: CloudLegacyConverterDeps) {
  const controllers = new Set<AbortController>()
  let disposed = false
  return {
    async convert(input: CloudLegacyConvertInput): Promise<CloudConvertOutcome> {
      if (disposed) return { ok: false, reason: 'cancelled' }
      const controller = new AbortController()
      controllers.add(controller)
      const endProgress = deps.beginProgress(input.name, () => controller.abort())
      let dir: string | null = null
      try {
        const root = deps.stagingRoot?.() ?? tmpdir()
        await mkdir(root, { recursive: true })
        dir = await mkdtemp(join(root, 'genoffice-cloud-legacy-'))
        const staged = join(dir, `document.${input.from}`)
        await writeFile(staged, input.bytes, { mode: 0o600 })
        if (controller.signal.aborted || disposed) return { ok: false, reason: 'cancelled' }
        const result = await deps.convert(staged, {
          signal: controller.signal,
          sourceFormat: input.from,
        })
        // Cancel or quit during the converter's own tail (its output stat, read and cleanup run
        // after the subprocess has exited and its abort listener is gone) must still win over a
        // success the caller would otherwise open
        if (controller.signal.aborted || disposed) return { ok: false, reason: 'cancelled' }
        // an OOXML package that only carries a legacy name must still be the family the
        // document's own format maps to, or the server would refuse it as the next version
        if (result.targetFormat !== LEGACY_TARGET[input.from]) {
          throw new LegacyConvertError('corrupt', 'converted family does not match the document')
        }
        return { ok: true, bytes: result.bytes, to: result.targetFormat }
      } catch (err) {
        if (controller.signal.aborted || disposed) return { ok: false, reason: 'cancelled' }
        if (err instanceof LegacyConvertError && err.code === 'cancelled') {
          return { ok: false, reason: 'cancelled' }
        }
        const failure =
          err instanceof LegacyConvertError ? err : new LegacyConvertError('failed', String(err))
        deps.notice(legacyErrorMessage(failure, input.name, deps.t))
        return { ok: false, reason: 'failed' }
      } finally {
        endProgress()
        controllers.delete(controller)
        if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
      }
    },
    /** app quit: a pending conversion stops and no new one starts */
    dispose(): void {
      disposed = true
      for (const controller of controllers) controller.abort()
    },
  }
}

export type CloudLegacyConverter = ReturnType<typeof createCloudLegacyConverter>
