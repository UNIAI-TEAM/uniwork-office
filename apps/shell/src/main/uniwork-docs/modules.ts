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
}

/**
 * Hands every editor module the UniWork policy (bound / read-only paths) and
 * its explicit-user-save hook. null restores genoffice behaviour everywhere.
 */
export function installUniworkModuleSeams(seam: UniworkModuleSeam | null): void {
  const policy = seam
    ? {
        isBound: (path: string) => seam.isBound(path),
        isReadOnly: (path: string) => seam.isReadOnly(path),
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
