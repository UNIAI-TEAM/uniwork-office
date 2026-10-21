/**
 * The frame's `comments` claim per module (lane contract G8-11 §2 D4, invariant 8).
 *
 * A frame that claims `comments` in `ready` (and gets it back in the InitAck) is the page's only
 * comments surface: the UniWork page hides its own panel. So a module claims only when the frame
 * covers everything the page panel would show for that format. Markdown and HTML have Discussion
 * only, and the frame Discussion panel covers it. Docs serves its anchored comments (S12) in the
 * editor since G8-12. Sheets, Slides and PDF also have anchored comments, which their frames do not
 * serve yet: they stay off until their in-frame comments land and flip the switch, and the page
 * panel (Comments + Discussion) keeps serving them.
 */
import type { Capabilities, OfficeModule } from '../../../docs/protocol/types'

export const FRAME_COMMENTS: Readonly<Record<OfficeModule, boolean>> = Object.freeze({
  markdown: true,
  html: true,
  docs: true,
  sheets: true,
  slides: false,
  pdf: false,
})

/**
 * the `ready` capability entries of the switch: `comments` only when on. G8-18: the frame also claims
 * `commentsShareView` with it (it serves the pre-send dialog and the post-send notice); the effective
 * capability stays frame AND host grant, and the host grants it only to a caller who may share.
 * UNI-2033: the same for `commentsViewVersion` (the "view that version" action on a lost anchor); the
 * host never grants it inside a version view.
 */
export function frameCommentsClaim(on: boolean): Capabilities {
  return on ? { comments: true, commentsShareView: true, commentsViewVersion: true } : {}
}
