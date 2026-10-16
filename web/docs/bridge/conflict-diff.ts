/**
 * "View differences" of the Docs save conflict dialog (S5): my version against the head, built in
 * the frame from the two docx byte sets (no host call, no editor change). It reuses the editor's
 * paragraph diff (Review > Compare) and its wording, and renders into plain DOM the shared dialog
 * shows as a step of its own card: the editor's compare pane would sit behind the dialog's inert
 * backdrop, out of reach of every user.
 */
import { parseDocx } from '@genoffice/docx-engine'
import { blockTexts, compareParagraphs } from '../../../apps/docs/src/renderer/editor/compare-core'
import { text } from './notice'

/** one paragraph-level difference, the editor compare's shape */
export interface DiffEntry {
  kind: 'same' | 'removed' | 'added' | 'changed'
  /** paragraph text in my version */
  left?: string
  /** paragraph text in the head */
  right?: string
}

/** the comparison as DOM: stats line, then one card per difference, unchanged runs collapsed */
export function diffContent(headName: string, entries: readonly DiffEntry[]): HTMLElement {
  const root = document.createElement('div')
  root.className = 'ow-dlg-diff'
  const count = (kind: DiffEntry['kind']) => entries.filter((e) => e.kind === kind).length
  const [added, removed, changed] = [count('added'), count('removed'), count('changed')]
  const meta = document.createElement('p')
  meta.className = 'ow-dlg-diff-meta'
  meta.append(text('appCompareWithPrefix'))
  const name = document.createElement('b')
  name.textContent = headName
  meta.append(name, text('appCompareStats', { added, removed, changed }))
  root.append(meta)
  if (added + removed + changed === 0) {
    const same = document.createElement('p')
    same.className = 'ow-dlg-diff-same'
    same.textContent = text('appCompareIdentical')
    root.append(same)
    return root
  }
  let run = 0
  const flush = () => {
    if (run === 0) return
    const same = document.createElement('p')
    same.className = 'ow-dlg-diff-same'
    same.textContent = text('appCompareSameRun', { n: run })
    root.append(same)
    run = 0
  }
  for (const entry of entries) {
    if (entry.kind === 'same') {
      run++
      continue
    }
    flush()
    const card = document.createElement('div')
    card.className = 'ow-dlg-diff-card'
    card.dataset.kind = entry.kind
    if (entry.kind !== 'added') card.append(para('ow-dlg-diff-left', entry.left))
    if (entry.kind !== 'removed') card.append(para('ow-dlg-diff-right', entry.right))
    root.append(card)
  }
  flush()
  return root
}

function para(className: string, value: string | undefined): HTMLElement {
  const el = document.createElement('div')
  el.className = className
  el.textContent = value || text('appEmptyParagraph')
  return el
}

/** the failure variant: one line, the dialog still returns to step 1 with Back */
export function diffFailure(err: unknown): HTMLElement {
  const el = document.createElement('p')
  el.className = 'ow-dlg-diff-same'
  el.textContent = text('appCompareFailed', {
    error: err instanceof Error ? err.message : String(err),
  })
  return el
}

/** parse both documents and compare their paragraphs */
export async function buildDiff(
  mine: ArrayBuffer,
  head: ArrayBuffer,
  headName: string,
): Promise<HTMLElement> {
  try {
    const [a, b] = await Promise.all([
      parseDocx(new Uint8Array(mine)),
      parseDocx(new Uint8Array(head)),
    ])
    return diffContent(headName, compareParagraphs(blockTexts(a.blocks), blockTexts(b.blocks)))
  } catch (err) {
    console.warn('[docs-web] comparing with the head failed:', err)
    return diffFailure(err)
  }
}
