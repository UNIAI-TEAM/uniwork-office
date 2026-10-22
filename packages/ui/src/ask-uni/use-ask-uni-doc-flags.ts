import { useEffect, useState } from 'react'
import {
  asAskUniDocFlags,
  type AskUniDocBridge,
  type AskUniDocFlags,
} from '@genoffice/ai-provider/askuni'

/**
 * What the asking tab shows (a UniWork document, a local file, another account's copy, signed out)
 * and whether the stream is on. null until the first answer, and with no bridge (the web build has
 * none: the host hides the mode). A failing call counts as off and signed out. Change `refreshKey`
 * to ask again, for example after the file was saved to UniWork.
 */
export function useAskUniDocFlags(
  bridge: Pick<AskUniDocBridge, 'askUniDocFlags'> | undefined,
  refreshKey: number | string = 0,
): AskUniDocFlags | null {
  const [flags, setFlags] = useState<AskUniDocFlags | null>(null)
  useEffect(() => {
    if (!bridge) {
      setFlags(null)
      return
    }
    let alive = true
    bridge.askUniDocFlags().then(
      (raw) => alive && setFlags(asAskUniDocFlags(raw)),
      () => alive && setFlags(asAskUniDocFlags(undefined)),
    )
    return () => {
      alive = false
    }
  }, [bridge, refreshKey])
  return flags
}
