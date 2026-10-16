import type { Node as PmNode } from '@tiptap/pm/model'
import type { PmNode as PmJson } from './convert'

/** per document: any block carries the AI marker (a PM doc is immutable, so the answer never changes) */
const markedMemo = new WeakMap<PmNode, boolean>()

/** some node of the document still carries the AI change marker (memoised per document) */
export function docHasAiMarks(doc: PmNode): boolean {
  const known = markedMemo.get(doc)
  if (known !== undefined) return known
  let found = false
  doc.descendants((node) => {
    if (found) return false
    if (node.attrs?.aiChanged) found = true
    return !found
  })
  markedMemo.set(doc, found)
  return found
}

/** the document as JSON with the marker normalised away (the marker is not file content) */
function unmarkedJson(node: PmNode): unknown {
  const walk = (n: Record<string, unknown>): Record<string, unknown> => {
    const attrs = n.attrs as Record<string, unknown> | undefined
    return {
      ...n,
      ...(attrs && 'aiChanged' in attrs ? { attrs: { ...attrs, aiChanged: false } } : {}),
      ...(Array.isArray(n.content)
        ? { content: (n.content as Record<string, unknown>[]).map(walk) }
        : {}),
    }
  }
  return walk(node.toJSON() as Record<string, unknown>)
}

/**
 * Document equality that ignores the AI marker. A save compares the live doc with the one
 * reloaded from the written bytes (which never carry the marker); a marked doc must still count
 * as unchanged there, or the save would rewrite it, wipe the marker and reset undo history.
 */
export function sameDocIgnoringAiMarks(a: PmNode, b: PmNode): boolean {
  if (a.eq(b)) return true
  if (!docHasAiMarks(a) && !docHasAiMarks(b)) return false
  return JSON.stringify(unmarkedJson(a)) === JSON.stringify(unmarkedJson(b))
}

/**
 * The reloaded document with the live doc's AI marker carried over. A save that has to rewrite
 * the editor from the written file (the file gives blocks new docxIndex anchors) would otherwise
 * drop the marker, which is not file content: an autosave must leave it on screen, only a user
 * Save or Accept clears it (a user Save clears it before writing, so nothing is carried then).
 * Top-level blocks pair by index when the block count is unchanged, else by their text.
 */
export function carryAiMarks(live: PmNode, next: PmJson): PmJson {
  if (!docHasAiMarks(live) || !next.content) return next
  const marked = new Set<number>()
  live.forEach((node, _offset, index) => {
    let hit = Boolean(node.attrs?.aiChanged)
    if (!hit)
      node.descendants((child) => {
        if (child.attrs?.aiChanged) hit = true
        return !hit
      })
    if (hit) marked.add(index)
  })
  const targets = new Set<number>()
  if (live.childCount === next.content.length) for (const i of marked) targets.add(i)
  else {
    const texts = next.content.map(jsonText)
    let from = 0
    for (const i of [...marked].sort((a, b) => a - b)) {
      const at = texts.indexOf(live.child(i).textContent, from)
      if (at < 0) continue
      targets.add(at)
      from = at + 1
    }
  }
  if (targets.size === 0) return next
  return {
    ...next,
    content: next.content.map((block, i) =>
      targets.has(i) && block.attrs && 'aiChanged' in block.attrs
        ? { ...block, attrs: { ...block.attrs, aiChanged: true } }
        : block,
    ),
  }
}

function jsonText(node: PmJson): string {
  return (node.text ?? '') + (node.content ?? []).map(jsonText).join('')
}
