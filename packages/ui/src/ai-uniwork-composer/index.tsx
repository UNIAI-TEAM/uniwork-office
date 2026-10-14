import './ai-uniwork-composer.css'
import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { Lang } from '@genoffice/i18n'
import type { ComposerNote, ComposerNoteAction } from '@genoffice/ai-provider/browser'
import { aiUniworkText, type AiUniworkStringKey } from '../strings-ai-uniwork'
import { useUniworkDisclosureAck, type UniworkAckKey } from './ack-store'

export {
  UNIWORK_ACK_STORAGE_KEY,
  ack,
  clearUniworkAcks,
  isAcked,
  serializeUniworkAckKey,
  subscribeUniworkAck,
  useUniworkDisclosureAck,
  type UniworkAckKey,
} from './ack-store'

export type UniworkDisclosureVariant = 'document' | 'local'

/** Resolves the localized body text for a `ComposerNote` */
export function resolveComposerNoteText(note: ComposerNote, lang: Lang = 'vi'): string {
  if (note.text) return note.text
  return aiUniworkText(lang, note.key)
}

export interface UniworkComposerNoteProps {
  /** Resolved composer note from `composerNoteFor`; renders nothing when `null` */
  readonly note: ComposerNote | null | undefined
  /** UI language for translating `ai-uniwork` keys and action labels (default `'vi'`) */
  readonly lang?: Lang | undefined
  /** Current provider id; changing away from `'uniwork'` clears the note */
  readonly provider?: string | undefined
  /** Invoked when the user clicks the note's action button (also clears the note) */
  readonly onAction?: ((action: ComposerNoteAction, note: ComposerNote) => void) | undefined
  /** Invoked when the user clicks "Chọn nhà cung cấp khác" (`aiRunChooseOther`) */
  readonly onChooseProvider?: (() => void) | undefined
  /** Alias for `onChooseProvider` */
  readonly onChooseOtherProvider?: (() => void) | undefined
  /** Invoked when the user clicks "Đăng nhập" (`acctSignIn`) on a `signed-out` note */
  readonly onSignIn?: (() => void) | undefined
  /** Optional callback to write the note text once into an external polite live region */
  readonly onAnnounce?: ((text: string) => void) | undefined
}

/**
 * S7–S9 Composer note above the composer (one at a time, no auto-hide, clears on action or
 * provider change, announced once through a persistent polite live region).
 */
export function UniworkComposerNote({
  note,
  lang = 'vi',
  provider = 'uniwork',
  onAction,
  onChooseProvider,
  onChooseOtherProvider,
  onSignIn,
  onAnnounce,
}: UniworkComposerNoteProps): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState<{ provider: string; kind: string } | null>(null)
  const [localLiveText, setLocalLiveText] = useState('')
  const prevProviderRef = useRef(provider)

  useEffect(() => {
    if (prevProviderRef.current !== provider) {
      prevProviderRef.current = provider
      setDismissed(null)
    }
  }, [provider])

  const isDismissed =
    dismissed !== null &&
    dismissed.provider === provider &&
    note !== null &&
    note !== undefined &&
    dismissed.kind === note.kind

  const visibleNote = note && provider === 'uniwork' && !isDismissed ? note : null
  const bodyText = visibleNote ? resolveComposerNoteText(visibleNote, lang) : ''

  useEffect(() => {
    if (!bodyText) return
    if (onAnnounce) {
      onAnnounce(bodyText)
    } else {
      setLocalLiveText(bodyText)
    }
  }, [bodyText, onAnnounce])

  if (!visibleNote) {
    return onAnnounce ? null : (
      <div className="ai-uniwork-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {localLiveText}
      </div>
    )
  }

  const actionLabel =
    visibleNote.action === 'sign-in'
      ? aiUniworkText(lang, 'acctSignIn')
      : aiUniworkText(lang, 'aiRunChooseOther')

  const handleActionClick = () => {
    setDismissed({ provider, kind: visibleNote.kind })
    onAction?.(visibleNote.action, visibleNote)
    if (visibleNote.action === 'sign-in') {
      onSignIn?.()
    } else {
      onChooseProvider?.()
      onChooseOtherProvider?.()
    }
  }

  return (
    <>
      {!onAnnounce && (
        <div className="ai-uniwork-sr-only" role="status" aria-live="polite" aria-atomic="true">
          {localLiveText}
        </div>
      )}
      <div className="ai-uniwork-composer-note" data-note-kind={visibleNote.kind}>
        <span className="ai-uniwork-composer-note-text">{bodyText}</span>
        <button
          type="button"
          className="ai-uniwork-composer-note-action"
          onClick={handleActionClick}
        >
          {actionLabel}
        </button>
      </div>
    </>
  )
}

