/**
 * G8-15 (UNI-1410): the server-comments panel of a bound PDF, driven through a
 * fake `window.uniworkComments` bridge and a fake context seam.
 * Card test lines: create / resolve; delete a page -> lost (end to end through
 * the save receipt); reveal -> right page + rect; invariant 7 (an AI draft sends
 * nothing before Send); and the fallback without a server context (an unknown
 * version, an error envelope).
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { collabStrings, type CollabComment } from '@genoffice/ui/collab'
import type {
  CommentsContextResult,
  CommentsRevealPayload,
  UniworkCommentsApi,
} from '@genoffice/electron-utils/comments-ipc'
import {
  PdfServerCommentsHost,
  type PdfServerComments,
} from '../src/renderer/server-comments/PdfServerComments'
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
  /** main's push after a Save of `path` settled with a commit receipt */
  receipt(versionId: string, path?: string): void
}

/** what `context({path})` answers: a value, or an error envelope (unbound, no session) */
type ContextAnswer = CommentsContextResult | { error: { code: string; message: string } }

const boundContext = (over: Partial<CommentsContextResult> = {}): CommentsContextResult => ({
  documentId: 'doc-1',
  versionId: 'ver-1',
  level: 'edit',
  myUserId: 'u-1',
  ...over,
})

function fakeBridge(
  initial: CollabComment[] = [],
  context: ContextAnswer = boundContext(),
): FakeBridge {
  const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value })
  let revealHandler: ((p: CommentsRevealPayload) => void) | null = null
  let savedHandler: ((p: { path: string; versionId: string }) => void) | null = null
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
    context: vi.fn(() =>
      Promise.resolve(
        'error' in context ? { ok: false as const, error: context.error } : ok(context),
      ),
    ) as FakeBridge['context'],
    onSaved: vi.fn((handler) => {
      savedHandler = handler
      return () => {
        savedHandler = null
      }
    }),
    receipt: (versionId, path = PATH) => savedHandler?.({ path, versionId }),
  }
  return b
}

interface Mounted {
  api: { current: PdfServerComments | null }
  goTo: ReturnType<typeof vi.fn>
  onRevealRequest: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
  onPendingAnchor: ReturnType<typeof vi.fn>
  onFocusOpener: ReturnType<typeof vi.fn>
  /** render again with the panel open or closed (the host stays mounted, like App) */
  setOpen(open: boolean): Promise<void>
}

