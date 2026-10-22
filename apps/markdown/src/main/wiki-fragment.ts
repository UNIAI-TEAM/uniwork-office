/**
 * Where a wiki link pointed, carried from the tab that followed it to the tab
 * that shows the note.
 *
 * The shell activates an already-open tab without telling its renderer
 * anything, and the path it does queue carries no fragment, so `Note#Heading`
 * could not say where to land by riding along with the open request. The
 * fragment waits here instead, keyed by path, until a renderer loads that path
 * and takes it.
 *
 * Paths are matched by their real location: the shell finds a note's tab with
 * its realpath, so a symlinked folder must not hide a tab that is already open.
 */
import { realpathSync } from 'node:fs'

/** same shape as the shell's canonicalPath: the real location, or the path itself when it cannot be resolved */
function canon(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    return path
  }
}

/** real paths whose fragment is still waiting; a click whose note is never opened must not pile up */
const MAX_PENDING = 32

const pending = new Map<string, string>()

export function rememberWikiFragment(path: string, fragment: string): void {
  if (!path) return
  const key = canon(path)
  // a link with no fragment cancels an earlier one aimed at the same note
  if (!fragment) {
    pending.delete(key)
    return
  }
  while (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next().value
    if (oldest === undefined) break
    pending.delete(oldest)
  }
  pending.set(key, fragment)
}

export function takeWikiFragment(path: string): string {
  if (!path) return ''
  const key = canon(path)
  const fragment = pending.get(key) ?? ''
  pending.delete(key)
  return fragment
}

/**
 * The views, other than `exceptId`, that already show `path`, each with the
 * path it shows (its own spelling, which is what its renderer compares). Such a
 * view is only activated by the shell and loads nothing, so it never asks for
 * the fragment; main tells it instead.
 */
export function viewsShowingNote(
  pathByView: ReadonlyMap<number, string>,
  path: string,
  exceptId: number,
): Array<{ id: number; path: string }> {
  if (!path) return []
  const wanted = canon(path)
  const views: Array<{ id: number; path: string }> = []
  for (const [id, shown] of pathByView) {
    if (id !== exceptId && (shown === path || canon(shown) === wanted))
      views.push({ id, path: shown })
  }
  return views
}

/**
 * Remember a followed link's fragment and tell every other view that already
 * shows the note. An empty fragment only cancels an earlier one and tells nobody.
 */
export function notifyViewsShowingNote(
  pathByView: ReadonlyMap<number, string>,
  path: string,
  fragment: string,
  senderId: number,
  send: (id: number, shownPath: string) => void,
): void {
  rememberWikiFragment(path, fragment)
  if (!fragment) return
  for (const view of viewsShowingNote(pathByView, path, senderId)) send(view.id, view.path)
}
