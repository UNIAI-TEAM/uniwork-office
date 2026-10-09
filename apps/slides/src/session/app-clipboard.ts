/**
 * In-app clipboards, shared by every session in the process so a slide or elements
 * copied in one deck paste into any other open deck.
 */
import type { ElementClipboardItem, SlideBundle } from '@genoffice/pptx-engine'

/** System clipboard marker formats written next to the in-app copies. */
export const SLIDE_MARKER = 'io.genoffice.slides.slide'
export const ELEMENTS_MARKER = 'io.genoffice.slides.elements'

export const appClipboard = {
  /** One slide, copied from any open deck, waiting to be pasted into another. */
  slide: null as { bundle: SlideBundle; png?: string } | null,
  /** Copied elements; pasteCount drives the cascading paste offset. */
  elements: null as { items: ElementClipboardItem[]; pasteCount: number } | null,
}

/** The immediately preceding slide paste per client, so the paste-options floater can redo it with another mode. */
export const lastSlidePaste = new Map<number, { afterIndex: number; undoLen: number }>()

/** Drop per-client clipboard state when a client goes away. */
export function forgetClient(clientId: number): void {
  lastSlidePaste.delete(clientId)
}
