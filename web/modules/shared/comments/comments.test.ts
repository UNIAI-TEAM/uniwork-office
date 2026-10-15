// @vitest-environment jsdom
/**
 * G8-12 (UNI-1407) lane contract §3.3: the web frame half of the shared comments seam.
 * `window.uniworkComments` over the frame protocol (same shape as the desktop preload), its
 * `context()` from `init` + the open / landed version, the install gate on the effective
 * `comments` capability, and the frame's one `comments.reveal` router shared with the G8-11
 * Discussion mount (discussion id -> Discussion, editor-owned id -> editor, unknown -> one
 * `revealed:false`, held until the first list).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMockPort } from '../../../docs/bridge/testing/mock-port'
import {
  COMMENTS_REVEAL_WAIT_MS,
  type CommentsListResult,
  type DocumentComment,
} from '../../../docs/protocol/types'
import { frameCommentsClaim } from '../discussion/claim'
import { mountFrameDiscussion, type DiscussionPort } from '../discussion/mount'
import {
  FRAME_SIDE_PANEL_EVENT,
  announceFrameSidePanel,
  createFrameCommentsApi,
  createFrameDocVersion,
  frameMentionAccess,
  frameRevealRouter,
  installFrameComments,
  onFrameSidePanel,
} from './index'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ME = '01J8X4USR0AAAAAAAAAAAAAAAA'

function post(over: Partial<DocumentComment> & { id: string }): DocumentComment {
  return {
    document_id: 'doc-1',
    author_id: ME,
    parent_id: null,
    body: `body ${over.id}`,
    kind: 'discussion',
    revision: 1,
    anchor: null,
    created_at: '2026-10-13T09:00:00Z',
    updated_at: '2026-10-13T09:00:00Z',
    display_name: 'An',
    ...over,
  }
}

const listOf = (comments: DocumentComment[], token = 'lt1'): CommentsListResult => ({
  comments,
  mentions: [],
  list_token: token,
  unchanged: false,
})

/** the mock port plus the real client's reveal hook (one handler per port, like the client) */
function framePort(
  session: {
    comments?: boolean
    commentsShareView?: boolean
    level?: 'view' | 'comment' | 'edit' | 'manage' | null
  } = {},
) {
  const mock = createMockPort({
    documentId: 'doc-1',
    capabilities: {
      save: true,
      comments: session.comments ?? true,
      ...(session.commentsShareView ? { commentsShareView: true } : {}),
    },
    user: { displayName: 'An', id: ME },
    ...(session.level === null ? {} : { commentsLevel: session.level ?? 'edit' }),
  } as never)
  mock.override('comments.list', () => listOf([post({ id: 'p1' })]))
  let revealHandler:
    ((p: { comment_id: string }, ctx: { signal: AbortSignal }) => unknown) | undefined
  const registered = vi.fn()
  const port: DiscussionPort = {
    ...mock.port,
    onCommentsChanged: () => () => {},
    handleCommentsReveal: (h) => {
      registered()
      revealHandler = h as never
      return () => {
        if (revealHandler === (h as never)) revealHandler = undefined
      }
    },
  }
  return {
    mock,
    port,
    registered,
    reveal: async (id: string) =>
      (await revealHandler!({ comment_id: id }, { signal: new AbortController().signal })) as {
        revealed: boolean
      },
    handler: () => revealHandler as NonNullable<typeof revealHandler>,
    hasRevealHandler: () => revealHandler !== undefined,
    calls: (type: string) => mock.calls.filter((c) => c.type === type),
  }
}

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })
}

const disposers: Array<() => void> = []
afterEach(() => {
  act(() => {
    for (const d of disposers.splice(0)) d()
  })
  document.body.innerHTML = ''
  document.documentElement.className = ''
})

