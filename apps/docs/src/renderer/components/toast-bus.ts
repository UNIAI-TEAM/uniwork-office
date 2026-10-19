/** Toast event bus, split from the ToastHost component so this module has no
 * component exports: React Fast Refresh replaces mixed-export modules wholesale,
 * which strands callers (file-actions) on a stale emitter during dev HMR. */

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
