import type { PdfUniworkState } from '../shared/ipc'

/** A plain local file: not bound, editable */
export const PLAIN_PDF_STATE: PdfUniworkState = { bound: false, readOnly: false }

/**
 * Ask main whether `path` is a UniWork copy. The browser harness may not
 * expose the method, and the call may fail: either answer reads as a plain
 * local file (main still refuses a write it must not allow).
 */
export async function queryPdfUniworkState(
  api: { uniworkState?: (path: string) => Promise<PdfUniworkState> },
  path: string,
): Promise<PdfUniworkState> {
  try {
    const state = await api.uniworkState?.(path)
    return { bound: state?.bound === true, readOnly: state?.readOnly === true }
  } catch {
    return PLAIN_PDF_STATE
  }
}
