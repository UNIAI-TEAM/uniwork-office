import type { UniworkDocsService } from '../uniwork-docs/service'
import type { AskUniDocBinding } from './doc-service'

/**
 * What an editor's Ask UNI asks about: the same binding rule as UniWork AI
 * (uniworkAiBinding in uniwork-docs/wiring.ts), with the workspace the
 * document lives in instead of its org. 'hidden' = another account's copy,
 * null = a local file.
 */
export function askUniDocBinding(
  service: Pick<UniworkDocsService, 'store' | 'owns'>,
  path: string,
): AskUniDocBinding {
  const doc = service.store.lookup(path)
  if (!doc) return service.store.isInside(path) ? 'hidden' : null
  if (!service.owns(doc)) return 'hidden'
  return { workspaceId: doc.binding.workspaceId, documentId: doc.binding.documentId }
}
