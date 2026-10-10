/**
 * The capability object pattern (generic bridge piece, GO-B4/B5/B6; extracted from install.ts).
 *
 * A renderer reads its capabilities once from its preload global (Docs:
 * `window.desktop.capabilities` via apps/docs/src/renderer/capabilities.ts `cap()`) and keeps
 * the object reference. The bridge therefore hands out ONE mutable object: the web defaults
 * (everything desktop-only off) are in it from the start, and the host grants from `init`
 * (frame ∩ host) are assigned into the same object when the handshake completes. Boot waits
 * (bounded) for `init`, so the grants land before the first render.
 */
import type { Capabilities } from '../protocol/types'
import type { FramePort } from './frame-port'

export function createCapabilityObject<C extends object>(
  defaults: Readonly<C>,
  port: Pick<FramePort, 'whenInitialized'>,
  grants: (granted: Capabilities | undefined) => Partial<C> = () => ({}),
): C {
  const caps = { ...defaults } as C
  port
    .whenInitialized()
    .then((session) => Object.assign(caps, grants(session.capabilities)))
    .catch(() => {}) // a failed handshake is reported elsewhere (bridge open flow / host)
  return caps
}

/**
 * The renderer-side check, same semantics as the Docs `cap()`: an entry is on unless its key
 * is explicitly false (Electron sets no object at all, so desktop keeps everything).
 */
export function capEnabled(caps: object | null | undefined, key: string): boolean {
  return (caps as Record<string, unknown> | null | undefined)?.[key] !== false
}
