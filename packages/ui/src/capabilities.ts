/**
 * Capability gating for every renderer (GO-B4/B5/B6; the pattern of apps/docs/src/renderer/capabilities.ts,
 * which Docs keeps as is).
 *
 * The host platform decides what exists: Electron leaves `<preload global>.capabilities` unset
 * (everything on); a web bridge (web/docs/bridge/module-bridge.ts) sets one mutable object before
 * the renderer boots and assigns the host grants into it once the frame handshake completes.
 * Entries are declared with `cap('key')` where they are rendered, never with a platform check.
 *
 *   // apps/pdf/src/renderer/capabilities.ts
 *   export const { cap, resetForTest } = createCapabilityReader<PdfCapability>(
 *     () => window.pdfApi?.capabilities,
 *   )
 */
export type CapabilityObject = Readonly<Record<string, unknown>>

export interface CapabilityReader<K extends string> {
  /** true unless the platform explicitly turned `key` off */
  cap(key: K): boolean
  /** 'web' inside a web frame, undefined on desktop */
  platform(): string | undefined
  /** test hook: forget the cached object so the next call re-reads it */
  resetForTest(): void
}

export function createCapabilityReader<K extends string>(
  read: () => CapabilityObject | null | undefined,
): CapabilityReader<K> {
  let resolved: CapabilityObject | null = null
  // read once, on first use (the bridge installs the global before the renderer runs); the object
  // reference is kept, so host grants assigned into it later are seen
  const caps = (): CapabilityObject => {
    if (resolved) return resolved
    let found: CapabilityObject | null | undefined
    try {
      found = read()
    } catch {
      found = undefined // a renderer started without its preload global (unit tests, dev page)
    }
    resolved = found ?? {}
    return resolved
  }
  return {
    cap: (key) => caps()[key] !== false,
    platform: () => {
      const p = caps().platform
      return typeof p === 'string' ? p : undefined
    },
    resetForTest: () => {
      resolved = null
    },
  }
}

/**
 * The bound answer the AI layer reads (the skills' C-BOUND filter), shared by
 * every app so they agree. A web frame IS the UniWork document, but its adapter
 * still answers `bound: false` because the save path, server comments and the
 * Save button key off the working-copy state — so the frame's `platform: 'web'`
 * capability marks the document UniWork-owned for the AI without touching those
 * consumers. `platform` is the app's capability reader `platform()` (the reader
 * is per-app, so the value is passed in): undefined on the desktop, where the
 * adapter answer is used verbatim.
 */
export function uniworkBoundForAi(bound: boolean, platform: string | undefined): boolean {
  return bound || platform === 'web'
}
