import { format, type Lang } from '@genoffice/i18n'
import { anchorLabel, type AnchorLabelKey } from './anchor-label'
import type { CollabAnchor } from './types'

/** only the keys this component reads; the panel passes its `CollabPanelStrings` */
export interface AnchorLabelStrings extends Record<AnchorLabelKey, string> {
  collabAnchorStale: string
  collabAnchorLost: string
}

export interface AnchorLabelProps {
  /** null/undefined (discussion kind): nothing is rendered */
  anchor: CollabAnchor | null | undefined
  /** the server's / adapter's state; `stale` and `lost` show as text, anything else shows no state */
  state?: string | null
  lang: Lang
  strings: AnchorLabelStrings
  activeSheet?: string
  resolveSheetName?: (sheet: string) => string | undefined
  /** ids for the thread's aria-labelledby (author, anchor label, state text) */
  labelId?: string
  stateId?: string
  className?: string
}

/** The position label of a comment thread, with the stale / lost state as words (never colour or an icon alone). */
export function AnchorLabel({
  anchor,
  state,
  lang,
  strings,
  activeSheet,
  resolveSheetName,
  labelId,
  stateId,
  className,
}: AnchorLabelProps) {
  if (!anchor) return null
  const parts = anchorLabel(anchor, { lang, activeSheet, resolveSheetName })
  const stateText =
    state === 'stale'
      ? strings.collabAnchorStale
      : state === 'lost'
        ? strings.collabAnchorLost
        : undefined
  if (!parts && !stateText) return null

  return (
    <span className={className ? `collab-anchor ${className}` : 'collab-anchor'}>
      {parts && (
        <span
          id={labelId}
          className="collab-anchor-label"
          title={parts.title}
          // a cut quote has its full text in the title: reachable from the keyboard
          tabIndex={parts.title ? 0 : undefined}
        >
          {format(strings[parts.key], parts.params)}
        </span>
      )}
      {stateText && (
        <span id={stateId} className={`collab-anchor-state collab-anchor-state-${state}`}>
          {stateText}
        </span>
      )}
    </span>
  )
}
