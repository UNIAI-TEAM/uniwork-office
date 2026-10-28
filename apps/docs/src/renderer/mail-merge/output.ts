import {
  mergeFieldName,
  mergeOutputFileName,
  placeholderText,
  type MergeRecord,
} from '@genoffice/docx-engine'
import type { Lang } from '@genoffice/i18n'
import type { MergeOutputMode } from '../../shared/ipc'
import { buildDocBytes, type FileActionContext } from '../file-actions'
import type { PmNode } from '../editor/convert'
import type { TFunc } from '../i18n/locale'
import { mergeAllRecords, substituteMergeFields } from './template'
/**
 * The output half of the mail merge: the documents the merge writes.
 *
 * The letters are the template with one record's values in it, serialized the
 * way the document itself is serialized — so a merged letter keeps the
 * template's styles, sections, headers and pictures, and carries no field
 * code any more. genoffice#2097.
 */

/** what the user asked the merge to write */
export interface MailMergeRequest {
  /** one document for all the records, or one document per record */
  mode: MergeOutputMode
  /** the records to merge */
  records: readonly MergeRecord[]
  /** the column names of the data source */
  fields: readonly string[]
  /** the field the file names come from; empty takes the first field */
  namePattern: string
}

/** one merged document, ready to be written */
export interface MailMergeFile {
  /** the file name, without a folder */
  name: string
  /** the .docx bytes */
  bytes: Uint8Array
}

/** the answer to a merge: what was written, or what went wrong */
export interface MailMergeResponse {
  ok: boolean
  /** how many documents were written */
  count?: number
  /** the file that was written (one document for all the records) */
  path?: string
  /** the folder the documents went into (one document per record) */
  folder?: string
  /** the user closed the dialog without choosing */
  canceled?: boolean
  error?: string
}

/**
 * A merge writes ordinary local .docx copies of the template: no open password and no UniWork
 * binding. For a password-protected or UniWork-bound document the user must confirm that first
 * (never a silent plaintext copy); the returned string is the i18n key of the question, null
 * when the document is a plain local file.
 */
export function mergeWriteWarning(
  doc: { encrypted?: boolean } | null | undefined,
  uniworkBound: boolean,
): 'appMergeWarnPassword' | 'appMergeWarnUniwork' | null {
  if (doc?.encrypted) return 'appMergeWarnPassword'
  return uniworkBound ? 'appMergeWarnUniwork' : null
}

/**
 * Friendly label for the status bar after inserting a field: a MERGEFIELD shows
 * its guillemet placeholder (`«City»`) rather than the raw field instruction.
 */
export function fieldInsertedLabel(instr: string): string {
  const kw = instr.trim().split(/\s+/)[0]?.toUpperCase()
  if (kw === 'MERGEFIELD') {
    const name = mergeFieldName(instr)
    if (name) return placeholderText(name)
  }
  return instr
}

function isSingular(lang: Lang, n: number): boolean {
  try {
    return new Intl.PluralRules(lang).select(n) === 'one'
  } catch {
    return n === 1
  }
}

/** "N documents merged" in the singular or plural form the language uses for N */
export function mergedCountLabel(tr: TFunc, lang: Lang, n: number): string {
  return tr(isSingular(lang, n) ? 'ribbonMailingsMergedOne' : 'ribbonMailingsMerged', { n })
}

/** "N documents written" in the singular or plural form the language uses for N */
export function mergeWrittenLabel(tr: TFunc, lang: Lang, n: number): string {
  return tr(isSingular(lang, n) ? 'appMergeWrittenOne' : 'appMergeWritten', { n })
}
/**
 * The documents a merge writes.
 *
 * One document per record is the letter case: every record gets its own
 * letter, named after the record. One document for all the records is the
 * directory case: the letters follow each other, each on its own page.
 */
export async function buildMailMergeFiles(
  ctx: FileActionContext,
  request: MailMergeRequest,
): Promise<MailMergeFile[]> {
  const editor = ctx.editor
  if (!editor || request.records.length === 0) return []
  const template = editor.getJSON() as PmNode
  if (request.mode === 'perRecord') {
    const files: MailMergeFile[] = []
    for (const record of request.records) {
      const bytes = await buildDocBytes(ctx, substituteMergeFields(template, record))
      if (!bytes) continue
      files.push({
        name: `${mergeOutputFileName(request.namePattern, record, request.fields)}.docx`,
        bytes,
      })
    }
    return files
  }
  const bytes = await buildDocBytes(ctx, mergeAllRecords(template, request.records))
  if (!bytes) return []
  return [{ name: mergedDocumentName(ctx), bytes }]
}

/** the name of the document that holds every letter */
function mergedDocumentName(ctx: FileActionContext): string {
  const base = (ctx.doc?.fileName ?? 'document').replace(/\.docx$/i, '')
  return `${mergeOutputFileName(base, {}, [])}-merged.docx`
}
