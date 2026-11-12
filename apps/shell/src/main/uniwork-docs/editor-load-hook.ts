/**
 * UNI-2510: an editor view that loads again (renderer crash reload, a module's own
 * `window.location.reload()`) mounts its document anew, as the web does on a new handshake: the
 * path's next save is a new editor session. Only the load of the view that shows the document
 * counts; the shell window, Home, settings and any other web contents have no path and are ignored.
 */

export interface LoadEventSource {
  id: number
  on(event: 'did-finish-load', listener: () => void): unknown
}

export function watchEditorLoads(
  contents: LoadEventSource,
  /** the document path shown by this web contents, undefined when it is not an editor view */
  pathOf: (webContentsId: number) => string | undefined,
  noteLoaded: (path: string) => void,
): void {
  contents.on('did-finish-load', () => {
    const path = pathOf(contents.id)
    if (path) noteLoaded(path)
  })
}
