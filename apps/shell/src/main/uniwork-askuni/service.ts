import type { IpcMain } from 'electron'
import {
  ASKUNI_CHANNELS,
  type AskUniContext,
  type AskUniRequest,
  type AskUniResult,
  type AskUniWorkspace,
} from '../../shared/askuni-api'
import { askUniCodeOfError, type AskUniClient } from './client'

/**
 * The Ask UNI service behind `uniwork:askuni:*`: validates what the renderer
 * sends (a refused input never reaches the network), answers the context the
 * Home chat needs (the account's workspaces + the one Home shows) and hands a
 * valid question to the client. Every outcome is an AskUniResult, never a throw.
 */

/** where the Home doclist keeps its workspace pick (renderer: active-workspace.ts, in the workbench store) */
export const ACTIVE_WORKSPACE_STORE_KEY = 'uniwork.wb.activeWorkspace'

export const ASKUNI_MAX_QUESTION = 2000
/** how long a workspace list read for one account/org answers the workspace check */
const LIST_TTL_MS = 60_000
const ID = /^[A-Za-z0-9_-]{1,128}$/

export interface AskUniServiceDeps {
  isSignedIn(): boolean
  /** account + org the list belongs to; a change drops the cached list */
  scopeKey(): string | null
  /** the signed-in org's workspaces (the Home's own list call); rejects like a docs call */
  listWorkspaces(): Promise<AskUniWorkspace[]>
  /** the workspace the Home doclist last picked (workbench store), unvalidated */
  activeWorkspaceId(): string | null
  client: AskUniClient
  now?(): number
}

export interface AskUniService {
  ask(input: unknown): Promise<AskUniResult>
  context(): Promise<AskUniContext>
}

const error = (): AskUniResult => ({ ok: false, code: 'error' })

/** the stored workspace while it is still listed, else the first one, else null (as the Home does) */
function pickCurrent(workspaces: readonly AskUniWorkspace[], stored: string | null): string | null {
  return workspaces.find((w) => w.id === stored)?.id ?? workspaces[0]?.id ?? null
}

function parseRequest(input: unknown): AskUniRequest | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const r = input as Record<string, unknown>
  if (typeof r.question !== 'string') return null
  const question = r.question.trim()
  if (question.length < 1 || question.length > ASKUNI_MAX_QUESTION) return null
  if (r.locale !== 'vi' && r.locale !== 'en') return null
  if (typeof r.workspaceId !== 'string' || !ID.test(r.workspaceId)) return null
  if (r.conversationId !== undefined) {
    if (typeof r.conversationId !== 'string' || !ID.test(r.conversationId)) return null
    return {
      workspaceId: r.workspaceId,
      conversationId: r.conversationId,
      question,
      locale: r.locale,
    }
  }
  return { workspaceId: r.workspaceId, question, locale: r.locale }
}

export function createAskUniService(deps: AskUniServiceDeps): AskUniService {
  const now = deps.now ?? Date.now
  let cached: { scope: string | null; at: number; workspaces: AskUniWorkspace[] } | null = null

  /** the cached list of this scope, however old (stale-if-error), else null */
  const cachedFor = (scope: string | null): AskUniWorkspace[] | null =>
    cached && cached.scope === scope ? cached.workspaces : null

  const readList = async (): Promise<AskUniWorkspace[]> => {
    const scope = deps.scopeKey()
    if (cached && cached.scope === scope && now() - cached.at < LIST_TTL_MS) {
      return cached.workspaces
    }
    const workspaces = await deps.listWorkspaces()
    // the account or org can switch while the list is on its way: that list
    // belongs to the new scope, so it is not stored under the old key
    if (deps.scopeKey() === scope) cached = { scope, at: now(), workspaces }
    return workspaces
  }

  return {
    async context() {
      if (!deps.isSignedIn()) {
        cached = null
        return { workspaces: [], currentWorkspaceId: null, signedIn: false }
      }
      let workspaces: AskUniWorkspace[]
      try {
        workspaces = await readList()
      } catch {
        // offline or a transient failure: keep showing the workspaces of this scope
        workspaces = cachedFor(deps.scopeKey()) ?? []
      }
      return {
        workspaces,
        currentWorkspaceId: pickCurrent(workspaces, deps.activeWorkspaceId()),
        signedIn: true,
      }
    },

    async ask(input) {
      const req = parseRequest(input)
      if (!req) return error()
      if (!deps.isSignedIn()) {
        cached = null
        return { ok: false, code: 'signed_out' }
      }
      let workspaces: AskUniWorkspace[]
      try {
        workspaces = await readList()
      } catch (failure) {
        return { ok: false, code: askUniCodeOfError(failure) }
      }
      if (!workspaces.some((w) => w.id === req.workspaceId)) return error()
      try {
        return await deps.client.ask(req)
      } catch {
        return error()
      }
    },
  }
}

export function registerAskUniIpc(ipcMain: IpcMain, service: AskUniService): void {
  ipcMain.handle(ASKUNI_CHANNELS.ask, (_event, req: unknown) => service.ask(req))
  ipcMain.handle(ASKUNI_CHANNELS.context, () => service.context())
}