export interface UniworkDisclosureProps {
  /** Ack key `{ account, org, document | 'local' }`; when provided, reads/updates the ack store */
  readonly ackKey?: UniworkAckKey | null | undefined
  /** Explicit override for whether acknowledgment is still required */
  readonly needsAck?: boolean | undefined
  /** Organization display name for the `{org}` slot */
  readonly orgName?: string | undefined
  /** `'document'` (default) or `'local'` (`aiUniworkLocalFile` + G05BE-6 restart notice) */
  readonly variant?: UniworkDisclosureVariant | undefined
  /** UI language (default `'vi'`) */
  readonly lang?: Lang | undefined
  /** DOM id of the disclosure sentence element (referenced by Send's `aria-describedby`) */
  readonly sentenceId?: string | undefined
  /** Ref to the disclosure `role="region"` element (focused when clicking Send while unacked) */
  readonly regionRef?: React.RefObject<HTMLElement | null> | undefined
  /** Called when the user clicks "Đã hiểu" (`aiUniworkAck`) */
  readonly onAck?: (() => void) | undefined
  /** Called when the user clicks "Tìm hiểu thêm" (`aiUniworkLearnMore`) */
  readonly onLearnMore?: (() => void) | undefined
  /** If true (default false when rendered standalone above composer), also renders the post-ack short line */
  readonly showShortWhenAcked?: boolean | undefined
  /** Optional callback to write the disclosure text once into an external polite live region */
  readonly onAnnounce?: ((text: string) => void) | undefined
}

/**
 * S8/S10 AI disclosure region above the composer (`role="region"`, `aria-label=aiUniworkDisclosureLabel`,
 * `tabIndex=-1`, never steals focus on appear, read polite).
 */
export function UniworkDisclosure({
  ackKey,
  needsAck,
  orgName,
  variant = 'document',
  lang = 'vi',
  sentenceId,
  regionRef,
  onAck,
  onLearnMore,
  showShortWhenAcked = false,
  onAnnounce,
}: UniworkDisclosureProps): React.JSX.Element | null {
  const autoId = useId()
  const resolvedSentenceId = sentenceId ?? `ai-uniwork-disclosure-sentence-${autoId}`
  const { acked, acknowledge } = useUniworkDisclosureAck(ackKey)
  const shouldShow = needsAck ?? (ackKey ? !acked : true)
  const [localLiveText, setLocalLiveText] = useState('')

  const org = orgName?.trim() || 'UniWork'
  const primaryText =
    variant === 'local'
      ? aiUniworkText(lang, 'aiUniworkLocalFile', { org })
      : aiUniworkText(lang, 'aiUniworkDisclosure', { org })
  const restartText = variant === 'local' ? aiUniworkText(lang, 'aiUniworkLocalFileRestart') : ''
  const fullText = restartText ? `${primaryText} ${restartText}` : primaryText

  useEffect(() => {
    if (!shouldShow) return
    if (onAnnounce) {
      onAnnounce(fullText)
    } else {
      setLocalLiveText(fullText)
    }
  }, [shouldShow, fullText, onAnnounce])

  const setRegionNode = useCallback(
    (node: HTMLDivElement | null) => {
      if (regionRef && 'current' in regionRef) {
        ;(regionRef as React.MutableRefObject<HTMLElement | null>).current = node
      }
    },
    [regionRef],
  )

  if (!shouldShow) {
    if (showShortWhenAcked) {
      return <UniworkDisclosureShort orgName={org} variant={variant} lang={lang} />
    }
    return null
  }

  return (
    <>
      {!onAnnounce && (
        <div className="ai-uniwork-sr-only" role="status" aria-live="polite" aria-atomic="true">
          {localLiveText}
        </div>
      )}
      <div
        ref={setRegionNode}
        className="ai-uniwork-disclosure"
        role="region"
        aria-label={aiUniworkText(lang, 'aiUniworkDisclosureLabel')}
        tabIndex={-1}
      >
        <p id={resolvedSentenceId} className="ai-uniwork-disclosure-body">
          {primaryText}
          {restartText ? (
            <span className="ai-uniwork-disclosure-restart"> {restartText}</span>
          ) : null}
        </p>
        <div className="ai-uniwork-disclosure-actions">
          <button
            type="button"
            className="ai-uniwork-disclosure-ack"
            aria-describedby={resolvedSentenceId}
            onClick={() => {
              acknowledge()
              onAck?.()
            }}
          >
            {aiUniworkText(lang, 'aiUniworkAck')}
          </button>
          <button
            type="button"
            className="ai-uniwork-disclosure-learn"
            onClick={() => onLearnMore?.()}
          >
            {aiUniworkText(lang, 'aiUniworkLearnMore')}
          </button>
        </div>
      </div>
    </>
  )
}

