/**
 * A drop zone that owns a file drag marks the native dragenter/dragleave event
 * here, so the window-level "Drop to open" overlay in Home leaves that drag
 * alone (UNI-2052: the library list is a zone while Upload applies). The mark
 * lives on the event object, so it cannot outlive the drag.
 */
const claimed = new WeakSet<Event>()

export function claimDrag(event: Event): void {
  claimed.add(event)
}

export function isDragClaimed(event: Event): boolean {
  return claimed.has(event)
}
