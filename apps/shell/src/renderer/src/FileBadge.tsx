import iconDocx from './assets/file-docx.svg'
import iconXlsx from './assets/file-xlsx.svg'
import iconPptx from './assets/file-pptx.svg'
import iconPdf from './assets/file-pdf.svg'
import iconMd from './assets/file-md.svg'
import iconTxt from './assets/file-txt.svg'
import iconHtml from './assets/file-html.svg'

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

/** the UniNote mark (the web's page tile): the glyph in the blue tint pair, so it follows the theme */
function UniNoteBadge({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6.5" style={{ fill: 'var(--tint-blue)' }} />
      <g transform="translate(7.5 7.5) scale(0.17)" style={{ color: 'var(--tint-blue-fg)' }}>
        <path
          d="M22 14 V56 A28 28 0 0 0 78 56"
          fill="none"
          stroke="currentColor"
          strokeWidth="20"
          strokeLinecap="round"
        />
        <path
          d="M68 2 H88 V26 H68 Z M68 30 H88 L78 50 Z M77 33 H79 V43 H77 Z"
          fill="currentColor"
          fillRule="evenodd"
        />
      </g>
    </svg>
  )
}

/** file-type icon by extension ('page' = UniNote); an unknown extension gets a neutral letter tile */
export function FileBadge({ ext, size }: { ext: string; size: number }) {
  if (ext === 'page') return <UniNoteBadge size={size} />
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
