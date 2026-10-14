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
  | 'aiUniworkProvider'

export type NoticeTranslate = (key: NoticeKey, params?: Record<string, string | number>) => string

export interface PanelNote {
  kind: 'restarted' | 'boundary' | 'dropped' | 'off'
  text: string
}

/**
 * A turn whose notes are the whole answer: a restarted conversation (the question was not sent) and
 * UniWork AI being off. Neither is a failure, so the panel shows no error, no empty-reply line and no Retry.
 */
export function endsQuietly(notes: readonly PanelNote[] | undefined): boolean {
  return !!notes?.some((n) => n.kind === 'restarted' || n.kind === 'off')
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
        // the adapter names the new conversation's provider by id; 'uniwork' reads as the product name
        text: tr('aiConversationBoundary', {
          provider: notice.provider === 'uniwork' ? tr('aiUniworkProvider') : notice.provider,
        }),
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

/**
 * For a panel whose chat message is a single text (sheets): the notices are folded into that text.
 * Order: notes, then the wait line, then the answer. The wait line goes away when the turn resets
 * or text arrives; notes stay for the run. `compose(raw)` is the display text for a raw answer.
 */
export interface TextNoticeSurface {
  /** a transport notice; returns the display text for the current raw answer, or null when nothing changed */
  notice(notice: AgentStreamNotice, tr: NoticeTranslate, moduleName: string): string | null
  /** streamed (cumulative) answer text: ends a wait */
  text(raw: string): string
  /** the transport restarted the turn */
  reset(): string
  /** display text for a final answer (notes above it); the wait is over */
  compose(raw: string): string
  /** the conversation was restarted and the question not sent: an empty answer is on purpose */
  restarted(): boolean
  /** the notes are the whole answer (restarted, or UniWork AI off): an empty answer is on purpose */
  quiet(): boolean
  /** a new run starts */
  clear(): void
}

export function createTextNoticeSurface(): TextNoticeSurface {
  let notes: PanelNote[] = []
  let waitLine: string | undefined
  let raw = ''
  const display = (): string =>
    [...notes.map((n) => n.text), waitLine, raw]
      .filter((part): part is string => !!part)
      .join('\n\n')
  return {
    notice(notice, tr, moduleName) {
      const patch = noticePatch({ waitLine, notes }, notice, tr, moduleName)
      if (!patch) return null
      if (patch.notes) notes = [...patch.notes]
      if ('waitLine' in patch) waitLine = patch.waitLine
      return display()
    },
    text(next) {
      raw = next
      waitLine = undefined
      return display()
    },
    reset() {
      raw = ''
      waitLine = undefined
      return display()
    },
    compose(final) {
      raw = final
      waitLine = undefined
      return display()
    },
    restarted: () => notes.some((n) => n.kind === 'restarted'),
    quiet: () => endsQuietly(notes),
    clear() {
      notes = []
      waitLine = undefined
      raw = ''
    },
  }
}
