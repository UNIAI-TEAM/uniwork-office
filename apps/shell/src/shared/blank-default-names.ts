/**
 * UNI-1959: the default titles of a document created blank from the New menu
 * (the web's `documents.home.default_names.*`: vi and en; every other UI
 * language uses the English value). The renderer's strings
 * (`uhDefaultName*`) carry the same values; main reads this table to tell a
 * never-saved blank document from an ordinary one after a restart (file
 * version 1 + one of these titles), which is the web's first-save predicate.
 */
export type BlankDefaultKind = 'docx' | 'xlsx' | 'pptx' | 'md' | 'html' | 'pdf'

export const BLANK_DEFAULT_NAMES: Record<'vi' | 'en', Record<BlankDefaultKind, string>> = {
  vi: {
    docx: 'Tài liệu chưa đặt tên.docx',
    xlsx: 'Bảng tính chưa đặt tên.xlsx',
    pptx: 'Bản trình chiếu chưa đặt tên.pptx',
    md: 'Markdown chưa đặt tên.md',
    html: 'Trang HTML chưa đặt tên.html',
    pdf: 'PDF chưa đặt tên.pdf',
  },
  en: {
    docx: 'Untitled document.docx',
    xlsx: 'Untitled spreadsheet.xlsx',
    pptx: 'Untitled presentation.pptx',
    md: 'Untitled markdown.md',
    html: 'Untitled HTML page.html',
    pdf: 'Untitled PDF.pdf',
  },
}

const ALL_DEFAULTS: ReadonlySet<string> = new Set(
  Object.values(BLANK_DEFAULT_NAMES).flatMap((names) => Object.values(names)),
)

/** whether `title` is one of the default blank titles (compared as the server stores it: trimmed, NFC) */
export function isBlankDefaultTitle(title: string): boolean {
  return ALL_DEFAULTS.has(title.trim().normalize('NFC'))
}
