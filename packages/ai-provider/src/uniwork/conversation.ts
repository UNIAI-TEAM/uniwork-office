/**
 * Server conversation and run ids per panel session (design §3.3). Kept
 * where the adapter runs (the desktop shell main process, the web frame),
 * keyed by the panel transport's sessionId. Every AI turn of a session,
 * BYOK ones included, is observed here, so a UniWork AI turn after another
 * provider's turn starts a new server conversation and says so.
 */
import type { UniworkScope, UniworkTurnIds } from './types'

interface SessionState {
  /** provider of the last turn on this session */
  lastProvider?: string
  scopeKey?: string
  conversationId?: string
  runId?: string
  /**
   * the server issued tool calls in this conversation and no tool-result turn answered them yet
   * (Stop while tools ran, an answer the client dropped): the server transcript ends in an
   * assistant turn with dangling tool_calls, so it cannot take another question
   */
  openToolCalls?: boolean
}

export interface UniworkTurnStart {
  ids: UniworkTurnIds
  /** a new conversation starts because another provider ran in between */
  boundary: boolean
}

export function uniworkScopeKey(scope: UniworkScope): string {
  return scope.kind === 'org'
    ? `org:${scope.orgId}:${scope.format}`
    : `${scope.kind}:${scope.documentId}`
}

const DEFAULT_SESSION = ''

export class UniworkConversations {
  private readonly sessions = new Map<string, SessionState>()

  private state(sessionId: string | undefined): SessionState {
    const key = sessionId ?? DEFAULT_SESSION
    let s = this.sessions.get(key)
    if (!s) {
      s = {}
      this.sessions.set(key, s)
    }
    return s
  }

  /** a turn of another provider ran on this session (streamForProvider reports every turn) */
  observe(sessionId: string | undefined, provider: string): void {
    if (provider === 'uniwork') return
    const s = this.state(sessionId)
    s.lastProvider = provider
    delete s.conversationId
    delete s.runId
    delete s.openToolCalls
  }

  /**
   * The ids a UniWork AI turn sends. A question opens a new run (no run
   * header) unless it continues the run right after tool results; a turn in
   * another scope (document, organization/format) starts its own conversation.
   */
  begin(
    sessionId: string | undefined,
    scope: UniworkScope,
    continuesRun: boolean,
  ): UniworkTurnStart {
    const s = this.state(sessionId)
    const scopeKey = uniworkScopeKey(scope)
    const boundary = s.lastProvider !== undefined && s.lastProvider !== 'uniwork'
    if (boundary || s.scopeKey !== scopeKey) {
      delete s.conversationId
      delete s.runId
      delete s.openToolCalls
    }
    s.lastProvider = 'uniwork'
    s.scopeKey = scopeKey
    if (!continuesRun) delete s.runId
    return { ids: this.ids(sessionId), boundary }
  }

  /** ids an answer carried back; an absent header keeps the known id (API §3.7 Q6) */
  update(sessionId: string | undefined, ids: UniworkTurnIds): UniworkTurnIds {
    const s = this.state(sessionId)
    if (ids.conversationId) s.conversationId = ids.conversationId
    if (ids.runId) s.runId = ids.runId
    return this.ids(sessionId)
  }

  /** the server handed this session tool calls (set as soon as one arrives, Stop or not) */
  toolCallsIssued(sessionId: string | undefined): void {
    this.state(sessionId).openToolCalls = true
  }

  /** a turn completed without new tool calls: nothing in the server transcript waits for results */
  toolCallsSettled(sessionId: string | undefined): void {
    delete this.state(sessionId).openToolCalls
  }

  /** tool calls of this conversation are still unanswered */
  hasOpenToolCalls(sessionId: string | undefined): boolean {
    return this.sessions.get(sessionId ?? DEFAULT_SESSION)?.openToolCalls === true
  }

  /** the run is over (run_expired, run_limit_reached): the next turn opens a new run in the same conversation */
  dropRun(sessionId: string | undefined): void {
    delete this.state(sessionId).runId
  }

  /** the conversation is gone (conversation_expired, lost access): the next turn starts a new one */
  dropConversation(sessionId: string | undefined): void {
    const s = this.state(sessionId)
    delete s.conversationId
    delete s.runId
    delete s.openToolCalls
  }

  ids(sessionId: string | undefined): UniworkTurnIds {
    const s = this.sessions.get(sessionId ?? DEFAULT_SESSION)
    return {
      ...(s?.conversationId ? { conversationId: s.conversationId } : {}),
      ...(s?.runId ? { runId: s.runId } : {}),
    }
  }

  /** the panel closed */
  forget(sessionId: string | undefined): void {
    this.sessions.delete(sessionId ?? DEFAULT_SESSION)
  }

  /** sign-out or another account: nothing of the old session may be sent again */
  clear(): void {
    this.sessions.clear()
  }
}

/** the process-wide store the hosts use (tests pass their own) */
export const uniworkConversations = new UniworkConversations()
