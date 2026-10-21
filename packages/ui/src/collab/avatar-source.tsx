/**
 * Avatar photos of the collab kit. A web frame cannot show the host's `avatar_url` straight: the
 * frame CSP is `img-src 'self' data: blob:` and the avatar route wants a Bearer token an `<img>`
 * cannot send. The host rewrites the url to a same-origin path; a frame that mounts an
 * `AvatarSourceProvider` fetches that path itself and the kit shows the `blob:` url it gets back.
 * Without a provider (desktop) or for any other url the `<img src>` is used as before.
 */
import { createContext, useContext, useEffect, useState } from 'react'

export interface AvatarSource {
  /** the `blob:` url of the picture behind a same-origin path, or null when there is none */
  load(url: string, signal: AbortSignal): Promise<string | null>
  /** revoke what the source holds; it may be used again afterwards */
  dispose?(): void
}

/** what a web frame publishes on `window.uniworkAvatars` (shared/avatar/install.ts) */
export interface FrameAvatars {
  createSource(): AvatarSource
}

export const AvatarSourceContext = createContext<AvatarSource | null>(null)
export const AvatarSourceProvider = AvatarSourceContext.Provider

/** a same-origin path the frame can fetch (not a protocol-relative or absolute url) */
function isSameOriginPath(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//')
}

/**
 * The src to put on an `<img>`: `url` itself without a provider or for a non-path url, `undefined`
 * while the provider loads it, the `blob:` url when done and `null` when there is no picture.
 */
export function useAvatarSrc(url: string | undefined): string | null | undefined {
  const source = useContext(AvatarSourceContext)
  const viaSource = source !== null && !!url && isSameOriginPath(url)
  const [done, setDone] = useState<{ url: string; src: string | null } | null>(null)
  useEffect(() => {
    if (!source || !url || !isSameOriginPath(url)) return
    const ctl = new AbortController()
    const settle = (src: string | null) => {
      if (!ctl.signal.aborted) setDone({ url, src })
    }
    source.load(url, ctl.signal).then(settle, () => settle(null))
    return () => ctl.abort()
  }, [source, url])
  if (!url) return null
  if (!viaSource) return url
  return done?.url === url ? done.src : undefined
}

/**
 * The source a frame host provides: made from `window.uniworkAvatars` (absent on desktop and in a
 * frame without comments: no provider) and disposed when the host unmounts.
 */
export function useFrameAvatarSource(
  frame: FrameAvatars | undefined = (globalThis as { uniworkAvatars?: FrameAvatars })
    .uniworkAvatars,
): AvatarSource | null {
  const [source] = useState<AvatarSource | null>(() => frame?.createSource() ?? null)
  useEffect(() => {
    // a disposed source loads again, so a re-run of this effect (StrictMode) needs no new one
    return () => source?.dispose?.()
  }, [source])
  return source
}

/** photo with the initials as fallback: a missing photo, a loading one and a load error show initials */
export function AvatarFace(p: { url: string | undefined; initials: string }) {
  const src = useAvatarSrc(p.url)
  const [badFor, setBadFor] = useState<string | null>(null)
  if (!src || badFor === src) return <>{p.initials}</>
  return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBadFor(src)} />
}
