import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  onDocumentsIntent,
  onDocumentsIntentRoute,
  openDocumentShare,
  resetDocumentsIntentBusForTests,
  revealInTrash,
} from '../src/renderer/src/documents-intent-bus'

const SHARE = {
  kind: 'share',
  documentId: 'doc-1',
  workspaceId: 'ws-1',
  section: 'requests',
} as const

describe('documents intent bus (UNI-2079 notice targets)', () => {
  afterEach(() => resetDocumentsIntentBusForTests())

  it('hands an intent to the subscribed consumer once', () => {
    const consumer = vi.fn(() => true)
    onDocumentsIntent(consumer)
    openDocumentShare({ documentId: 'doc-1', workspaceId: 'ws-1', section: 'requests' })
    expect(consumer).toHaveBeenCalledTimes(1)
    expect(consumer).toHaveBeenCalledWith(SHARE)
    // a second consumer subscribing later gets nothing: the intent was taken
    const late = vi.fn(() => true)
    onDocumentsIntent(late)
    expect(late).not.toHaveBeenCalled()
  })

  it('holds the last intent until a consumer subscribes, then delivers it once', () => {
    revealInTrash({ documentId: 'doc-1', workspaceId: 'ws-1' })
    openDocumentShare({ documentId: 'doc-2', workspaceId: 'ws-1', section: 'break_glass' })
    const consumer = vi.fn(() => true)
    onDocumentsIntent(consumer)
    expect(consumer).toHaveBeenCalledTimes(1)
    expect(consumer).toHaveBeenCalledWith({
      kind: 'share',
      documentId: 'doc-2',
      workspaceId: 'ws-1',
      section: 'break_glass',
    })
    const next = vi.fn(() => true)
    onDocumentsIntent(next)
    expect(next).not.toHaveBeenCalled()
  })

  it('keeps an intent a consumer declined (another workspace) for the next one', () => {
    revealInTrash({ documentId: 'doc-1', workspaceId: 'ws-2' })
    const other = vi.fn(() => false)
    onDocumentsIntent(other)
    expect(other).toHaveBeenCalledTimes(1)
    const mine = vi.fn(() => true)
    onDocumentsIntent(mine)
    expect(mine).toHaveBeenCalledWith({ kind: 'trash', documentId: 'doc-1', workspaceId: 'ws-2' })
  })

  it('stops delivering after unsubscribe and holds the intent again', () => {
    const consumer = vi.fn(() => true)
    const off = onDocumentsIntent(consumer)
    off()
    revealInTrash({ documentId: 'doc-1', workspaceId: 'ws-1' })
    expect(consumer).not.toHaveBeenCalled()
    const next = vi.fn(() => true)
    onDocumentsIntent(next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('tells the route subscribers (the host that switches the surface) on every publish', () => {
    const route = vi.fn()
    onDocumentsIntentRoute(route)
    revealInTrash({ documentId: 'doc-1', workspaceId: 'ws-1' })
    openDocumentShare({ documentId: 'doc-2', workspaceId: 'ws-1', section: 'requests' })
    expect(route).toHaveBeenCalledTimes(2)
    expect(route.mock.calls[0]![0]).toMatchObject({ kind: 'trash', documentId: 'doc-1' })
  })

  it('replays a held intent to a route subscriber that mounts late, without consuming it', () => {
    revealInTrash({ documentId: 'doc-1', workspaceId: 'ws-1' })
    const route = vi.fn()
    onDocumentsIntentRoute(route)
    expect(route).toHaveBeenCalledTimes(1)
    const consumer = vi.fn(() => true)
    onDocumentsIntent(consumer)
    expect(consumer).toHaveBeenCalledTimes(1)
  })
})
