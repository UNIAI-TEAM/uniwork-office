import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { closeHistory, isHistoryTransaction } from '@tiptap/pm/history'
import type { RunHistoryGroup } from '@genoffice/agent-core'
import { editableIntent } from './editable-intent'

export const AI_RUN_HISTORY_KEY = new PluginKey('aiRunHistory')

export interface DocsRunHistoryGroup extends RunHistoryGroup {
  /** the editor whose history the group folds (null detaches; the panel re-attaches on a new editor) */
  attach(editor: Editor | null): void
}

/** a change prosemirror-history records as an undo step (not an undo/redo itself, not opted out) */
function recordsHistory(tr: Transaction): boolean {
  return tr.docChanged && tr.getMeta('addToHistory') !== false && !isHistoryTransaction(tr)
}

/**
 * Folds every ProseMirror change of one AI run into ONE undo step: begin() on the loop's
 * onRunStart, end() on onRunEnd. While the run is open the view is not editable (Stop ends
 * the run; end() puts back the App's own editable setting, see restoreEditable), so each
 * recorded change in that window is the run's own: the first one starts a
 * fresh history event, every later one joins it. prosemirror-history has no explicit group
 * API; a transaction carrying the `appendedTransaction` meta is merged into the previous
 * event regardless of time or adjacency, which is what this uses. A run that changed nothing
 * records nothing, so no empty step is left behind (a Stop reports mutated=true even when the
 * cut tool did nothing). Changes outside the history (the write_document draft, the AI marker)
 * stay outside it.
 */
export function createDocsRunHistoryGroup(): DocsRunHistoryGroup {
  let editor: Editor | null = null
  let active: string | null = null
  /** the next recorded change of the run opens its event */
  let fresh = false
  /** the run recorded something: the next change after it must not merge into it */
  let closeNext = false
  /** editor option at begin(): the fallback when the App never stated its intent */
  let editableAtBegin = true
  /** the page had focus when the run locked it: it gets it back when the run ends */
  let focusedAtBegin = false

  const plugin = new Plugin({
    key: AI_RUN_HISTORY_KEY,
    props: {
      editable: () => active === null,
    },
    filterTransaction(tr) {
      // an Undo/Redo command (ribbon, menu) during the run would pop the run's own event or an
      // older one, and the rest of the run would then merge into the wrong step
      if (active !== null && isHistoryTransaction(tr)) return false
      if (!recordsHistory(tr)) return true
      if (active !== null) {
        if (fresh) {
          closeHistory(tr)
          fresh = false
          closeNext = true
        } else {
          tr.setMeta('appendedTransaction', tr)
        }
      } else if (closeNext) {
        closeHistory(tr)
        closeNext = false
      }
      return true
    },
  })

  /** the view re-reads `editable` on its next update: nudge it with a no-op transaction */
  const refresh = () => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr)
  }

  /**
   * Undo what an App render wrote into the editor option while the run held the view: useEditor
   * re-applies its options as `editable: editor.isEditable` (false during the run), and that
   * would keep the page locked (no typing, no keyboard undo) long after the run ended.
   */
  const restoreEditable = () => {
    if (!editor || editor.isDestroyed) return
    const wanted = editableIntent(editor) ?? editableAtBegin
    if (editor.options.editable !== wanted) editor.setEditable(wanted, false)
  }

  return {
    get activeRunId() {
      return active
    },
    attach(next) {
      if (editor === next) return
      if (editor && !editor.isDestroyed) editor.unregisterPlugin(AI_RUN_HISTORY_KEY)
      editor = next
      if (editor && !editor.isDestroyed) editor.registerPlugin(plugin)
    },
    begin(runId) {
      active = runId
      fresh = true
      if (editor && !editor.isDestroyed) {
        editableAtBegin = editor.options.editable
        focusedAtBegin = editor.view.hasFocus()
      }
      refresh()
    },
    end(runId) {
      if (active !== runId) return
      active = null
      fresh = false
      restoreEditable()
      refresh()
      // focus went nowhere while the page was locked: hand it back (never steal it from elsewhere)
      const focused = document.activeElement
      if (
        focusedAtBegin &&
        editor &&
        !editor.isDestroyed &&
        editor.isEditable &&
        (!focused || focused === document.body || editor.view.dom.contains(focused))
      )
        editor.view.focus()
      focusedAtBegin = false
    },
  }
}
