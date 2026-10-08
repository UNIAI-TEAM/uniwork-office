import type { DesktopCapabilities } from '../shared/ipc'

/**
 * The one capability source for the renderer. The host platform decides what
 * exists: Electron leaves `window.desktop.capabilities` unset (everything on),
 * the web bridge sets it once before the renderer boots. Entries are declared
 * with `cap('zotero')` where they are rendered, never with a platform check.
 */
export type Capability = Exclude<keyof DesktopCapabilities, 'platform'>

let resolved: DesktopCapabilities | null = null

/** read once, on first use (the bridge installs `window.desktop` before the renderer runs) */
function capabilities(): DesktopCapabilities {
  resolved ??= (typeof window !== 'undefined' ? window.desktop?.capabilities : undefined) ?? {}
  return resolved
}

/** true unless the platform explicitly turned the capability off */
export function cap(key: Capability): boolean {
  return capabilities()[key] !== false
}

/** test hook: forget the cached capabilities so the next `cap()` re-reads `window.desktop` */
export function resetCapabilitiesForTest(): void {
  resolved = null
}
