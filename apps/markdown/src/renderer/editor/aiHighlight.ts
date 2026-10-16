import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { isHistoryTransaction, redoDepth, undoDepth } from '@tiptap/pm/history'
import { AddMarkStep, RemoveMarkStep } from '@tiptap/pm/transform'
import { OP_META, blockIndexRange, blockRange, type OpMeta } from './ops'

const key = new PluginKey<HighlightState>('aiHighlight')

type Range = { from: number; to: number }

/**
 * Ranges (in tr.doc coordinates) an AI op transaction rewrote, read off its
 * step maps. A structural step (heading conversion, wrap) only touches node
 * boundary tokens where an inline decoration paints nothing, so text-less
 * ranges widen to the top-level block(s) they sit in.
 */
function changedRanges(tr: Transaction): Range[] {
  const ranges: Range[] = []
  const push = (from: number, to: number) => {
    if (to <= from) return
    let inline = false
    tr.doc.nodesBetween(from, to, (node) => {
      if (node.isInline) inline = true
      return !inline
    })
    if (inline) return ranges.push({ from, to })
    const { startIndex, endIndex } = blockIndexRange(tr.doc, from, to)
    ranges.push(blockRange(tr.doc, startIndex, endIndex))
  }
  tr.steps.forEach((step, i) => {
    const rest = tr.mapping.slice(i + 1)
    // mark steps do not move positions, so their step map is empty — use the step's own range
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      push(rest.map(step.from, 1), rest.map(step.to, -1))
      return
    }
    step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      push(rest.map(newStart, 1), rest.map(newEnd, -1))
    })
  })
  return ranges
}

/** Remove every AI-change highlight (a new run starts, or the panel goes away) */
export function clearAiHighlights(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.setMeta('aiHighlightClear', true))
}

/**
 * The highlight outlives its run and goes when the user saves; an autosave is not the user
 * accepting the change, so it keeps the highlight.
 */
export function clearAiHighlightsOnSave(editor: Editor, origin?: 'auto'): void {
  if (origin !== 'auto') clearAiHighlights(editor)
}

interface HighlightState {
  set: DecorationSet
  /**
   * one entry per undo the editor could still redo: did that undo take the wash off something?
   * (its redo then puts the wash back on what it re-applies; a hand edit ends the redo stack)
   */
  redo: boolean[]
  /** the history transaction just applied took a wash away (read by the transaction appended to it) */
  removed: boolean
}

interface HistoryMeta {
  dir: 'undo' | 'redo'
  /** a redo: what it re-applied, in the new document */
  ranges: Range[]
}

const HISTORY_META = 'aiHighlightHistory'

/**
 * Yellow wash over content the AI wrote (every transaction an AI-sourced runOps dispatches), so
 * the user can see what changed. It stays after the run until the user saves or the next run
 * starts; an undo of the run takes it away and the redo of that undo brings it back. Display-only:
 * decorations never touch the document, the serialized markdown or any export.
 */
export const AiHighlight = Extension.create({
  name: 'aiHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<HighlightState>({
        key,
        state: {
          init: () => ({ set: DecorationSet.empty, redo: [], removed: false }),
          apply(tr, value) {
            if (tr.getMeta('aiHighlightClear')) {
              return { set: DecorationSet.empty, redo: [], removed: false }
            }
            const history = tr.getMeta(HISTORY_META) as HistoryMeta | undefined
            let next = value.set.map(tr.mapping, tr.doc)
            let redo = value.redo
            let removed = false
            const addWash = (ranges: Range[]): void => {
              for (const range of ranges) {
                const from = Math.max(0, Math.min(range.from, tr.doc.content.size))
                const to = Math.max(from, Math.min(range.to, tr.doc.content.size))
                if (to > from) {
                  next = next.add(tr.doc, [Decoration.inline(from, to, { class: 'ai-changed' })])
                }
              }
            }
            if (history) {
              // the transaction appended to an undo / redo says which one it was
              if (history.dir === 'undo') redo = [...redo, value.removed]
              else {
                const brought = redo.at(-1)
                redo = redo.slice(0, -1)
                if (brought) addWash(history.ranges)
              }
              return { set: next, redo, removed: false }
            }
            // an undo / redo puts the text it touches back: the wash over it must not stay behind
            // (a style-only change keeps its text, so mapping alone would leave the wash on it)
            if (isHistoryTransaction(tr) && tr.docChanged) {
              const before = value.set.find().length
              for (const range of changedRanges(tr)) {
                next = next.remove(next.find(range.from, range.to, (spec) => spec !== null))
              }
              removed = next.find().length < before
            } else if (tr.docChanged && tr.getMeta('addToHistory') !== false) {
              // a new edit ends the redo stack
              redo = []
            }
            const meta = tr.getMeta(OP_META) as OpMeta | undefined
            if (meta?.source === 'ai' && !meta.rollback && tr.docChanged) addWash(changedRanges(tr))
            return { set: next, redo, removed }
          },
        },
        // tell the plugin whether a history step was an undo or a redo (the transaction itself
        // does not say): a step-less transaction appended to it carries the answer
        appendTransaction(trs, oldState, newState) {
          const step = trs.find((tr) => isHistoryTransaction(tr) && tr.docChanged)
          if (!step) return null
          const dir: HistoryMeta['dir'] | null =
            redoDepth(newState) > redoDepth(oldState)
              ? 'undo'
              : undoDepth(newState) > undoDepth(oldState)
                ? 'redo'
                : null
          if (!dir) return null
          return newState.tr.setMeta('addToHistory', false).setMeta(HISTORY_META, {
            dir,
            ranges: dir === 'redo' ? changedRanges(step) : [],
          } satisfies HistoryMeta)
        },
        props: {
          decorations(state) {
            return key.getState(state)?.set
          },
        },
      }),
    ]
  },
})
