/**
 * One fixed polite live region per window, shared by every collab panel (Accessibility Floor G8: the visible
 * status line is the on-screen copy; the sentence itself is written into this node). Created on first use,
 * visually hidden, never removed, so screen readers keep a stable node to listen to.
 */

export const COLLAB_LIVE_REGION_ID = 'collab-live-region'

/** the delay between clearing and writing, so the same sentence twice is still announced twice */
export const COLLAB_ANNOUNCE_DELAY_MS = 50

const pending = new WeakMap<Document, ReturnType<typeof setTimeout>>()

export function collabLiveRegion(doc: Document = document): HTMLElement {
  const found = doc.getElementById(COLLAB_LIVE_REGION_ID)
  if (found) return found
  const el = doc.createElement('div')
  el.id = COLLAB_LIVE_REGION_ID
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', 'polite')
  el.setAttribute('aria-atomic', 'true')
  el.className = 'collab-sr'
  // inline geometry so the node stays hidden even before collab.css loads
  el.style.cssText =
    'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0'
  doc.body.append(el)
  return el
}

/** Writes one polite sentence; a newer call before the write replaces the older one. */
export function announcePolite(text: string, doc: Document = document): void {
  if (!text) return
  const el = collabLiveRegion(doc)
  const prev = pending.get(doc)
  if (prev !== undefined) clearTimeout(prev)
  el.textContent = ''
  pending.set(
    doc,
    setTimeout(() => {
      pending.delete(doc)
      el.textContent = text
    }, COLLAB_ANNOUNCE_DELAY_MS),
  )
}
