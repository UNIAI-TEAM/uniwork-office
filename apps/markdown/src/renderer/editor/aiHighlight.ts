import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { isHistoryTransaction } from '@tiptap/pm/history'
import { AddMarkStep, RemoveMarkStep } from '@tiptap/pm/transform'
import { OP_META, blockIndexRange, blockRange, type OpMeta } from './ops'

const key = new PluginKey<DecorationSet>('aiHighlight')

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

/**
 * Yellow wash over content the AI wrote (every transaction an AI-sourced runOps dispatches), so
 * the user can see what changed. It stays after the run until the user saves or the next run
 * starts. Display-only: decorations never touch the document, the serialized markdown or any
 * export.
 */
export const AiHighlight = Extension.create({
  name: 'aiHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            if (tr.getMeta('aiHighlightClear')) return DecorationSet.empty
            let next = set.map(tr.mapping, tr.doc)
            // an undo / redo puts the text it touches back: the wash over it must not stay behind
            // (a style-only change keeps its text, so mapping alone would leave the wash on it)
            if (isHistoryTransaction(tr) && tr.docChanged) {
              for (const range of changedRanges(tr)) {
                next = next.remove(next.find(range.from, range.to, (spec) => spec !== null))
              }
            }
            const meta = tr.getMeta(OP_META) as OpMeta | undefined
            const add =
              meta?.source === 'ai' && !meta.rollback && tr.docChanged ? changedRanges(tr) : []
            for (const range of add) {
              const from = Math.max(0, Math.min(range.from, tr.doc.content.size))
              const to = Math.max(from, Math.min(range.to, tr.doc.content.size))
              if (to > from) {
                next = next.add(tr.doc, [Decoration.inline(from, to, { class: 'ai-changed' })])
              }
            }
            return next
          },
        },
        props: {
          decorations(state) {
            return key.getState(state)
          },
        },
      }),
    ]
  },
})
