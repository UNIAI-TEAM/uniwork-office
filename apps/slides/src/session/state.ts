/**
 * Slides document sessions: the per-client session map, snapshot undo/redo history,
 * history batches (AI runs), AI rollback points and the applied-op journal.
 *
 * A "client" is one renderer attached to a session: an Electron webContents id on the
 * desktop, a frame instance on the web. Two clients on the same file share one Session.
 */
import type { OpenedPptx, Slide } from '@genoffice/pptx-engine'
import { sessionPlatform } from './platform'
import { buildAllRenderSlides } from './render'

export interface Session {
  path: string
  opened: OpenedPptx
  fitWidthPx: number
  undoStack: HistorySnapshot[]
  redoStack: HistorySnapshot[]
  /** Nested history transaction used to collapse an AI tool/run into one undo step. */
  historyBatch?: {
    depth: number
    undoStart: number
    before: HistorySnapshot
  }
  /** Rollback points for the AI panel's Snapshots list, keyed by id (one per AI run that edited the deck). */
  aiSnapshots?: Map<number, HistorySnapshot>
  /** Edits that only touch archive entries (notes/comments; element-level dirty cannot detect them), reset after save */
  metaDirty?: boolean
  /** Monotonic count of metaDirty transitions, so a save can tell a notes/comments
      edit committed while its write was streaming from one the write carried. */
  metaRev?: number
  /** Transform preview gesture in progress (the first preview already pushed an undo snapshot; later previews/final commit do not) */
  transformPreview?: boolean
  /** The part currently edited in master view (exception to the fidelity rule: only that part is written back) */
  masterEdit?: { partPath: string; slide: Slide } | null
  /** A history-state notification is already queued for this session (coalesces per task) */
  historyNotifyScheduled?: boolean
  /** A deck-changed broadcast is already queued for this session (coalesces per task) */
  deckBroadcastScheduled?: boolean
  /** Monotonic sequence of the last journaled op entry (collab groundwork) */
  opSeq?: number
  /** Applied-op journal, capped ring — the attachment point for a future sync transport */
  opLog?: OpLogEntry[]
}

/** One session per client, keyed by client id (aliased entries share a session). */
export const sessions = new Map<number, Session>()

/** Flag an archive-only edit (notes/comments) and advance the save-snapshot counter. */
export function markMetaDirty(session: Session): void {
  session.metaDirty = true
  session.metaRev = (session.metaRev ?? 0) + 1
}

/** Register a fresh session for a client and announce its (empty) history. */
export function createSession(
  clientId: number,
  init: { path: string; opened: OpenedPptx; fitWidthPx: number; recovered?: boolean },
): Session {
  const session: Session = {
    path: init.path,
    opened: init.opened,
    fitWidthPx: init.fitWidthPx,
    undoStack: [],
    redoStack: [],
    ...(init.recovered ? { metaDirty: true } : {}),
  }
  sessions.set(clientId, session)
  scheduleHistoryNotify(session)
  return session
}

export function sessionDirty(session: Session): boolean {
  return (
    !!session.metaDirty ||
    session.opened.deck.slides.some(
      (s) => s.structureDirty || s.elements.some((el) => el.dirty || el.dirtyTransform),
    )
  )
}

// ── Op journal (collab groundwork) ──────────────────────────────────────
// Every applied transaction appends its records here in order. Snapshot restores
// (undo/redo/AI rollback) append a `reset` marker instead of inverse entries: a
// consumer that cannot invert must full-resync past one. Payloads (e.g. picture
// bytes) are kept verbatim; content-addressing them is the transport layer's job.
export interface OpLogEntry {
  seq: number
  source: 'edit' | 'batch' | 'script' | 'generate' | 'reset'
  ops: Array<{ op: { op: string; [k: string]: unknown }; slideId?: string; created?: string[] }>
}
const OP_LOG_MAX = 200

