import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import {
  LegacyConvertError,
  legacyFormatForPath,
  type ConvertLegacyResult,
  type LegacyConvertErrorCode,
  type LegacySourceFormat,
  type LegacyTargetFormat,
} from './legacy-converter'
import type { LegacyOpenStringKey } from './legacy-open-strings'

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

  const byOriginal = (originalPath: string): ConvertedDocument | undefined =>
    [...documents.values()].find((doc) => doc.originalPath === originalPath)

  /**
   * A sheets session streams from its backing workbook for as long as it lives
   * (even after Save As) and removes that directory itself when it closes, so
   * its temp dir is never deleted from here.
   */
  async function removeTempDir(doc: ConvertedDocument): Promise<void> {
    documents.delete(doc.tempPath)
    if (doc.kind === 'sheets') return
    await rm(doc.tempDir, { recursive: true, force: true }).catch(() => undefined)
  }

  async function runConversion(filePath: string, source: LegacySourceFormat): Promise<void> {
    const fileName = basename(filePath)
    const controller = new AbortController()
    const endProgress = deps.beginProgress(fileName, () => controller.abort())
    let tempDir: string | null = null
    try {
      const result = await deps.convert(filePath, {
        signal: controller.signal,
        sourceFormat: source,
      })
      const kind = KIND_FOR_TARGET[result.targetFormat]
      tempDir = join(deps.importRoot(), randomUUID())
      await mkdir(tempDir, { recursive: true })
      const stem = fileName.replace(/\.[^.]+$/, '')
      const tempPath = join(tempDir, `${stem}.${result.targetFormat}`)
      await writeFile(tempPath, result.bytes)
      const doc: ConvertedDocument = {
        kind,
        originalPath: filePath,
        tempPath,
        tempDir,
        suggestSaveAs: result.suggestedSaveAsPath,
      }
      documents.set(tempPath, doc)
      endProgress()
      try {
        deps.openConverted(doc)
      } catch (err) {
        documents.delete(tempPath)
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
        throw err
      }
      // the recents entry is the file the user picked: reopening it converts again
      deps.recordRecent(filePath)
      tempDir = null
    } catch (err) {
      endProgress()
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
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
    }
  }

  return {
    /** true = accepted (the conversion runs in the background and opens the tab when done) */
    open(filePath: string): boolean {
      const source = legacyFormatForPath(filePath)
      if (!source) return false
      const existing = byOriginal(filePath)
      if (existing) {
        if (deps.activateConverted(existing)) return true
        void removeTempDir(existing)
      }
      if (inFlight.has(filePath)) return true
      inFlight.add(filePath)
      void runConversion(filePath, source).finally(() => inFlight.delete(filePath))
      return true
    },
    /** the converted document whose tab shows exactly this path, if any */
    documentForPath(tempPath: string): ConvertedDocument | undefined {
      return documents.get(tempPath)
    },
    /** drop the temp copy of every converted document no tab or window shows any more */
    sweep(): void {
      for (const doc of [...documents.values()]) {
        if (!deps.isPathOpen(doc.tempPath)) void removeTempDir(doc)
      }
    },
    /** app quit: every temp copy goes */
    async dispose(): Promise<void> {
      await Promise.all([...documents.values()].map((doc) => removeTempDir(doc)))
    },
  }
}

export type LegacyOpener = ReturnType<typeof createLegacyOpener>
