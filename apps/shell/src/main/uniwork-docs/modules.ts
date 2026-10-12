import {
  setDocsUserSaveHook,
  setUniworkDocumentPolicy as setDocsUniworkPolicy,
} from '../../../../docs/src/main/docs-main'
import {
  setHtmlUserSaveHook,
  setUniworkDocumentPolicy as setHtmlUniworkPolicy,
} from '../../../../html/src/main/html-main'
import {
  setMarkdownUserSaveHook,
  setUniworkDocumentPolicy as setMarkdownUniworkPolicy,
} from '../../../../markdown/src/main/markdown-main'
import {
  setPdfUserSaveHook,
  setUniworkDocumentPolicy as setPdfUniworkPolicy,
} from '../../../../pdf/src/main/pdf-main'
import {
  setSheetsUserSaveHook,
  setUniworkDocumentPolicy as setSheetsUniworkPolicy,
} from '../../../../sheets/src/main/sheets-main'
import {
  setSlidesUserSaveHook,
  setUniworkDocumentPolicy as setSlidesUniworkPolicy,
} from '../../../../slides/src/main/slides-main'

/** what the six editor mains need from the UniWork documents service */
export interface UniworkModuleSeam {
  isBound(path: string): boolean
  isReadOnly(path: string): boolean
  onUserSave(path: string): void
  /**
   * G5-04g: true when the path's folder declares a store this build does not
   * read, so the module's open chokepoint must not read the file at all. The
   * service records and pushes the S11 lock as a side effect.
   */
  refuseLockedPath(path: string): boolean
}

/**
 * G8-02: the author written into a comment when no UniWork account resolves —
 * a fixed, locale-independent constant. Never the OS account name.
 */
export const NEUTRAL_COMMENT_AUTHOR = 'User'

/** G8-02: author name for a new comment on `path`; null installs the neutral constant. */
export type CommentAuthorResolver = (path: string) => string

/**
 * G8-02: the single comment-author rule. A document bound to the signed-in
 * account takes its display name; every other document (local file, signed
 * out, or a profile that carries no name) takes the neutral constant. The OS
 * account name is never consulted.
 */
export function createCommentAuthorResolver(deps: {
  isBound(path: string): boolean
  displayName(): string | null
}): CommentAuthorResolver {
  return (path) => {
    if (!deps.isBound(path)) return NEUTRAL_COMMENT_AUTHOR
    const name = deps.displayName()?.trim()
    return name ? name : NEUTRAL_COMMENT_AUTHOR
  }
}

/**
 * Hands every editor module the UniWork policy (bound / read-only paths), its
 * explicit-user-save hook and the single comment-author source. `commentAuthor`
 * is asked once per new comment with the document path and returns the author
 * to write into the file: the signed-in account's display name for a bound
 * document, else the neutral constant. null restores genoffice behaviour
 * everywhere (the modules then fall back to the same neutral constant, never
 * to the OS account).
 */
export function installUniworkModuleSeams(
  seam: UniworkModuleSeam | null,
  commentAuthor: CommentAuthorResolver | null = null,
): void {
  const author = commentAuthor ?? (() => NEUTRAL_COMMENT_AUTHOR)
  const policy = seam
    ? {
        isBound: (path: string) => seam.isBound(path),
        isReadOnly: (path: string) => seam.isReadOnly(path),
        refuseOpen: (path: string) => seam.refuseLockedPath(path),
        commentAuthor: (path: string) => author(path),
      }
    : null
  const hook = seam ? (path: string) => seam.onUserSave(path) : null
  for (const set of [
    setDocsUniworkPolicy,
    setSheetsUniworkPolicy,
    setSlidesUniworkPolicy,
    setPdfUniworkPolicy,
    setMarkdownUniworkPolicy,
    setHtmlUniworkPolicy,
  ]) {
    set(policy)
  }
  for (const set of [
    setDocsUserSaveHook,
    setSheetsUserSaveHook,
    setSlidesUserSaveHook,
    setPdfUserSaveHook,
    setMarkdownUserSaveHook,
    setHtmlUserSaveHook,
  ]) {
    set(hook)
  }
}
