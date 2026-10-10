/**
 * In-app clipboards, shared by every session in the process so a slide or elements
 * copied in one deck paste into any other open deck.
 */
import type { ElementClipboardItem, SlideBundle } from '@genoffice/pptx-engine'
import type { PasteCascade } from '../main/paste-cascade'

/** System clipboard marker formats written next to the in-app copies. */
export const SLIDE_MARKER = 'io.genoffice.slides.slide'
export const ELEMENTS_MARKER = 'io.genoffice.slides.elements'

export const appClipboard = {
  /** Slides copied from any open deck, waiting to be pasted into another (in order). */
  slide: null as { bundles: SlideBundle[]; pngs?: string[] } | null,
  /** Copied elements; the cascade decides the paste offset, the token identifies this copy
   *  on the system clipboard (an external copy or a later copy replaces it). */
  elements: null as {
    items: ElementClipboardItem[]
    cascade: PasteCascade
    token: string
    senderId: number
  } | null,
}

const MAX_TOKEN_LENGTH = 256

/** a renderer-supplied clipboard token is usable as the copy's marker */
export function isElementClipboardToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TOKEN_LENGTH
}

/** The immediately preceding slide paste per client, so the paste-options floater can redo it with another mode. */
export const lastSlidePaste = new Map<number, { afterIndex: number; undoLen: number }>()

/** Drop per-client clipboard state when a client goes away. */
export function forgetClient(clientId: number): void {
  lastSlidePaste.delete(clientId)
}
