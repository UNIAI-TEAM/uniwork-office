import iconDocx from './assets/file-docx.svg'
import iconXlsx from './assets/file-xlsx.svg'
import iconPptx from './assets/file-pptx.svg'
import iconPdf from './assets/file-pdf.svg'
import iconMd from './assets/file-md.svg'
import iconTxt from './assets/file-txt.svg'
import iconHtml from './assets/file-html.svg'
import { UniNoteIcon } from './UniNoteIcon'

const FILE_ICONS: Record<string, string> = {
  docx: iconDocx,
  xlsx: iconXlsx,
  xlsm: iconXlsx,
  pptx: iconPptx,
  pdf: iconPdf,
  md: iconMd,
  markdown: iconMd,
  txt: iconTxt,
  html: iconHtml,
  htm: iconHtml,
}

// Legacy Office formats draw a lighter copy of their modern format's icon (same rule as the web DocumentTypeIcon).
const LEGACY_ICONS: Record<string, string> = {
  doc: iconDocx,
  dot: iconDocx,
  rtf: iconDocx,
  xls: iconXlsx,
  xlt: iconXlsx,
  ppt: iconPptx,
  pps: iconPptx,
  pot: iconPptx,
}

/** file-type icon by extension ('page' = UniNote, the shared option J tile); an unknown extension gets a neutral letter tile */
export function FileBadge({ ext, size }: { ext: string; size: number }) {
  if (ext === 'page') return <UniNoteIcon width={size} height={size} />
  const legacy = LEGACY_ICONS[ext]
  if (legacy) {
    return (
      <img
        src={legacy}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        style={{ opacity: 0.55 }}
      />
    )
  }
  const icon = FILE_ICONS[ext]
  if (icon) {
    return <img src={icon} width={size} height={size} alt="" aria-hidden="true" />
  }
  const label = ext ? ext[0].toUpperCase() : '?'
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      {/* chrome, not document data: the neutral tint pair follows the theme */}
      <rect width="32" height="32" rx="7.5" style={{ fill: 'var(--tint-gray)' }} />
      <text
        x="16"
        y="16.5"
        textAnchor="middle"
        dominantBaseline="central"
        style={{ fill: 'var(--tint-gray-fg)' }}
        fontSize={17}
        fontWeight="700"
        fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
      >
        {label}
      </text>
    </svg>
  )
}
