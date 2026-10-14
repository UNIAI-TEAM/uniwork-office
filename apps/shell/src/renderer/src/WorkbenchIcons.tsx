import type { ReactElement } from 'react'
import type { PracticePillarId, WorkbenchModuleId } from '@uniwork/practice-core'
import { MODULE_TONES, tintStyle, type Tint } from './module-tones'

type IconId = PracticePillarId | WorkbenchModuleId | 'add' | 'inbox'

/**
 * Line glyphs on a 24-unit box, 1.5 stroke in currentColor (redesign spec 2.3):
 * the tile's tint (module-tones.ts) sets both the fill and the glyph, in either theme.
 */
const GLYPH: Record<IconId, ReactElement> = {
  knowledge: (
    <>
      <path d="M7 6.5h10v11H7z" />
      <path d="M10 6.5V17.5M7 10.5h10" />
    </>
  ),
  materials: (
    <>
      <path d="M7.5 5.5h7l3 3V18H7.5z" />
      <path d="M14.5 5.5V8.5h3" />
      <path d="M10 11.5h5M10 14h4" />
    </>
  ),
  skills: (
    <>
      <path d="M11 5.5 12.6 9.4 16.5 11l-3.9 1.6L11 16.5l-1.6-3.9L5.5 11l3.9-1.6z" />
      <path d="M17 15.5v3.5M15.25 17.25h3.5" />
    </>
  ),
  compose: (
    <>
      <path d="M14.5 6.5 17.5 9.5 9 18H6v-3z" />
      <path d="M12.5 8.5l3 3" />
    </>
  ),
  desk: (
    <>
      <path d="M4.5 10.5 12 4.5l7.5 6V18a1 1 0 0 1-1 1h-4.2v-4.2H9.7V19H5.5a1 1 0 0 1-1-1z" />
    </>
  ),
  calendar: (
    <>
      <rect x="6.5" y="7" width="11" height="10" rx="1.5" />
      <path d="M6.5 10h11M9 5.5v3M15 5.5v3" />
    </>
  ),
  tasks: (
    <>
      <path d="M7 8h10M7 12h10M7 16h7" />
      <path d="M5.5 8l1 1 2-2.2" />
    </>
  ),
  notes: (
    <>
      <path d="M7 5.5h7.5L17.5 8.5V18H7z" />
      <path d="M9.5 11h5M9.5 13.5h5M9.5 16h3" />
    </>
  ),
  forms: (
    <>
      <rect x="7" y="5.5" width="10" height="13" rx="1.5" />
      <path d="M9.5 9h5M9.5 12h5M9.5 15h3" />
    </>
  ),
  personal: (
    <>
      <circle cx="12" cy="9" r="2.6" />
      <path d="M6.5 18c.9-2.6 2.8-3.8 5.5-3.8S16.6 15.4 17.5 18" />
    </>
  ),
  inbox: (
    <>
      <path d="M8 16.5V11a4 4 0 0 1 8 0v5.5l1.5 1.5h-11z" />
      <path d="M10.5 19.5h3" />
    </>
  ),
  add: <path d="M12 7v10M7 12h10" />,
}

/**
 * `tint` overrides the module tone (the Overview strip paints Meetings violet, Unread blue).
 * `bare` drops the tile: a tinted glyph that fills its box (the tab row, spec 3).
 */
export function WorkbenchIcon({
  id,
  size = 18,
  tint,
  bare = false,
}: {
  id: IconId
  size?: number
  tint?: Tint
  bare?: boolean
}): ReactElement {
  const tone = tint ?? (id === 'add' || id === 'inbox' ? 'gray' : MODULE_TONES[id])
  const style = bare ? { color: `var(--tint-${tone}-fg)` } : tintStyle(tone)
  return (
    <span
      className={bare ? 'wb-icon-glyph' : 'wb-icon-tile'}
      style={{ ...style, width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        width={size}
        height={size}
        // the glyphs sit inside 4..20: a bare glyph crops the tile's padding away
        viewBox={bare ? '4 4 16 16' : '0 0 24 24'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
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

/** small control glyphs on a 16-unit box; they replace the ▾ ⋮⋮ × → + text characters */
const UI_GLYPH = {
  chevronDown: <path d="M4 6l4 4 4-4" />,
  chevronLeft: <path d="M10 4 6 8l4 4" />,
  chevronRight: <path d="m6 4 4 4-4 4" />,
  close: <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  arrowRight: <path d="M3.5 8h9M9 4.5 12.5 8 9 11.5" />,
  external: <path d="M9 3h4v4M13 3 7.5 8.5M11.5 9.5v3.5h-8.5v-8.5h3.5" />,
  refresh: (
    <>
      <path d="M13 8a5 5 0 1 1-1.46-3.54" />
      <path d="M13 2.5V5h-2.5" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </>
  ),
  exportPdf: (
    <>
      <path d="M4 2.5h5.5L12 5v3M4 2.5v11h4" />
      <path d="M10 11.5h4M12 9.5l2 2-2 2" />
    </>
  ),
  merge: (
    <>
      <path d="M3 3h4v4H3zM3 9h4v4H3z" />
      <path d="M7 5h2.5A1.5 1.5 0 0 1 11 6.5V8M7 11h2.5A1.5 1.5 0 0 0 11 9.5V8h2.5" />
    </>
  ),
  split: (
    <>
      <path d="M3 2.5h10v4H3zM3 9.5h10v4H3z" />
      <path d="M1.5 8h1.5M6.5 8h3M13 8h1.5" />
    </>
  ),
  upload: <path d="M8 10.5V3M5 6l3-3 3 3M3 10.5v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2" />,
  bell: (
    <>
      <path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3z" />
      <path d="M6.5 13.5a1.5 1.5 0 0 0 3 0" />
    </>
  ),
  video: (
    <>
      <rect x="2" y="4.5" width="8.5" height="7" rx="1.5" />
      <path d="m10.5 7 3.5-2v6l-3.5-2" />
    </>
  ),
  folder: (
    <path d="M2.5 4.5a1 1 0 0 1 1-1h3L8 5h4.5a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
  ),
  more: (
    <>
      <circle cx="3.5" cy="8" r="0.6" />
      <circle cx="8" cy="8" r="0.6" />
      <circle cx="12.5" cy="8" r="0.6" />
    </>
  ),
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </>
  ),
  pencil: <path d="M11 2.5 13.5 5 6 12.5H3.5V10z" />,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" />,
  grip: (
    <>
      <circle cx="6" cy="4" r="0.6" />
      <circle cx="10" cy="4" r="0.6" />
      <circle cx="6" cy="8" r="0.6" />
      <circle cx="10" cy="8" r="0.6" />
      <circle cx="6" cy="12" r="0.6" />
      <circle cx="10" cy="12" r="0.6" />
    </>
  ),
} satisfies Record<string, ReactElement>

export type WbGlyphId = keyof typeof UI_GLYPH

/** a 1.5-stroke control glyph in currentColor, decorative (the control carries the name) */
export function WbGlyph({ id, size = 16 }: { id: WbGlyphId; size?: number }): ReactElement {
  return (
    <svg
      className="wb-glyph"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {UI_GLYPH[id]}
    </svg>
  )
}
