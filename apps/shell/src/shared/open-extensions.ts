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
