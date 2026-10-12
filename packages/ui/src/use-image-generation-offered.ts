import { useEffect, useRef, useState } from 'react'
import { imageGenerationAvailable, type AiSettings } from '@genoffice/ai-provider/browser'

/** the shell's `ai:gsk-status` answer: signed in to UniWork and the plan includes cloud AI */
type CloudStatusRead = () => Promise<{ loggedIn?: boolean } | null | undefined> | undefined

/**
 * Whether the visible image-generation entries (the "AI image" buttons, the "Regenerate with AI"
 * chip) are offered: the host grant (`cap('imageGeneration')`) AND a live way to generate
 * (the person's own image model, or UniWork cloud sign-in with the cloud tools on). It is the same
 * rule the AI skills use for the generate_image tool, so a button never offers what the agent
 * would refuse. Unlike `useCloudSignedIn` (a ref read at tool-call time) this is state: a button
 * has to render, or vanish, when the answer changes. The cloud state is re-read on mount, on
 * window focus and when the settings change; with the grant off nothing is read at all.
 */
export function useImageGenerationOffered(
  granted: boolean,
  settings: Pick<AiSettings, 'media' | 'gskToolsEnabled'> | null | undefined,
  readCloud: CloudStatusRead,
): boolean {
  const [loggedIn, setLoggedIn] = useState(false)
  const readRef = useRef(readCloud)
  readRef.current = readCloud
  useEffect(() => {
    if (!granted) return
    let alive = true
    const refresh = () => {
      // tests render without a preload bridge
      void readRef
        .current()
        ?.then((status) => {
          if (alive) setLoggedIn(!!status?.loggedIn)
        })
        .catch(() => {})
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      alive = false
      window.removeEventListener('focus', refresh)
    }
  }, [granted, settings])
  return granted && imageGenerationAvailable(settings, loggedIn)
}
