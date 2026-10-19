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

/** the "Open in app" action exists: web frame only, and only on the host's explicit grant (an unset
    key reads as on in `cap()`, so this tests the value) */
export function appOpenAvailable(): boolean {
  const caps = capabilities()
  return caps.platform === 'web' && caps.desktopOpen === true
}

/** File > Save as a copy: the locked-out tab's one write — `saveCopy` granted while `save` is
 *  withheld, and not under the readOnly profile (createCapabilityObject already strips saveCopy
 *  there; the check here keeps an object built without it honest). An unset key is not a grant —
 *  cap() reads it as on, so this tests the value. */
export function saveCopyAvailable(): boolean {
  const caps = capabilities()
  return caps.saveCopy === true && caps.save !== true && caps.readOnlyProfile !== true
}

/** the host's `readOnly` profile is on: the document's own comments stay hidden too (an unset key is off) */
export function isReadOnlyProfile(): boolean {
  return capabilities().readOnlyProfile === true
}

/** 'web' inside a web frame, undefined on the desktop (the shared reader's convention) */
export function platform(): string | undefined {
  return capabilities().platform
}

/** the editor runs in a web frame (the host around it has its own chrome, e.g. a Comments drawer) */
export function isWebFrame(): boolean {
  return platform() === 'web'
}

/** test hook: forget the cached capabilities so the next `cap()` re-reads `window.desktop` */
export function resetCapabilitiesForTest(): void {
  resolved = null
}
