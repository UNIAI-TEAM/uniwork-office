/**
 * View-only grid lock (web frame without the host's `save` grant, UNI-1016 SH3).
 *
 * Without the save grant every save path is already refused (save-actions.ts, the bridge); this
 * keeps the grid itself from being edited, so nobody types into a workbook that can never be
 * saved. A command guard cancels every command the sheet-protection guard knows as an edit, a
 * format, a structure or a sort/filter change, plus the sheet-level commands (insert, remove,
 * copy, rename, reorder, tab colour). Loader writes run under `journalSuppression` and pass
 * through, as they do for sheet protection, so streamed rows still land in the grid.
 *
 * Why not `FWorkbook.setEditable(false)`: it withdraws Univer's workbook edit permission, which
 * Univer's permission controller enforces on EVERY SetRangeValues command, including the loader's
 * own writes of streamed rows (they would throw), and it answers each refused edit with Univer's
 * modal "no permission" dialog (unlocalized to the host language, blocks the page). The guard is
 * the equivalent lock without either effect, and its notice is the app's own localized toast.
 */
import { isViewOnly } from './capabilities'
import { t } from './i18n/locale'
import { commandGuardKind } from './sheet-protection'
import { journalSuppression, type UniverRuntime } from './univer-state'

/** workbook-level commands outside the sheet-protection lists */
const SHEET_TAB_COMMANDS: ReadonlySet<string> = new Set([
  'sheet.command.insert-sheet',
  'sheet.command.remove-sheet',
  'sheet.command.copy-sheet',
  'sheet.command.set-worksheet-name',
  'sheet.command.set-worksheet-order',
  'sheet.command.set-tab-color',
])

/** the same message is not shown again within this window (held keys, drag handles) */
const NOTIFY_INTERVAL_MS = 3_000

/** the commands a view-only grid refuses (everything that would change the workbook) */
export function isViewOnlyBlocked(commandId: string, params?: Record<string, unknown>): boolean {
  if (commandId === 'sheet.operation.set-cell-edit-visible') return params?.visible === true
  return commandGuardKind(commandId) !== undefined || SHEET_TAB_COMMANDS.has(commandId)
}

export function installViewOnlyGuard(
  runtime: UniverRuntime,
  notify: (message: string) => void,
): { dispose(): void } {
  let lastNotice = 0
  return runtime.univerAPI.addEvent(runtime.univerAPI.Event.BeforeCommandExecute, (event) => {
    if (!isViewOnly() || journalSuppression.active) return
    if (!isViewOnlyBlocked(event.id, (event.params ?? {}) as Record<string, unknown>)) return
    event.cancel = true
    const now = Date.now()
    if (now - lastNotice < NOTIFY_INTERVAL_MS) return
    lastNotice = now
    notify(t('appWebViewOnly'))
  })
}
