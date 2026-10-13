/**
 * G8-15 (UNI-1410): the server-comments panel of a bound PDF, driven through a
 * fake `window.uniworkComments` bridge and a fake context seam.
 * Card test lines: create / resolve; delete a page -> lost (end to end through
 * the save receipt); reveal -> right page + rect; invariant 7 (an AI draft sends
 * nothing before Send); and the fallback without the shell's context.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collabStrings, type CollabComment } from '@genoffice/ui/collab'
import type {
  CommentsRevealPayload,
  UniworkCommentsApi,
} from '@genoffice/electron-utils/comments-ipc'
import {
  PdfServerCommentsHost,
  type PdfServerComments,
} from '../src/renderer/server-comments/PdfServerComments'
import { createPdfAnchorAdapter } from '../src/renderer/server-comments/pdf-adapter'
import { makePdfAnchor } from '../src/renderer/server-comments/pdf-anchor'
import type { PdfCommentsContextApi } from '../src/renderer/server-comments/pdf-comments-source'

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
})

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

function comment(over: Partial<CollabComment> & { id: string }): CollabComment {
  return {
    document_id: 'doc-1',
    author_id: 'u-1',
    body: 'Check this figure',
    kind: 'comment',
    anchor: makePdfAnchor(2, RECT),
    anchor_state: 'exact',
    created_at: '2026-10-13T08:00:00Z',
    updated_at: '2026-10-13T08:00:00Z',
    display_name: 'An',
    ...over,
  }
}

interface FakeBridge extends UniworkCommentsApi {
  comments: CollabComment[]
  discussion: CollabComment[]
  reveal(payload: CommentsRevealPayload): void
}

function fakeBridge(initial: CollabComment[] = []): FakeBridge {
  const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value })
  let revealHandler: ((p: CommentsRevealPayload) => void) | null = null
  const b: FakeBridge = {
    comments: [...initial],
    discussion: [],
    list: vi.fn((input) =>
      ok({
        comments: input.kind === 'discussion' ? b.discussion : b.comments,
        mentions: [],
        list_token: `t${b.comments.length}`,
        unchanged: false,
      }),
    ),
    create: vi.fn((input) => {
      const c = comment({
        id: `new-${b.comments.length}`,
        body: input.body,
        anchor: (input.anchor as CollabComment['anchor']) ?? null,
        ...(input.parentId ? { parent_id: input.parentId, anchor: null } : {}),
      })
      b.comments.push(c)
      return ok({ comment: c })
    }),
    update: vi.fn(() => ok({ comment: b.comments[0]! })),
    remove: vi.fn(() => ok({ outcome: 'removed' as const })),
    resolve: vi.fn((input) => {
      const c = b.comments.find((x) => x.id === input.commentId)!
      c.resolved_at = '2026-10-13T09:00:00Z'
      return ok({ comment: c })
    }),
    reopen: vi.fn(() => ok({ comment: b.comments[0]! })),
    revisions: vi.fn(() => ok({ revisions: [] })),
    anchors: vi.fn((input) =>
      ok({
        updated: input.anchors.map((a) => a.commentId),
        skipped: [],
        list_token: 'tx',
      }),
    ),
    searchMentions: vi.fn(() => ok({ candidates: [] })),
    onReveal: vi.fn((handler) => {
      revealHandler = handler
      return () => {
        revealHandler = null
      }
    }),
    reveal: (p) => revealHandler?.(p),
  }
  return b
}

interface FakeContext extends PdfCommentsContextApi {
  receipt(versionId: string): void
}

function fakeContext(
  ctx: { versionId?: string; level?: 'view' | 'edit' | 'manage' } = {},
): FakeContext {
  let saved: ((r: { versionId: string }) => void) | null = null
  return {
    uniworkCommentsContext: vi.fn(async () => ({
      documentId: 'doc-1',
      userId: 'u-1',
      level: ctx.level ?? 'edit',
      ...(ctx.versionId ? { versionId: ctx.versionId } : {}),
    })),
    onUniworkSaved: (handler) => {
      saved = handler
      return () => {
        saved = null
      }
    },
    receipt: (versionId) => saved?.({ versionId }),
  }
}

interface Mounted {
  api: { current: PdfServerComments | null }
  goTo: ReturnType<typeof vi.fn>
  onRevealRequest: ReturnType<typeof vi.fn>
}

async function mount(
  bridge: FakeBridge,
  contextApi: PdfCommentsContextApi | undefined,
  opts: { readOnly?: boolean } = {},
): Promise<Mounted> {
  const api: Mounted['api'] = { current: null }
  const goTo = vi.fn()
  const onRevealRequest = vi.fn()
  const adapter = createPdfAnchorAdapter({
    pageCount: 3,
    isShown: () => true,
    viewTop: (_i, rect) => 842 - rect[3],
    goTo,
  })
  await act(async () => {
    root.render(
      createElement(PdfServerCommentsHost, {
        bridge,
        path: PATH,
        lang: 'en',
        readOnly: opts.readOnly ?? false,
        ...(contextApi ? { contextApi } : {}),
        adapter,
        open: true,
        apiRef: api,
        onRevealRequest,
        onClose: () => {},
        onPendingAnchor: () => {},
        startUnavailableText: 'A new comment can’t be added to this document right now.',
      }),
    )
    await flush()
  })
  return { api, goTo, onRevealRequest }
}

const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
const box = () => el.querySelector<HTMLTextAreaElement>('.collab-thread--new textarea')!

async function typeAndSend(text: string) {
  await act(async () => {
    nativeValue.call(box(), text)
    box().dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    box().dispatchEvent(
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

describe('create / resolve (G8-15)', () => {
  it('the note tool click starts a thread anchored {page, rect} on the open version; Send creates it', async () => {
    const bridge = fakeBridge()
    const { api } = await mount(bridge, fakeContext({ versionId: 'ver-1' }))
    expect(api.current?.canStartThread).toBe(true)
    await act(async () => {
      expect(api.current!.startAt(1, [100, 700])).toBe(true)
      await flush()
    })
    expect(box()).toBeTruthy()
    await typeAndSend('Please check the total')
    expect(bridge.create).toHaveBeenCalledTimes(1)
    expect(bridge.create).toHaveBeenCalledWith({
      path: PATH,
      kind: 'comment',
      body: 'Please check the total',
      anchor: { format: 'pdf', v: 1, page: 1, rect: [100, 676, 124, 700] },
      baseVersionId: 'ver-1',
    })
    // the list reloads with the new thread under its page label
    expect(el.textContent).toContain('Please check the total')
  })

  it('resolve goes to the server (PDF annotations have no /State)', async () => {
    const bridge = fakeBridge([comment({ id: 'c1' })])
    await mount(bridge, fakeContext({ versionId: 'ver-1' }))
    const resolveBtn = el.querySelector<HTMLButtonElement>('[data-resolve-for="c1"]')!
    expect(resolveBtn).toBeTruthy()
    await act(async () => {
      resolveBtn.click()
      await flush()
    })
    expect(bridge.resolve).toHaveBeenCalledWith({ path: PATH, commentId: 'c1' })
  })
})

describe('delete a page -> lost (G8-15)', () => {
  it('after the save receipt the thread on the deleted page is sent lost with the new version', async () => {
    const ctx = fakeContext({ versionId: 'ver-1' })
    const bridge = fakeBridge([
      comment({ id: 'c1', anchor: makePdfAnchor(1, RECT) }),
      comment({ id: 'c2', anchor: makePdfAnchor(2, RECT) }),
    ])
    const { api } = await mount(bridge, ctx)
    await act(async () => {
      // the renderer saved with page 1 (index 0) deleted: 1 -> 0, 2 -> 1
      api.current!.saved(
        new Map([
          [1, 0],
          [2, 1],
        ]),
      )
      await flush()
    })
    expect(bridge.anchors).not.toHaveBeenCalled()
    await act(async () => {
      ctx.receipt('ver-2')
      await flush()
    })
    expect(bridge.anchors).toHaveBeenCalledWith({
      path: PATH,
      versionId: 'ver-2',
      anchors: [
        { commentId: 'c1', anchor: makePdfAnchor(1, RECT), state: 'lost' },
        { commentId: 'c2', anchor: makePdfAnchor(1, RECT), state: 'exact' },
      ],
    })
    // new threads now anchor against the saved version
    expect(api.current?.context.versionId).toBe('ver-2')
  })
})

describe('reveal (G8-15)', () => {
  it('comments.reveal opens the panel and moves the viewer to the right page and rect', async () => {
    const bridge = fakeBridge([comment({ id: 'c1', anchor: makePdfAnchor(3, RECT) })])
    const { goTo, onRevealRequest } = await mount(bridge, fakeContext({ versionId: 'ver-1' }))
    await act(async () => {
      bridge.reveal({ path: PATH, commentId: 'c1' })
      await flush()
    })
    expect(onRevealRequest).toHaveBeenCalled()
    expect(goTo).toHaveBeenCalledWith(2, RECT)
  })

  it('a lost thread only opens; a reveal for another path or a Discussion post does nothing', async () => {
    const bridge = fakeBridge([comment({ id: 'c1', anchor_state: 'lost' })])
    bridge.discussion = [comment({ id: 'd1', kind: 'discussion', anchor: null })]
    const { goTo, onRevealRequest } = await mount(bridge, fakeContext({ versionId: 'ver-1' }))
    await act(async () => {
      bridge.reveal({ path: PATH, commentId: 'c1' })
      await flush()
    })
    expect(onRevealRequest).toHaveBeenCalledTimes(1)
    expect(goTo).not.toHaveBeenCalled()
    await act(async () => {
      bridge.reveal({ path: '/other.pdf', commentId: 'c1' })
      bridge.reveal({ path: PATH, commentId: 'd1' })
      await flush()
    })
    expect(onRevealRequest).toHaveBeenCalledTimes(1)
  })
})

describe('invariant 7: AI only drafts', () => {
  it('an AI suggestion pre-fills the composer with the AI label and sends nothing before Send', async () => {
    const bridge = fakeBridge()
    const { api } = await mount(bridge, fakeContext({ versionId: 'ver-1' }))
    await act(async () => {
      api.current!.startAt(2, [72, 560], 'The total on this page does not add up.')
      await flush()
    })
    expect(box().value).toBe('The total on this page does not add up.')
    expect(el.textContent).toContain(collabStrings('en').collabAiDraftLabel)
    expect(bridge.create).not.toHaveBeenCalled()
    await typeAndSend('The total on this page does not add up.')
    expect(bridge.create).toHaveBeenCalledTimes(1)
  })
})

describe('fallback without the shell context (residual R1)', () => {
  it('no version: no new anchored thread (notice), the list still reads and resolves', async () => {
    const bridge = fakeBridge([comment({ id: 'c1' })])
    const { api } = await mount(bridge, undefined)
    expect(api.current?.canStartThread).toBe(false)
    let started = true
    await act(async () => {
      started = api.current!.startAt(1, [100, 700])
      await flush()
    })
    expect(started).toBe(false)
    expect(el.querySelector('.collab-thread--new')).toBeNull()
    expect(el.textContent).toContain('A new comment can’t be added to this document right now.')
    // the fallback level is edit for an editable copy: resolve stays available
    expect(el.querySelector('[data-resolve-for="c1"]')).toBeTruthy()
    expect(bridge.create).not.toHaveBeenCalled()
  })

  it('a view-only copy writes nothing whatever the context says', async () => {
    const bridge = fakeBridge([comment({ id: 'c1' })])
    const { api } = await mount(bridge, fakeContext({ versionId: 'ver-1', level: 'manage' }), {
      readOnly: true,
    })
    expect(api.current?.context.level).toBe('view')
    expect(el.querySelector('[data-resolve-for="c1"]')).toBeNull()
  })
})
