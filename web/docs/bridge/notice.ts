/**
 * In-frame dialogs the bridge raises on its own (the desktop raises the same ones from the main
 * process, e.g. the "modified by another program" Overwrite/Cancel box in docs-main.ts):
 *   - `ask()`: a choice (save conflict, discard unsaved changes before opening another document),
 *   - `showFatal()`: a blocking notice when the document could not be opened.
 *
 * The box is the shared frame dialog (web/modules/shared/frame-dialog.ts), the same in every
 * module. Strings come from the renderer's app i18n shards in the current UI language.
 */
import { createI18n } from '@genoffice/i18n'
import { appStrings } from '../../../apps/docs/src/renderer/i18n/strings-app'
import { frameAsk, hideFrameNotices, showFrameNotice } from '../../modules/shared/frame-dialog'
import { webLanguage } from './browser'

type AppKey = keyof (typeof appStrings)['zh']

const translate = createI18n(appStrings)

export function text(key: AppKey): string {
  return translate(webLanguage(), key)
}

export interface Choice<T extends string> {
  id: T
  label: AppKey
  primary?: boolean
  /** destructive (e.g. Overwrite): danger styling, never the initial focus */
  danger?: boolean
}

const MARKER_ATTR = 'data-docs-web'
const MASK_CLASS = 'docs-web-backdrop'

// ------------------------------------------------------------ open-dialog tracking

type ModalListener = (open: boolean) => void
let modalListener: ModalListener | null = null
let reportedOpen = false

/** the bridge reports open/closed to the host (protocol `modal`) so it can dim its own chrome */
export function onModalChange(listener: ModalListener | null): void {
  modalListener = listener
  reportedOpen = false
  syncModal()
}

/** read from the DOM, so a dialog removed by anyone (or a reset body) still reports closed */
function syncModal(): void {
  if (typeof document === 'undefined') return
  const open = document.querySelector(`.${MASK_CLASS}`) !== null
  if (open === reportedOpen) return
  reportedOpen = open
  modalListener?.(open)
}

/**
 * Modal choice; resolves with the chosen id, or `cancelId` on Escape. Initial focus is the
 * cancel choice (the safe one), so a stray Enter never runs a destructive action; Tab stays
 * inside the dialog.
 */
export function ask<T extends string>(opts: {
  title: AppKey
  body: AppKey
  choices: Choice<T>[]
  cancelId: T
  marker: string
}): Promise<T> {
  return frameAsk<T>({
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
    markerAttr: MARKER_ATTR,
    maskClass: MASK_CLASS,
    onChange: syncModal,
  })
}

const FATAL = 'fatal'

/** blocking notice over the editor (no buttons: the host decides what happens next) */
export function showFatal(body: AppKey): void {
  hideFatal()
  showFrameNotice({
    title: text('appWebFatalTitle'),
    body: text(body),
    marker: FATAL,
    markerAttr: MARKER_ATTR,
    maskClass: MASK_CLASS,
  })
  syncModal()
}

export function hideFatal(): void {
  hideFrameNotices(FATAL, MARKER_ATTR)
  syncModal()
}
