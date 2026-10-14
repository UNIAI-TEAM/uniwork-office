/**
 * G8-13 (UNI-1408): is the open workbook in server-comment mode (spine S12)? Yes when the host gives
 * the editor `window.uniworkComments` (desktop preload, or the web frame bridge once the frame claims
 * `comments`) AND `context({path})` answers ok for this workbook. Anything else — a local file, no
 * shell, an unbound copy (`not_found`), a host without `context` — keeps today's threaded comments.
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
  const level =
    v.level === 'view' || v.level === 'edit' || v.level === 'manage' ? v.level : undefined
  return {
    documentId: v.documentId,
    versionId: isId(v.versionId) ? v.versionId : null,
    ...(level ? { level } : {}),
    ...(isId(v.myUserId) ? { myUserId: v.myUserId } : {}),
    ...(v.frame === true ? { frame: true as const } : {}),
  }
}

export async function resolveServerMode(
  api: ServerCommentsApi | undefined,
  path: string | null | undefined,
): Promise<ServerMode | null> {
  if (!api || typeof api.context !== 'function') return null
  const p = path ?? ''
  let mode: ServerMode | null = null
  try {
    const reply = await api.context({ path: p })
    const ctx = reply && reply.ok ? readContext(reply.value) : null
    if (ctx) mode = { ...ctx, api, path: p }
  } catch {
    // no server mode
  }
  // the web frame waits for this editor's reveal owner: with no server mode none will come
  if (!mode) api.noEditor?.()
  return mode
}

/**
 * `window.uniworkComments`, read lazily: the web frame installs it only after init (it publishes
 * `window.uniworkCommentsReady` while that runs); desktop preloads set it before the renderer starts.
 */
export async function currentCommentsApi(): Promise<ServerCommentsApi | undefined> {
  if (typeof window === 'undefined') return undefined
  if (!window.uniworkComments && window.uniworkCommentsReady) {
    try {
      await window.uniworkCommentsReady
    } catch {
      // no comments API: local mode
    }
  }
  return window.uniworkComments
}

/**
 * The server mode of the document identified by `docKey` (any value that changes when another
 * document opens, and stays put when a Save reopens the same one) at `path`; null while unknown
 * and for a local document.
 */
export function useServerMode(
  docKey: string | null,
  path: string | null | undefined,
  /** tests inject the API; the app reads `window.uniworkComments` lazily */
  api?: ServerCommentsApi,
): ServerMode | null {
  const [mode, setMode] = useState<{ key: string; mode: ServerMode } | null>(null)
  useEffect(() => {
    setMode(null)
    if (!docKey) return
    let live = true
    void (api ? Promise.resolve(api) : currentCommentsApi())
      .then((a) => resolveServerMode(a, path))
      .then((m) => {
        if (live && m) setMode({ key: docKey, mode: m })
      })
    return () => {
      live = false
    }
  }, [docKey, path, api])
  return mode && mode.key === docKey ? mode.mode : null
}
