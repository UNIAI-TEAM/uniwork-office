import { randomUUID } from 'node:crypto'
import type { IpcMain } from 'electron'
import {
  ASKUNI_FOCUS_KINDS,
  ASKUNI_MAX_MENTIONS,
  ASKUNI_MENTION_KINDS,
  ASKUNI_V2_CHANNELS,
  type AskUniEffort,
  type AskUniErrorCode,
  type AskUniFlags,
  type AskUniFocusKind,
  type AskUniMentionKind,
  type AskUniModel,
  type AskUniObjectRef,
  type AskUniOkResult,
  type AskUniStreamEvent,
  type AskUniStreamRequest,
  type AskUniStreamStart,
} from '../../shared/askuni-api'
import { ASKUNI_MAX_QUESTION } from './service'
import type { AskUniStreamClient, AskUniStreamPayload, AskUniStreamTerminal } from './stream-client'

/**
 * The Ask UNI v2 stream service behind `uniwork:askuni:stream*`: validates
 * what the renderer sends (a refused input never reaches the network), checks
 * the workspace like P1, runs one stream per sender and pushes its events to
 * that sender only (`uniwork:askuni:stream-event`, never a broadcast). A
 * stream ends on its terminal event, a cancel from the same sender, a newer
 * stream of that sender, the sender going away, or a sign-out / account
 * switch - and each request gets exactly one terminal event.
 */

/** the part of a webContents the service uses */
export interface AskUniStreamSender {
  readonly id: number
  isDestroyed(): boolean
  send(channel: string, ev: AskUniStreamEvent): void
  once(event: 'destroyed', listener: () => void): unknown
  removeListener(event: 'destroyed', listener: () => void): unknown
}

export interface AskUniStreamServiceDeps {
  isSignedIn(): boolean
  /** account + org; a change (sign-out, switch) cancels every stream */
  scopeKey(): string | null
  /** null when the workspace is one of the account's (P1 cached list), else the code */
  checkWorkspace(workspaceId: string): Promise<AskUniErrorCode | null>
  client: AskUniStreamClient
  newRequestId?(): string
  /** how often a running stream checks the scope (default 1 s) */
  scopeCheckMs?: number
}

export interface AskUniStreamService {
  start(sender: AskUniStreamSender, input: unknown): Promise<AskUniStreamStart>
  cancel(sender: AskUniStreamSender, input: unknown): AskUniOkResult
  /** cancels every running stream (sign-out) */
  abortAll(): void
  /** running streams (tests) */
  active(): number
}

const ID = /^[A-Za-z0-9_-]{1,128}$/
const FOCUS: ReadonlySet<string> = new Set(ASKUNI_FOCUS_KINDS)
const MENTION: ReadonlySet<string> = new Set(ASKUNI_MENTION_KINDS)
const MODELS: ReadonlySet<string> = new Set<AskUniModel>(['', 'haiku', 'sonnet', 'opus'])
const EFFORTS: ReadonlySet<string> = new Set<AskUniEffort>(['low', 'medium', 'high'])

function refOf<K extends string>(
  raw: unknown,
  kinds: ReadonlySet<string>,
): AskUniObjectRef<K> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { kind, id } = raw as Record<string, unknown>
  if (typeof kind !== 'string' || !kinds.has(kind)) return null
  if (typeof id !== 'string' || !ID.test(id)) return null
  return { kind: kind as K, id }
}

/** P1's rules (question, locale, ids) plus focus, mentions, model and effort; only contract fields survive */
export function parseStreamRequest(input: unknown): AskUniStreamRequest | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const r = input as Record<string, unknown>
  if (typeof r.question !== 'string') return null
  const question = r.question.trim()
  if (question.length < 1 || question.length > ASKUNI_MAX_QUESTION) return null
  if (r.locale !== 'vi' && r.locale !== 'en') return null
  if (typeof r.workspaceId !== 'string' || !ID.test(r.workspaceId)) return null
  const req: AskUniStreamRequest = { workspaceId: r.workspaceId, question, locale: r.locale }
  if (r.conversationId !== undefined) {
    if (typeof r.conversationId !== 'string' || !ID.test(r.conversationId)) return null
    req.conversationId = r.conversationId
  }
  if (r.focus !== undefined) {
    const focus = refOf<AskUniFocusKind>(r.focus, FOCUS)
    if (!focus) return null
    req.focus = focus
  }
  if (r.mentions !== undefined) {
    if (!Array.isArray(r.mentions) || r.mentions.length > ASKUNI_MAX_MENTIONS) return null
    const mentions = r.mentions.map((m) => refOf<AskUniMentionKind>(m, MENTION))
    if (mentions.some((m) => m === null)) return null
    req.mentions = mentions as AskUniObjectRef<AskUniMentionKind>[]
  }
  if (r.model !== undefined) {
    if (typeof r.model !== 'string' || !MODELS.has(r.model)) return null
    req.model = r.model as AskUniModel
  }
  if (r.effort !== undefined) {
    if (typeof r.effort !== 'string' || !EFFORTS.has(r.effort)) return null
    req.effort = r.effort as AskUniEffort
  }
  return req
}

interface Running {
  requestId: string
  sender: AskUniStreamSender
  scope: string | null
  controller: AbortController
  /** set once the terminal is decided; nothing is sent after it */
  ended: boolean
  unwatch(): void
}

