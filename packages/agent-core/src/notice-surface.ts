import type { AgentStreamNotice } from './types'

/**
 * How a chat panel shows a transport notice (UniWork AI), text only: a status line while the
 * transport waits out a Retry-After (the run keeps going, so the panel offers Stop and no Retry),
 * and notes inside the assistant bubble for a restarted conversation, a provider boundary and a
 * tool call the server dropped. The panels own the markup; this owns which text each notice gets.
 */

/** the UniWork AI panel strings a notice can use (packages/ui `ai-uniwork`) */
export type NoticeKey =
  | 'aiErrRateLimited'
  | 'aiConversationRestarted'
  | 'aiConversationBoundary'
  | 'aiErrViewOnlyEdit'
  | 'aiErrUnsupported'
  | 'aiUniworkOff'

export type NoticeTranslate = (key: NoticeKey, params?: Record<string, string | number>) => string

export interface PanelNote {
  kind: 'restarted' | 'boundary' | 'dropped' | 'off'
  text: string
}

/** the two chat-entry fields a notice writes */
export interface NoticeSurface {
  /** set while the transport waits to resend; cleared by the panel when text, an error or the end arrives */
  waitLine?: string | undefined
  notes?: PanelNote[] | undefined
}

/** the fields to merge into the current assistant entry, or null when the notice shows nothing new */
export function noticePatch(
  current: NoticeSurface,
  notice: AgentStreamNotice,
  tr: NoticeTranslate,
  moduleName: string,
): NoticeSurface | null {
  const notes = current.notes ?? []
  const addNote = (note: PanelNote): NoticeSurface | null =>
    notes.some((n) => n.kind === note.kind && n.text === note.text)
      ? null
      : { notes: [...notes, note] }
  switch (notice.kind) {
    case 'rate-limit-wait':
      return { waitLine: tr('aiErrRateLimited', { seconds: Math.ceil(notice.seconds) }) }
    case 'conversation-restarted':
      return addNote({ kind: 'restarted', text: tr('aiConversationRestarted') })
    case 'conversation-boundary':
      return addNote({
        kind: 'boundary',
        text: tr('aiConversationBoundary', { provider: notice.provider }),
      })
    case 'uniwork-off':
      return addNote({ kind: 'off', text: tr('aiUniworkOff') })
    case 'dropped-tool-calls': {
      let next = notes
      for (const call of notice.calls) {
        const text =
          call.reason === 'view_only'
            ? tr('aiErrViewOnlyEdit')
            : tr('aiErrUnsupported', { module: moduleName })
        if (!next.some((n) => n.kind === 'dropped' && n.text === text))
          next = [...next, { kind: 'dropped', text }]
      }
      return next === notes ? null : { notes: next }
    }
    default:
      // `step` carries nothing to show yet, and a kind this build predates is not an error
      return null
  }
}
