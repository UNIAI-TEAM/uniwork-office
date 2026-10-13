/**
 * G8-12 (UNI-1407): the w14:paraId of the source paragraph a top-level block came from, read from the
 * parsed block's original XML (the editor model does not carry it). An anchor's `para_id` lets a
 * comment find its paragraph again after blocks above it moved.
 */
import type { Node as PmNode } from '@tiptap/pm/model'

const PARA_ID = /^<w:p\b[^>]*?\bw14:paraId="([0-9A-Fa-f]{1,8})"/

export function paraIdResolver(
  blocks: () => ReadonlyArray<{ docxIndex?: number | null; originalXml?: string | null }>,
): (node: PmNode) => string | undefined {
  let cached: { source: unknown; ids: Map<number, string> } | null = null
  return (node) => {
    const index = (node.attrs as Record<string, unknown>).docxIndex
    if (typeof index !== 'number') return undefined
    const list = blocks()
    if (!cached || cached.source !== list) {
      const ids = new Map<number, string>()
      for (const b of list) {
        const m =
          typeof b.docxIndex === 'number' && b.originalXml ? PARA_ID.exec(b.originalXml) : null
        if (m) ids.set(b.docxIndex as number, m[1]!)
      }
      cached = { source: list, ids }
    }
    return cached.ids.get(index)
  }
}
