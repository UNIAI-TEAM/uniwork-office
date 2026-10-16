/**
 * Review → Compare: the live-editor side of the paragraph diff (the pure diff is ./compare-core).
 */
import type { Block } from '@genoffice/docx-engine'
import { inlineToRuns, type PmNode } from './convert'

export * from './compare-core'

/** Comparable text from the live editor, including paragraphs not yet saved to the DOCX. */
export function editorBlockTexts(doc: PmNode, originalBlocks: Block[]): string[] {
  const originalByIndex = new Map(
    originalBlocks
      .filter((block) => block.docxIndex !== null)
      .map((block) => [block.docxIndex, block]),
  )
  return (doc.content ?? []).map((node) => {
    if (node.type === 'docProtected') return String(node.attrs?.previewText ?? '')
    if (node.type === 'docTable') {
      const original = originalByIndex.get(node.attrs?.docxIndex as number)
      return original?.previewText ?? ''
    }
    return inlineToRuns(node.content ?? [])
      .map((run) => run.text)
      .join('')
  })
}