describe('createFrameCommentsApi: the desktop shape over the frame protocol', () => {
  it('maps every call to its frame request and resolves the envelope', async () => {
    const p = framePort()
    p.mock.init()
    p.mock.override('comments.create', () => ({ comment: post({ id: 'c9', kind: 'comment' }) }))
    p.mock.override('comments.anchors', () => ({ updated: ['c9'], skipped: [], list_token: 'x' }))
    const api = createFrameCommentsApi(p.port, { version: createFrameDocVersion() })
    const anchor = { format: 'docx', v: 1, path: [0], start: 0, end: 1 }
    expect(await api.list({ path: 'ignored', kind: 'comment', sinceToken: 't' })).toMatchObject({
      ok: true,
      value: { list_token: 'lt1' },
    })
    expect(
      await api.create({
        path: 'ignored',
        kind: 'comment',
        body: 'b',
        anchor,
        baseVersionId: 'v1',
      }),
    ).toMatchObject({ ok: true, value: { comment: { id: 'c9' } } })
    expect(
      await api.anchors({
        path: 'ignored',
        versionId: 'v2',
        anchors: [{ commentId: 'c9', anchor, state: 'lost' }],
      }),
    ).toEqual({ ok: true, value: { updated: ['c9'], skipped: [], list_token: 'x' } })
    expect(p.calls('comments.list')[0]!.payload).toEqual({ kind: 'comment', since_token: 't' })
    expect(p.calls('comments.create')[0]!.payload).toEqual({
      kind: 'comment',
      body: 'b',
      anchor,
      base_version_id: 'v1',
    })
    expect(p.calls('comments.anchors')[0]!.payload).toEqual({
      version_id: 'v2',
      anchors: [{ comment_id: 'c9', anchor, state: 'lost' }],
    })
  })

  it('a failed request resolves to the error envelope, never rejects', async () => {
    const p = framePort()
    p.mock.init()
    p.mock.override('comments.resolve', () => {
      throw { code: 'forbidden', message: 'no', retryable: false }
    })
    const api = createFrameCommentsApi(p.port, { version: createFrameDocVersion() })
    expect(await api.resolve({ path: '', commentId: 'c1' })).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'forbidden', retryable: false }),
    })
  })

  it('context() answers from init, then from every landed save; onSaved fires once per save', async () => {
    const p = framePort({ level: 'manage' })
    const file = p.mock.seed('Plan.docx', new Uint8Array([1]))
    p.mock.init({ documentId: 'doc-1', open: p.mock.openPayload(file.fileId) } as never)
    const version = createFrameDocVersion()
    const api = createFrameCommentsApi(p.port, { version })
    expect(await api.context({ path: '' })).toEqual({
      ok: true,
      value: {
        documentId: 'doc-1',
        versionId: file.versionId,
        level: 'manage',
        myUserId: ME,
        frame: true,
      },
    })
    const heard: unknown[] = []
    const off = api.onSaved((s) => heard.push(s))
    version.noteOpened({ path: 'uniwork://f/Plan.docx', versionId: 'v-open' })
    expect(heard).toEqual([])
    expect(await api.context({ path: '' })).toMatchObject({ value: { versionId: 'v-open' } })
    version.noteSaved({ path: 'uniwork://f/Plan.docx', versionId: 'v-saved' })
    expect(heard).toEqual([{ path: 'uniwork://f/Plan.docx', versionId: 'v-saved' }])
    expect(await api.context({ path: '' })).toMatchObject({ value: { versionId: 'v-saved' } })
    // a save whose version the host did not say is not announced
    version.noteSaved({ path: 'uniwork://f/Plan.docx' })
    off()
    version.noteSaved({ path: 'uniwork://f/Plan.docx', versionId: 'v-later' })
    expect(heard).toHaveLength(1)
    // no comment request was needed for any of it
    expect(p.mock.calls.filter((c) => c.type.startsWith('comments.'))).toEqual([])
  })

  it('context() leaves an unknown level and a missing user id out', async () => {
    const p = framePort({ level: null })
    p.mock.init()
    const api = createFrameCommentsApi(p.port, { version: createFrameDocVersion() })
    const reply = (await api.context({ path: '' })) as { ok: true; value: object }
    expect(reply.value).not.toHaveProperty('level')
    expect(reply.value).toMatchObject({ documentId: 'doc-1', myUserId: ME, frame: true })
  })
})

