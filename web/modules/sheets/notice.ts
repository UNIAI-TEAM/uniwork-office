/**
 * In-frame choices the Sheets bridge raises itself (UNI-1016): the save conflict
 * (Overwrite / Reload latest / Cancel, like the Docs bridge and the desktop's "modified by another
 * program" box) and "discard unsaved changes?" before another workbook replaces this one.
 *
 * The box is the shared frame dialog (../shared/frame-dialog.ts), the same in every module.
 * Strings come from the Sheets app i18n shards (`appWeb*`) in the current UI language.
 */
import { createI18n } from '@genoffice/i18n'
import { appStrings } from '../../../apps/sheets/src/renderer/i18n/strings-app'
import { showToast } from '../../../apps/sheets/src/renderer/toast-bus'
import { webLanguage } from '../../docs/bridge/browser'
import { frameAsk } from '../shared/frame-dialog'

export type SheetsAppKey = keyof (typeof appStrings)['zh']

const translate = createI18n(appStrings)

export function text(key: SheetsAppKey): string {
  return translate(webLanguage(), key)
}

export interface Choice<T extends string> {
  id: T
  label: SheetsAppKey
  primary?: boolean
  /** destructive (Overwrite, Discard): never the initial focus */
  danger?: boolean
}

export interface AskOptions<T extends string> {
  title: SheetsAppKey
  body: SheetsAppKey
  choices: Choice<T>[]
  cancelId: T
  /** `data-sheets-web` marker, for tests and e2e */
  marker: string
}

export type AskFn = <T extends string>(opts: AskOptions<T>) => Promise<T>

/** modal choice; resolves with the chosen id, or `cancelId` on Escape */
export const ask: AskFn = <T extends string>(opts: AskOptions<T>) =>
  frameAsk<T>({
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
    markerAttr: 'data-sheets-web',
  })

/**
 * The engine stopped and was restarted (a Rust panic aborts the wasm instance, SH3): the open
 * workbook was reopened from its last saved bytes, so the user hears about it as a toast in the
 * Sheets renderer's own toast host. Nothing is said when no workbook was open.
 */
export function notifyEngineRecovered(recovery: { sessions: number }): void {
  if (recovery.sessions === 0) return
  showToast(text('appWebEngineRestarted'), 'error')
}

/**
 * The host stored a save, but the engine could not reopen the saved bytes (the session swap
 * failed, e.g. out of memory): nothing is lost, the editor just has to be reloaded.
 */
export function notifySavedReopenFailed(): void {
  showToast(text('appWebSavedReopenFailed'), 'error')
}
