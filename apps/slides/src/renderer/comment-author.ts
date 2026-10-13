/**
 * G8-02: the author the desktop host writes into a comment when no UniWork
 * account resolves (apps/slides/src/main/uniwork-policy.ts) — a fixed,
 * locale-independent constant, so a locale change never adds a person.
 */
export const NEUTRAL_COMMENT_AUTHOR = 'User'

/**
 * G8-02: what a comment pane shows for a stored author — the neutral constant
 * (written into the file as the fixed "User") in the UI language, any other
 * name verbatim. Display only: the file value never changes with the locale.
 */
export function displayCommentAuthor(author: string, neutralLabel: string): string {
  return author === NEUTRAL_COMMENT_AUTHOR ? neutralLabel : author
}