describe('G8-18 mention access through the frame bridge (F1)', () => {
  const searchRows = { candidates: [{ user_id: 'u1', display_name: 'Ann', can_view: false }] }

  async function installed(session: Parameters<typeof framePort>[0]) {
    const p = framePort(session)
    const target: Record<string, unknown> = {}
    const pending = installFrameComments(p.port, { version: createFrameDocVersion() }, target)
    p.mock.init()
    const api = (await pending)!
    return { p, api }
  }

  it('searchMentions passes include through to mentions.search (it used to drop it)', async () => {
    const { p, api } = await installed({ level: 'manage' })
    p.mock.override('mentions.search', () => searchRows)
    expect(
      await api.searchMentions({ path: '', q: 'an', limit: 20, include: 'no_access' } as never),
    ).toEqual({ ok: true, value: searchRows })
    await api.searchMentions({ path: '', q: 'an' })
    expect(p.calls('mentions.search').map((c) => c.payload)).toEqual([
      { q: 'an', limit: 20, include: 'no_access' },
      { q: 'an' },
    ])
  })

  it('shareView calls comments.shareView with the user id only when the capability is effective', async () => {
    const { p, api } = await installed({ level: 'manage', commentsShareView: true })
    p.mock.override('comments.shareView', () => ({ ok: true as const }))
    expect(api.shareView).toBeTypeOf('function')
    expect(await api.shareView!({ userId: 'u1' })).toEqual({ ok: true, value: { ok: true } })
    // the level is the host's decision: the frame never sends one
    expect(p.calls('comments.shareView').map((c) => c.payload)).toEqual([{ user_id: 'u1' }])
  })

  it('a failed share resolves to the error envelope like every other call', async () => {
    const { p, api } = await installed({ level: 'manage', commentsShareView: true })
    p.mock.override('comments.shareView', () => {
      throw { code: 'forbidden', message: 'no', retryable: false }
    })
    expect(await api.shareView!({ userId: 'u1' })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    })
  })

  it('without the capability there is no shareView, so the editor offers no share action', async () => {
    const { p, api } = await installed({ level: 'edit' })
    expect(api.shareView).toBeUndefined()
    expect(p.calls('comments.shareView')).toEqual([])
  })

  it('canListMembers follows the caller: manage level or a granted commentsShareView', async () => {
    expect((await installed({ level: 'manage' })).api.canListMembers).toBe(true)
    expect((await installed({ level: 'edit', commentsShareView: true })).api.canListMembers).toBe(
      true,
    )
    expect((await installed({ level: 'edit' })).api.canListMembers).toBe(false)
    expect((await installed({ level: 'comment' })).api.canListMembers).toBe(false)
  })

  it('the frame claims commentsShareView with comments, so the host grant can become effective', () => {
    expect(frameCommentsClaim(true)).toEqual({ comments: true, commentsShareView: true })
    expect(frameCommentsClaim(false)).toEqual({})
    expect(
      frameMentionAccess({ capabilities: { comments: true, commentsShareView: true } }),
    ).toEqual({
      commentsShareView: true,
      canListMembers: true,
    })
    // an unrelated grant never turns it on
    expect(
      frameMentionAccess({ capabilities: { commentsShareView: true } }).commentsShareView,
    ).toBe(false)
  })
})

describe('installFrameComments: only with the effective comments capability', () => {
  it('installs window.uniworkComments when init grants comments', async () => {
    const p = framePort()
    const target: Record<string, unknown> = {}
    const pending = installFrameComments(p.port, {}, target)
    p.mock.init()
    const api = await pending
    expect(api).not.toBeNull()
    expect(target.uniworkComments).toBe(api)
  })

  it('installs nothing and sends nothing without it', async () => {
    const p = framePort({ comments: false })
    const target: Record<string, unknown> = {}
    const pending = installFrameComments(p.port, {}, target)
    p.mock.init()
    expect(await pending).toBeNull()
    expect(target).toEqual({})
    expect(p.mock.calls.filter((c) => c.type.startsWith('comments.'))).toEqual([])
  })
})

