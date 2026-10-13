/**
 * G8-12 (UNI-1407): is the open document in server-comment mode (spine S12)? Yes when the host gives
 * the editor `window.uniworkComments` (desktop preload, or the web frame bridge once the frame claims
 * `comments`) AND `context({path})` answers ok for this document. Anything else — a local file, no
 * shell, an unbound copy (`not_found`), a host without `context` — keeps today's local comments.
 * Re-asked whenever the document changes; a stale answer never applies to another document.
 */
import { useEffect, useState } from 'react'
import type { ServerCommentsApi, ServerCommentsContext } from './seam'

export interface ServerMode extends ServerCommentsContext {
  api: ServerCommentsApi
  /** the path every comments call names ('' in the web frame, where the port ignores it) */
  path: string
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 128
}

/** a usable context answer, or null */
export function readContext(value: unknown): ServerCommentsContext | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!isId(v.documentId)) return null
  if (v.versionId !== null && v.versionId !== undefined && !isId(v.versionId)) return null
  const level = v.level === 'view' || v.level === 'edit' || v.level === 'manage' ? v.level : undefined
  return {
    documentId: v.documentId,
    versionId: isId(v.versionId) ? v.versionId : null,
    ...(level ? { level } : {}),
    ...(isId(v.myUserId) ? { myUserId: v.myUserId } : {}),
  }
}

export async function resolveServerMode(
  api: ServerCommentsApi | undefined,
  path: string | null | undefined,
): Promise<ServerMode | null> {
  if (!api || typeof api.context !== 'function') return null
  const p = path ?? ''
  try {
    const reply = await api.context({ path: p })
    if (!reply || !reply.ok) return null
    const ctx = readContext(reply.value)
    return ctx ? { ...ctx, api, path: p } : null
  } catch {
    return null
  }
}

/**
 * The server mode of the document identified by `docKey` (any value that changes when another
 * document opens) at `path`; null while unknown and for a local document.
 */
export function useServerMode(
  docKey: unknown,
  path: string | null | undefined,
  api: ServerCommentsApi | undefined = typeof window !== 'undefined'
    ? window.uniworkComments
    : undefined,
): ServerMode | null {
  const [mode, setMode] = useState<{ key: unknown; mode: ServerMode } | null>(null)
  useEffect(() => {
    setMode(null)
    if (!docKey) return
    let live = true
    void resolveServerMode(api, path).then((m) => {
      if (live && m) setMode({ key: docKey, mode: m })
    })
    return () => {
      live = false
    }
  }, [docKey, path, api])
  return mode && mode.key === docKey ? mode.mode : null
}
