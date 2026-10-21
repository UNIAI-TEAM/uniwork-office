import type { IpcMain } from 'electron'
import {
  ASKUNI_CHANNELS,
  type AskUniCitationKind,
  type AskUniErrorCode,
  type AskUniOpenResult,
} from '../../shared/askuni-api'
import type { UniworkDocErrorCode } from '../../shared/home-api'
import { isAllowedOrigin, type DeploymentProfile } from '../uniwork-auth/deployment'

/**
 * Opens a citation of an Ask UNI answer. The renderer sends only `{ kind, href }` (the server's
 * path); this module decides what that means, so a hostile or odd href can never pick a URL:
 *  - a document opens in the app through the existing open-by-id path;
 *  - every other kind opens as the signed-in deployment's web page, and only when the resolved
 *    URL stays on that origin (https, or http to localhost on the dev channel).
 * Every outcome is an AskUniOpenResult, never a throw.
 */

export interface AskUniOpenDeps {
  isSignedIn(): boolean
  profile(): DeploymentProfile | null
  /** the uniwork-docs service's open-by-id (downloads when needed, opens the tab) */
  openDocument(
    documentId: string,
  ): Promise<{ ok: true } | { ok: false; error: UniworkDocErrorCode }>
  openExternal(url: string): Promise<void>
}

export interface AskUniOpener {
  open(input: unknown): Promise<AskUniOpenResult>
}

const KINDS: ReadonlySet<string> = new Set<AskUniCitationKind>([
  'document',
  'task',
  'meeting',
  'chat',
  'member',
  'other',
])
/** the server's `/{orgSlug}/{wsSlug}/documents/{id}`, ids in the shape the docs client validates */
const DOCUMENT_HREF =
  /^\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9_-]{1,128}\/documents\/([A-Za-z0-9_-]{1,128})$/

const error = (): AskUniOpenResult => ({ ok: false, code: 'error' })

function codeOfDocError(code: UniworkDocErrorCode): AskUniErrorCode {
  switch (code) {
    case 'not_signed_in':
      return 'signed_out'
    case 'session_expired':
      return 'session'
    case 'network':
    case 'timeout':
      return 'offline'
    case 'forbidden':
      return 'forbidden'
    default:
      return 'error'
  }
}

/**
 * The URL of a server path on the signed-in origin, or null. Only a single-slash path qualifies:
 * `//host`, a scheme, a backslash, whitespace/control characters and an encoded slash in the path
 * are refused before the URL is built, and the result must still equal the profile's origin.
 */
function webUrlOf(href: string, profile: DeploymentProfile): string | null {
  if (!href.startsWith('/') || href.startsWith('//')) return null
  if (/[\\\s]/.test(href) || [...href].some((ch) => ch.charCodeAt(0) < 0x20 || ch === '\x7f')) {
    return null
  }
  const path = href.split(/[?#]/, 1)[0] ?? ''
  if (/%(2f|5c)/i.test(path)) return null
  try {
    const base = new URL(profile.apiOrigin)
    if (!isAllowedOrigin(base, profile.channel)) return null
    const url = new URL(href, base.origin)
    return url.origin === base.origin ? url.href : null
  } catch {
    return null
  }
}

export function createAskUniOpener(deps: AskUniOpenDeps): AskUniOpener {
  return {
    async open(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return error()
      const { kind, href } = input as Record<string, unknown>
      if (typeof kind !== 'string' || !KINDS.has(kind) || typeof href !== 'string') return error()
      const profile = deps.profile()
      if (!deps.isSignedIn() || !profile) return { ok: false, code: 'signed_out' }
      try {
        if (kind === 'document') {
          const id = DOCUMENT_HREF.exec(href)?.[1]
          if (!id) return error()
          const opened = await deps.openDocument(id)
          return opened.ok ? { ok: true } : { ok: false, code: codeOfDocError(opened.error) }
        }
        const url = webUrlOf(href, profile)
        if (!url) return error()
        await deps.openExternal(url)
        return { ok: true }
      } catch {
        return error()
      }
    },
  }
}

export function registerAskUniOpenIpc(ipcMain: IpcMain, opener: AskUniOpener): void {
  ipcMain.handle(ASKUNI_CHANNELS.openCitation, (_event, req: unknown) => opener.open(req))
}
