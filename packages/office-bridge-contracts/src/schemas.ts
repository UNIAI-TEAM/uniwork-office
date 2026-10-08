import { z } from 'zod'
import { OFFICE_MIME_BY_EXT, SUPPORTED_OFFICE_EXTENSIONS } from './constants'

const id = z.string().min(1).max(128)

export const officeSessionCreateRequestSchema = z.object({
  documentId: id,
})

export const officeLaunchExchangeRequestSchema = z.object({
  token: z.string().min(16).max(256),
})

export const officeSavePrepareRequestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  baseVersion: z.number().int().nonnegative(),
  sessionId: id,
})

export const officeSaveCompleteRequestSchema = z.object({
  sessionId: id,
  saveOperationId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
})

export const supportedOfficeExtensionSchema = z.enum(SUPPORTED_OFFICE_EXTENSIONS)

export function mimeForExtension(ext: string): string | null {
  const key = ext.replace(/^\./, '').toLowerCase()
  if (key === 'docx' || key === 'xlsx' || key === 'pptx' || key === 'pdf') {
    return OFFICE_MIME_BY_EXT[key]
  }
  return null
}
