import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { forgetConvertedDocument, registerConvertedDocument } from '@genoffice/electron-utils'
import {
  LegacyConvertError,
  legacyFormatForPath,
  type ConvertLegacyResult,
  type LegacyConvertErrorCode,
  type LegacySourceFormat,
  type LegacyTargetFormat,
  LEGACY_TARGET_FOR_SOURCE as LEGACY_TARGET,
} from './legacy-converter'
import type { LegacyOpenStringKey } from './legacy-open-strings'
import type { CloudConvertOutcome, CloudLegacyConvertInput } from './uniwork-docs/legacy-cloud-open'

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

/** the user-facing text of a conversion failure (unmapped codes read as a plain failure) */
export function legacyErrorMessage(
  err: LegacyConvertError,
  fileName: string,
  t: LegacyOpenDeps['t'],
): string {
  const key = ERROR_COPY[err.code] ?? 'legacyFailed'
  return t(key, { name: fileName, ext: extname(fileName) })
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

  async function runConversion(filePath: string, source: LegacySourceFormat): Promise<void> {
    const fileName = basename(filePath)
    const controller = new AbortController()
    controllers.add(controller)
    const endProgress = deps.beginProgress(fileName, () => controller.abort())
    let tempDir: string | null = null
    try {
      const result = await deps.convert(filePath, {
        signal: controller.signal,
        sourceFormat: source,
      })
      const kind = KIND_FOR_TARGET[result.targetFormat]
      throwIfStopped(controller.signal)
      // the shared root keeps the default mode; the document's own dir and file are private
      // (a shared temp dir is traversable by other local users)
      const importRoot = deps.importRoot()
      await mkdir(importRoot, { recursive: true })
      tempDir = join(importRoot, randomUUID())
      await mkdir(tempDir, { mode: 0o700 })
      const stem = fileName.replace(/\.[^.]+$/, '')
      const tempPath = join(tempDir, `${stem}.${result.targetFormat}`)
      await writeFile(tempPath, result.bytes, { mode: 0o600 })
      throwIfStopped(controller.signal)
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
    } catch (err) {
      endProgress()
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
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
