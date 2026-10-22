import {
  ASKUNI_MAX_LOOKUP_RESULTS,
  ASKUNI_MAX_TITLE,
  type AskUniConversation,
  type AskUniLookupItem,
  type AskUniMessage,
  type AskUniObjectKind,
  type AskUniStreamRequest,
} from '../../shared/askuni-api'
import { foldForMatch, type AskUniLookupClient } from './lookup-client'
import type { AskUniRestClient } from './rest-client'

/**
 * Test/dev only (UNIWORK_ASKUNI_FAKE=1, never packaged): the Ask UNI v2 REST
 * routes over an in-memory store. The streaming fake records every finished
 * answer here, so history, rename, delete and feedback work after a fake
 * question. Capabilities: Auto (= sonnet) + haiku + sonnet, opus switched off.
 * The picker fixtures carry Vietnamese names with diacritics.
 */

export interface FakeAskUniStore {
  /** the conversation a turn goes to: the asked one when stored, else a new id */
  conversationFor(req: AskUniStreamRequest): string
  /** stores a finished turn (the question and its answer) */
  record(req: AskUniStreamRequest, conversationId: string, answer: AskUniMessage): void
  list(workspaceId: string): AskUniConversation[]
  messages(conversationId: string): AskUniMessage[] | null
  rename(conversationId: string, title: string): boolean
  remove(conversationId: string): boolean
  hasMessage(conversationId: string, messageId: string): boolean
}

interface StoredConversation extends AskUniConversation {
  workspaceId: string
  messages: AskUniMessage[]
}

export function createFakeAskUniStore(): FakeAskUniStore {
  const conversations = new Map<string, StoredConversation>()
  let next = 0
  let tick = 0
  /** strictly increasing stamps, so "newest first" holds within one millisecond */
  const stamp = () => new Date(Date.UTC(2026, 9, 22, 2, 0, 0) + ++tick * 1000).toISOString()
  const pad = (n: number) => String(n).padStart(12, '0')

  return {
    conversationFor(req) {
      if (req.conversationId && conversations.has(req.conversationId)) return req.conversationId
      next += 1
      return `fakeconv${pad(next)}`
    },
    record(req, conversationId, answer) {
      const at = stamp()
      let conv = conversations.get(conversationId)
      if (!conv) {
        conv = {
          id: conversationId,
          workspaceId: req.workspaceId,
          title: req.question.slice(0, ASKUNI_MAX_TITLE),
          createdAt: at,
          updatedAt: at,
          messages: [],
        }
        conversations.set(conversationId, conv)
      }
      conv.messages.push(
        {
          id: `fakeq${pad(conv.messages.length + 1)}${conversationId.slice(-4)}`,
          role: 'user',
          content: req.question,
          citations: [],
          createdAt: at,
        },
        { ...answer, createdAt: at },
      )
      conv.updatedAt = at
    },
    list(workspaceId) {
      return [...conversations.values()]
        .filter((c) => c.workspaceId === workspaceId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }))
    },
    messages(conversationId) {
      return conversations.get(conversationId)?.messages.map((m) => ({ ...m })) ?? null
    },
    rename(conversationId, title) {
      const conv = conversations.get(conversationId)
      if (!conv) return false
      conv.title = title
      return true
    },
    remove(conversationId) {
      return conversations.delete(conversationId)
    },
    hasMessage(conversationId, messageId) {
      return !!conversations.get(conversationId)?.messages.some((m) => m.id === messageId)
    },
  }
}

const FIXTURES: Record<string, Array<[string, string, string?]>> = {
  task: [
    ['faketask0000000000000001', 'Gửi ngân sách cho phòng Tài chính', 'Hạn 30/10'],
    ['faketask0000000000000002', 'Viết đặc tả F-09'],
    ['faketask0000000000000003', 'Rà soát hợp đồng nhà cung cấp'],
    ['faketask0000000000000004', 'Send the budget to finance'],
  ],
  meeting: [
    ['fakemtg00000000000000001', 'Họp giao ban tuần', '2026-10-23T02:00:00Z'],
    ['fakemtg00000000000000002', 'Đánh giá quý 4', '2026-10-24T07:00:00Z'],
    ['fakemtg00000000000000003', 'Weekly sync', '2026-10-27T02:00:00Z'],
  ],
  document: [
    ['fakedoc0000000000000001', 'Kế hoạch ngân sách Q4'],
    ['fakedoc0000000000000002', 'Lộ trình tuyển dụng'],
    ['fakedoc0000000000000003', 'Vendor contract renewal'],
  ],
  project: [
    ['fakeprj00000000000000001', 'Dự án Văn phòng số'],
    ['fakeprj00000000000000002', 'Chuyển đổi hệ thống kế toán'],
  ],
  member: [
    ['fakeusr00000000000000001', 'Nguyễn Văn Đức', 'duc@example.com'],
    ['fakeusr00000000000000002', 'Trần Thị Mai', 'mai@example.com'],
    ['fakeusr00000000000000003', 'Lê Hoàng Nam', 'nam@example.com'],
    ['fakeusr00000000000000004', 'An Nguyễn', 'an@example.com'],
  ],
  room: [
    ['fakeroom0000000000000001', 'Phòng Kế toán'],
    ['fakeroom0000000000000002', 'Dự án Văn phòng số'],
    ['fakeroom0000000000000003', 'General'],
  ],
}

export function createFakeAskUniRest(store: FakeAskUniStore): {
  rest: AskUniRestClient
  lookup: AskUniLookupClient
} {
  const ok = { ok: true as const }
  const missing = { ok: false as const, error: 'error' as const }
  const rest: AskUniRestClient = {
    async capabilities() {
      return {
        ok: true,
        enabled: true,
        models: [
          { key: 'haiku', speed: 5, intelligence: 3, cost: 1, enabled: true },
          { key: 'sonnet', speed: 4, intelligence: 4, cost: 3, enabled: true },
          { key: 'opus', speed: 2, intelligence: 5, cost: 5, enabled: false },
        ],
        autoModel: 'sonnet',
      }
    },
    async conversations(workspaceId) {
      return { ok: true, conversations: store.list(workspaceId) }
    },
    async messages(conversationId) {
      const messages = store.messages(conversationId)
      return messages ? { ok: true, messages } : missing
    },
    async rename(conversationId, title) {
      return store.rename(conversationId, title) ? ok : missing
    },
    async remove(conversationId) {
      return store.remove(conversationId) ? ok : missing
    },
    async feedbackSet(req) {
      return store.hasMessage(req.conversationId, req.messageId) ? ok : missing
    },
    async feedbackClear(conversationId, messageId) {
      return store.hasMessage(conversationId, messageId) ? ok : missing
    },
  }
  const lookup: AskUniLookupClient = {
    async lookup(req) {
      const rows = Object.hasOwn(FIXTURES, req.kind) ? FIXTURES[req.kind] : null
      if (!rows) return missing
      const needle = foldForMatch(req.query.trim())
      const items: AskUniLookupItem[] = rows
        .filter(([, title, sub]) =>
          [title, sub ?? ''].some((h) => !needle || foldForMatch(h).includes(needle)),
        )
        .slice(0, ASKUNI_MAX_LOOKUP_RESULTS)
        .map(([id, title, sub]) => ({
          kind: req.kind as AskUniObjectKind,
          id,
          title,
          // a member's email is a match key, not a line to show
          ...(sub && req.kind !== 'member' ? { subtitle: sub } : {}),
        }))
      return { ok: true, items }
    },
  }
  return { rest, lookup }
}
