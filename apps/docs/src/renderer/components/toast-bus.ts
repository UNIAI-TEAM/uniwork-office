/** Toast event bus, split from the ToastHost component so this module has no
 * component exports: React Fast Refresh replaces mixed-export modules wholesale,
 * which strands callers (file-actions) on a stale emitter during dev HMR. */

import { statusText, type StatusLine, type StringKey, type TFunc } from '../i18n/locale'

export interface ToastData {
  text: string
  kind: 'success' | 'error' | 'info'
}

let emit: ((toast: ToastData) => void) | null = null

/** Registered by ToastHost on mount; null while unmounted. */
export function setToastEmitter(fn: ((toast: ToastData) => void) | null): void {
  emit = fn
}

let lastText = ''
let lastAt = 0

export function showToast(text: string, kind: ToastData['kind'] = 'success'): void {
  lastText = text
  lastAt = Date.now()
  emit?.({ text, kind })
}

/**
 * The status line as a toast (phone widths hide the status message in the bar). An action that
 * already toasted the same text (a failed save) keeps its own toast and kind.
 */
export function showStatusToast(text: string): void {
  if (!text || (text === lastText && Date.now() - lastAt < 5000)) return
  showToast(text, 'info')
}

/** the width at and below which the status bar drops its message (styles.css) */
export const NARROW_STATUS_QUERY = '(max-width: 640px)'

export function isNarrowStatusFrame(): boolean {
  return !!window.matchMedia?.(NARROW_STATUS_QUERY).matches
}

/**
 * Status lines that are progress or housekeeping, not an outcome: they stay in the bar and never
 * toast (a toast per export image, an autosave clock every 30 s, "Saving…" before "Saved"). Only
 * a keyed line (`{ key }`) can be recognised; ready text is always an outcome.
 */
const QUIET_STATUS_KEYS: ReadonlySet<StringKey> = new Set<StringKey>([
  'appSaving',
  'appSavingAs',
  'appAutoSavedAt',
  'appExportingPdf',
  'appExportingHtml',
  'appExportingImages',
  'appExportImagesProgress',
  'appMixedExportOpening',
  'appOpenedFile',
])

export function isOutcomeStatus(line: StatusLine): boolean {
  return !!line && (typeof line === 'string' || !QUIET_STATUS_KEYS.has(line.key))
}

/** App's status -> toast bridge: outcome lines only, and only where the bar hides the message */
export function toastStatusLine(line: StatusLine, tr: TFunc): void {
  if (!isOutcomeStatus(line) || !isNarrowStatusFrame()) return
  showStatusToast(statusText(line, tr))
}
