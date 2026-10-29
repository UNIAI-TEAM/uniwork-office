/**
 * Single source of truth for the open-dialog filter, in shared so the renderer
 * can read it too (the Home hint). Includes the legacy .doc/.xls/.ppt binaries:
 * the desktop converts them to .docx/.xlsx/.pptx on open (legacy-open.ts).
 */
export const OPEN_DIALOG_EXTENSIONS: readonly string[] = [
  'docx',
  'doc',
  'odt',
  'ott',
  'xlsx',
  'xlsm',
  'xls',
  'csv',
  'tsv',
  'ods',
  'ots',
  'pptx',
  'ppt',
  'odp',
  'otp',
  'pdf',
  'md',
  'markdown',
  'txt',
  'json',
  'html',
  'htm',
]

/**
 * Dialog entries that are listed but do not open, so the Home hint leaves them
 * out. Empty since the legacy .doc/.ppt binaries open through the converter.
 */
export const OPEN_DIALOG_UNSUPPORTED_EXTENSIONS: readonly string[] = []

/** `.ext / .ext` text of the formats that actually open, derived from the dialog list */
export function openLocalHint(): string {
  return OPEN_DIALOG_EXTENSIONS.filter((ext) => !OPEN_DIALOG_UNSUPPORTED_EXTENSIONS.includes(ext))
    .map((ext) => `.${ext}`)
    .join(' / ')
}
