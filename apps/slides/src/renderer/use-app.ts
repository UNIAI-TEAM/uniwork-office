/**
 * "Use the app" notes (web frame, A7 contract): what the web cannot do (linked external media,
 * print-quality PDF) says so in one localised sentence and, only when the host grants
 * `desktopOpen`, offers the host's own Open-in-app flow (protocol `app.open`). The frame never
 * builds a deep link; `feature` is a short opaque tag for the host's diagnostics.
 */
import { cap } from './capabilities'

/** the action is offered only where the host can run its flow */
export function canOpenInApp(): boolean {
  return cap('desktopOpen') && typeof window.slidesApi.openInDesktopApp === 'function'
}

/** true when the host launched the app or opened its install prompt (the note can go away) */
export async function openInApp(feature: string): Promise<boolean> {
  const open = window.slidesApi.openInDesktopApp
  if (!open) return false
  try {
    return (await open(feature)).outcome !== 'unavailable'
  } catch {
    return false
  }
}
