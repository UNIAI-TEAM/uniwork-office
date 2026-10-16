/**
 * The panel and App talk about saving after an AI run through window events (the panel is mounted
 * by App, which owns the file state): the panel announces the end of every run, App offers a
 * first-save name for a never-saved document it changed, and the panel's ask card hands the
 * user's Save back. Nothing is written before that click.
 */

/** fired by the panel when a run ends */
export const AI_RUN_DONE_EVENT = 'ai-docs-run-done'
/** fired by the panel when the user clicks Save on the ask card */
export const AI_SAVE_OFFER_EVENT = 'ai-docs-save-offer'

export interface AiRunDoneDetail {
  /** the run changed the document */
  mutated: boolean
  /** App: ask the user whether to save under this name ('' when none could be derived) */
  offerSave(name: string): void
}

export interface AiSaveOfferDetail {
  /** the name the card showed; App saves the document under it */
  name: string
}