export interface UniworkDisclosureShortProps {
  /** Organization display name for the `{org}` slot */
  readonly orgName?: string | undefined
  /** `'document'` (default) or `'local'` (includes G05BE-6 local-file conversation restart notice) */
  readonly variant?: UniworkDisclosureVariant | undefined
  /** UI language (default `'vi'`) */
  readonly lang?: Lang | undefined
}

/**
 * Permanent post-acknowledgment sub-line under the composer (`aiUniworkDisclosureShort`).
 */
export function UniworkDisclosureShort({
  orgName,
  variant = 'document',
  lang = 'vi',
}: UniworkDisclosureShortProps): React.JSX.Element {
  const org = orgName?.trim() || 'UniWork'
  const shortText = aiUniworkText(lang, 'aiUniworkDisclosureShort', { org })
  const restartText = variant === 'local' ? aiUniworkText(lang, 'aiUniworkLocalFileRestart') : ''
  return (
    <div className="ai-uniwork-disclosure-short">
      {shortText}
      {restartText ? ` ${restartText}` : ''}
    </div>
  )
}

export interface AiComposerUniworkDisclosureConfig {
  /** Ack key `{ account, org, document | 'local' }`; when provided, `AiComposer` tracks `isAcked`/`ack` */
  readonly ackKey?: UniworkAckKey | null | undefined
  /** Explicit unacked state override (when `ackKey` is not used or controlled externally) */
  readonly needsAck?: boolean | undefined
  /** Organization display name for `{org}` */
  readonly orgName?: string | undefined
  /** `'document'` (default) or `'local'` (`aiUniworkLocalFile` + G05BE-6 restart notice) */
  readonly variant?: UniworkDisclosureVariant | undefined
  /** DOM id of an externally rendered `<UniworkDisclosure>` sentence element */
  readonly sentenceId?: string | undefined
  /** Ref to an externally rendered `<UniworkDisclosure>` region element */
  readonly regionRef?: React.RefObject<HTMLElement | null> | undefined
  /** Called when the user clicks Send while unacked so an external disclosure region can take focus */
  readonly onRequestFocus?: (() => void) | undefined
  /** Called when the user clicks "Đã hiểu" (`aiUniworkAck`) */
  readonly onAck?: (() => void) | undefined
  /** Called when the user clicks "Tìm hiểu thêm" (`aiUniworkLearnMore`) */
  readonly onLearnMore?: (() => void) | undefined
  /**
   * When true (default true), `AiComposer` renders `<UniworkDisclosure>` above the input box
   * and `<UniworkDisclosureShort>` below it. Set `false` if the panel mounts them itself.
   */
  readonly renderInline?: boolean | undefined
}

