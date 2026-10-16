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

/** this node or something below it carries the AI marker */
function carriesMark(node: PmNode): boolean {
  return Boolean(node.attrs?.aiChanged) || docHasAiMarks(node)
}

/**
 * The reloaded document with the live doc's AI marker carried over. A save that has to rewrite
 * the editor from the written file (the file gives blocks new docxIndex anchors) would otherwise
 * drop the marker, which is not file content: an autosave must leave it on screen, only a user
 * Save or Accept clears it (a user Save clears it before writing, so nothing is carried then).
 * Children pair by index when their count is unchanged, else by their text; the walk goes down
 * into containers (a table cell's paragraph carries the marker, the table does not).
 */
export function carryAiMarks(live: PmNode, next: PmJson): PmJson {
  if (!docHasAiMarks(live)) return next
  return carryInto(live, next)
}

function carryInto(live: PmNode, next: PmJson): PmJson {
  let result = next
  if (live.attrs?.aiChanged && next.attrs && 'aiChanged' in next.attrs)
    result = { ...result, attrs: { ...next.attrs, aiChanged: true } }
  const children = next.content
  if (!children) return result
  // live child index -> reloaded child index, for the children that carry a marker
  const pairs = new Map<number, number>()
  const marked: number[] = []
  live.forEach((child, _offset, index) => {
    if (carriesMark(child)) marked.push(index)
  })
  if (marked.length === 0) return result
  if (live.childCount === children.length) for (const i of marked) pairs.set(i, i)
  else {
    const texts = children.map(jsonText)
    let from = 0
    for (const i of marked) {
      const at = texts.indexOf(live.child(i).textContent, from)
      if (at < 0) continue
      pairs.set(i, at)
      from = at + 1
    }
  }
  if (pairs.size === 0) return result
  const byTarget = new Map<number, number>()
  for (const [liveIndex, at] of pairs) byTarget.set(at, liveIndex)
  return {
    ...result,
    content: children.map((child, i) => {
      const liveIndex = byTarget.get(i)
      return liveIndex === undefined ? child : carryInto(live.child(liveIndex), child)
    }),
  }
}

function jsonText(node: PmJson): string {
  return (node.text ?? '') + (node.content ?? []).map(jsonText).join('')
}
