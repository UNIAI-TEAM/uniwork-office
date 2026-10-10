/**
 * The HTML full-screen request of the slide show and the presenter view, made once the shell's
 * window snap (`slidesApi.setShowFullScreen`) settled. On the web that call already took the frame
 * full screen with the click that started the show; a second request has no fresh user
 * activation and the browser logs "API can only be initiated by a user gesture", so a document
 * that is already full screen is left alone. macOS skips HTML full screen (it would only
 * re-trigger the animated native one).
 */
export function requestShowFullscreen(isMac: boolean, doc: Document = document): void {
  if (isMac || doc.fullscreenElement) return
  void doc.documentElement.requestFullscreen?.()?.catch(() => {})
}