export function journalOps(
  session: Session,
  source: Exclude<OpLogEntry['source'], 'reset'>,
  records: Array<{
    op: { op: string; [k: string]: unknown }
    slideId?: string
    created?: string[]
  }>,
): void {
  if (records.length === 0) return
  const seq = (session.opSeq = (session.opSeq ?? 0) + 1)
  const log = (session.opLog ??= [])
  log.push({
    seq,
    source,
    ops: records.map((r) => ({
      op: r.op,
      ...(r.slideId ? { slideId: r.slideId } : {}),
      ...(r.created ? { created: r.created } : {}),
    })),
  })
  while (log.length > OP_LOG_MAX) log.shift()
}

// ── Undo/redo (snapshot-based) ─────────────────────────────────────────
// The document's source of truth lives in the session (deck.slides mutated in place +
// archive.entries surgery), so history lives here too: snapshot both before every edit.
// slides needs a deep copy (elements are mutated in place); entries only needs a shallow Map
// copy (byte Buffers are never mutated in place, only replaced wholesale).
export interface HistorySnapshot {
  slides: Slide[]
  entries: Map<string, Uint8Array>
  size: { cx: number; cy: number }
  /** archive-only edits (notes, theme) flag the session, so undo must restore that too */
  metaDirty: boolean
}
const MAX_HISTORY = 50

function trimHistory(stack: HistorySnapshot[]): void {
  while (stack.length > MAX_HISTORY) stack.shift()
}

export function takeSnapshot(session: Session): HistorySnapshot {
  return {
    slides: structuredClone(session.opened.deck.slides),
    entries: new Map(session.opened.archive.entries),
    size: { ...session.opened.deck.size },
    metaDirty: !!session.metaDirty,
  }
}

// slides must be deep-copied: restoreSnapshot hands them to the live deck, which mutates in place
function cloneSnapshot(snap: HistorySnapshot): HistorySnapshot {
  return {
    slides: structuredClone(snap.slides),
    entries: new Map(snap.entries),
    size: { ...snap.size },
    metaDirty: snap.metaDirty,
  }
}

/**
 * Tell the renderer whether undo/redo have anything to apply (drives the QAT
 * button gray states). Deferred to the next task so no-op handlers that push
 * a snapshot and then pop it back in the same turn report the settled state,
 * and multiple stack changes per turn coalesce into one message.
 */
export function scheduleHistoryNotify(session: Session): void {
  if (session.historyNotifyScheduled) return
  session.historyNotifyScheduled = true
  const platform = sessionPlatform()
  platform.defer(() => {
    session.historyNotifyScheduled = false
    // A shared session (second window on the same file, presenter audience) has
    // several attached clients; the undo/redo button states change for all.
    platform.events.historyChanged(attachedIds(session), {
      canUndo: session.undoStack.length > 0,
      canRedo: session.redoStack.length > 0,
    })
  })
}

/** Client ids currently mapped to this session (aliased entries included). */
export function attachedIds(session: Session): number[] {
  const ids: number[] = []
  for (const [id, s] of sessions) if (s === session) ids.push(id)
  return ids
}

/**
 * View-only attachments (presenter audience windows). They receive broadcasts
 * but cannot save, so they must not count as "someone still holds this
 * document" in close guards.
 */
export const viewerWcIds = new Set<number>()

/** Attached clients that can actually edit/save the session. */
export function editorAttachedIds(session: Session): number[] {
  return attachedIds(session).filter((id) => !viewerWcIds.has(id))
}

/**
 * Push the session's current render state to every attached client (coalesced
 * per task, like scheduleHistoryNotify, so it fires after the handler's own
 * post-processing). No-op for the ordinary single-client session; with a second
 * window on the same file this is what makes one side's edit appear on the
 * other. The originating client applies its handler's return value and simply
 * receives the same state again.
 */
export function scheduleDeckBroadcast(session: Session): void {
  if (session.deckBroadcastScheduled) return
  session.deckBroadcastScheduled = true
  const platform = sessionPlatform()
  platform.defer(() => {
    session.deckBroadcastScheduled = false
    const ids = attachedIds(session)
    if (ids.length < 2) return
    const payload = {
      slides: buildAllRenderSlides(session.opened, session.fitWidthPx),
      size: { cx: session.opened.deck.size.cx, cy: session.opened.deck.size.cy },
    }
    platform.events.deckChanged(ids, payload)
  })
}

