import { setUniworkAiAvailable } from '../providers'

/**
 * The preload's window.uniworkAiFlag (structural copy of electron-utils' bridge type: this
 * package imports nothing from it). `get` pulls the shell main process's flag, `onChange` hears
 * every later change.
 */
export interface UniworkAiFlagBridge {
  get(): Promise<boolean>
  onChange(handler: (available: boolean) => void): () => void
}

/**
 * Mirrors the shell main process's UniWork AI availability flag into THIS realm, so this
 * renderer's AI_PROVIDERS (picker, settings) shows or hides the `uniwork` entry. A renderer has
 * its own module instances, so main's setUniworkAiAvailable never reaches it. Subscribes before
 * the pull: a change pushed while the pull is in flight wins over the older pulled value. With no
 * bridge, or a failing or non-boolean answer, the entry stays hidden. Returns the unsubscribe.
 */
export function mirrorUniworkAiFlag(
  bridge: UniworkAiFlagBridge | undefined = (globalThis as { uniworkAiFlag?: UniworkAiFlagBridge })
    .uniworkAiFlag,
): () => void {
  if (!bridge) return () => {}
  let pushed = false
  const off = bridge.onChange((available) => {
    pushed = true
    setUniworkAiAvailable(available === true)
  })
  bridge.get().then(
    (available) => {
      if (!pushed) setUniworkAiAvailable(available === true)
    },
    () => {},
  )
  return off
}
