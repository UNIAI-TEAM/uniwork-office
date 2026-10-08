import type { AgentIntent } from '@uniwork/practice-core'

export type AgentIntentNavigateHandler = (tabId: string, intent: AgentIntent) => void

const navigateListeners = new Set<AgentIntentNavigateHandler>()
let pendingNavigate: { tabId: string; intent: AgentIntent } | null = null

/** Workbench homes subscribe so Intent Host can switch tabs after consent. */
export function onAgentIntentNavigate(handler: AgentIntentNavigateHandler): () => void {
  navigateListeners.add(handler)
  if (pendingNavigate) {
    const next = pendingNavigate
    pendingNavigate = null
    handler(next.tabId, next.intent)
  }
  return () => {
    navigateListeners.delete(handler)
  }
}

export function emitAgentIntentNavigate(tabId: string, intent: AgentIntent): void {
  if (navigateListeners.size === 0) {
    pendingNavigate = { tabId, intent }
    return
  }
  pendingNavigate = null
  for (const h of navigateListeners) h(tabId, intent)
}
