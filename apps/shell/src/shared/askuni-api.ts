// IPC contract for Ask UNI (workspace question answering over UniWork documents).
// Shared by the shell main client and the Home renderer; keep it dependency-free.

export const ASKUNI_CHANNELS = {
  ask: 'uniwork:askuni:ask',
  context: 'uniwork:askuni:context',
} as const

export type AskUniLocale = 'vi' | 'en'

export interface AskUniRequest {
  workspaceId: string
  conversationId?: string
  question: string
  locale: AskUniLocale
}

export type AskUniCitationKind = 'document' | 'task' | 'meeting' | 'chat' | 'member'

export interface AskUniCitation {
  sourceId: string
  kind: AskUniCitationKind
  title: string
  quote: string
  href: string
}

export type AskUniNotice = 'no_sources' | 'empty_answer'

export type AskUniErrorCode =
  | 'offline'
  | 'signed_out'
  | 'forbidden'
  | 'quota'
  | 'rate_limited'
  | 'disabled'
  | 'session'
  | 'error'

export type AskUniResult =
  | {
      ok: true
      conversationId: string
      message: {
        id: string
        content: string
        citations: AskUniCitation[]
        notice?: AskUniNotice
      }
    }
  | { ok: false; code: AskUniErrorCode; retryAfterSec?: number }

export interface AskUniWorkspace {
  id: string
  name: string
}

export interface AskUniContext {
  workspaces: AskUniWorkspace[]
  currentWorkspaceId: string | null
  signedIn: boolean
}

export interface AskUniBridge {
  uniworkAskUni(req: AskUniRequest): Promise<AskUniResult>
  uniworkAskUniContext(): Promise<AskUniContext>
}