describe('the frame reveal router (one handler, exactly one panel reacts)', () => {
  async function mountDiscussion(p: ReturnType<typeof framePort>, opts = {}) {
    let dispose: () => void = () => {}
    await act(async () => {
      const pending = mountFrameDiscussion(p.port, opts)
      p.mock.init()
      dispose = await pending
    })
    disposers.push(dispose)
    await flush()
  }
  const discussionPanel = () => document.querySelector<HTMLElement>('aside.collab-panel')

  it('registers one port handler for the Discussion panel and the editor together', async () => {
    const p = framePort()
    await mountDiscussion(p)
    const api = createFrameCommentsApi(p.port, { version: createFrameDocVersion() })
    const off = api.onReveal(() => true)
    expect(p.registered).toHaveBeenCalledTimes(1)
    off()
    expect(p.hasRevealHandler()).toBe(true)
  })

  it('a discussion id goes to the Discussion panel; the editor is not asked', async () => {
    const p = framePort()
    await mountDiscussion(p)
    const editor = vi.fn(() => true)
    disposers.push(createFrameCommentsApi(p.port).onReveal(editor))
    let result: unknown
    await act(async () => {
      result = await p.reveal('p1')
    })
    await flush()
    expect(result).toEqual({ revealed: true })
    expect(editor).not.toHaveBeenCalled()
    expect(discussionPanel()).not.toBeNull()
  })

  it('an editor-owned id goes to the editor; the Discussion panel stays closed and silent', async () => {
    const p = framePort()
    await mountDiscussion(p)
    const version = createFrameDocVersion()
    version.noteOpened({ path: 'uniwork://f/Plan.docx', versionId: 'v1' })
    const editor = vi.fn(async (payload: { commentId: string }) => payload.commentId === 'c1')
    disposers.push(createFrameCommentsApi(p.port, { version }).onReveal(editor))
    let result: unknown
    await act(async () => {
      result = await p.reveal('c1')
    })
    await flush()
    expect(result).toEqual({ revealed: true })
    expect(editor).toHaveBeenCalledWith({
      path: 'uniwork://f/Plan.docx',
      commentId: 'c1',
      last: true,
    })
    expect(discussionPanel()).toBeNull()
  })

  it('an unknown id answers revealed:false once; the editor (asked once) owns the S15 line', async () => {
    const p = framePort()
    await mountDiscussion(p)
    const editor = vi.fn(() => false)
    disposers.push(createFrameCommentsApi(p.port).onReveal(editor))
    let result: unknown
    await act(async () => {
      result = await p.reveal('nope')
    })
    await flush()
    expect(result).toEqual({ revealed: false })
    expect(editor).toHaveBeenCalledTimes(1)
    // the Discussion panel neither opened nor shows the S15 line: the editor panel does
    expect(discussionPanel()).toBeNull()
  })

  it('without an editor owner the Discussion panel keeps the S15 line (markdown / html unchanged)', async () => {
    const p = framePort()
    await mountDiscussion(p)
    let result: unknown
    await act(async () => {
      result = await p.reveal('nope')
    })
    await flush()
    expect(result).toEqual({ revealed: false })
    expect(discussionPanel()!.textContent).toContain('This discussion post was deleted')
  })

  it('a reveal is held until the first list, then answered once', async () => {
    const p = framePort()
    let release!: (r: CommentsListResult) => void
    p.mock.override(
      'comments.list',
      () =>
        new Promise<CommentsListResult>((resolve) => {
          release = resolve
        }),
    )
    await mountDiscussion(p)
    const editor = vi.fn(() => false)
    disposers.push(createFrameCommentsApi(p.port).onReveal(editor))
    let result: unknown
    let settled = 0
    const pending = p.reveal('nope').then((r) => {
      settled += 1
      result = r
    })
    await flush()
    expect(settled).toBe(0)
    expect(editor).not.toHaveBeenCalled()
    await act(async () => release(listOf([post({ id: 'p1' })])))
    await act(async () => pending)
    await flush()
    expect(settled).toBe(1)
    expect(result).toEqual({ revealed: false })
    expect(editor).toHaveBeenCalledTimes(1)
  })

  describe('an editor is expected (installFrameComments ran) but has not registered yet', () => {
    async function expecting() {
      const p = framePort()
      await mountDiscussion(p)
      const target: Record<string, unknown> = {}
      await installFrameComments(p.port, { version: createFrameDocVersion() }, target)
      return p
    }

    it('an editor-owned id revealed before addEditor waits for the editor, which answers true; Discussion shows no notice', async () => {
      const p = await expecting()
      let result: unknown
      let settled = false
      const pending = p.reveal('c1').then((r) => {
        settled = true
        result = r
      })
      await flush()
      // not answered `revealed:false` just because the editor has not registered: still waiting
      expect(settled).toBe(false)
      const editor = vi.fn(async (payload: { commentId: string }) => payload.commentId === 'c1')
      disposers.push(createFrameCommentsApi(p.port).onReveal(editor))
      await act(async () => pending)
      await flush()
      expect(result).toEqual({ revealed: true })
      expect(editor).toHaveBeenCalledTimes(1)
      expect(discussionPanel()).toBeNull()
    })

    it('an editor that reports no server mode releases the wait: a non-discussion id answers revealed:false at once', async () => {
      const p = framePort()
      await mountDiscussion(p)
      const target: Record<string, unknown> = {}
      const api = (await installFrameComments(
        p.port,
        { version: createFrameDocVersion() },
        target,
      )) as { noEditor?: () => void } | null
      expect(typeof api?.noEditor).toBe('function')
      api!.noEditor!()
      // idempotent: a second report never over-releases
      api!.noEditor!()
      let result: unknown
      await act(async () => {
        result = await p.reveal('nope')
      })
      await flush()
      expect(result).toEqual({ revealed: false })
      expect(discussionPanel()!.textContent).toContain('This discussion post was deleted')
    })

    it('a discussion id is still answered by Discussion at once, without waiting for the editor', async () => {
      const p = await expecting()
      let result: unknown
      await act(async () => {
        result = await p.reveal('p1')
      })
      expect(result).toEqual({ revealed: true })
    })

    it('no editor within the reveal budget throws the retryable not_ready, never revealed:false', async () => {
      vi.useFakeTimers()
      try {
        const p = await expecting()
        const pending = p.reveal('c1').then(
          (r) => ({ ok: true as const, r }),
          (e: unknown) => ({ ok: false as const, e }),
        )
        await vi.advanceTimersByTimeAsync(COMMENTS_REVEAL_WAIT_MS)
        const out = await pending
        expect(out.ok).toBe(false)
        expect(out).toMatchObject({ e: { code: 'not_ready', retryable: true } })
        expect(discussionPanel()).toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })

    it('the cancelled reveal stops waiting', async () => {
      const p = await expecting()
      const ctl = new AbortController()
      const handler = p.handler()
      const pending = Promise.resolve(handler({ comment_id: 'c1' }, { signal: ctl.signal })).then(
        (r) => ({ ok: true as const, r }),
        (e: unknown) => ({ ok: false as const, e }),
      )
      await flush()
      ctl.abort()
      const out = await pending
      expect(out.ok).toBe(false)
      expect(out).toMatchObject({ e: { code: 'cancelled' } })
    })
  })

  describe('the editor owner is told when it is the last one asked (note A)', () => {
    it('the only editor owner gets last:true; with two the first gets false and the second true', async () => {
      const p = framePort()
      const router = frameRevealRouter(p.port)
      const seen: Array<[string, boolean]> = []
      router.addEditor((_id, { last }) => {
        seen.push(['a', last])
        return false
      })
      await p.reveal('x')
      expect(seen).toEqual([['a', true]])
      seen.length = 0
      router.addEditor((_id, { last }) => {
        seen.push(['b', last])
        return false
      })
      await p.reveal('x')
      expect(seen).toEqual([
        ['a', false],
        ['b', true],
      ])
    })

    it('onReveal hands the web handler { path, commentId, last } with last always set', async () => {
      const p = framePort()
      const version = createFrameDocVersion()
      version.noteOpened({ path: 'uniwork://f/Plan.docx', versionId: 'v1' })
      const handler = vi.fn(() => false)
      disposers.push(createFrameCommentsApi(p.port, { version }).onReveal(handler))
      await p.reveal('x')
      expect(handler).toHaveBeenCalledWith({
        path: 'uniwork://f/Plan.docx',
        commentId: 'x',
        last: true,
      })
    })
  })

  describe('one side panel at a time in the frame (note B)', () => {
    const emit = (owner: string, open: boolean) =>
      window.dispatchEvent(new CustomEvent(FRAME_SIDE_PANEL_EVENT, { detail: { owner, open } }))

    it('uses the agreed event name and detail shape', () => {
      expect(FRAME_SIDE_PANEL_EVENT).toBe('uniwork:frame-side-panel')
      const seen: unknown[] = []
      const on = (e: Event) => seen.push((e as CustomEvent).detail)
      window.addEventListener(FRAME_SIDE_PANEL_EVENT, on)
      announceFrameSidePanel('editor', true)
      window.removeEventListener(FRAME_SIDE_PANEL_EVENT, on)
      expect(seen).toEqual([{ owner: 'editor', open: true }])
    })

    it('the Docs renderer literal (it cannot import web/**) names the same event', () => {
      const source = readFileSync(
        join(
          __dirname,
          '../../../../apps/docs/src/renderer/server-comments/ServerCommentsHost.tsx',
        ),
        'utf8',
      )
      const literal = /const FRAME_SIDE_PANEL_EVENT = '([^']+)'/.exec(source)?.[1]
      expect(literal).toBe(FRAME_SIDE_PANEL_EVENT)
    })

    it('onFrameSidePanel closes only for an open event of another owner', () => {
      const close = vi.fn()
      const off = onFrameSidePanel('discussion', close)
      emit('discussion', true)
      emit('editor', false)
      expect(close).not.toHaveBeenCalled()
      emit('editor', true)
      expect(close).toHaveBeenCalledTimes(1)
      off()
      emit('editor', true)
      expect(close).toHaveBeenCalledTimes(1)
    })

    it('the Discussion panel announces its own open and close', async () => {
      const p = framePort()
      await mountDiscussion(p)
      const seen: Array<{ owner: string; open: boolean }> = []
      const on = (e: Event) => seen.push((e as CustomEvent).detail)
      window.addEventListener(FRAME_SIDE_PANEL_EVENT, on)
      try {
        await act(async () => {
          await p.reveal('p1')
        })
        await flush()
        expect(discussionPanel()).not.toBeNull()
        expect(seen).toEqual([{ owner: 'discussion', open: true }])
        await act(async () => {
          emit('editor', true)
        })
        await flush()
        expect(discussionPanel()).toBeNull()
        // it closes itself without announcing another open
        expect(seen.filter((d) => d.owner === 'discussion' && d.open)).toHaveLength(1)
        expect(seen.at(-1)).toEqual({ owner: 'discussion', open: false })
      } finally {
        window.removeEventListener(FRAME_SIDE_PANEL_EVENT, on)
      }
    })

    it('without an editor event the Discussion panel stays as it is', async () => {
      const p = framePort()
      await mountDiscussion(p)
      await act(async () => {
        await p.reveal('p1')
      })
      await flush()
      await act(async () => {
        emit('discussion', true)
      })
      await flush()
      expect(discussionPanel()).not.toBeNull()
    })
  })

  it('the router unregisters from the port when its last owner leaves', () => {
    const p = framePort()
    const router = frameRevealRouter(p.port)
    const offA = router.addEditor(() => true)
    const offB = router.addEditor(() => false)
    expect(p.registered).toHaveBeenCalledTimes(1)
    offA()
    expect(p.hasRevealHandler()).toBe(true)
    offB()
    expect(p.hasRevealHandler()).toBe(false)
  })
})
