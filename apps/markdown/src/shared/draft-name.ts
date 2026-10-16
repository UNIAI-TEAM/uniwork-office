/**
 * A file name taken from the document's own words (the ask-before-saving offer, the save dialog's
 * default): no trailing sentence punctuation, dots or blanks, so adding an extension can never
 * give `name..md`. Empty when nothing is left.
 */
export function cleanDraftName(text: string): string {
  return text.replace(/[\s.,;:!?…。、，；：！？]+$/u, '')
}
