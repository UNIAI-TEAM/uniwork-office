import type {
  AskUniBridge,
  AskUniCitationKind,
  AskUniFeedbackClearRequest,
  AskUniFeedbackRequest,
  AskUniOkResult,
  AskUniV2Bridge,
} from '../../../shared/askuni-api'

/** the v2 methods plus the P1 citation opener, all optional: an older preload has none of them */
type AskUniWindowBridge = Partial<AskUniV2Bridge & AskUniBridge>

export function v2Bridge(): AskUniWindowBridge {
  return (window.aiOffice ?? {}) as unknown as AskUniWindowBridge
}

/** whether the shell preload exposes the Ask UNI v2 stream (the entry points fall back to P1 otherwise) */
export function hasAskUniV2Bridge(): boolean {
  const b = v2Bridge()
  return (
    typeof b.askUniStream === 'function' &&
    typeof b.askUniStreamCancel === 'function' &&
    typeof b.onAskUniStreamEvent === 'function'
  )
}

/** feedback calls the actions bar uses; the panel may inject its own (tests, a fake) */
export interface AskUniFeedbackApi {
  set(req: AskUniFeedbackRequest): Promise<AskUniOkResult>
  clear(req: AskUniFeedbackClearRequest): Promise<AskUniOkResult>
}

const FAILED: AskUniOkResult = { ok: false, error: 'error' }

export const bridgeFeedback: AskUniFeedbackApi = {
  async set(req) {
    const call = v2Bridge().askUniFeedbackSet
    return call ? call(req) : FAILED
  },
  async clear(req) {
    const call = v2Bridge().askUniFeedbackClear
    return call ? call(req) : FAILED
  },
}

/**
 * Opens a cited source through the P1 channel: main decides how (a document in the app, any other
 * kind as the signed-in server's web page) and refuses what it cannot place. False = it did not open.
 */
export async function openCitationSource(c: {
  kind: AskUniCitationKind
  href: string
}): Promise<boolean> {
  const open = v2Bridge().uniworkAskUniOpenCitation
  if (!open) return false
  try {
    return (await open({ kind: c.kind, href: c.href })).ok
  } catch {
    return false
  }
}
