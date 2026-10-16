/**
 * Single source of truth for the open-dialog filter, in shared so the renderer
 * can read it too (the Home hint). Includes the legacy .doc/.ppt binaries so
 * they are selectable and surface the explicit "not supported" dialog via
 * openDocumentPath instead of being grayed out.
 */
export const OPEN_DIALOG_EXTENSIONS: readonly string[] = [
  'docx',
  'doc',
  'xlsx',
  'xlsm',
  'xls',
  'csv',
  'tsv',
  'pptx',
  'ppt',
  'pdf',
  'md',
  'markdown',
  'txt',
  'json',
  'html',
  'htm',
]

/**
 * The legacy binaries kept in the dialog list only so picking one shows the
 * "not supported" dialog. They do not open, so the Home hint leaves them out.
 */
export const OPEN_DIALOG_UNSUPPORTED_EXTENSIONS: readonly string[] = ['doc', 'ppt']

/** `.ext / .ext` text of the formats that actually open, derived from the dialog list */
export function openLocalHint(): string {
  return OPEN_DIALOG_EXTENSIONS.filter((ext) => !OPEN_DIALOG_UNSUPPORTED_EXTENSIONS.includes(ext))
    .map((ext) => `.${ext}`)
    .join(' / ')
}
