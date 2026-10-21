/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  COMMENTS_REVEAL_WAIT_MS,
  buildCollabThreads,
  collabPermissions,
  useCollabThreads,
  type CollabController,
  type CollabControllerOptions,
} from '../src/collab/use-collab-threads'
import type { CollabAnchorAdapter, CollabHostState, CollabSource } from '../src/collab/types'
import { COLLAB_LIVE_REGION_ID, announcePolite } from '../src/collab/live-region'
import {
  EN,
  UNCHANGED,
  cm,
  err,
  fakeSource,
  flush,
  host,
  list,
  type FakeSource,
} from './collab-kit'

let el: HTMLDivElement
let root: ReturnType<typeof createRoot>
let ctl: CollabController
let renders = 0

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  renders = 0
})

afterEach(() => {
  act(() => root.unmount())
  el.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function Harness(p: {
  source: CollabSource
  host: CollabHostState
  opts?: CollabControllerOptions
}) {
  renders++
  ctl = useCollabThreads(p.source, p.host, p.opts)
  return null
}

async function mount(source: FakeSource, h = host(), opts: CollabControllerOptions = {}) {
  await act(async () => {
    root.render(createElement(Harness, { source, host: h, opts: { strings: EN, ...opts } }))
    await flush()
  })
}

const docx = (start: number) => ({ format: 'docx', v: 1, start, quote: `q${start}` })
const adapter = (unlocatable: number[] = []): CollabAnchorAdapter => ({
  order: (a) => a.start as number,
  locate: (a) => !unlocatable.includes(a.start as number),
  goTo: vi.fn(),
})

describe('first load', () => {
  it('goes loading -> ready with the list', async () => {
    let resolve!: (v: unknown) => void
    const src = fakeSource()
    src.list.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    await mount(src)
    expect(ctl.state).toBe('loading')
    expect(src.list).toHaveBeenCalledWith({ kind: 'comment' })
    await act(async () => {
      resolve(list([cm({ id: 'a' })]))
      await flush()
    })
    expect(ctl.state).toBe('ready')
    expect(ctl.threads.map((t) => t.id)).toEqual(['a'])
  })

  it('internal / network -> loadError, retry loads again', async () => {
    const src = fakeSource()
    src.list.mockRejectedValueOnce(err('network'))
    await mount(src)
    expect(ctl.state).toBe('loadError')
    src.list.mockResolvedValueOnce(list([cm({ id: 'a' })]))
    await act(async () => {
      await ctl.retry()
    })
    expect(ctl.state).toBe('ready')
    expect(src.list).toHaveBeenLastCalledWith({ kind: 'comment' })
  })

  it.each(['forbidden', 'not_found'])('%s -> noAccess', async (code) => {
    const src = fakeSource()
    src.list.mockRejectedValueOnce(err(code))
    await mount(src)
    expect(ctl.state).toBe('noAccess')
  })
})

describe('reload', () => {
  it('sends since_token; unchanged changes no state (no render)', async () => {
    const src = fakeSource(list([cm({ id: 'a' })], 'tok-1'))
    await mount(src)
    const before = renders
    const threads = ctl.threads
    src.list.mockResolvedValueOnce(UNCHANGED)
    await act(async () => {
      await ctl.reload()
    })
    expect(src.list).toHaveBeenLastCalledWith({ kind: 'comment', since_token: 'tok-1' })
    expect(renders).toBe(before)
    expect(ctl.threads).toBe(threads)
  })

  it('a changed list replaces the whole list and announces once', async () => {
    const announce = vi.fn()
    const src = fakeSource(list([cm({ id: 'a' }), cm({ id: 'b' })]))
    await mount(src, host(), { announce })
    expect(announce).not.toHaveBeenCalled()
    src.list.mockResolvedValueOnce(list([cm({ id: 'c' })], 't2'))
    await act(async () => {
      await ctl.reload()
    })
    expect(ctl.threads.map((t) => t.id)).toEqual(['c'])
    expect(announce).toHaveBeenCalledTimes(1)
    expect(announce).toHaveBeenCalledWith(EN.collabUpdatedAnnounce)
    // a new token with the same visible content is not announced
    src.list.mockResolvedValueOnce(
      list([cm({ id: 'c', created_at: ctl.threads[0]!.root.created_at })], 't3'),
    )
    await act(async () => {
      await ctl.reload()
    })
    expect(announce).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['network', 'offline'],
    ['internal', 'serverError'],
    ['unauthorized', 'signedOut'],
  ])(
    '%s after data -> status %s, data kept, cleared by the next good list',
    async (code, status) => {
      const src = fakeSource(list([cm({ id: 'a' })]))
      await mount(src)
      src.list.mockRejectedValueOnce(err(code))
      await act(async () => {
        await ctl.reload()
      })
      expect(ctl.state).toBe('ready')
      expect(ctl.status).toBe(status)
      expect(ctl.threads).toHaveLength(1)
      src.list.mockResolvedValueOnce(UNCHANGED)
      await act(async () => {
        await ctl.reload()
      })
      expect(ctl.status).toBeNull()
    },
  )

  it('forbidden on reload -> noAccess', async () => {
    const src = fakeSource(list([cm({ id: 'a' })]))
    await mount(src)
    src.list.mockRejectedValueOnce(err('forbidden'))
    await act(async () => {
      await ctl.reload()
    })
    expect(ctl.state).toBe('noAccess')
  })
})

describe('freshComments', () => {
  it('lists again and returns the changed list', async () => {
    const src = fakeSource(list([cm({ id: 'a' })], 'tok-1'))
    await mount(src)
    src.list.mockResolvedValueOnce(list([cm({ id: 'a' }), cm({ id: 'b' })], 'tok-2'))
    let out: readonly { id: string }[] = []
    await act(async () => {
      out = await ctl.freshComments()
    })
    expect(src.list).toHaveBeenLastCalledWith({ kind: 'comment', since_token: 'tok-1' })
    expect(out.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('an unchanged list keeps the data', async () => {
    const src = fakeSource(list([cm({ id: 'a' })], 'tok-1'))
    await mount(src)
    src.list.mockResolvedValueOnce(UNCHANGED)
    let out: readonly { id: string }[] = []
    await act(async () => {
      out = await ctl.freshComments()
    })
    expect(out.map((c) => c.id)).toEqual(['a'])
  })

  it('a failed list returns the last data and does not reject', async () => {
    const src = fakeSource(list([cm({ id: 'a' })], 'tok-1'))
    await mount(src)
    src.list.mockRejectedValueOnce(err('network'))
    let out: readonly { id: string }[] = []
    await act(async () => {
      out = await ctl.freshComments()
    })
    expect(out.map((c) => c.id)).toEqual(['a'])
  })

  it('joins the first list while it is still in flight', async () => {
    let resolve!: (v: unknown) => void
    const src = fakeSource()
    src.list.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    src.list.mockResolvedValue(UNCHANGED)
    await mount(src)
    let out: readonly { id: string }[] | undefined
    await act(async () => {
      void ctl.freshComments().then((v) => (out = v))
      await flush()
    })
    expect(out).toBeUndefined()
    await act(async () => {
      resolve(list([cm({ id: 'a' })], 'tok-1'))
      await flush()
    })
    expect(out?.map((c) => c.id)).toEqual(['a'])
  })
})

describe('writes', () => {
  it('403 on a write -> view only from then on', async () => {
    const src = fakeSource(list([cm({ id: 'a', author_id: 'me' })]))
    await mount(src)
    expect(ctl.viewOnly).toBe(false)
    src.create.mockRejectedValueOnce(err('forbidden'))
    await act(async () => {
      await expect(ctl.actions.reply('a', 'hi')).rejects.toMatchObject({ code: 'forbidden' })
    })
    expect(ctl.viewOnly).toBe(true)
    expect(ctl.can.canWrite).toBe(false)
    expect(ctl.can.canEdit(ctl.threads[0]!.root)).toBe(false)
  })

  it('a successful write reloads the list', async () => {
    const src = fakeSource(list([cm({ id: 'a' })]))
    await mount(src)
    src.list.mockClear()
    await act(async () => {
      await ctl.actions.reply('a', 'hello')
      await flush()
    })
    expect(src.create).toHaveBeenCalledWith({ kind: 'comment', parent_id: 'a', body: 'hello' })
    expect(src.list).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['network', 'offline'],
    ['internal', 'serverError'],
    ['unauthorized', 'signedOut'],
  ])(
    '%s on a write -> status %s, then a reload clears it once the connection is back',
    async (code, status) => {
      const src = fakeSource(list([cm({ id: 'a' })], 't1'))
      await mount(src)
      src.list.mockClear()
      src.create.mockRejectedValueOnce(err(code))
      let back!: (v: unknown) => void
      src.list.mockReturnValueOnce(new Promise((r) => (back = r)))
      await act(async () => {
        await expect(ctl.actions.reply('a', 'draft')).rejects.toMatchObject({ code })
        await flush()
      })
      // the failure itself triggers a reload; until it answers the status line stays
      expect(src.list).toHaveBeenCalledTimes(1)
      expect(ctl.status).toBe(status)
      await act(async () => {
        back(UNCHANGED)
        await flush()
      })
      expect(ctl.status).toBeNull()
    },
  )

  it('network on a write while still offline: the status stays after the reload', async () => {
    const src = fakeSource(list([cm({ id: 'a' })], 't1'))
    await mount(src)
    src.list.mockClear()
    src.create.mockRejectedValueOnce(err('network'))
    src.list.mockRejectedValueOnce(err('network'))
    await act(async () => {
      await expect(ctl.actions.reply('a', 'draft')).rejects.toMatchObject({ code: 'network' })
      await flush()
    })
    expect(src.list).toHaveBeenCalledTimes(1)
    expect(ctl.status).toBe('offline')
  })

  it('conflict + comment_deleted: thread marked deleted, body kept for copy, list reloaded', async () => {
    const src = fakeSource(list([cm({ id: 'a' })], 't1'))
    await mount(src)
    src.create.mockRejectedValueOnce(err('conflict', 'comment_deleted'))
    // the server removed the thread entirely
    src.list.mockResolvedValueOnce(list([], 't2'))
    await act(async () => {
      await expect(ctl.actions.reply('a', 'my draft')).rejects.toMatchObject({
        code: 'conflict',
        detailsCode: 'comment_deleted',
      })
      await flush()
    })
    expect(src.list).toHaveBeenLastCalledWith({ kind: 'comment', since_token: 't1' })
    expect(ctl.conflict).toEqual({ threadId: 'a', body: 'my draft' })
    // the ghost stays (deleted) so the composer under it keeps its draft
    expect(ctl.threads.map((t) => [t.id, t.deleted])).toEqual([['a', true]])
  })
})

describe('stale in-flight list (F1)', () => {
  it('a document change while the old list is pending: the next reload joins the new list, no parallel list', async () => {
    const announce = vi.fn()
    const pending: Array<(v: unknown) => void> = []
    const src = fakeSource()
    src.list.mockImplementation(() => new Promise((r) => pending.push(r)))
    await mount(src, host(), { announce })
    expect(src.list).toHaveBeenCalledTimes(1)
    // the document changes: the effect starts a new first load while the old list is still pending
    await act(async () => {
      root.render(
        createElement(Harness, {
          source: src,
          host: host({ documentId: 'doc2' }),
          opts: { strings: EN, announce },
        }),
      )
      await flush()
    })
    expect(src.list).toHaveBeenCalledTimes(2)
    // the old list settles (its result is dropped) ...
    await act(async () => {
      pending[0]!(list([cm({ id: 'old' })], 'tOld'))
      await flush()
    })
    // ... and a poll / focus reload arrives while the new list is still pending
    await act(async () => {
      void ctl.reload()
      await flush()
    })
    expect(src.list).toHaveBeenCalledTimes(2)
    await act(async () => {
      pending[1]!(list([cm({ id: 'new' })], 'tNew'))
      await flush()
    })
    // the joined reload re-asks with the new token only
    expect(src.list).toHaveBeenCalledTimes(3)
    expect(src.list).toHaveBeenLastCalledWith({ kind: 'comment', since_token: 'tNew' })
    await act(async () => {
      pending[2]!(UNCHANGED)
      await flush()
    })
    expect(ctl.threads.map((t) => t.id)).toEqual(['new'])
    expect(announce).not.toHaveBeenCalled()
  })
})

describe('level rules (S12)', () => {
  const mine = cm({ id: 'm', author_id: 'me' })
  const other = cm({ id: 'o', author_id: 'u2' })
  const system = cm({ id: 's', author_id: null })

  it('view: nothing', () => {
    const can = collabPermissions({ level: 'view', myUserId: 'me' })
    expect([can.canWrite, can.canEdit(mine), can.canRemove(mine), can.canResolve(mine)]).toEqual([
      false,
      false,
      false,
      false,
    ])
  })

  it('undefined: own comments only, never others or a null author', () => {
    const can = collabPermissions({ level: undefined, myUserId: 'me' })
    expect(can.canWrite).toBe(true)
    expect([can.canEdit(mine), can.canRemove(mine), can.canResolve(mine)]).toEqual([
      true,
      true,
      true,
    ])
    expect([can.canEdit(other), can.canRemove(other), can.canResolve(other)]).toEqual([
      false,
      false,
      false,
    ])
    expect(can.canEdit(system)).toBe(false)
    expect(collabPermissions({ level: undefined }).canEdit(system)).toBe(false)
  })

  it('edit: own edit/delete, resolve any; manage: edit/delete others too', () => {
    const edit = collabPermissions({ level: 'edit', myUserId: 'me' })
    expect([edit.canEdit(other), edit.canRemove(other), edit.canResolve(other)]).toEqual([
      false,
      false,
      true,
    ])
    const manage = collabPermissions({ level: 'manage', myUserId: 'me' })
    expect([manage.canEdit(other), manage.canRemove(other)]).toEqual([true, true])
  })

  it('a tombstone is never editable', () => {
    const can = collabPermissions({ level: 'manage', myUserId: 'me' })
    expect(can.canEdit({ ...mine, deleted_at: 'x' })).toBe(false)
  })
})

describe('grouping and ordering', () => {
  it('comment kind: adapter order, lost after located by time, resolved apart', () => {
    const a = adapter()
    const out = buildCollabThreads(
      [
        cm({ id: 'late', anchor: docx(30), created_at: '2026-10-12T09:00:00Z' }),
        cm({ id: 'early', anchor: docx(10), created_at: '2026-10-12T11:00:00Z' }),
        cm({
          id: 'lost2',
          anchor: docx(1),
          anchor_state: 'lost',
          created_at: '2026-10-12T08:00:00Z',
        }),
        cm({
          id: 'lost1',
          anchor: docx(2),
          anchor_state: 'lost',
          created_at: '2026-10-12T07:00:00Z',
        }),
        cm({ id: 'res', anchor: docx(5), resolved_at: '2026-10-12T12:00:00Z' }),
        cm({ id: 'r2', parent_id: 'early', created_at: '2026-10-12T13:00:00Z' }),
        cm({ id: 'r1', parent_id: 'early', created_at: '2026-10-12T12:30:00Z' }),
      ],
      'comment',
      a,
    )
    expect(out.open.map((t) => t.id)).toEqual(['early', 'late', 'lost1', 'lost2'])
    expect(out.resolved.map((t) => t.id)).toEqual(['res'])
    expect(out.open[0]!.replies.map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it('stale only when the editor cannot locate the anchor', () => {
    const out = buildCollabThreads(
      [
        cm({ id: 'x', anchor: docx(1), anchor_state: 'stale' }),
        cm({ id: 'y', anchor: docx(2), anchor_state: 'exact' }),
      ],
      'comment',
      adapter([2]),
    )
    expect(out.open.map((t) => [t.id, t.anchorState])).toEqual([
      ['x', 'exact'],
      ['y', 'stale'],
    ])
  })

  it('discussion: by time, oldest first, no anchor state', () => {
    const out = buildCollabThreads(
      [
        cm({ id: 'b', kind: 'discussion', created_at: '2026-10-12T10:00:00Z' }),
        cm({ id: 'a', kind: 'discussion', created_at: '2026-10-12T09:00:00Z' }),
      ],
      'discussion',
      undefined,
    )
    expect(out.open.map((t) => [t.id, t.anchorState])).toEqual([
      ['a', undefined],
      ['b', undefined],
    ])
  })

  it('a tombstone root is a deleted thread that keeps its replies', () => {
    const out = buildCollabThreads(
      [
        cm({ id: 't', body: '', deleted_at: '2026-10-12T10:00:00Z' }),
        cm({ id: 'r', parent_id: 't' }),
      ],
      'comment',
      undefined,
    )
    expect(out.open[0]).toMatchObject({ id: 't', deleted: true })
    expect(out.open[0]!.replies.map((r) => r.id)).toEqual(['r'])
  })
})

describe('reveal', () => {
  it('is held until the first list, then expands, focuses and goes to the anchor', async () => {
    vi.useFakeTimers()
    let resolve!: (v: unknown) => void
    const src = fakeSource()
    src.list.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const ad = adapter()
    await mount(src, host(), { adapter: ad })
    let answer: unknown
    void ctl.reveal('r1').then((v) => (answer = v))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMMENTS_REVEAL_WAIT_MS - 1)
    })
    expect(answer).toBeUndefined()
    await act(async () => {
      resolve(
        list([
          cm({ id: 'a', anchor: docx(4), resolved_at: '2026-10-12T10:00:00Z' }),
          cm({ id: 'r1', parent_id: 'a' }),
        ]),
      )
      await flush()
    })
    expect(answer).toEqual({ revealed: true })
    expect(ctl.resolvedOpen).toBe(true)
    expect(ctl.isExpanded(ctl.resolved[0]!)).toBe(true)
    expect(ctl.focus).toMatchObject({ threadId: 'a', commentId: 'r1', target: 'heading' })
    expect(ad.goTo).toHaveBeenCalledWith(docx(4))
  })

  it('rejects not_ready after 10 s without a first list', async () => {
    vi.useFakeTimers()
    const src = fakeSource()
    src.list.mockReturnValueOnce(new Promise(() => {}))
    await mount(src)
    const p = ctl.reveal('a')
    const seen = p.catch((e) => e)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMMENTS_REVEAL_WAIT_MS)
    })
    expect(await seen).toEqual({ code: 'not_ready', retryable: true })
  })

  it('lost: opens the thread only, no goTo', async () => {
    const src = fakeSource(list([cm({ id: 'a', anchor: docx(1), anchor_state: 'lost' })]))
    const ad = adapter()
    await mount(src, host(), { adapter: ad })
    let answer: unknown
    await act(async () => {
      answer = await ctl.reveal('a')
    })
    expect(answer).toEqual({ revealed: true })
    expect(ad.goTo).not.toHaveBeenCalled()
    expect(ctl.focus).toMatchObject({ threadId: 'a', target: 'heading' })
  })

  it('lost + the open version is the anchor version: located by the adapter, reveal calls goTo', async () => {
    const lost = cm({
      id: 'a',
      anchor: docx(1),
      anchor_state: 'lost',
      anchor_version_id: 'v-old',
      anchor_version_no: 2,
    })
    const src = fakeSource(list([lost, cm({ id: 'b', anchor: docx(2), anchor_state: 'lost' })]))
    const ad = adapter([2])
    await mount(src, host(), { adapter: ad, openVersionId: 'v-old' })
    expect(ctl.threads.find((t) => t.id === 'a')?.anchorState).toBe('exact')
    await act(async () => {
      await ctl.reveal('a')
    })
    expect(ad.goTo).toHaveBeenCalledWith(docx(1))
    expect(src.list).toHaveBeenCalledTimes(1)
    expect(src.create).not.toHaveBeenCalled()
    expect(src.update).not.toHaveBeenCalled()
  })

  it('lost + the open version is the anchor version, adapter cannot locate it: stale, no goTo', async () => {
    const src = fakeSource(
      list([cm({ id: 'a', anchor: docx(1), anchor_state: 'lost', anchor_version_id: 'v-old' })]),
    )
    const ad = adapter([1])
    await mount(src, host(), { adapter: ad, openVersionId: 'v-old' })
    expect(ctl.threads[0]?.anchorState).toBe('stale')
    await act(async () => {
      await ctl.reveal('a')
    })
    expect(ad.goTo).not.toHaveBeenCalled()
  })

  it.each([
    ['another version is open', 'v-head', 'v-old'],
    ['no version is open', undefined, 'v-old'],
    ['the comment has no anchor version', 'v-head', undefined],
  ])('lost stays lost, no goTo: %s', async (_name, openVersionId, anchorVersionId) => {
    const src = fakeSource(
      list([
        cm({
          id: 'a',
          anchor: docx(1),
          anchor_state: 'lost',
          ...(anchorVersionId ? { anchor_version_id: anchorVersionId } : {}),
        }),
      ]),
    )
    const ad = adapter()
    await mount(src, host(), { adapter: ad, ...(openVersionId ? { openVersionId } : {}) })
    expect(ctl.threads[0]?.anchorState).toBe('lost')
    await act(async () => {
      await ctl.reveal('a')
    })
    expect(ad.goTo).not.toHaveBeenCalled()
    expect(ctl.focus).toMatchObject({ threadId: 'a', target: 'heading' })
  })

  it('the open version id moving to the anchor version re-locates the thread without a new list', async () => {
    const src = fakeSource(
      list([cm({ id: 'a', anchor: docx(1), anchor_state: 'lost', anchor_version_id: 'v-old' })]),
    )
    const ad = adapter()
    await mount(src, host(), { adapter: ad, openVersionId: 'v-head' })
    expect(ctl.threads[0]?.anchorState).toBe('lost')
    await mount(src, host(), { adapter: ad, openVersionId: 'v-old' })
    expect(ctl.threads[0]?.anchorState).toBe('exact')
  })

  it('exposes the host version inputs on the controller', async () => {
    const onViewVersion = vi.fn()
    await mount(fakeSource(), host(), { openVersionId: 'v1', onViewVersion })
    expect(ctl.openVersionId).toBe('v1')
    expect(ctl.onViewVersion).toBe(onViewVersion)
  })

  it('missing -> revealed false + the notice line takes focus; tombstone -> deleted frame', async () => {
    const src = fakeSource(
      list([cm({ id: 't', body: '', deleted_at: 'x' }), cm({ id: 'r', parent_id: 't' })]),
    )
    await mount(src, host({ kind: 'discussion' }))
    let answer: unknown
    await act(async () => {
      answer = await ctl.reveal('gone')
    })
    expect(answer).toEqual({ revealed: false })
    expect(ctl.notice).toBe('discussionDeleted')
    expect(ctl.focus).toMatchObject({ threadId: null, target: 'notice' })
    await act(async () => {
      answer = await ctl.reveal('t')
    })
    expect(answer).toEqual({ revealed: true })
    expect(ctl.focus).toMatchObject({ threadId: 't', commentId: 't', target: 'deleted' })
  })
})

describe('history', () => {
  it('newest first', async () => {
    const src = fakeSource(list([cm({ id: 'a', revision: 3 })]))
    src.revisions.mockResolvedValueOnce({
      revisions: [
        { id: 'v1', revision: 1, body: 'one', created_by_id: 'u1', created_at: '1' },
        { id: 'v2', revision: 2, body: 'two', created_by_id: 'u1', created_at: '2' },
      ],
    })
    await mount(src)
    let out: unknown
    await act(async () => {
      out = await ctl.actions.history('a')
    })
    expect((out as { id: string }[]).map((r) => r.id)).toEqual(['v2', 'v1'])
  })
})

describe('live region', () => {
  it('one fixed polite node per window; a new sentence replaces the pending one', () => {
    vi.useFakeTimers()
    announcePolite('one')
    announcePolite('two')
    const nodes = document.querySelectorAll(`#${COLLAB_LIVE_REGION_ID}`)
    expect(nodes).toHaveLength(1)
    const node = nodes[0]!
    expect(node.getAttribute('aria-live')).toBe('polite')
    vi.advanceTimersByTime(100)
    expect(node.textContent).toBe('two')
  })
})
