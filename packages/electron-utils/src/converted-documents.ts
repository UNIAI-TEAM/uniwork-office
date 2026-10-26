/**
 * Local documents the desktop converted from a legacy .doc/.xls/.ppt and opened
 * as an unsaved .docx/.xlsx/.pptx. The shell registers one per converted tab,
 * keyed by the exact path the tab edits (the converted copy in its own temp
 * dir): the editors read it to turn Save into a Save As next to the original,
 * and the UniWork first save finds the converted session by that same path.
 * Never look one up by file-name stem: `budget.xls` converts to a temp
 * `budget.xlsx` while a real `budget.xlsx` can be open beside it.
 *
 * One process-wide table behind Symbol.for, because the shell and each editor's
 * main code can end up as separate bundled copies of this module.
 */
import { resolve } from 'node:path'

export interface ConvertedDocumentInfo {
  /** the legacy file the copy came from; only ever read, never written */
  originalPath: string
  /** where the first Save asks to write: `<original name>.docx|.xlsx|.pptx` next to the original */
  suggestSaveAs: string
  /** the temp directory holding the converted copy */
  tempDir: string
}

const TABLE = Symbol.for('genoffice.converted-documents')

function table(): Map<string, ConvertedDocumentInfo> {
  const holder = globalThis as Record<symbol, Map<string, ConvertedDocumentInfo> | undefined>
  return (holder[TABLE] ??= new Map())
}

/** exact path identity: absolute, case-folded where the filesystem is */
function keyOf(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' || process.platform === 'darwin'
    ? absolute.toLowerCase()
    : absolute
}

export function registerConvertedDocument(tempPath: string, info: ConvertedDocumentInfo): void {
  table().set(keyOf(tempPath), info)
}

/** the conversion behind a tab path, or undefined for every ordinary document */
export function convertedDocumentFor(
  path: string | null | undefined,
): ConvertedDocumentInfo | undefined {
  return path ? table().get(keyOf(path)) : undefined
}

/** the document got a real home (Save As, UniWork first save) or its tab closed */
export function forgetConvertedDocument(path: string | null | undefined): void {
  if (path) table().delete(keyOf(path))
}
