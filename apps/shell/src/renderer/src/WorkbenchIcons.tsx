import type { ReactElement } from 'react'
import type { PracticePillarId, WorkbenchModuleId } from '@uniwork/practice-core'

type IconId = PracticePillarId | WorkbenchModuleId | 'add'

/**
 * Genspark / Office-style app badges: rounded square + solid brand color + white glyph.
 * Same visual language as Home file icons (docx blue, xlsx green, pptx red).
 */
const BADGE: Record<IconId, { bg: string; glyph: ReactElement }> = {
  knowledge: {
    bg: '#3276CD',
    glyph: (
      <>
        <path d="M7 6.5h10v11H7z" stroke="#fff" strokeWidth="1.6" fill="none" />
        <path d="M10 6.5V17.5M7 10.5h10" stroke="#fff" strokeWidth="1.5" />
      </>
    ),
  },
  materials: {
    bg: '#4FA16B',
    glyph: (
      <>
        <path d="M7.5 5.5h7l3 3V18H7.5z" stroke="#fff" strokeWidth="1.6" fill="none" />
        <path d="M14.5 5.5V8.5h3" stroke="#fff" strokeWidth="1.5" />
        <path d="M10 11.5h5M10 14h4" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
      </>
    ),
  },
  skills: {
    bg: '#F5A524',
    glyph: (
      <path
        d="M12 5.5 13.6 9.2l4 .6-2.9 2.9.7 4L12 14.8l-3.4 1.9.7-4-2.9-2.9 4-.6z"
        fill="#fff"
      />
    ),
  },
  compose: {
    bg: '#7B61FF',
    glyph: (
      <>
        <path d="M6.5 17 15.5 8l2 2-9 9H6.5z" fill="#fff" />
        <path d="M14.8 7.2 16.5 5.5 18.2 7.2 16.5 8.9z" fill="#fff" />
      </>
    ),
  },
  desk: {
    bg: '#0EA5E9',
    glyph: (
      <>
        <path
          d="M4.5 10.5 12 4.5l7.5 6V18a1 1 0 0 1-1 1h-4.2v-4.2H9.7V19H5.5a1 1 0 0 1-1-1z"
          stroke="#fff"
          strokeWidth="1.45"
          strokeLinejoin="round"
          fill="none"
        />
        <circle cx="12" cy="11.2" r="1.3" fill="#fff" />
      </>
    ),
  },
  calendar: {
    bg: '#E85D4C',
    glyph: (
      <>
        <rect x="6.5" y="7" width="11" height="10" rx="1.5" stroke="#fff" strokeWidth="1.5" fill="none" />
        <path d="M6.5 10h11M9 5.5v3M15 5.5v3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
      </>
    ),
  },
  tasks: {
    bg: '#2F9E8A',
    glyph: (
      <>
        <path d="M7 8h10M7 12h10M7 16h7" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M5.5 8l1 1 2-2.2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  notes: {
    bg: '#5B7CFA',
    glyph: (
      <>
        <path d="M7 5.5h7.5L17.5 8.5V18H7z" stroke="#fff" strokeWidth="1.5" fill="none" />
        <path d="M9.5 11h5M9.5 13.5h5M9.5 16h3" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
      </>
    ),
  },
  forms: {
    bg: '#3D8BDB',
    glyph: (
      <>
        <rect x="7" y="5.5" width="10" height="13" rx="1.5" stroke="#fff" strokeWidth="1.5" fill="none" />
        <path d="M9.5 9h5M9.5 12h5M9.5 15h3" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" />
      </>
    ),
  },
  personal: {
    bg: '#6366F1',
    glyph: (
      <>
        <circle cx="12" cy="9" r="2.4" fill="#fff" />
        <path d="M6.5 18c.9-2.6 2.8-3.8 5.5-3.8S16.6 15.4 17.5 18" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
  add: {
    bg: '#64748B',
    glyph: <path d="M12 7v10M7 12h10" stroke="#fff" strokeWidth="2" strokeLinecap="round" />,
  },
}

export function WorkbenchIcon({ id, size = 18 }: { id: IconId; size?: number }): ReactElement {
  const def = BADGE[id]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="wb-app-icon"
    >
      <rect width="24" height="24" rx="5.5" fill={def.bg} />
      {def.glyph}
    </svg>
  )
}
