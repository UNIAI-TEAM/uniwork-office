import { useId } from 'react'
import { useI18n } from './locale'

/** The module an attachment came from; the names follow the web (Chat, Tasks, Meetings, Email). */
export type SourceViewOrigin = 'chat' | 'task' | 'meeting' | 'email'

export interface UniworkSourceViewState {
  /** file name, shown by the tab itself (kept here so the tab and the chip read one state) */
  name: string
  origin: SourceViewOrigin
  /** title of the chat / task / meeting / email the file is attached to, when it has one */
  parentTitle?: string | null
}

const ORIGIN_KEY = {
  chat: 'uwSourceOriginChat',
  task: 'uwSourceOriginTask',
  meeting: 'uwSourceOriginMeeting',
  email: 'uwSourceOriginEmail',
} as const

/**
 * "View only · From Chat" for a source file opened in an editor tab: an attachment of a chat, task,
 * meeting or email that carries no UniWork document. Same pill as the view-only save chip (neutral
 * tone, dot + label, native title tooltip, the sentence once more for a screen reader), no button:
 * there is nothing to resolve, the way to a copy is Download in the Documents list.
 */
export function UniworkSourceViewChip({ state }: { state: UniworkSourceViewState | null }) {
  const { t } = useI18n()
  const tipId = useId()
  if (!state) return null
  const origin = t(ORIGIN_KEY[state.origin])
  const parentTitle = state.parentTitle?.trim()
  const label = t('uwChipSourceView', { origin })
  const tip = t('uwTipSourceView', { origin, parent: parentTitle ? ` · ${parentTitle}` : '' })
  return (
    <div
      className="uw-pill"
      role="group"
      aria-label={label}
      aria-describedby={tipId}
      title={tip}
      data-tone="neutral"
      data-state="view-only"
    >
      <span id={tipId} className="uw-sr-only">
        {tip}
      </span>
      <span className="uw-pill-status">
        <span className="uw-pill-dot" aria-hidden="true" />
        <span className="uw-pill-label">{label}</span>
      </span>
    </div>
  )
}
