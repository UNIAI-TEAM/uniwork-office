/** Session handlers: History batches, AI rollback points, undo/redo, dirty state, save and save-as. */
import { commitSaved } from '@genoffice/pptx-engine'
import type { HandlerContext } from '../host-io'
import { buildAllRenderSlides } from '../render'
import {
  beginHistoryBatch,
  endHistoryBatch,
  registerAiSnapshot,
  restoreAiSnapshot,
  restoreSnapshot,
  scheduleDeckBroadcast,
  scheduleHistoryNotify,
  sessionDirty,
  sessions,
  settleStaleHistoryBatch,
  takeSnapshot,
} from '../state'

export const historySaveHandlers = {
  'slides:history-batch-begin': (ctx: HandlerContext) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return false
    beginHistoryBatch(session)
    return true
  },

  'slides:history-batch-end': (ctx: HandlerContext) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return null
    const before = endHistoryBatch(session)
    return before ? registerAiSnapshot(session, before) : null
  },

  'slides:ai-snapshot-restore': (ctx: HandlerContext, id: number) => {
    const session = sessions.get(ctx.clientId)
    if (!session || session.masterEdit || session.historyBatch) return null
    if (!restoreAiSnapshot(session, id)) return null
    scheduleDeckBroadcast(session)
    return buildAllRenderSlides(session.opened, session.fitWidthPx)
  },

  'slides:undo': (ctx: HandlerContext) => {
    const session = sessions.get(ctx.clientId)
    // Undo disabled in master view: the masterEdit.slide model cannot roll back with snapshots (v1 trade-off; undoable after exiting)
    if (!session || session.masterEdit) return null
    settleStaleHistoryBatch(session)
    if (session.undoStack.length === 0) return null
    session.redoStack.push(takeSnapshot(session))
    restoreSnapshot(session, session.undoStack.pop()!)
    scheduleHistoryNotify(session)
    scheduleDeckBroadcast(session)
    return buildAllRenderSlides(session.opened, session.fitWidthPx)
  },

  'slides:redo': (ctx: HandlerContext) => {
    const session = sessions.get(ctx.clientId)
    if (!session || session.masterEdit) return null
    settleStaleHistoryBatch(session)
    if (session.redoStack.length === 0) return null
    session.undoStack.push(takeSnapshot(session))
    restoreSnapshot(session, session.redoStack.pop()!)
    scheduleHistoryNotify(session)
    scheduleDeckBroadcast(session)
    return buildAllRenderSlides(session.opened, session.fitWidthPx)
  },

  'slides:is-dirty': (ctx: HandlerContext) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return false
    return sessionDirty(session)
  },

  'slides:save': async (ctx: HandlerContext, rawOrigin?: unknown) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return { ok: false, error: 'no file open' }
    const pathBefore = session.path || null
    const gate =
      pathBefore && ctx.host.saveGate
        ? ctx.host.saveGate({
            kind: 'save',
            origin: rawOrigin === 'auto' ? 'auto' : 'user',
            currentPath: pathBefore,
            targetPath: pathBefore,
          })
        : { write: true, fireHook: false }
    // view-only UniWork document, or an AutoSave pass on one: no write, cancel shape
    if (!gate.write) return { ok: false }
    // Untitled (new blank file): the first save goes to the host's untitled target
    // without a dialog (the desktop lands it in the drafts folder; Save As keeps its dialog)
    if (!session.path) {
      session.path = ctx.host.saveTarget.untitled()
      await ctx.host.saved({ kind: 'untitled', session, path: session.path })
    }
    try {
      const metaRevAtSave = session.metaRev ?? 0
      await ctx.host.writeDeck(session.opened, session.path)
      await ctx.host.saved({ kind: 'save', session, path: session.path })
      // Bake the saved patches back into the in-memory model (clears dirty, syncs
      // anchor.originalXml with disk) — a full reopen would re-read and unzip the
      // whole package, doubling save latency on large decks. Element ids survive,
      // but the renderer still expects the render tree in the response.
      commitSaved(session.opened)
      if ((session.metaRev ?? 0) === metaRevAtSave) session.metaDirty = false
      if (gate.fireHook) ctx.host.userSaved?.(session.path)
      return {
        ok: true,
        path: session.path,
        slides: buildAllRenderSlides(session.opened, session.fitWidthPx),
      }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  },

  'slides:save-as': async (ctx: HandlerContext, defaultName: string) => {
    const session = sessions.get(ctx.clientId)
    if (!session) return { ok: false, error: 'no file open' }
    const target = await ctx.host.saveTarget.saveAs(session.path, defaultName)
    if (!target) return { ok: false }
    // A view-only UniWork path is refused (cancel shape); picking the deck's own
    // file is an explicit Save of it and reports a user save, any other target is
    // a plain local copy
    const gate = ctx.host.saveGate?.({
      kind: 'save-as',
      origin: 'user',
      currentPath: session.path || null,
      targetPath: target,
    }) ?? { write: true, fireHook: false }
    if (!gate.write) return { ok: false }
    try {
      const metaRevAtSave = session.metaRev ?? 0
      await ctx.host.writeDeck(session.opened, target)
      session.path = target
      await ctx.host.saved({ kind: 'saveAs', session, path: target })
      commitSaved(session.opened)
      if ((session.metaRev ?? 0) === metaRevAtSave) session.metaDirty = false
      if (gate.fireHook) ctx.host.userSaved?.(target)
      return {
        ok: true,
        path: target,
        slides: buildAllRenderSlides(session.opened, session.fitWidthPx),
      }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  },

  'slides:recent': (ctx: HandlerContext) => ctx.host.recent(),
}
