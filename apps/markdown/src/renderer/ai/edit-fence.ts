import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import type { Transaction } from '@tiptap/pm/state'
import { blockIndexRange, blockRange } from '../editor/ops'

/**
 * Edit fence of a selection-scoped AI turn: when the user sends with the
 * scope chip (a non-empty selection) or submits the edit queue, the run may
 * only change the top-level blocks those ranges cover. The panel sets the
 * fence at send and clears it when the run ends (`clearEditFence`); the tools check every write
 * against it in code (apply_ops is rolled back, whole-document writers are
 * refused), so the text outside stays byte-identical whatever the model
 * sends. A new turn gets the fence of its own scope (`turnFence`); a retried one
 * gets the fence its entry ended with (`retryFence`), never the one the last
 * send left. Blocks are the unit because the ops address blocks: a fence over
 * part of a paragraph allows rewriting that paragraph. Content inserted
 * directly before or after a fenced block counts as inside.
 */

export interface FenceRange {
  from: number
  to: number
}

interface Fence {
  ranges: FenceRange[]
  /** keeps the ranges on the same content through every edit (AI and user) */
  follow: (props: { transaction: Transaction; appendedTransactions?: Transaction[] }) => void
}

const fences = new WeakMap<Editor, Fence>()

export const FENCE_REFUSAL =
  'This turn edits only the user selection (or the queued targets); the change touched content outside the selection, so nothing was applied. Keep every edit inside the selected blocks (target "selection" or their indexes), or ask the user to clear the selection to edit the rest of the document.'

/** the live non-empty selection as a fence range; null when nothing is selected */
export function selectionFence(editor: Editor): FenceRange[] | null {
  const { from, to, empty } = editor.state.selection
  return empty ? null : [{ from, to }]
}

/**
 * set (or with null clear) the fence for the editor's current AI turn; an empty
 * list is a fence that allows nothing (every edit is refused), never "no fence"
 */
export function setEditFence(editor: Editor, ranges: FenceRange[] | null): void {
  const previous = fences.get(editor)
  if (previous) editor.off('transaction', previous.follow)
  fences.delete(editor)
  if (!ranges) return
  const doc = editor.state.doc
  const fence: Fence = {
    // whole blocks, so a block the run inserts at a fenced block's edge stays editable
    ranges: ranges.map((r) => {
      const { startIndex, endIndex } = blockIndexRange(doc, r.from, Math.max(r.to, r.from + 1))
      return blockRange(doc, startIndex, endIndex)
    }),
    follow: ({ transaction, appendedTransactions }) => {
      for (const tr of [transaction, ...(appendedTransactions ?? [])]) {
        if (!tr.docChanged) continue
        // widen on both edges: content landing right at a fenced block's edge stays inside
        fence.ranges = fence.ranges.map((r) => ({
          from: tr.mapping.map(r.from, -1),
          to: tr.mapping.map(r.to, 1),
        }))
      }
    },
  }
  editor.on('transaction', fence.follow)
  fences.set(editor, fence)
}

/**
 * clear the fence at the end of a run (done, error or stop) and drop its
 * transaction listener; returns where the ranges ended up (null when no fence
 * was set) so a retry of the same turn can reuse them
 */
export function clearEditFence(editor: Editor): FenceRange[] | null {
  const previous = fences.get(editor)
  if (!previous) return null
  editor.off('transaction', previous.follow)
  fences.delete(editor)
  return previous.ranges
}

/**
 * the fence a NEW turn runs with: a queue submission keeps its anchored ranges
 * (an empty list stays an empty fence); a scoped turn (scope chip) is fenced to
 * the live selection; an unscoped turn has no fence.
 */
export function turnFence(
  editor: Editor,
  opts: { scoped: boolean; queueFence?: FenceRange[] },
): FenceRange[] | null {
  if (opts.queueFence) return opts.queueFence
  if (!opts.scoped) return null
  return selectionFence(editor)
}

/** what a chat entry remembers about the fence of its turn */
export interface EntryFence {
  /** the turn was fenced (selection scope or queue submission) */
  fenced: boolean
  /** where the fence's ranges ended up when its run ended; absent for an entry restored from a transcript */
  ranges?: FenceRange[] | null
}

