/** G8-02: the author written into a note when no UniWork account resolves. */
export const NEUTRAL_COMMENT_AUTHOR = 'User'

/**
 * G8-02: keep the note author current for the open document. Asks now, and
 * again on every account-change ping (sign-in, sign-out, session expiry); only
 * the latest request's answer is applied, and nothing is applied after the
 * returned dispose (the document changed). A failed or blank answer applies
 * the neutral constant — never the OS account name. While an ask is in flight
 * the author is the neutral constant, so a comment written in that window never
 * carries the previous document's or account's name (BE-8).
 */
export function followCommentAuthor(
  ask: () => Promise<string>,
  onChanged: ((handler: () => void) => () => void) | undefined,
  apply: (name: string) => void,
): () => void {
  let latest = 0
  let live = true
  const refresh = (): void => {
    if (!live) return
    const request = ++latest
    apply(NEUTRAL_COMMENT_AUTHOR)
    void ask().then(
      (name) => {
        if (!live || request !== latest) return
        const trimmed = typeof name === 'string' ? name.trim() : ''
        apply(trimmed.length > 0 ? trimmed : NEUTRAL_COMMENT_AUTHOR)
      },
      () => {
        if (live && request === latest) apply(NEUTRAL_COMMENT_AUTHOR)
      },
    )
  }
  refresh()
  const unsubscribe = onChanged?.(refresh)
  return () => {
    live = false
    unsubscribe?.()
  }
}

/**
 * G8-02: what a comment pane shows for a stored author — the neutral constant
 * (written into the file as the fixed "User") in the UI language, any other
 * name verbatim. Display only: the file value never changes with the locale.
 */
export function displayCommentAuthor(author: string, neutralLabel: string): string {
  return author === NEUTRAL_COMMENT_AUTHOR ? neutralLabel : author
}
