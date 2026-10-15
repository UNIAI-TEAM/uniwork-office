import { isAbsolute, relative, resolve } from 'node:path'

/** the directory (under userData) that holds the read-only copies of kept drafts */
export const DRAFT_PREVIEW_DIR = 'uniwork-drafts-preview'

/**
 * True for a file inside the draft-preview root: a preview is a temporary decrypted copy, not a
 * file the user opened, so it never belongs in any recent-files list. Shared by the shell and by
 * every module that keeps its own recents writer (a preview reaches those through the open route).
 */
export function isDraftPreviewPath(userDataDir: string, filePath: string): boolean {
  const rel = relative(resolve(userDataDir, DRAFT_PREVIEW_DIR), resolve(filePath))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}
