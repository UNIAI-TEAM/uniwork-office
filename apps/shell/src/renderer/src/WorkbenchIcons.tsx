import type { ReactElement } from 'react'
import type { PracticePillarId, WorkbenchModuleId } from '@uniwork/practice-core'
import { MODULE_TONES, tintStyle, type Tint } from './module-tones'

type IconId = PracticePillarId | WorkbenchModuleId | 'add' | 'inbox'

/**
 * Line glyphs on a 24-unit box, drawn in currentColor: the tile's tint
 * (module-tones.ts) sets both the fill and the glyph, in either theme.
 */
const GLYPH: Record<IconId, ReactElement> = {
  knowledge: (
    <>
      <path d="M7 6.5h10v11H7z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 6.5V17.5M7 10.5h10" stroke="currentColor" strokeWidth="1.5" />
    </>
  ),
  materials: (
    <>
      <path d="M7.5 5.5h7l3 3V18H7.5z" stroke="currentColor" strokeWidth="1.6" />
      <path d="M14.5 5.5V8.5h3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 11.5h5M10 14h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  skills: (
    <path
      d="M12 5.5 13.6 9.2l4 .6-2.9 2.9.7 4L12 14.8l-3.4 1.9.7-4-2.9-2.9 4-.6z"
      fill="currentColor"
    />
  ),
  compose: (
    <>
      <path d="M6.5 17 15.5 8l2 2-9 9H6.5z" fill="currentColor" />
      <path d="M14.8 7.2 16.5 5.5 18.2 7.2 16.5 8.9z" fill="currentColor" />
    </>
  ),
  desk: (
    <>
      <path
        d="M4.5 10.5 12 4.5l7.5 6V18a1 1 0 0 1-1 1h-4.2v-4.2H9.7V19H5.5a1 1 0 0 1-1-1z"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="11.2" r="1.3" fill="currentColor" />
    </>
  ),
  calendar: (
    <>
      <rect x="6.5" y="7" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M6.5 10h11M9 5.5v3M15 5.5v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </>
  ),
  tasks: (
    <>
      <path
        d="M7 8h10M7 12h10M7 16h7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M5.5 8l1 1 2-2.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </>
  ),
  notes: (
    <>
      <path d="M7 5.5h7.5L17.5 8.5V18H7z" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9.5 11h5M9.5 13.5h5M9.5 16h3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </>
  ),
  forms: (
    <>
      <rect x="7" y="5.5" width="10" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9.5 9h5M9.5 12h5M9.5 15h3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </>
  ),
  personal: (
    <>
      <circle cx="12" cy="9" r="2.4" fill="currentColor" />
      <path
        d="M6.5 18c.9-2.6 2.8-3.8 5.5-3.8S16.6 15.4 17.5 18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </>
  ),
  inbox: (
    <>
      <path
        d="M8 16.5V11a4 4 0 0 1 8 0v5.5l1.5 1.5h-11z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M10.5 19.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  add: <path d="M12 7v10M7 12h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
}

/** `tint` overrides the module tone (the Overview strip paints Meetings violet, Unread blue) */
export function WorkbenchIcon({
  id,
  size = 18,
  tint,
}: {
  id: IconId
  size?: number
  tint?: Tint
}): ReactElement {
  const tone = tint ?? (id === 'add' || id === 'inbox' ? 'gray' : MODULE_TONES[id])
  return (
    <span
      className="wb-icon-tile"
      style={{ ...tintStyle(tone), width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {GLYPH[id]}
      </svg>
    </span>
  )
}

/** the tick inside a `.wb-check` box, shared by the Overview and Tasks lists */
export const CHECK_GLYPH = (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path
      d="M2 5.2 4.1 7.2 8 3"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