async function mount(bridge: FakeBridge, opts: { readOnly?: boolean } = {}): Promise<Mounted> {
  const api: Mounted['api'] = { current: null }
  const goTo = vi.fn()
  const onRevealRequest = vi.fn()
  const onClose = vi.fn()
  const onPendingAnchor = vi.fn()
  const onFocusOpener = vi.fn()
  const adapter = createPdfAnchorAdapter({
    pageCount: 3,
    isShown: () => true,
    viewTop: (_i, rect) => 842 - rect[3],
    goTo,
  })
  const render = (open: boolean) =>
    root.render(
      createElement(PdfServerCommentsHost, {
        bridge,
        path: PATH,
        lang: 'en',
        readOnly: opts.readOnly ?? false,
        adapter,
        open,
        apiRef: api,
        onRevealRequest,
        onClose,
        onPendingAnchor,
        onFocusOpener,
        saveFirstText: 'Save the document first to add a comment',
      }),
    )
  await act(async () => {
    render(true)
    await flush()
  })
  const setOpen = async (open: boolean) => {
    await act(async () => {
      render(open)
      await flush()
    })
  }
  return { api, goTo, onRevealRequest, onClose, onPendingAnchor, onFocusOpener, setOpen }
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
    const { api } = await mount(bridge)
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
    await mount(bridge)
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
    const bridge = fakeBridge([
      comment({ id: 'c1', anchor: makePdfAnchor(1, RECT) }),
      comment({ id: 'c2', anchor: makePdfAnchor(2, RECT) }),
    ])
    const { api } = await mount(bridge)
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
      bridge.receipt('ver-2')
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

describe('a comment that appears with the panel closed (G819-A02b)', () => {
  it('made on the server after the first list, it is in the PUT after the receipt', async () => {
    const bridge = fakeBridge([comment({ id: 'c1', anchor: makePdfAnchor(1, RECT) })])
    const { api, setOpen } = await mount(bridge)
    await setOpen(false)
    // the other host comments after this editor listed; nothing here lists again while closed
    bridge.comments.push(comment({ id: 'c2', anchor: makePdfAnchor(2, RECT) }))
    await act(async () => {
      // the renderer saved with page 1 (index 0) deleted: 1 -> 0, 2 -> 1
      api.current!.saved(
        new Map([
          [1, 0],
          [2, 1],
        ]),
      )
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
  })
})

describe('closed-panel Save after a prepare Save (G819-A02c)', () => {
  it('the comment made while the prepare receipt is still in flight ends on page 1 at the shift version', async () => {
    const bridge = fakeBridge()
    const { api, setOpen } = await mount(bridge)
    await setOpen(false)
    // the prepare Save (3 pages, nothing moved) has its page map, its receipt comes a moment later
    await act(async () => {
      api.current!.saved(
        new Map([
          [0, 0],
          [1, 1],
          [2, 2],
        ]),
      )
      await flush()
    })
    // the other host comments on page 2 before the prepare receipt lands
    bridge.comments.push(comment({ id: 'c2', anchor: makePdfAnchor(2, RECT) }))
    await act(async () => {
      bridge.receipt('ver-1')
      await flush()
    })
    // the desktop deletes page 1 and saves: the anchored page 2 becomes page 1
    await act(async () => {
      api.current!.saved(
        new Map([
          [1, 0],
          [2, 1],
        ]),
      )
      bridge.receipt('ver-2')
      await flush()
    })
    expect(bridge.anchors.mock.calls.map(([call]) => [call.versionId, call.anchors])).toEqual([
      ['ver-1', [{ commentId: 'c2', anchor: makePdfAnchor(2, RECT), state: 'exact' }]],
      ['ver-2', [{ commentId: 'c2', anchor: makePdfAnchor(1, RECT), state: 'exact' }]],
    ])
  })
})

describe('reveal (G8-15)', () => {
  it('comments.reveal opens the panel and moves the viewer to the right page and rect', async () => {
    const bridge = fakeBridge([comment({ id: 'c1', anchor: makePdfAnchor(3, RECT) })])
    const { goTo, onRevealRequest } = await mount(bridge)
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
    const { goTo, onRevealRequest } = await mount(bridge)
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
    const { api } = await mount(bridge)
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

describe('the shared comments seam: context + onSaved (G8-12 shape)', () => {
  it('asks window.uniworkComments.context for this path and takes level and myUserId from it', async () => {
    const bridge = fakeBridge([comment({ id: 'c1', author_id: 'u-1' })])
    await mount(bridge)
    expect(bridge.context).toHaveBeenCalledWith({ path: PATH })
    // myUserId u-1 owns c1: the edit affordance shows for it
    expect(el.querySelector('[data-resolve-for="c1"]')).toBeTruthy()
  })

  it('a save receipt of another document is ignored', async () => {
    const bridge = fakeBridge([comment({ id: 'c1' })])
    const { api } = await mount(bridge)
    await act(async () => {
      api.current!.saved(new Map([[1, 0]]))
      bridge.receipt('ver-other', '/work/uniwork/doc-2/other.pdf')
      await flush()
    })
    expect(bridge.anchors).not.toHaveBeenCalled()
    expect(api.current?.context.versionId).toBe('ver-1')
  })

  it('an unknown version (versionId null): no new root, asks to save first, replies and resolve stay', async () => {
    const bridge = fakeBridge([comment({ id: 'c1' })], boundContext({ versionId: null }))
    const { api } = await mount(bridge)
    expect(api.current?.canStartThread).toBe(false)
    expect(api.current?.needsSave).toBe(true)
    let started = true
    await act(async () => {
      started = api.current!.startAt(1, [100, 700])
      await flush()
    })
    expect(started).toBe(false)
    expect(el.querySelector('.collab-thread--new')).toBeNull()
    expect(el.textContent).toContain('Save the document first to add a comment')
    expect(el.querySelector('[data-resolve-for="c1"]')).toBeTruthy()
    expect(bridge.create).not.toHaveBeenCalled()
    // the Save receipt unlocks new roots, anchored against its version
    await act(async () => {
      bridge.receipt('ver-2')
      await flush()
    })
    expect(api.current?.needsSave).toBe(false)
    await act(async () => {
      expect(api.current!.startAt(1, [100, 700])).toBe(true)
      await flush()
    })
    await typeAndSend('Now it can')
    expect(bridge.create).toHaveBeenCalledWith(expect.objectContaining({ baseVersionId: 'ver-2' }))
  })

  it('an error envelope (unbound path) is no server context: the same save-first rule, comments still read', async () => {
    const bridge = fakeBridge([comment({ id: 'c1' })], {
      error: { code: 'not_found', message: 'not bound' },
    })
    const { api } = await mount(bridge)
    expect(api.current?.canStartThread).toBe(false)
    expect(api.current?.context.documentId).toBe(PATH)
    expect(el.textContent).toContain('Check this figure')
    expect(bridge.create).not.toHaveBeenCalled()
  })

  it('a bridge without context (an older preload) falls back instead of throwing', async () => {
    const bridge = fakeBridge([comment({ id: 'c1' })])
    ;(bridge as { context?: unknown }).context = undefined
    ;(bridge as { onSaved?: unknown }).onSaved = undefined
    const { api } = await mount(bridge)
    expect(api.current?.canStartThread).toBe(false)
    expect(api.current?.context.level).toBe('edit')
  })

  it('DOC5-W04: a comment-level caller keeps the comment level (it was read as edit before)', async () => {
    const bridge = fakeBridge([comment({ id: 'c1' })], boundContext({ level: 'comment' }))
    const { api } = await mount(bridge)
    expect(api.current?.context.level).toBe('comment')
  })

  it('a view-only copy writes nothing whatever the context says', async () => {
    const bridge = fakeBridge([comment({ id: 'c1' })], boundContext({ level: 'manage' }))
    const { api } = await mount(bridge, { readOnly: true })
    expect(api.current?.context.level).toBe('view')
    expect(el.querySelector('[data-resolve-for="c1"]')).toBeNull()
  })
})

describe('anchor_version_invalid keeps the anchors stale and retries on the next Save (G8-15)', () => {
  const STALE = collabStrings('en').collabAnchorStale
  const invalid = {
    ok: false as const,
    error: {
      code: 'malformed' as const,
      message: 'anchor_version_invalid',
      details: { code: 'anchor_version_invalid' },
    },
  }
  /** the thread card of a comment as the panel draws it now */
  const card = (id: string) => el.querySelector(`[data-thread-id="${id}"]`)?.textContent ?? ''

  it('a 400 anchor_version_invalid never throws; the next Save sends both layout changes', async () => {
    const bridge = fakeBridge([
      comment({ id: 'c1', anchor: makePdfAnchor(1, RECT) }),
      comment({ id: 'c2', anchor: makePdfAnchor(2, RECT) }),
    ])
    ;(bridge.anchors as ReturnType<typeof vi.fn>).mockResolvedValueOnce(invalid)
    const { api } = await mount(bridge)
    const listCalls = (bridge.list as ReturnType<typeof vi.fn>).mock.calls.length
    await act(async () => {
      api.current!.saved(
        new Map([
          [1, 0],
          [2, 1],
        ]),
      ) // page 1 deleted
      bridge.receipt('ver-2')
      await flush()
    })
    expect(bridge.anchors).toHaveBeenCalledTimes(1)
    // nothing changed on the server: no reload after the PUT; the one list is the receipt's own refresh (G819-A02b)
    expect((bridge.list as ReturnType<typeof vi.fn>).mock.calls.length).toBe(listCalls + 1)
    await act(async () => {
      api.current!.saved(new Map([[0, 0]])) // the next Save keeps page 1 (old page 2)
      bridge.receipt('ver-3')
      await flush()
    })
    expect(bridge.anchors).toHaveBeenCalledTimes(2)
    expect(bridge.anchors).toHaveBeenLastCalledWith({
      path: PATH,
      versionId: 'ver-3',
      anchors: [
        { commentId: 'c1', anchor: makePdfAnchor(1, RECT), state: 'lost' },
        { commentId: 'c2', anchor: makePdfAnchor(1, RECT), state: 'exact' },
      ],
    })
  })

  it('shows the anchors whose page the refused layout change moved or dropped as stale, the rest exact', async () => {
    const bridge = fakeBridge([
      comment({ id: 'c1', anchor: makePdfAnchor(1, RECT) }),
      comment({ id: 'c2', anchor: makePdfAnchor(2, RECT) }),
      comment({ id: 'c3', anchor: makePdfAnchor(3, RECT) }),
    ])
    ;(bridge.anchors as ReturnType<typeof vi.fn>).mockResolvedValueOnce(invalid)
    const { api } = await mount(bridge)
    for (const id of ['c1', 'c2', 'c3']) expect(card(id)).not.toContain(STALE)
    await act(async () => {
      // the Save deleted page 2: 1 -> 0, 3 -> 1; the server still counts pages in the old layout
      api.current!.saved(
        new Map([
          [0, 0],
          [2, 1],
        ]),
      )
      bridge.receipt('ver-2')
      await flush()
    })
    expect(bridge.anchors).toHaveBeenCalledTimes(1)
    expect(card('c1')).not.toContain(STALE) // page 1 is still page 1
    expect(card('c2')).toContain(STALE) // dropped
    expect(card('c3')).toContain(STALE) // moved: the open file's page 3 is another page
    // another Save before the receipt moves pages again: still stale, not exact on a wrong page
    await act(async () => {
      api.current!.saved(new Map([[0, 0]]))
      await flush()
    })
    expect(card('c2')).toContain(STALE)
    expect(card('c3')).toContain(STALE)
    // the next Save lands the anchors: the server answers, the list reloads, nothing stays stale
    bridge.comments = [
      comment({ id: 'c1', anchor: makePdfAnchor(1, RECT) }),
      comment({ id: 'c2', anchor: makePdfAnchor(2, RECT), anchor_state: 'lost' }),
      comment({ id: 'c3', anchor: makePdfAnchor(1, RECT) }),
    ]
    await act(async () => {
      bridge.receipt('ver-3')
      await flush()
    })
    expect(bridge.anchors).toHaveBeenCalledTimes(2)
    expect(card('c1')).not.toContain(STALE)
    expect(card('c2')).not.toContain(STALE)
    expect(card('c3')).not.toContain(STALE)
  })
})

const esc = () =>
  box().dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  )
const lastPending = (m: Mounted) => m.onPendingAnchor.mock.calls.at(-1)?.[0]

describe('an empty new-thread composer can be dismissed (V15-02)', () => {
  it('Esc drops it, clears the pending frame and closes the panel', async () => {
    const m = await mount(fakeBridge())
    await act(async () => {
      m.api.current!.startAt(1, [100, 700])
      await flush()
    })
    expect(lastPending(m)).toMatchObject({ page: 1 })
    await act(async () => {
      esc()
      await flush()
    })
    expect(el.querySelector('.collab-thread--new')).toBeNull()
    expect(lastPending(m)).toBeNull()
    expect(m.onClose).toHaveBeenCalledTimes(1)
    expect(m.onFocusOpener).toHaveBeenCalled()
  })

  it('Esc with typed text asks first and neither drops nor closes (the kit owns it)', async () => {
    const m = await mount(fakeBridge())
    await act(async () => {
      m.api.current!.startAt(1, [100, 700])
      await flush()
    })
    await act(async () => {
      nativeValue.call(box(), 'half a thought')
      box().dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      esc()
      await flush()
    })
    expect(el.querySelector('.collab-thread--new')).not.toBeNull()
    expect(m.onClose).not.toHaveBeenCalled()
  })

  it('Esc on an unedited AI-drafted composer keeps the thread, the draft and the panel (RFE15b-01)', async () => {
    const m = await mount(fakeBridge())
    await act(async () => {
      m.api.current!.startAt(1, [100, 700], 'The total on this page does not add up.')
      await flush()
    })
    await act(async () => {
      esc()
      await flush()
    })
    expect(el.querySelector('.collab-thread--new')).not.toBeNull()
    expect(box().value).toBe('The total on this page does not add up.')
    expect(lastPending(m)).toMatchObject({ page: 1 })
    expect(m.onClose).not.toHaveBeenCalled()
    expect(m.api.current!.aiDraft?.text).toBe('The total on this page does not add up.')
  })

  it('closing the panel drops an empty composer and its frame; a typed draft survives the close', async () => {
    const m = await mount(fakeBridge())
    await act(async () => {
      m.api.current!.startAt(1, [100, 700])
      await flush()
    })
    await m.setOpen(false)
    expect(lastPending(m)).toBeNull()
    await m.setOpen(true)
    expect(el.querySelector('.collab-thread--new')).toBeNull()

    await act(async () => {
      m.api.current!.startAt(1, [100, 700])
      await flush()
    })
    await act(async () => {
      nativeValue.call(box(), 'keep me')
      box().dispatchEvent(new Event('input', { bubbles: true }))
    })
    await m.setOpen(false)
    await m.setOpen(true)
    expect(box().value).toBe('keep me')
    expect(lastPending(m)).toMatchObject({ page: 1 })
  })

  it('cancelEmptyThread (Note tool off) drops an untouched composer, never one with text or an AI draft', async () => {
    const m = await mount(fakeBridge())
    await act(async () => {
      m.api.current!.startAt(1, [100, 700])
      await flush()
    })
    await act(async () => {
      m.api.current!.cancelEmptyThread()
      await flush()
    })
    expect(el.querySelector('.collab-thread--new')).toBeNull()

    await act(async () => {
      m.api.current!.startAt(1, [100, 700], 'AI suggestion')
      await flush()
    })
    await act(async () => {
      m.api.current!.cancelEmptyThread()
      await flush()
    })
    expect(box().value).toBe('AI suggestion')
  })
})

describe('focus after a new thread (V15-03)', () => {
  it('Send moves the focus to the new thread heading', async () => {
    const bridge = fakeBridge()
    const m = await mount(bridge)
    await act(async () => {
      m.api.current!.startAt(1, [100, 700])
      await flush()
    })
    await typeAndSend('Please check the total')
    const heading = el.querySelector('[data-thread-id="new-0"] [data-thread-heading]')
    expect(heading).not.toBeNull()
    expect(document.activeElement).toBe(heading)
  })

  it('Discard hands the focus back to the opener', async () => {
    const m = await mount(fakeBridge())
    await act(async () => {
      m.api.current!.startAt(1, [100, 700])
      await flush()
    })
    // an empty root composer has no Cancel button (kit): Discard comes with a draft
    await act(async () => {
      nativeValue.call(box(), 'draft')
      box().dispatchEvent(new Event('input', { bubbles: true }))
    })
    const cancelBtn = [
      ...el.querySelectorAll<HTMLButtonElement>('.collab-thread--new button'),
    ].find((b) => b.textContent === collabStrings('en').collabCancel)!
    await act(async () => {
      cancelBtn.click()
      await flush()
    })
    const discard = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === collabStrings('en').collabDiscard,
    )
    await act(async () => {
      discard?.click()
      await flush()
    })
    expect(el.querySelector('.collab-thread--new')).toBeNull()
    expect(m.onFocusOpener).toHaveBeenCalled()
  })
})

describe('an older preload without the seam (V15-07)', () => {
  it('is not "save first": no receipt will ever come, so the generic line applies', async () => {
    const bridge = fakeBridge()
    ;(bridge as { context?: unknown }).context = undefined
    ;(bridge as { onSaved?: unknown }).onSaved = undefined
    const { api } = await mount(bridge)
    expect(api.current?.needsSave).toBe(false)
    expect(api.current?.canStartThread).toBe(false)
    expect(el.textContent).not.toContain('Save the document first')
  })

  it('a seam with an unknown version still says save first', async () => {
    const bridge = fakeBridge([], boundContext({ versionId: undefined }))
    const { api } = await mount(bridge)
    expect(api.current?.needsSave).toBe(true)
    expect(el.textContent).toContain('Save the document first')
  })
})
