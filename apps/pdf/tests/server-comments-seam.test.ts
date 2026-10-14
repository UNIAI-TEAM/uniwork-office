/**
 * G8-15 (UNI-1410) on the REAL shared seam. Only the object the bridge exposes
 * (`window.uniworkComments`, the preload / frame port shape) is stubbed; the
 * editor reads it through `pdfCommentsBridge()` and every call goes through the
 * kit (`createUniworkCommentsSource`, `sendAnchorMap`, `useCollabThreads`).
 *
 * G8-A01 (the pdf slice): a new anchored thread is created when the document is
 * bound and its version id is known, as exactly one `comments.create` carrying a
 * page + rect anchor and `baseVersionId`; nothing is created otherwise.
 * G8-A02 (the pdf slice): after the Save receipt the anchor map goes out with
 * that version and only `exact` | `lost` states; `anchor_version_invalid` sends
 * nothing more and never throws.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollabComment } from '@genoffice/ui/collab'
import type { UniworkCommentsApi } from '@genoffice/electron-utils/comments-ipc'
import {
  PdfServerCommentsHost,
  type PdfServerComments,
} from '../src/renderer/server-comments/PdfServerComments'
import { pdfCommentsBridge } from '../src/renderer/server-comments/pdf-comments-context'
import { createPdfAnchorAdapter } from '../src/renderer/server-comments/pdf-adapter'
import { makePdfAnchor } from '../src/renderer/server-comments/pdf-anchor'

const PATH = '/work/uniwork/doc-1/report.pdf'
const RECT: [number, number, number, number] = [72, 540, 300, 560]

let el: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  sessionStorage.clear()
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
})

afterEach(() => {
  act(() => root.unmount())
  el.remove()
  vi.unstubAllGlobals()
  delete (window as unknown as Record<string, unknown>).uniworkComments
})

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value })

function comment(id: string, page: number): CollabComment {
  return {
    id,
    document_id: 'doc-1',
    author_id: 'u-1',
    body: 'Check this figure',
    kind: 'comment',
    anchor: makePdfAnchor(page, RECT),
    anchor_state: 'exact',
    created_at: '2026-10-13T08:00:00Z',
    updated_at: '2026-10-13T08:00:00Z',
    display_name: 'An',
  }
}

type ContextValue = {
  documentId: string
  versionId: string | null
  level?: 'edit'
  myUserId?: string
}

/** `window.uniworkComments` as the bridge exposes it: every call resolves to a reply envelope */
function installBridge(
  comments: CollabComment[],
  context: ContextValue | 'unbound',
  anchorsReply?: () => Promise<unknown>,
) {
  let savedHandler: ((p: { path: string; versionId: string }) => void) | null = null
  const bridge = {
    list: vi.fn(() => ok({ comments, mentions: [], list_token: 't', unchanged: false })),
    create: vi.fn((input: { anchor?: unknown; body: string }) =>
      ok({ comment: { ...comment('new-1', 1), body: input.body, anchor: input.anchor } }),
    ),
    update: vi.fn(() => ok({ comment: comments[0] })),
    remove: vi.fn(() => ok({ outcome: 'removed' as const })),
    resolve: vi.fn(() => ok({ comment: comments[0] })),
    reopen: vi.fn(() => ok({ comment: comments[0] })),
    revisions: vi.fn(() => ok({ revisions: [] })),
    anchors: vi.fn(
      anchorsReply ??
        ((input: { anchors: Array<{ commentId: string }> }) =>
          ok({ updated: input.anchors.map((a) => a.commentId), skipped: [], list_token: 'tx' })),
    ),
    searchMentions: vi.fn(() => ok({ candidates: [] })),
    onReveal: vi.fn(() => () => undefined),
    context: vi.fn(() =>
      context === 'unbound'
        ? Promise.resolve({ ok: false as const, error: { code: 'not_found', message: 'unbound' } })
        : ok(context),
    ),
    onSaved: vi.fn((handler: (p: { path: string; versionId: string }) => void) => {
      savedHandler = handler
      return () => {
        savedHandler = null
      }
    }),
    receipt: (versionId: string) => savedHandler?.({ path: PATH, versionId }),
  }
  ;(window as unknown as Record<string, unknown>).uniworkComments = bridge
  return bridge
}

async function mount(): Promise<{ api: { current: PdfServerComments | null } }> {
  // the editor takes the bridge from the window, exactly as App does
  const bridge = pdfCommentsBridge() as UniworkCommentsApi
  const api: { current: PdfServerComments | null } = { current: null }
  const adapter = createPdfAnchorAdapter({
    pageCount: 3,
    isShown: () => true,
    viewTop: (_i, rect) => 842 - rect[3],
    goTo: vi.fn(),
  })
  await act(async () => {
    root.render(
      createElement(PdfServerCommentsHost, {
        bridge,
        path: PATH,
        lang: 'en',
        readOnly: false,
        adapter,
        open: true,
        apiRef: api,
        onRevealRequest: vi.fn(),
        onClose: vi.fn(),
        onPendingAnchor: vi.fn(),
        saveFirstText: 'Save the document first to add a comment',
      }),
    )
    await flush()
  })
  return { api }
}

