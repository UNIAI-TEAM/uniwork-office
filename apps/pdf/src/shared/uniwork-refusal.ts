/**
 * Why main refuses a pdf:save on a UniWork copy. Shared so the renderer can tell
 * a deliberate refusal (a view-only document, or an autosave tick that landed
 * before the renderer learned the document is bound) from a real write failure.
 */
export const PDF_UNIWORK_VIEW_ONLY = 'pdf: document is view only'
export const PDF_UNIWORK_AUTOSAVE_OFF = 'pdf: autosave is off for this document'

export function isUniworkRefusal(error: string | undefined): boolean {
  return error === PDF_UNIWORK_VIEW_ONLY || error === PDF_UNIWORK_AUTOSAVE_OFF
}
