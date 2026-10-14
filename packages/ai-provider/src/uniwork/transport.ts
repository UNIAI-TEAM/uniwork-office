/**
 * The UniWork AI chat transport of this process (the pattern of
 * setUniworkCloudTransport in ../uniwork-cloud.ts). The desktop shell main
 * process injects one that adds the device bearer itself; the web frame
 * injects one over its frame-token client. No token ever reaches this module.
 */
import type { UniworkChatTransport } from './types'

let transport: UniworkChatTransport | null = null

export function setUniworkChatTransport(next: UniworkChatTransport | null): void {
  transport = next
}

/** the injected transport, or null when none is installed (signed out, or not the shell main process) */
export function uniworkChatTransport(): UniworkChatTransport | null {
  return transport
}
