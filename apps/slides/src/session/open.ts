/**
 * Opening a deck from bytes into a client's session (the web frame's open path; Electron main
 * keeps its own openAndBuild with the file system, recovery copies and the shell hooks).
 */
import { createBlankPptx, openPptx, type OpenedPptx } from '@genoffice/pptx-engine'
import type { OpenResult } from '../shared/ipc'
import { sessionPlatform } from './platform'
import { buildAllRenderSlides, deckDefaultFont } from './render'
import { createSession, type Session } from './state'

/** The renderer's view of a session: path, every RenderSlide, size, default font. */
export function openResultFor(session: Session, fitWidthPx: number): OpenResult {
  return {
    path: session.path,
    slides: buildAllRenderSlides(session.opened, fitWidthPx),
    size: { cx: session.opened.deck.size.cx, cy: session.opened.deck.size.cy },
    defaultFont: deckDefaultFont(session.opened),
  }
}

/** Parse `bytes`, register the deck's fonts with the host, and make it the client's session. */
export async function openSessionFromBytes(
  clientId: number,
  init: { path: string; bytes: Uint8Array; fitWidthPx: number },
): Promise<{ session: Session; result: OpenResult }> {
  const opened: OpenedPptx = await openPptx(init.bytes)
  sessionPlatform().deckOpened?.(opened)
  const session = createSession(clientId, {
    path: init.path,
    opened,
    fitWidthPx: init.fitWidthPx,
  })
  return { session, result: openResultFor(session, init.fitWidthPx) }
}

/** A new untitled deck (single blank 16:9 page). */
export async function openBlankSession(
  clientId: number,
  fitWidthPx: number,
): Promise<{ session: Session; result: OpenResult }> {
  return openSessionFromBytes(clientId, { path: '', bytes: await createBlankPptx(), fitWidthPx })
}