const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
async function typeAndSend(text: string) {
  const box = el.querySelector<HTMLTextAreaElement>('.collab-thread--new textarea')!
  await act(async () => {
    nativeValue.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    box.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
    await flush()
  })
}

describe('G8-A01 (pdf): a new anchored thread on the real seam', () => {
  it('bound + version known: exactly one comments.create with the page+rect anchor and baseVersionId', async () => {
    const bridge = installBridge([], { documentId: 'doc-1', versionId: 'ver-7', myUserId: 'u-1' })
    const { api } = await mount()
    expect(bridge.context).toHaveBeenCalledWith({ path: PATH })
    expect(api.current?.canStartThread).toBe(true)
    await act(async () => {
      expect(api.current!.startAt(2, [100, 700])).toBe(true)
      await flush()
    })
    await typeAndSend('Is this amount right?')
    expect(bridge.create).toHaveBeenCalledTimes(1)
    expect(bridge.create).toHaveBeenCalledWith({
      path: PATH,
      kind: 'comment',
      body: 'Is this amount right?',
      anchor: expect.objectContaining({ format: 'pdf', v: 1, page: 2 }),
      baseVersionId: 'ver-7',
    })
  })

  it('bound but the version is unknown: no thread can start, nothing is created', async () => {
    const bridge = installBridge([], { documentId: 'doc-1', versionId: null })
    const { api } = await mount()
    expect(api.current?.canStartThread).toBe(false)
    await act(async () => {
      expect(api.current!.startAt(1, [100, 700])).toBe(false)
      await flush()
    })
    expect(el.querySelector('.collab-thread--new')).toBeNull()
    expect(bridge.create).not.toHaveBeenCalled()
  })

  it('unbound (context answers not_found): no thread can start, nothing is created', async () => {
    const bridge = installBridge([], 'unbound')
    const { api } = await mount()
    expect(api.current?.canStartThread).toBe(false)
    await act(async () => {
      expect(api.current!.startAt(1, [100, 700])).toBe(false)
      await flush()
    })
    expect(bridge.create).not.toHaveBeenCalled()
  })
})

describe('G8-A02 (pdf): the anchor map after the Save receipt on the real seam', () => {
  const ctx = { documentId: 'doc-1', versionId: 'ver-1', myUserId: 'u-1' }

  it('sends the receipt version with exact | lost only, and the old anchor kept for lost', async () => {
    const bridge = installBridge([comment('c1', 1), comment('c2', 2)], ctx)
    const { api } = await mount()
    await act(async () => {
      // the save dropped page 1: 1 -> 0, 2 -> 1
      api.current!.saved(
        new Map([
          [1, 0],
          [2, 1],
        ]),
      )
      await flush()
    })
    // nothing before the receipt
    expect(bridge.anchors).not.toHaveBeenCalled()
    await act(async () => {
      bridge.receipt('ver-2')
      await flush()
    })
    expect(bridge.anchors).toHaveBeenCalledTimes(1)
    expect(bridge.anchors).toHaveBeenCalledWith({
      path: PATH,
      versionId: 'ver-2',
      anchors: [
        { commentId: 'c1', anchor: makePdfAnchor(1, RECT), state: 'lost' },
        { commentId: 'c2', anchor: makePdfAnchor(1, RECT), state: 'exact' },
      ],
    })
    const states = bridge.anchors.mock.calls.flatMap((c) =>
      (c[0] as { anchors: Array<{ state: string }> }).anchors.map((a) => a.state),
    )
    expect(new Set(states)).toEqual(new Set(['exact', 'lost']))
    // new threads now anchor on the saved version
    expect(api.current?.context.versionId).toBe('ver-2')
  })

  it('anchor_version_invalid (400) never throws and sends nothing more until the next Save', async () => {
    const invalid = () =>
      Promise.resolve({
        ok: false as const,
        error: { code: 'malformed', message: 'x', details: { code: 'anchor_version_invalid' } },
      })
    const bridge = installBridge([comment('c1', 1)], ctx, invalid)
    const { api } = await mount()
    const lists = bridge.list.mock.calls.length
    await act(async () => {
      api.current!.saved(new Map([[1, 0]]))
      bridge.receipt('ver-gone')
      await flush()
    })
    expect(bridge.anchors).toHaveBeenCalledTimes(1)
    expect(bridge.list.mock.calls.length).toBe(lists)
  })
})
