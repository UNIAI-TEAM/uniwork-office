/** Budget-capped local file excerpt for My AI (never full vault dumps). */

export const FILE_EXCERPT_MAX_FILES = 6
export const FILE_EXCERPT_MAX_CHARS = 1_400
export const FILE_EXCERPT_MAX_BYTES = 8 * 1024 * 1024
export const FILE_EXCERPT_PACK_CHARS = 6_500

export type FileExcerptStatus = 'ok' | 'skipped' | 'unsupported' | 'too_large' | 'error'

export interface FileExcerpt {
  path: string
  name: string
  ext: string
  status: FileExcerptStatus
  excerpt?: string
  charCount?: number
  error?: string
}

export function clipExcerpt(text: string, max = FILE_EXCERPT_MAX_CHARS): string {
  const t = text.replace(/\u0000/g, '').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

/** Flatten excerpts into a prompt block (pack-budgeted). */
export function formatExcerptsForPrompt(items: readonly FileExcerpt[], maxChars = FILE_EXCERPT_PACK_CHARS): string {
  const parts: string[] = []
  let used = 0
  for (const item of items) {
    const head = `### ${item.name} (.${item.ext}) [${item.status}]`
    const body =
      item.status === 'ok' && item.excerpt
        ? item.excerpt
        : item.error || item.status
    const block = `${head}\n${body}`
    const room = maxChars - used
    if (room < 80) break
    const clipped = block.length <= room ? block : `${block.slice(0, room - 1)}…`
    parts.push(clipped)
    used += clipped.length + 2
  }
  return parts.join('\n\n')
}
