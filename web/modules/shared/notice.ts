/**
 * In-frame dialogs of the text-module bridges (Markdown, HTML), the counterpart of the Docs
 * frame's web/docs/bridge/notice.ts:
 *   - `ask()`: a choice (save conflict: Cancel / Reload latest / Overwrite),
 *   - `showFatal()`: a blocking notice when the document could not be opened.
 *
 * The box is the shared frame dialog (./frame-dialog.ts), so it looks like the host's own dialogs
 * in every module. Strings: ./i18n/strings-web.ts in the UI language.
 */
import { webLanguage } from '../../docs/bridge/browser'
import { frameAsk, hideFrameNotices, showFrameNotice } from './frame-dialog'
import { webText, type WebStringKey } from './i18n/strings-web'

export function text(key: WebStringKey): string {
  return webText(webLanguage(), key)
}

export interface Choice<T extends string> {
  id: T
  label: WebStringKey
  primary?: boolean
  /** destructive (Overwrite, Discard): never the initial focus */
  danger?: boolean
}

/** modal choice; resolves with the chosen id, or `cancelId` on Escape */
export function ask<T extends string>(opts: {
  title: WebStringKey
  body: WebStringKey
  choices: Choice<T>[]
  cancelId: T
  marker: string
  /** extra lines under the body (already translated: names, times) */
  details?: readonly string[]
  /** extra class on the backdrop (see frame-dialog.css) */
  maskClass?: string
}): Promise<T> {
  return frameAsk<T>({
    title: text(opts.title),
    body: text(opts.body),
    ...(opts.details ? { details: opts.details } : {}),
    choices: opts.choices.map((c) => ({
      id: c.id,
      label: text(c.label),
      ...(c.primary ? { primary: true } : {}),
      ...(c.danger ? { danger: true } : {}),
    })),
    cancelId: opts.cancelId,
    marker: opts.marker,
    ...(opts.maskClass ? { maskClass: opts.maskClass } : {}),
  })
}

const FATAL = 'fatal'

/** blocking notice over the editor (no buttons: the host decides what happens next) */
export function showFatal(body: WebStringKey): void {
  hideFatal()
  showFrameNotice({ title: text('webFatalTitle'), body: text(body), marker: FATAL })
}

export function hideFatal(): void {
  hideFrameNotices(FATAL)
}