/**
 * the fence of a RETRIED turn, shared by the header retry and the bubble retry:
 * a fenced turn is never retried unfenced. It reuses the ranges its own run
 * ended with (not the live selection, not another entry's fence); when the
 * entry has none (restored from a transcript) it runs against an empty fence,
 * so every edit is refused instead of leaking. An unscoped turn stays unfenced.
 */
export function retryFence(entry: EntryFence): FenceRange[] | null {
  if (!entry.fenced) return null
  return entry.ranges ?? []
}

/**
 * what a user/assistant entry restored from a stored transcript carries. The stored message does
 * not say whether a user turn was a queue submission (it is saved as its summary, without scope),
 * so every restored user entry is fenced with unknown ranges (retryFence then refuses every edit)
 * and flagged restored, which hides the bubble retry: a fenced turn is never retried unfenced.
 */
export function restoredEntryState(role: 'user' | 'assistant'): {
  restored?: true
  fence?: EntryFence
} {
  return role === 'user' ? { restored: true, fence: { fenced: true } } : {}
}

/** the bubble retry belongs to a live undelivered entry only, never to a restored one */
export function canRetryEntry(
  entry: { undelivered?: boolean; restored?: boolean },
  busy: boolean,
): boolean {
  return !!entry.undelivered && !entry.restored && !busy
}

export function hasEditFence(editor: Editor): boolean {
  return fences.has(editor)
}

/** fenced top-level block index ranges in the current document, sorted, merged */
export function fencedBlocks(editor: Editor): Array<[number, number]> {
  const fence = fences.get(editor)
  if (!fence) return []
  const doc = editor.state.doc
  const spans = fence.ranges
    .map((r): [number, number] => {
      const from = Math.max(0, Math.min(r.from, doc.content.size))
      const to = Math.max(from, Math.min(r.to, doc.content.size))
      const { startIndex, endIndex } = blockIndexRange(doc, from, Math.max(to, from + 1))
      return [startIndex, endIndex]
    })
    .sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const span of spans) {
    const last = merged.at(-1)
    if (last && span[0] <= last[1] + 1) last[1] = Math.max(last[1], span[1])
    else merged.push([...span])
  }
  return merged
}

function blocksOf(doc: PmNode): PmNode[] {
  const out: PmNode[] = []
  doc.forEach((node) => out.push(node))
  return out
}

function sameRun(blocks: PmNode[], at: number, run: PmNode[]): boolean {
  if (at < 0 || at + run.length > blocks.length) return false
  return run.every((node, i) => node.eq(blocks[at + i]!))
}

/**
 * null when `after` keeps every block outside `spans` (block indexes of
 * `before`) identical and in order; else the refusal message. The gaps
 * between fenced spans are matched in order: the first as a prefix, the last
 * as a suffix, the ones in between at their first match after the previous.
 */
export function fenceViolation(
  before: PmNode,
  after: PmNode,
  spans: Array<[number, number]>,
): string | null {
  const old = blocksOf(before)
  const now = blocksOf(after)
  const gaps: PmNode[][] = []
  let cursor = 0
  for (const [start, end] of spans) {
    gaps.push(old.slice(cursor, start))
    cursor = end + 1
  }
  gaps.push(old.slice(cursor))
  const first = gaps[0]!
  const last = gaps.at(-1)!
  if (!sameRun(now, 0, first)) return FENCE_REFUSAL
  if (!sameRun(now, now.length - last.length, last)) return FENCE_REFUSAL
  let at = first.length
  const limit = now.length - last.length
  for (const gap of gaps.slice(1, -1)) {
    if (gap.length === 0) continue
    let found = -1
    for (let i = at; i + gap.length <= limit; i++) {
      if (sameRun(now, i, gap)) {
        found = i
        break
      }
    }
    if (found < 0) return FENCE_REFUSAL
    at = found + gap.length
  }
  return at <= limit ? null : FENCE_REFUSAL
}

/** whether a write landing after block `afterIndex` (-1 = start) stays inside the fence */
export function insertInsideFence(editor: Editor, afterIndex: number): boolean {
  return fencedBlocks(editor).some(([start, end]) => afterIndex >= start - 1 && afterIndex <= end)
}
