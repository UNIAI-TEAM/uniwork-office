import type { DocumentTabKind } from '../shared/tabs-api'

// shared by the open route, the open-dialog filter and the rename gate so they cannot drift
const DOCX_RE = /\.docx$/i
const XLSX_RE = /\.(xlsx|xlsm|xls|csv|tsv|ods|ots)$/i
const PPTX_RE = /\.pptx$/i
const PDF_RE = /\.pdf$/i
const HTML_RE = /\.html?$/i
// the legacy binaries and OpenDocument files open through the converter (legacy-open.ts), then in docs / sheets / slides
const LEGACY_DOC_RE = /\.(doc|odt|ott)$/i
const LEGACY_PPT_RE = /\.(ppt|odp|otp)$/i

const TEXT_RE = /\.(md|markdown|txt|json)$/i

export { DOCX_RE, XLSX_RE, PPTX_RE, PDF_RE, HTML_RE, TEXT_RE, LEGACY_DOC_RE, LEGACY_PPT_RE }

export function appForPath(path: string): DocumentTabKind | undefined {
  if (DOCX_RE.test(path) || LEGACY_DOC_RE.test(path)) return 'docs'
  if (XLSX_RE.test(path)) return 'sheets'
  if (PPTX_RE.test(path) || LEGACY_PPT_RE.test(path)) return 'slides'
  if (PDF_RE.test(path)) return 'pdf'
  if (TEXT_RE.test(path)) return 'markdown'
  if (HTML_RE.test(path)) return 'html'
  return undefined
}

/** An editor view reaches home:open-path for markdown wiki links only, so only the notes they resolve to. */
export function editorMayOpenPath(path: string): boolean {
  return appForPath(path) === 'markdown'
}

const LEGACY_EXT_RE = /\.(doc|xls|ppt|odt|ott|ods|ots|odp|otp)$/i
const legacyExtOf = (name: string): string | null =>
  LEGACY_EXT_RE.exec(name)?.[1]?.toLowerCase() ?? null

/**
 * A legal name in an extension no app routes to would turn an openable file into an unopenable one.
 * The legacy binaries and OpenDocument files are accepted as input (appForPath) but are never a write
 * format: a rename may not cross the legacy/modern boundary, or the editors would save OOXML under a
 * .doc/.xls/.ppt or .odt/.ods/.odp name.
 */
export function renameStaysInApp(from: string, newName: string): boolean {
  if (legacyExtOf(from) !== legacyExtOf(newName)) return false
  const current = appForPath(from)
  if (!current) return true
  return appForPath(newName) === current
}
