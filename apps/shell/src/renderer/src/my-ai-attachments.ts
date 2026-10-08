/**
 * My AI attachment helpers — pick / read / multimodal images (on-device only).
 */
import type { AgentImage } from '@genoffice/agent-core'
import {
  ATTACHMENT_IMAGE_EXTS,
  type AttachmentAddResult,
  type AttachmentMeta,
} from '../../shared/home-api'

const MAX_IMAGES = 20
const MAX_FILE_CHARS = 6_000
const MAX_FILES_TEXT = 4

export { ATTACHMENT_IMAGE_EXTS }
export type { AttachmentMeta }

export function isImageAttachment(att: AttachmentMeta): boolean {
  return ATTACHMENT_IMAGE_EXTS.has(att.ext)
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function mergeAttachmentResult(
  current: AttachmentMeta[],
  result: AttachmentAddResult | null,
): { next: AttachmentMeta[]; notice: string | null } {
  if (!result) return { next: current, notice: null }
  const seen = new Set(current.map((a) => a.path))
  const added = result.accepted.filter((a) => !seen.has(a.path))
  const notice =
    result.rejected.length > 0
      ? result.rejected.slice(0, 3).join('; ')
      : added.length === 0 && result.accepted.length > 0
        ? 'Already attached'
        : null
  return { next: [...current, ...added].slice(0, 12), notice }
}

export async function collectImageAttachments(atts: AttachmentMeta[]): Promise<AgentImage[]> {
  const api = window.aiOffice
  if (!api.readAttachmentImage) return []
  const images: AgentImage[] = []
  for (const att of atts.filter(isImageAttachment).slice(0, MAX_IMAGES)) {
    const result = await api.readAttachmentImage(att.path)
    if (result.ok && result.base64 && result.mime) {
      images.push({ base64: result.base64, mime: result.mime })
    }
  }
  return images
}

/** Extract text from non-image attachments for brief / prompt grounding. */
export async function collectAttachmentTextBlock(atts: AttachmentMeta[]): Promise<string> {
  const api = window.aiOffice
  if (!api.readAttachment) return ''
  const files = atts.filter((a) => !isImageAttachment(a)).slice(0, MAX_FILES_TEXT)
  if (files.length === 0) {
    const imgs = atts.filter(isImageAttachment)
    if (imgs.length === 0) return ''
    return `Attached images: ${imgs.map((a) => a.name).join(', ')}`
  }
  const parts: string[] = []
  for (const f of files) {
    const res = await api.readAttachment(f.path, 0, MAX_FILE_CHARS)
    if (res.ok && res.text?.trim()) {
      parts.push(`--- ${f.name} ---\n${res.text.trim()}`)
    } else {
      parts.push(`--- ${f.name} --- (could not read text)`)
    }
  }
  const imgs = atts.filter(isImageAttachment)
  if (imgs.length > 0) {
    parts.push(`Attached images (vision): ${imgs.map((a) => a.name).join(', ')}`)
  }
  return parts.join('\n\n')
}

export function attachmentEchoLabel(atts: AttachmentMeta[], vi: boolean): string {
  if (atts.length === 0) return ''
  const names = atts.map((a) => a.name).join(', ')
  return vi ? `\n📎 ${atts.length} tệp: ${names}` : `\n📎 ${atts.length} file(s): ${names}`
}
