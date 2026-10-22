/**
 * A notice can send the person to two places inside the Documents home: a document's Share
 * dialog (on its access-requests or break-glass section) and a row of the Trash. The inbox
 * publishes the intent here; two kinds of subscriber answer it:
 * - a route subscriber (the app Home) switches the surface to the Documents home of the
 *   intent's workspace; it never takes the intent;
 * - a consumer (the Documents home of that workspace) does the work and answers `true` once
 *   it has taken the intent, `false` when the intent is not for it.
 * The last intent is held until a consumer takes it, so a Documents home that is not mounted
 * yet (cold start, another workspace, hidden behind the Workbench) still gets it.
 */
export type DocumentsShareSection = 'requests' | 'break_glass'

export type DocumentsIntent =
  | {
      kind: 'share'
      documentId: string
      workspaceId: string
      section: DocumentsShareSection
    }
  | { kind: 'trash'; documentId: string; workspaceId: string }

export type DocumentsIntentConsumer = (intent: DocumentsIntent) => boolean
export type DocumentsIntentRouter = (intent: DocumentsIntent) => void

const consumers = new Set<DocumentsIntentConsumer>()
const routers = new Set<DocumentsIntentRouter>()
let pending: DocumentsIntent | null = null

function deliver(): void {
  if (!pending) return
  for (const consumer of [...consumers]) {
    if (!pending) return
    if (consumer(pending)) {
      pending = null
      return
    }
  }
}

function publish(intent: DocumentsIntent): void {
  pending = intent
  for (const router of [...routers]) router(intent)
  deliver()
}

/** Open the Share dialog of a document on one of its sections. */
export function openDocumentShare(input: {
  documentId: string
  workspaceId: string
  section: DocumentsShareSection
}): void {
  publish({ kind: 'share', ...input })
}

/** Open the Trash of a workspace with the document's row selected. */
export function revealInTrash(input: { documentId: string; workspaceId: string }): void {
  publish({ kind: 'trash', ...input })
}

/** Subscribe as the one that does the work; returns the unsubscribe function. */
export function onDocumentsIntent(handler: DocumentsIntentConsumer): () => void {
  consumers.add(handler)
  deliver()
  return () => {
    consumers.delete(handler)
  }
}

/** Subscribe as the host that switches the surface; a held intent is replayed (not consumed). */
export function onDocumentsIntentRoute(handler: DocumentsIntentRouter): () => void {
  routers.add(handler)
  if (pending) handler(pending)
  return () => {
    routers.delete(handler)
  }
}

/** The host could not route the intent (a workspace the person is not in): forget it. */
export function dropDocumentsIntent(intent: DocumentsIntent): void {
  if (pending === intent) pending = null
}

export function resetDocumentsIntentBusForTests(): void {
  consumers.clear()
  routers.clear()
  pending = null
}