export interface AiComposerUniworkProps {
  /** Whether UniWork AI (`uniwork`) is the active provider (default true when `uniwork` object is passed) */
  readonly active?: boolean | undefined
  /** Current provider id (used to clear the composer note on provider change) */
  readonly provider?: string | undefined
  /** UI language for `ai-uniwork` strings (default `'vi'`) */
  readonly lang?: Lang | undefined
  /** Active composer note above the composer (from `composerNoteFor`) */
  readonly note?: ComposerNote | null | undefined
  /** Invoked when the user clicks the composer note's action button */
  readonly onNoteAction?: ((action: ComposerNoteAction, note: ComposerNote) => void) | undefined
  /** Invoked when the user clicks "Chọn nhà cung cấp khác" on a composer note */
  readonly onChooseProvider?: (() => void) | undefined
  /** Alias for `onChooseProvider` */
  readonly onChooseOtherProvider?: (() => void) | undefined
  /** Invoked when the user clicks "Đăng nhập" on a `signed-out` composer note */
  readonly onSignIn?: (() => void) | undefined
  /** S8/S10 disclosure configuration and state */
  readonly disclosure?: AiComposerUniworkDisclosureConfig | undefined
  /** Renders the `aiUniworkViewOnly` sub-line under the composer (co-exists with `note`) */
  readonly viewOnly?: boolean | undefined
  /** Explicit flag indicating a popup/listbox/dialog is open (guards `Escape` from stopping a run) */
  readonly popupOpen?: boolean | undefined
  /** Optional override keys for Send/Stop labels (defaults to `'aiRunSend'` / `'aiRunStop'`) */
  readonly sendLabelKey?: AiUniworkStringKey | undefined
  readonly stopLabelKey?: AiUniworkStringKey | undefined
  /** Optional callback to mirror polite live announcements to a panel/window live node */
  readonly onAnnounce?: ((text: string) => void) | undefined
}

/** True when `el` is hidden from view or from assistive tech (own attributes or inline style). */
function isHiddenElement(el: Element): boolean {
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true
  const style = (el as HTMLElement).style
  return style?.display === 'none' || style?.visibility === 'hidden'
}

/**
 * Checks whether a popup owned by the composer is open inside `root`, blocking `Escape` from
 * stopping a run. Persistent ribbon/toolbar listboxes, inline collapsible sections
 * (`AiQueueStrip`) and inline menus that are hidden or whose owner is collapsed never block it.
 * A popup counts when it is a known composer popup (`.ai-model-pop`, `.gs-dd-pop`, rendered only
 * while open), an expanded `aria-haspopup` trigger, a visible modal dialog, or a visible
 * listbox/menu/dialog whose `aria-controls` owner is expanded.
 */
export function isComposerPopupOpen(root?: Document | Element | null): boolean {
  const docOrEl = root ?? (typeof document !== 'undefined' ? document : null)
  if (!docOrEl) return false
  const composerRoot =
    typeof Element !== 'undefined' && docOrEl instanceof Element
      ? docOrEl
      : docOrEl.querySelector('.ai-input-box')
  if (!composerRoot) return false
  if (
    composerRoot.querySelector(
      '[aria-haspopup][aria-expanded="true"], .ai-model-pop, .gs-dd-pop',
    ) !== null
  ) {
    return true
  }
  for (const popup of composerRoot.querySelectorAll(
    '[role="listbox"], [role="menu"], [role="dialog"]',
  )) {
    if (isHiddenElement(popup)) continue
    if (popup.getAttribute('role') === 'dialog' && popup.getAttribute('aria-modal') === 'true') {
      return true
    }
    const id = popup.id
    if (!id) continue
    const owner = [...composerRoot.querySelectorAll('[aria-controls]')].find((el) =>
      (el.getAttribute('aria-controls') ?? '').split(/\s+/).includes(id),
    )
    if (owner?.getAttribute('aria-expanded') === 'true') return true
  }
  return false
}
