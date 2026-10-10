/**
 * In-frame dialogs of the Slides web module: what the desktop raises from the main process
 * with dialog.showMessageBox (chart simplification, media warnings: HostIO.confirm) and the
 * bridge's own prompts (save conflict, unsaved changes, fatal open). The box is the shared frame
 * dialog (../shared/frame-dialog.ts), the same in every module. Bridge-owned strings come from the
 * renderer's `web` i18n shards in the UI language.
 */
import { createI18n } from '@genoffice/i18n'
import { webStrings } from '../../../apps/slides/src/renderer/i18n/strings-web'
import { webLanguage } from '../../docs/bridge/browser'
import { frameAsk, hideFrameNotices, showFrameNotice } from '../shared/frame-dialog'

export type WebKey = keyof (typeof webStrings)['zh']

const translate = createI18n(webStrings)

export function text(key: WebKey): string {
  return translate(webLanguage(), key)
}

const MARKER = 'data-slides-web'

/**
 * Modal choice with literal strings; resolves with the index of the chosen button, `cancelId`
 * on Escape. `defaultId` gets the primary style and the initial focus.
 */
export function choose(opts: {
  title: string
  body: string
  buttons: readonly string[]
  defaultId?: number
  cancelId?: number
  marker: string
}): Promise<number> {
  const cancelId = opts.cancelId ?? opts.buttons.length - 1
  const defaultId = opts.defaultId ?? 0
  return frameAsk<string>({
    title: opts.title,
    body: opts.body,
    choices: opts.buttons.map((label, i) => ({
      id: String(i),
      label,
      ...(i === defaultId ? { primary: true } : {}),
    })),
    cancelId: String(cancelId),
    focusId: String(defaultId),
    marker: opts.marker,
    markerAttr: MARKER,
  }).then(Number)
}

/** choose() over bridge-owned strings; resolves with the chosen id */
export async function ask<T extends string>(opts: {
  title: WebKey
  body: WebKey
  choices: ReadonlyArray<{ id: T; label: WebKey; primary?: boolean; danger?: boolean }>
  cancelId: T
  marker: string
}): Promise<T> {
  const choice = await frameAsk<T>({
    title: text(opts.title),
    body: text(opts.body),
    choices: opts.choices.map((c) => ({
      id: c.id,
      label: text(c.label),
      ...(c.primary ? { primary: true } : {}),
      ...(c.danger ? { danger: true } : {}),
    })),
    cancelId: opts.cancelId,
    marker: opts.marker,
    markerAttr: MARKER,
  })
  return choice
}

const FATAL = 'fatal'

/** blocking notice over the editor (no buttons: the host decides what happens next) */
export function showFatal(body: WebKey): void {
  hideFatal()
  showFrameNotice({
    title: text('webFatalTitle'),
    body: text(body),
    marker: FATAL,
    markerAttr: MARKER,
  })
}

export function hideFatal(): void {
  hideFrameNotices(FATAL, MARKER)
}