export function createAskUniStreamService(deps: AskUniStreamServiceDeps): AskUniStreamService {
  const newId = deps.newRequestId ?? randomUUID
  const scopeCheckMs = deps.scopeCheckMs ?? 1_000
  const running = new Map<string, Running>()
  let scopeTimer: ReturnType<typeof setInterval> | undefined

  const deliver = (run: Running, ev: AskUniStreamPayload) => {
    if (run.ended || run.sender.isDestroyed()) return
    run.sender.send(ASKUNI_V2_CHANNELS.streamEvent, {
      ...ev,
      requestId: run.requestId,
    } as AskUniStreamEvent)
  }

  /** the request's one terminal: sent (when the sender is still there), then forgotten */
  const finish = (run: Running, terminal: AskUniStreamTerminal) => {
    if (run.ended) return
    deliver(run, terminal)
    run.ended = true
    run.unwatch()
    if (running.get(run.requestId) === run) running.delete(run.requestId)
    if (running.size === 0 && scopeTimer) {
      clearInterval(scopeTimer)
      scopeTimer = undefined
    }
  }

  const cancelRun = (run: Running) => {
    run.controller.abort()
    finish(run, { type: 'error', code: 'cancelled' })
  }

  const scopeChanged = (run: Running) => !deps.isSignedIn() || deps.scopeKey() !== run.scope

  const checkScopes = () => {
    for (const run of [...running.values()]) if (scopeChanged(run)) cancelRun(run)
  }

  return {
    async start(sender, input) {
      const req = parseStreamRequest(input)
      if (!req) return { ok: false, error: 'error' }
      if (!deps.isSignedIn()) return { ok: false, error: 'signed_out' }
      const scope = deps.scopeKey()
      const refused = await deps.checkWorkspace(req.workspaceId)
      if (refused) return { ok: false, error: refused }
      if (sender.isDestroyed()) return { ok: false, error: 'error' }
      if (deps.scopeKey() !== scope) return { ok: false, error: 'cancelled' }

      // one stream per sender: the older one ends as cancelled
      for (const run of [...running.values()]) {
        if (run.sender.id === sender.id) cancelRun(run)
      }

      const controller = new AbortController()
      const onDestroyed = () => {
        controller.abort()
        // nothing to send to: the run just ends
        finish(run, { type: 'error', code: 'cancelled' })
      }
      const run: Running = {
        requestId: newId(),
        sender,
        scope,
        controller,
        ended: false,
        unwatch: () => sender.removeListener('destroyed', onDestroyed),
      }
      sender.once('destroyed', onDestroyed)
      running.set(run.requestId, run)
      if (!scopeTimer) {
        scopeTimer = setInterval(checkScopes, scopeCheckMs)
        scopeTimer.unref?.()
      }

      // starts after this reply is on its way, so the requestId reaches the renderer first
      setTimeout(() => {
        if (run.ended) return
        deps.client
          .stream(req, {
            signal: controller.signal,
            onEvent: (ev) => {
              if (ev.type === 'done' || ev.type === 'error') return
              if (scopeChanged(run)) return cancelRun(run)
              deliver(run, ev)
            },
          })
          .then(
            (terminal) =>
              finish(
                run,
                controller.signal.aborted ? { type: 'error', code: 'cancelled' } : terminal,
              ),
            () =>
              finish(run, {
                type: 'error',
                code: controller.signal.aborted ? 'cancelled' : 'error',
              }),
          )
      }, 0)
      return { ok: true, requestId: run.requestId }
    },

    cancel(sender, input) {
      const requestId =
        input && typeof input === 'object'
          ? (input as { requestId?: unknown }).requestId
          : undefined
      if (typeof requestId !== 'string' || !requestId) return { ok: false, error: 'error' }
      const run = running.get(requestId)
      if (!run) return { ok: true }
      if (run.sender.id !== sender.id) return { ok: false, error: 'forbidden' }
      cancelRun(run)
      return { ok: true }
    },

    abortAll() {
      for (const run of [...running.values()]) cancelRun(run)
    },

    active: () => running.size,
  }
}

/** the `ask_uni_stream` flag for the signed-in scope */
export interface AskUniFlagsReader {
  flags(): Promise<AskUniFlags>
}

const FLAGS_TTL_MS = 60_000

/** reads the flag once per scope and minute (like the P1 workspace list); off when signed out or on failure */
export function createAskUniFlags(deps: {
  isSignedIn(): boolean
  scopeKey(): string | null
  read(): Promise<boolean>
  now?(): number
}): AskUniFlagsReader {
  const now = deps.now ?? Date.now
  let cached: { scope: string | null; at: number; on: boolean } | null = null
  return {
    async flags() {
      if (!deps.isSignedIn()) {
        cached = null
        return { streamEnabled: false }
      }
      const scope = deps.scopeKey()
      if (cached && cached.scope === scope && now() - cached.at < FLAGS_TTL_MS) {
        return { streamEnabled: cached.on }
      }
      try {
        const on = (await deps.read()) === true
        if (deps.scopeKey() === scope) cached = { scope, at: now(), on }
        return { streamEnabled: on }
      } catch {
        return { streamEnabled: false }
      }
    },
  }
}

const FORBIDDEN = { ok: false, error: 'forbidden' } as const

export function registerAskUniStreamIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  deps: {
    stream: AskUniStreamService
    flags: AskUniFlagsReader
    isShellSender(event: unknown): boolean
  },
): void {
  ipcMain.handle(ASKUNI_V2_CHANNELS.stream, (event, req: unknown) =>
    deps.isShellSender(event) ? deps.stream.start(event.sender, req) : FORBIDDEN,
  )
  ipcMain.handle(ASKUNI_V2_CHANNELS.streamCancel, (event, req: unknown) =>
    deps.isShellSender(event) ? deps.stream.cancel(event.sender, req) : FORBIDDEN,
  )
  ipcMain.handle(ASKUNI_V2_CHANNELS.flags, (event) =>
    deps.isShellSender(event) ? deps.flags.flags() : FORBIDDEN,
  )
}
