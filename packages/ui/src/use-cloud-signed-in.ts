import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'

/** the shell's `ai:gsk-status` answer: signed in to UniWork and the plan includes cloud AI */
type CloudStatusRead = () => Promise<{ loggedIn?: boolean } | null | undefined> | undefined

/**
 * Keeps a ref in step with the UniWork cloud state for an AI panel's media-tool
 * gates. Every read goes through the shell main process, which re-reads the plan
 * from the server, so the state is re-read on mount, on window focus and every
 * time the panel is opened (`open` turns true): a plan changed while the panel
 * was collapsed shows as soon as it is reopened. `refresh` is stable, for a
 * panel whose open state lives elsewhere. Panels without an `open` flag leave
 * it undefined and refresh on mount and focus only.
 */
export function useCloudSignedIn(
  read: CloudStatusRead,
  open?: boolean,
): { loggedInRef: MutableRefObject<boolean>; refresh: () => void } {
  const loggedInRef = useRef(false)
  const readRef = useRef(read)
  readRef.current = read
  const aliveRef = useRef(true)
  const refresh = useCallback(() => {
    // tests render the panel without a preload bridge
    void readRef
      .current()
      ?.then((status) => {
        if (aliveRef.current) loggedInRef.current = !!status?.loggedIn
      })
      .catch(() => {})
  }, [])
  useEffect(() => {
    aliveRef.current = true
    window.addEventListener('focus', refresh)
    return () => {
      aliveRef.current = false
      window.removeEventListener('focus', refresh)
    }
  }, [refresh])
  useEffect(() => {
    if (open !== false) refresh()
  }, [open, refresh])
  return { loggedInRef, refresh }
}