/** Call before an edit operation: push onto the undo stack and clear the redo stack. */
export function pushHistory(session: Session): void {
  session.undoStack.push(takeSnapshot(session))
  trimHistory(session.undoStack)
  session.redoStack = []
  scheduleHistoryNotify(session)
}

/** Begin a nestable transaction. Individual edit handlers keep their normal rollback behavior. */
export function beginHistoryBatch(session: Session): void {
  if (session.historyBatch) {
    session.historyBatch.depth += 1
    return
  }
  session.historyBatch = {
    depth: 1,
    undoStart: session.undoStack.length,
    before: takeSnapshot(session),
  }
}

/**
 * End a transaction and collapse every successful edit since begin into the pre-transaction
 * snapshot. Failed/no-op handlers can continue popping their own snapshots safely.
 * Returns the pre-transaction snapshot when the outermost end collapsed real edits (null otherwise),
 * so the caller can register it as an AI-panel rollback point.
 */
export function endHistoryBatch(session: Session): HistorySnapshot | null {
  const batch = session.historyBatch
  if (!batch) return null
  batch.depth -= 1
  if (batch.depth > 0) return null
  session.historyBatch = undefined
  if (session.undoStack.length <= batch.undoStart) return null
  session.undoStack.splice(batch.undoStart)
  session.undoStack.push(batch.before)
  trimHistory(session.undoStack)
  scheduleHistoryNotify(session)
  return batch.before
}

/** Preserve the old deck and its history when AI replaces the entire presentation. */
export function carryHistoryForReplacement(
  previous: Session | undefined,
  replacement: Session,
): void {
  if (!previous) return
  pushHistory(previous)
  replacement.undoStack = previous.undoStack
  replacement.redoStack = previous.redoStack
  replacement.historyBatch = previous.historyBatch
  replacement.aiSnapshots = previous.aiSnapshots
  scheduleHistoryNotify(replacement)
}

const MAX_AI_SNAPSHOTS = 20
let nextAiSnapshotId = 1

/** Register a rollback point (stored as its own copy; `snap` typically also sits on the undo stack). */
export function registerAiSnapshot(session: Session, snap: HistorySnapshot): number {
  const map = (session.aiSnapshots ??= new Map())
  const id = nextAiSnapshotId++
  map.set(id, cloneSnapshot(snap))
  while (map.size > MAX_AI_SNAPSHOTS) map.delete(map.keys().next().value as number)
  return id
}

/** Roll the deck back to a registered AI snapshot; the pre-rollback state becomes one undo step. */
export function restoreAiSnapshot(session: Session, id: number): boolean {
  const snap = session.aiSnapshots?.get(id)
  if (!snap) return false
  pushHistory(session)
  restoreSnapshot(session, snap)
  session.aiSnapshots?.delete(id)
  return true
}

export function restoreSnapshot(session: Session, snap: HistorySnapshot): void {
  // Clone: the live deck mutates elements in place, so handing a snapshot's own
  // arrays over would let later edits rewrite history still referenced by the
  // other stack (undo → edit → redo would replay mutated state).
  const fresh = cloneSnapshot(snap)
  session.opened.deck.slides = fresh.slides
  session.opened.deck.size = fresh.size
  session.metaDirty = fresh.metaDirty
  const entries = session.opened.archive.entries
  entries.clear()
  for (const [k, v] of fresh.entries) entries.set(k, v)
  // The journal cannot express a snapshot jump as ops; mark the divergence so a
  // future consumer knows to full-resync rather than replay across it.
  if (session.opLog?.length) {
    const seq = (session.opSeq = (session.opSeq ?? 0) + 1)
    session.opLog.push({ seq, source: 'reset', ops: [] })
    while (session.opLog.length > OP_LOG_MAX) session.opLog.shift()
  }
}

/**
 * Close a history batch that outlived its run: an AI tool path that
 * throws between begin and end would otherwise leave historyBatch set forever,
 * and undo/redo — which refuse to run mid-batch — would silently do nothing for
 * the rest of the session. Collapsing here keeps the run's edits as one step.
 */
export function settleStaleHistoryBatch(session: Session): void {
  while (session.historyBatch) {
    const collapsed = endHistoryBatch(session)
    if (collapsed) registerAiSnapshot(session, collapsed)
  }
}
