/** G8-02: the author written into comments when no UniWork account resolves. */
export const NEUTRAL_COMMENT_AUTHOR = 'User'

/**
 * G8-02: what a comment surface (Comments pane, margin bubble, balloon tooltip)
 * shows for a stored author — the neutral constant in the UI language, any
 * other name verbatim. Display only: the file keeps the fixed "User".
 */
export function displayCommentAuthor(author: string, neutralLabel: string): string {
  return author === NEUTRAL_COMMENT_AUTHOR ? neutralLabel : author
}
