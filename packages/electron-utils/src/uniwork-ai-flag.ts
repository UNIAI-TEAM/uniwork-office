/// Availability flag of UniWork AI, from the shell main process to every renderer.
///
/// The main process decides whether the `uniwork` provider entry is offered (signed in, plan,
/// organization capability, module format) and calls setUniworkAiAvailable there. Each renderer
/// has its own AI_PROVIDERS, so the flag reaches it like the cloud status does: main answers a
/// pull and pushes every change to all webContents; each preload exposes window.uniworkAiFlag
/// (./uniwork-ai-flag-bridge); the renderer mirrors it (mirrorUniworkAiFlag in ai-provider).
///
/// Pure (no Electron import) so main, preload and tests share it.

/** renderer -> main: ask for the current flag (answers a boolean) */
export const UNIWORK_AI_FLAG_GET = 'uniwork:ai-flag'
/** main -> renderer: the flag changed (payload: boolean) */
export const UNIWORK_AI_FLAG_CHANGED = 'uniwork:ai-flag-changed'

/** the global each preload exposes the flag under */
export const UNIWORK_AI_FLAG_BRIDGE_KEY = 'uniworkAiFlag'

/** what a preload exposes to its renderer as window.uniworkAiFlag */
export interface UniworkAiFlagBridge {
  get(): Promise<boolean>
  onChange(handler: (available: boolean) => void): () => void
}

/** anything but a real boolean counts as "not offered": the entry stays hidden */
export function parseUniworkAiFlag(payload: unknown): boolean {
  return payload === true
}
