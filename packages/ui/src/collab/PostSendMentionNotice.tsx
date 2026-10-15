/**
 * G8-18 post-send notice under the comment the user just sent (or edited): mentioned people who could
 * not view the document were not notified. It belongs to the last write only (the panel drops it on the
 * next send), can be dismissed, and offers "Share view access" when the caller may share and the server
 * said `can_share`. A failed share is said out loud and the people stay listed for another try.
 */
import { format } from '@genoffice/i18n'
import { useEffect, useRef, useState } from 'react'
import { announcePolite } from './live-region'
import { canShareView, formatMentionNames } from './mention-query'
import type {
  CollabHostState,
  CollabMention,
  CollabMentionWithoutAccess,
  CollabSource,
} from './types'

/** the catalogue keys the notice reads */
export interface CollabPostSendStrings {
  /** `{names}` */
  collabPostSendNoAccess: string
  collabPostSendShareAction: string
  collabPostSendNoRetroNote: string
  /** `{unshareable}` */
  collabMentionMixedUnshareable: string
  collabSharingView: string
  /** `{failedNames}` */
  collabShareViewFailed: string
  /** the dismiss (×) button */
  collabDismissNotice: string
}

export function PostSendMentionNotice(p: {
  commentId: string
  items: readonly CollabMentionWithoutAccess[]
  mentions: readonly CollabMention[]
  host: CollabHostState
  source: CollabSource
  strings: CollabPostSendStrings
  /** `hadFocus`: focus was inside the notice, so the caller must put it somewhere */
  onDismiss(hadFocus: boolean): void
}) {
  const { commentId, items, mentions, host, source, strings, onDismiss } = p
  const rootRef = useRef<HTMLDivElement>(null)
  const [sharedIds, setSharedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [failedIds, setFailedIds] = useState<readonly string[]>([])
  const [sharing, setSharing] = useState(false)

  const remaining = items.filter((it) => !sharedIds.has(it.user_id))
  const nameOf = (it: CollabMentionWithoutAccess) =>
    it.display_name || mentions.find((m) => m.user_id === it.user_id)?.display_name || it.user_id
  const namesOf = (list: readonly CollabMentionWithoutAccess[]) =>
    formatMentionNames(list.map(nameOf), host.lang)

  const mayShare = canShareView(host, source)
  const shareable = mayShare ? remaining.filter((it) => it.can_share) : []
  const unshareable = mayShare ? remaining.filter((it) => !it.can_share) : []
  const failed = remaining.filter((it) => failedIds.includes(it.user_id))

  const text =
    remaining.length > 0
      ? format(strings.collabPostSendNoAccess, { names: namesOf(remaining) })
      : ''
  // the sentence is announced once when the notice appears, and the share failure when it happens
  useEffect(() => {
    if (text) announcePolite(text)
  }, [text])
  const failedText =
    failed.length > 0 ? format(strings.collabShareViewFailed, { failedNames: namesOf(failed) }) : ''
  useEffect(() => {
    if (failedText) announcePolite(failedText)
  }, [failedText])

  if (remaining.length === 0) return null

  async function handleShare() {
    if (sharing || !source.shareView || shareable.length === 0) return
    setSharing(true)
    const done: string[] = []
    const bad: string[] = []
    try {
      for (const it of shareable) {
        try {
          await source.shareView({ user_id: it.user_id })
          done.push(it.user_id)
        } catch {
          bad.push(it.user_id)
        }
      }
      if (done.length > 0) setSharedIds((prev) => new Set([...prev, ...done]))
      setFailedIds(bad)
    } finally {
      setSharing(false)
    }
  }

  return (
    <div
      ref={rootRef}
      className="collab-post-send-notice"
      role="status"
      data-post-send-for={commentId}
    >
      <p className="collab-post-send-text">{text}</p>
      {unshareable.length > 0 && shareable.length > 0 ? (
        <p className="collab-post-send-sub">
          {format(strings.collabMentionMixedUnshareable, { unshareable: namesOf(unshareable) })}
        </p>
      ) : null}
      {failedText ? <p className="collab-post-send-error">{failedText}</p> : null}
      {shareable.length > 0 ? (
        <>
          <button
            type="button"
            className="collab-btn collab-post-send-share"
            aria-disabled={sharing || undefined}
            onClick={() => void handleShare()}
          >
            {sharing ? strings.collabSharingView : strings.collabPostSendShareAction}
          </button>
          <p className="collab-post-send-retro">{strings.collabPostSendNoRetroNote}</p>
        </>
      ) : null}
      <button
        type="button"
        className="collab-ico collab-post-send-close"
        aria-label={strings.collabDismissNotice}
        onClick={() => onDismiss(rootRef.current?.contains(document.activeElement) ?? false)}
      >
        <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
          <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
    </div>
  )
}
