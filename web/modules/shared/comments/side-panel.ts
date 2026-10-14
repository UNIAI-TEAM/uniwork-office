/**
 * One side panel at a time in a web frame: the editor's S12 panel and the G8-11 Discussion panel
 * must not both stay open and crush the page. A plain DOM event keeps the shared editor renderers
 * free of web imports: each panel announces `{ owner, open }` when it opens or closes and closes
 * itself when another owner announces an open. On the desktop the event is harmless.
 */
export const FRAME_SIDE_PANEL_EVENT = 'uniwork:frame-side-panel'

export interface FrameSidePanelDetail {
  owner: string
  open: boolean
}

/** `win`: the window of the frame document (defaults to this one) */
export function announceFrameSidePanel(
  owner: string,
  open: boolean,
  win: EventTarget = globalThis as unknown as EventTarget,
): void {
  const detail: FrameSidePanelDetail = { owner, open }
  win.dispatchEvent(new CustomEvent(FRAME_SIDE_PANEL_EVENT, { detail }))
}

/** calls `close` when a different owner announces it opened; returns the unsubscribe */
export function onFrameSidePanel(
  owner: string,
  close: () => void,
  win: EventTarget = globalThis as unknown as EventTarget,
): () => void {
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<Partial<FrameSidePanelDetail> | null>).detail
    if (detail?.open === true && typeof detail.owner === 'string' && detail.owner !== owner) {
      close()
    }
  }
  win.addEventListener(FRAME_SIDE_PANEL_EVENT, listener)
  return () => win.removeEventListener(FRAME_SIDE_PANEL_EVENT, listener)
}
