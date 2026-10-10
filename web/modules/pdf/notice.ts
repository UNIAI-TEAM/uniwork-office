/**
 * In-frame dialogs of the PDF web bridge (GO-B4): the save-conflict choice, the merge "add another
 * PDF?" prompt and the blocking open-failure notice. The desktop raises the same moments from the
 * main process (native dialogs). The box is the shared frame dialog (../shared/frame-dialog.ts),
 * the same in every module; strings come from the renderer's web shard in the UI language.
 */
import { createI18n, type Params } from '@genoffice/i18n'
import { webStrings } from '../../../apps/pdf/src/renderer/i18n/strings-web'
import { webLanguage } from '../../docs/bridge/browser'
import { frameAsk, hideFrameNotices, showFrameNotice } from '../shared/frame-dialog'

export type WebKey = keyof (typeof webStrings)['zh']

const translate = createI18n(webStrings)

export function text(key: WebKey, params?: Params): string {
  return translate(webLanguage(), key, params)
}

export interface Choice<T extends string> {
  id: T
  label: WebKey
  primary?: boolean
  /** destructive (Overwrite): never the initial focus */
  danger?: boolean
}

const MARKER_ATTR = 'data-pdf-web'

/** modal choice; resolves with the chosen id, or `cancelId` on Escape */
export function ask<T extends string>(opts: {
  title: WebKey
  body: WebKey
  params?: Params
  choices: Choice<T>[]
  cancelId: T
  marker: string
}): Promise<T> {
  return frameAsk<T>({
    title: text(opts.title),
    body: text(opts.body, opts.params),
    choices: opts.choices.map((c) => ({
      id: c.id,
      label: text(c.label),
      ...(c.primary ? { primary: true } : {}),
      ...(c.danger ? { danger: true } : {}),
    })),
    cancelId: opts.cancelId,
    marker: opts.marker,
    markerAttr: MARKER_ATTR,
  })
}

const FATAL = 'fatal'

/** blocking notice over the viewer (no buttons: the host decides what happens next) */
export function showFatal(body: WebKey): void {
  hideFatal()
  showFrameNotice({
    title: text('webFatalTitle'),
    body: text(body),
    marker: FATAL,
    markerAttr: MARKER_ATTR,
  })
}

export function hideFatal(): void {
  hideFrameNotices(FATAL, MARKER_ATTR)
}
