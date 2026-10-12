/** G8-02: the author written into a note when no UniWork account resolves. */
export const NEUTRAL_COMMENT_AUTHOR = 'User'

/**
 * G8-02: keep the note author current for the open document. Asks now, and
 * again on every account-change ping (sign-in, sign-out, session expiry); only
 * the latest request's answer is applied, and nothing is applied after the
 * returned dispose (the document changed). A failed or blank answer applies
 * the neutral constant — never the OS account name.
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
