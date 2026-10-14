import type React from 'react'
import type { Lang } from '@genoffice/i18n'
import type { ComposerNote, ComposerNoteAction } from '@genoffice/ai-provider/browser'
import type { AiUniworkStringKey } from '../strings-ai-uniwork'
import type { UniworkAckKey } from './ack-store'

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
export function UniworkComposerNote(_props: UniworkComposerNoteProps): React.JSX.Element | null {
  return null
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
export function UniworkDisclosure(_props: UniworkDisclosureProps): React.JSX.Element | null {
  return null
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
export function UniworkDisclosureShort(
  _props: UniworkDisclosureShortProps,
): React.JSX.Element | null {
  return null
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
   * When true (default true unless `external` is set), `AiComposer` renders `<UniworkDisclosure>`
   * above the input box and `<UniworkDisclosureShort>` below it. Set `false` if the panel mounts
   * `<UniworkDisclosure>` and `<UniworkDisclosureShort>` itself.
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

/** Checks whether any popup/listbox/dialog/menu is open in `root`, blocking `Escape` from stopping a run */
export function isComposerPopupOpen(_root?: Document | Element | null): boolean {
  return false
}
