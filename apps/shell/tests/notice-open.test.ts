/**
 * @vitest-environment jsdom
 *
 * UNI-2509 (web `resource-href.ts`): a click on a version_created notice from an AI client opens the
 * document and then its version history; without via_client it opens the document only. A notice whose
 * document is gone or out of reach opens nothing and only clears itself, before any versions branch.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { WorkNotification } from '../src/shared/uniwork-work-api'
import {
  onDocumentsIntent,
  onDocumentsIntentRoute,
  openDocumentShare,
  refuseDocumentsIntent,
  resetDocumentsIntentBusForTests,
} from '../src/renderer/src/documents-intent-bus'
import type { TFunc } from '../src/renderer/src/locale'
import { noticeLine, openNotice } from '../src/renderer/src/notice-open'
import { onUniworkNotice, publishUniworkNotice } from '../src/renderer/src/uniwork-notice-bus'

const change = (params: Record<string, string>, over: Partial<WorkNotification> = {}) =>
  ({
    id: 'n1',
    kind: 'document_changed',
    workspace_id: 'w1',
    resource_type: 'document',
    resource_id: 'd1',
    actor_kind: 'user',
    title_key: 'notifications.kind.document_changed',
    params: { actor: 'An', verb: 'version_created', document_count: '1', ...params },
    sample_documents: [{ id: 'd1', title: 'Kế hoạch Q4' }],
    created_at: '2026-10-14T01:00:00Z',
    ...over,
  }) as WorkNotification

const viaClient = (over: Partial<WorkNotification> = {}) => change({ via_client: 'ChatGPT' }, over)

const t = ((key: string) => key) as TFunc

let order: string[]
let uniworkOpenDocument: Mock
let markRead: Mock
let openList: Mock
let intents: unknown[]

beforeEach(() => {
  order = []
  uniworkOpenDocument = vi.fn(async () => {
    order.push('open')
    return { ok: true, value: { path: 'C:/work/d1.docx' } }
  })
  // the preload bridge the app reads: a fake of the one method the open path calls
  const bridgeHost: { aiOffice?: unknown } = window
  bridgeHost.aiOffice = { uniworkOpenDocument }
  markRead = vi.fn(async () => {
    order.push('read')
  })
  openList = vi.fn()
  intents = []
  onDocumentsIntent((intent) => {
    order.push('intent')
    intents.push(intent)
    return true
  })
})

afterEach(() => {
  resetDocumentsIntentBusForTests()
})

const click = (n: WorkNotification) =>
  openNotice(n, noticeLine(n, t, 'vi'), { workspace: null, markRead, openList })

describe('openNotice: version_created', () => {
  it('through an AI client opens the document, then its version history, then marks it read', async () => {
    await click(viaClient())
    expect(uniworkOpenDocument).toHaveBeenCalledWith('d1')
    expect(intents).toEqual([{ kind: 'versions', documentId: 'd1', workspaceId: 'w1' }])
    expect(markRead).toHaveBeenCalledWith('n1')
    expect(order).toEqual(['open', 'intent', 'read'])
  })

  it('without via_client opens the document only', async () => {
    await click(change({}))
    await click(change({ via_client: '   ' }))
    expect(uniworkOpenDocument).toHaveBeenCalledTimes(2)
    expect(intents).toEqual([])
    expect(markRead).toHaveBeenCalledTimes(2)
  })

  it('a document that failed to open shows no history and stays unread', async () => {
    uniworkOpenDocument.mockResolvedValueOnce({ ok: false, error: 'network' })
    await click(viaClient())
    expect(intents).toEqual([])
    expect(markRead).not.toHaveBeenCalled()
  })

  it('a deleted document opens nothing: it only marks the notice read', async () => {
    await click(viaClient({ resource_deleted: true }))
    expect(uniworkOpenDocument).not.toHaveBeenCalled()
    expect(intents).toEqual([])
    expect(markRead).toHaveBeenCalledWith('n1')
  })
})

describe('a via-client notice for a workspace the person is not in', () => {
  // the Home router's answer to an intent it cannot route (workspace outside the list)
  let toasts: unknown[]
  let unsubscribe: () => void
  beforeEach(() => {
    toasts = []
    unsubscribe = onUniworkNotice((event) => toasts.push(event))
    onDocumentsIntentRoute((intent) => {
      const error = refuseDocumentsIntent(intent, 'forbidden')
      if (error) publishUniworkNotice({ phase: 'failed', error })
    })
  })

  afterEach(() => unsubscribe())

  it('opens the document and shows no launch failure after it', async () => {
    await click(viaClient({ workspace_id: 'elsewhere' }))
    expect(uniworkOpenDocument).toHaveBeenCalledWith('d1')
    expect(markRead).toHaveBeenCalledWith('n1')
    // the open's own progress is the only thing on the launch notice
    expect(toasts.map((e) => (e as { phase: string }).phase)).toEqual(['opening', 'opened'])
  })

  it('still tells the person when another intent cannot be routed', () => {
    openDocumentShare({ documentId: 'd1', workspaceId: 'elsewhere', section: 'requests' })
    expect(toasts).toEqual([{ phase: 'failed', error: 'forbidden' }])
  })
})
