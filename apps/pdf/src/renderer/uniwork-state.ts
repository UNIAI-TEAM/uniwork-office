import { platform } from './capabilities'

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

/**
 * The bound answer the AI layer reads (skill C-BOUND filter + guard). A web frame
 * IS the UniWork document (web/modules/pdf/install.ts), but its adapter still
 * answers `bound: false`: the save path, server comments and the Save button are
 * keyed off the working-copy state, and the desktop semantics of `bound` (force a
 * clean Save, drop file notes, autosave off) do not apply there. The frame's
 * capabilities carry `platform: 'web'` (module-bridge.ts), the smallest seam that
 * marks the document UniWork-owned for the AI without touching those consumers.
 */
export function pdfUniworkBoundForAi(state: PdfUniworkState): boolean {
  return state.bound || platform() === 'web'
}
