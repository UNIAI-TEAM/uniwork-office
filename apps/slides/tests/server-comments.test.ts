/**
 * G8-14 (UNI-1409): server comments per slide on a bound presentation (spine S12, addendum §4.3).
 *
 * Pure anchor rules (reorder -> the anchor follows slide_id, a deleted slide -> lost) and the
 * mounted host over a fake `window.uniworkComments` bridge: reveal -> the right slide (+ object),
 * no comments.create before Send, the post-save anchor round after the receipt, the file's own
 * comments read-only and never written, 21-locale parity of the new copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement, createRef, type MutableRefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LANGS, format } from '@genoffice/i18n'
import { collabStrings } from '@genoffice/ui/collab'
import type { CommentsRevealPayload } from '@genoffice/electron-utils/comments-ipc'
import type {
  CommentsContextResult,
  CommentsSavedPayload,
  UniworkCommentsSeamApi,
} from '../src/renderer/comments-seam'
import {
  anchorUpdatesAfterSave,
  createSlidesAnchorAdapter,
  loadCommentsContext,
  pptxAnchorFor,
  selectedObjectId,
  wantsServerComments,
  sendAnchorsAfterSave,
  type SlideIdentity,
} from '../src/renderer/server-comments'
import {
  CommentsPane,
  ServerCommentsHost,
  type ServerCommentsHandle,
} from '../src/renderer/components/CommentsPane'
import { paneStrings } from '../src/renderer/i18n/strings-panes'
import type { SlideComment } from '../src/shared/ipc'

/* ---------- a deck ---------- */

/** slideN carries p:sldId 255 + N, as the render tree does ("slide2" -> "257") */
const sldIdOf = (id: string) => String(255 + Number(id.replace(/\D/g, '')))
const deck = (...ids: string[]): SlideIdentity[] =>
  ids.map((id) => ({
    sldId: sldIdOf(id),
    partPath: `ppt/slides/${id}.xml`,
    nodes: [{ sourceId: `src-${id}`, durableId: `e_${id}` }],
  }))

const anchorOn = (slides: SlideIdentity[], i: number, objectId?: string) => {
  const a = pptxAnchorFor(slides, i, objectId)
  if (!a) throw new Error('no anchor')
  return a
}

/* ---------- a fake server behind the preload bridge ---------- */

interface Row {
  id: string
  document_id: string
  kind: 'comment'
  author_id: string
  parent_id: string | null
  body: string
  revision: number
  anchor: Record<string, unknown> | null
  anchor_state: string | null
  resolved_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  display_name: string
}

interface FakeOpts {
  /** what `context({path})` answers; default: a bound document, version unknown */
  context?: () => Promise<unknown>
  /** reject the next `anchors` calls with this protocol error code (400 anchor_version_invalid) */
  anchorsFail?: { code: string; status?: number; detailsCode?: string }
}

function fakeBridge(seed: Row[] = [], opts: FakeOpts = {}) {
  const rows = [...seed]
  const savedHandlers = new Set<(p: CommentsSavedPayload) => void>()
  const calls: Array<{ op: string; input: unknown }> = []
  let seq = 0
  let token = 0
  const revealHandlers = new Set<(p: CommentsRevealPayload) => void>()
  // the rows are structurally the protocol's DocumentComment; the reply type is the bridge's own
  const ok = (value: unknown) => Promise.resolve({ ok: true, value }) as Promise<never>
  const at = () => `2026-10-13T10:00:${String(seq).padStart(2, '0')}Z`
  const find = (id: string) => rows.find((r) => r.id === id)!
  const bridge: UniworkCommentsSeamApi = {
    list: (input) => {
      calls.push({ op: 'list', input })
      return ok({
        comments: rows.map((r) => ({ ...r })),
        mentions: [],
        list_token: `t${++token}`,
        unchanged: false,
      })
    },
    create: (input) => {
      calls.push({ op: 'create', input })
      seq++
      const row: Row = {
        id: `c${seq}`,
        document_id: 'doc-1',
        kind: 'comment',
        author_id: 'me',
        parent_id: input.parentId ?? null,
        body: input.body,
        revision: 1,
        anchor: input.anchor ?? null,
        anchor_state: input.anchor ? 'exact' : null,
        resolved_at: null,
        deleted_at: null,
        created_at: at(),
        updated_at: at(),
        display_name: 'Minh Anh',
      }
      rows.push(row)
      return ok({ comment: { ...row } })
    },
    update: (input) => {
      calls.push({ op: 'update', input })
      const r = find(input.commentId)
      r.body = input.body
      r.revision++
      return ok({ comment: { ...r } })
    },
    remove: (input) => {
      calls.push({ op: 'remove', input })
      rows.splice(rows.indexOf(find(input.commentId)), 1)
      return ok({ outcome: 'removed' as const })
    },
    resolve: (input) => {
      calls.push({ op: 'resolve', input })
      find(input.commentId).resolved_at = at()
      return ok({ comment: { ...find(input.commentId) } })
    },
    reopen: (input) => {
      calls.push({ op: 'reopen', input })
      find(input.commentId).resolved_at = null
      return ok({ comment: { ...find(input.commentId) } })
    },
    revisions: (input) => {
      calls.push({ op: 'revisions', input })
      return ok({ revisions: [] })
    },
    anchors: (input) => {
      calls.push({ op: 'anchors', input })
      const fail = opts.anchorsFail
      if (fail) {
        return Promise.resolve({
          ok: false,
          error: {
            code: fail.code,
            message: 'rejected',
            status: fail.status ?? 400,
            retryable: false,
            ...(fail.detailsCode ? { details: { code: fail.detailsCode } } : {}),
          },
        }) as Promise<never>
      }
      const updated: string[] = []
      for (const a of input.anchors) {
        const r = find(a.commentId)
        r.anchor = a.anchor
        r.anchor_state = a.state
        updated.push(a.commentId)
      }
      return ok({ updated, skipped: [], list_token: `t${++token}` })
    },
    searchMentions: (input) => {
      calls.push({ op: 'searchMentions', input })
      return ok({ candidates: [] })
    },
    onReveal: (handler) => {
      revealHandlers.add(handler)
      return () => revealHandlers.delete(handler)
    },
    context: (input) => {
      calls.push({ op: 'context', input })
      return (
        opts.context ? opts.context() : ok({ documentId: 'doc-1', versionId: null })
      ) as Promise<never>
    },
    onSaved: (handler) => {
      savedHandlers.add(handler)
      return () => savedHandlers.delete(handler)
    },
  }
  return {
    bridge,
    emitSaved: (p: CommentsSavedPayload) => savedHandlers.forEach((h) => h(p)),
    savedListeners: () => savedHandlers.size,
    rows,
    calls,
    ops: () => calls.map((c) => c.op),
    reveal: (p: CommentsRevealPayload) => revealHandlers.forEach((h) => h(p)),
  }
}

function rootRow(id: string, anchor: Record<string, unknown>, body = `body ${id}`): Row {
  return {
    id,
    document_id: 'doc-1',
    kind: 'comment',
    author_id: 'someone',
    parent_id: null,
    body,
    revision: 1,
    anchor,
    anchor_state: 'exact',
    resolved_at: null,
    deleted_at: null,
    created_at: `2026-10-12T09:00:0${id.length}Z`,
    updated_at: `2026-10-12T09:00:0${id.length}Z`,
    display_name: 'Lê Thu Hà',
  }
}

/* ---------- pure rules ---------- */

describe('pptx anchors follow the slide, not its position', () => {
  it('reorder then Save: each anchor is re-sent with its slide’s new index (slide_id kept)', () => {
    const before = deck('slide1', 'slide2', 'slide3')
    const onB = anchorOn(before, 1)
    const onC = anchorOn(before, 2, 'e_slide3')
    const comments = [
      { id: 'b', document_id: 'd', body: 'x', anchor: onB },
      { id: 'c', document_id: 'd', body: 'y', anchor: onC },
    ]
    // the user drags slide 3 to the front: C, A, B
    const after = [before[2]!, before[0]!, before[1]!]
    expect(anchorUpdatesAfterSave(comments, after)).toEqual([
      { commentId: 'b', state: 'exact', anchor: { ...onB, slide_index: 2 } },
      { commentId: 'c', state: 'exact', anchor: { ...onC, slide_index: 0 } },
    ])
    expect(onB.slide_id).toBe('257')
  })

  it('delete a slide then Save: its thread is lost, the old anchor kept, the others move up', () => {
    const before = deck('slide1', 'slide2', 'slide3')
    const comments = [
      { id: 'a', document_id: 'd', body: 'x', anchor: anchorOn(before, 1) },
      { id: 'b', document_id: 'd', body: 'y', anchor: anchorOn(before, 2) },
      // a reply and a tombstone carry no anchor round of their own
      { id: 'r', document_id: 'd', body: 'z', parent_id: 'a', anchor: anchorOn(before, 1) },
      { id: 't', document_id: 'd', body: '', deleted_at: 'x', anchor: anchorOn(before, 1) },
    ]
    const after = [before[0]!, before[2]!]
    expect(anchorUpdatesAfterSave(comments, after)).toEqual([
      { commentId: 'a', state: 'lost', anchor: anchorOn(before, 1) },
      { commentId: 'b', state: 'exact', anchor: { ...anchorOn(before, 2), slide_index: 1 } },
    ])
    // the lost thread keeps naming the deleted slide by its p:sldId
    expect(anchorOn(before, 1).slide_id).toBe('257')
  })

  it('a deleted object leaves the thread on its slide without object_id', () => {
    const before = deck('slide1')
    const a = anchorOn(before, 0, 'e_slide1')
    const after: SlideIdentity[] = [{ sldId: '256', partPath: 'ppt/slides/slide1.xml', nodes: [] }]
    const [u] = anchorUpdatesAfterSave([{ id: 'a', document_id: 'd', body: 'x', anchor: a }], after)
    expect(u).toEqual({
      commentId: 'a',
      state: 'exact',
      anchor: { format: 'pptx', v: 1, slide_id: '256', slide_index: 0 },
    })
  })

  it('prefers p:sldId when the render tree carries it', () => {
    const slides: SlideIdentity[] = [{ sldId: '257', partPath: 'ppt/slides/slide9.xml' }]
    expect(pptxAnchorFor(slides, 0)).toEqual({
      format: 'pptx',
      v: 1,
      slide_id: '257',
      slide_index: 0,
    })
    // a render tree without the id falls back to the part path
    expect(pptxAnchorFor([{ partPath: 'ppt/slides/slide9.xml' }], 0)?.slide_id).toBe(
      'ppt/slides/slide9.xml',
    )
  })

  it('the adapter sorts by the current position, locates by slide_id and goes to slide + object', () => {
    let slides = deck('slide1', 'slide2', 'slide3')
    const goTo = vi.fn()
    const adapter = createSlidesAnchorAdapter({ slides: () => slides, goTo })
    const onC = anchorOn(slides, 2, 'e_slide3')
    expect(adapter.order(onC)).toBe(2)
    slides = [slides[2]!, slides[0]!, slides[1]!]
    expect(adapter.order(onC)).toBe(0)
    adapter.goTo(onC)
    expect(goTo).toHaveBeenLastCalledWith(0, 'src-slide3')
    slides = slides.slice(1)
    expect(adapter.locate(onC)).toBe(false)
  })

  it('the selected object anchors only when exactly one is selected', () => {
    const [s] = deck('slide1')
    expect(selectedObjectId(s, ['src-slide1'])).toBe('e_slide1')
    expect(selectedObjectId(s, [])).toBeUndefined()
    expect(selectedObjectId(s, ['src-slide1', 'other'])).toBeUndefined()
  })
})

describe('server mode only for a bound document with the bridge', () => {
  const { bridge } = fakeBridge()
  it('a local (unbound) file keeps the local pane', () => {
    expect(wantsServerComments('/tmp/a.pptx', false, bridge)).toBe(false)
    expect(wantsServerComments('/tmp/a.pptx', true, null)).toBe(false)
    expect(wantsServerComments(null, true, bridge)).toBe(false)
    expect(wantsServerComments('/tmp/a.pptx', true, bridge)).toBe(true)
  })

  it('the context is read from window.uniworkComments.context({path}), field names as the seam', async () => {
    const ok = (value: CommentsContextResult) => async () => ({ ok: true as const, value })
    const ctxOf = (reply: () => Promise<unknown>) => ({ context: reply }) as never
    const calls: unknown[] = []
    const bridge = {
      context: async (input: unknown) => {
        calls.push(input)
        return ok({ documentId: 'doc-1', versionId: 'v1', myUserId: 'me', level: 'manage' })()
      },
    } as never
    expect(await loadCommentsContext(bridge, '/p.pptx', false)).toEqual({
      documentId: 'doc-1',
      versionId: 'v1',
      myUserId: 'me',
      level: 'manage',
    })
    expect(calls).toEqual([{ path: '/p.pptx' }])
    // versionId may be null (unknown); level / myUserId may be absent (own-comments-only rule)
    expect(
      await loadCommentsContext(
        ctxOf(ok({ documentId: 'doc-1', versionId: null })),
        '/p.pptx',
        false,
      ),
    ).toEqual({ documentId: 'doc-1', versionId: null })
    // a read-only copy never writes, whatever the context says
    expect((await loadCommentsContext(bridge, '/p.pptx', true))?.level).toBe('view')
  })

  it('an error envelope, a thrown call or a malformed answer is no server context', async () => {
    const ctxOf = (reply: () => Promise<unknown>) => ({ context: reply }) as never
    const notFound = async () => ({
      ok: false as const,
      error: { code: 'not_found', message: 'unbound' },
    })
    expect(await loadCommentsContext(ctxOf(notFound), '/p.pptx', false)).toBeNull()
    expect(
      await loadCommentsContext(
        ctxOf(async () => {
          throw new Error('ipc gone')
        }),
        '/p.pptx',
        false,
      ),
    ).toBeNull()
    for (const value of [
      null,
      { versionId: 'v1' },
      { documentId: '', versionId: null },
      { documentId: 'doc-1', versionId: 7 },
    ]) {
      expect(
        await loadCommentsContext(
          ctxOf(async () => ({ ok: true, value })),
          '/p.pptx',
          false,
        ),
      ).toBeNull()
    }
  })
})

describe('the anchor round behaves like the kit’s sendAnchorMap', () => {
  const rowsOf = async (b: UniworkCommentsSeamApi) => {
    const reply = await b.list({ path: '/p.pptx' })
    return reply.ok ? reply.value.comments : []
  }

  it('501 anchors go in chunks of 500, one after the other, answers merged', async () => {
    const slides = deck('slide1')
    const { bridge, calls } = fakeBridge(
      Array.from({ length: 501 }, (_, k) => rootRow(`m${k}`, anchorOn(slides, 0))),
    )
    const rows = await rowsOf(bridge)
    const res = await sendAnchorsAfterSave(bridge, '/p.pptx', 'v2', rows, slides)
    const rounds = calls.filter((c) => c.op === 'anchors')
    expect(rounds.map((c) => (c.input as { anchors: unknown[] }).anchors.length)).toEqual([500, 1])
    expect(res.outcome).toBe('synced')
    if (res.outcome === 'synced') {
      expect(res.updated).toHaveLength(501)
      expect(res.list_token).toBe('t3')
    }
  })

  it('anchor_version_invalid resolves to retry_next_save and stops the round; other errors reject', async () => {
    const slides = deck('slide1')
    const seed = [rootRow('x1', anchorOn(slides, 0))]
    const stale = fakeBridge(seed, {
      anchorsFail: { code: 'malformed', detailsCode: 'anchor_version_invalid' },
    })
    expect(
      await sendAnchorsAfterSave(stale.bridge, '/p.pptx', 'v2', await rowsOf(stale.bridge), slides),
    ).toEqual({ outcome: 'retry_next_save' })
    const broken = fakeBridge(seed, { anchorsFail: { code: 'internal', status: 500 } })
    await expect(
      sendAnchorsAfterSave(broken.bridge, '/p.pptx', 'v2', await rowsOf(broken.bridge), slides),
    ).rejects.toMatchObject({ code: 'internal' })
  })

  it('an empty round sends nothing', async () => {
    const { bridge, calls } = fakeBridge()
    expect(await sendAnchorsAfterSave(bridge, '/p.pptx', 'v2', [], deck('slide1'))).toMatchObject({
      outcome: 'synced',
      updated: [],
    })
    expect(calls).toEqual([])
  })
})

/* ---------- the mounted host ---------- */

const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

let host: HTMLDivElement
let slot: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  sessionStorage.clear()
  host = document.createElement('div')
  slot = document.createElement('div')
  document.body.append(host, slot)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  slot.remove()
  vi.unstubAllGlobals()
})

interface MountOpts {
  slides: SlideIdentity[]
  rows?: Row[]
  versionId?: string
  open?: boolean
  fileComments?: SlideComment[][]
  fake?: FakeOpts
}

async function mountHost(o: MountOpts) {
  const server = fakeBridge(o.rows, o.fake)
  const path = '/work/deck.pptx'
  const statuses: string[] = []
  const goTo = vi.fn()
  const onOpen = vi.fn()
  const handleRef =
    createRef<ServerCommentsHandle>() as MutableRefObject<ServerCommentsHandle | null>
  const readFileComments = vi.fn(async (i: number) => o.fileComments?.[i] ?? [])
  const props = {
    bridge: server.bridge,
    path,
    // what App builds from context({path}): this is the seam's shape, versionId null = unknown
    context: {
      documentId: 'doc-1',
      level: 'edit' as const,
      myUserId: 'me',
      versionId: o.versionId ?? null,
    },
    slides: o.slides,
    slot: o.open === false ? null : slot,
    goTo,
    onOpen,
    onCollapse: () => {},
    readFileComments,
    fileCommentsNonce: 0,
    handleRef,
    onOpenCount: () => {},
    onStatus: (text: string) => statuses.push(text),
  }
  const render = async (patch: Partial<typeof props> = {}) => {
    Object.assign(props, patch)
    await act(async () => {
      root.render(createElement(ServerCommentsHost, { ...props }))
      await flush()
    })
  }
  await render()
  const save = async (versionId: string, savedPath = path) =>
    act(async () => {
      server.emitSaved({ path: savedPath, versionId })
      await flush()
      await flush()
    })
  return { server, goTo, onOpen, handleRef, render, save, readFileComments, statuses }
}

describe('ServerCommentsHost over the comments bridge', () => {
  it('reveal: opens the pane, goes to the anchored slide and selects the object', async () => {
    const slides = deck('slide1', 'slide2', 'slide3')
    const h = await mountHost({
      slides,
      rows: [rootRow('x1', anchorOn(slides, 2, 'e_slide3'))],
      open: false,
    })
    await act(async () => {
      h.server.reveal({ path: '/work/deck.pptx', commentId: 'x1' })
      await flush()
    })
    expect(h.onOpen).toHaveBeenCalled()
    expect(h.goTo).toHaveBeenCalledWith(2, 'src-slide3')
    // a reveal for another window's document does nothing here
    h.goTo.mockClear()
    await act(async () => {
      h.server.reveal({ path: '/work/other.pptx', commentId: 'x1' })
      await flush()
    })
    expect(h.goTo).not.toHaveBeenCalled()
  })

  it('reveal after a reorder goes to where the slide is now', async () => {
    const slides = deck('slide1', 'slide2', 'slide3')
    const h = await mountHost({ slides, rows: [rootRow('x1', anchorOn(slides, 2))] })
    await h.render({ slides: [slides[2]!, slides[0]!, slides[1]!] })
    await act(async () => {
      h.server.reveal({ path: '/work/deck.pptx', commentId: 'x1' })
      await flush()
    })
    expect(h.goTo).toHaveBeenCalledWith(0, undefined)
    // the label names the slide where it is now
    expect(slot.textContent).toContain(
      format(collabStrings('zh').collabAnchorSlide, { slide: '1' }),
    )
  })

  it('New comment: no comments.create before Send; Send creates one anchored root comment', async () => {
    const slides = deck('slide1', 'slide2')
    const h = await mountHost({ slides, versionId: 'v7' })
    await act(async () => {
      expect(h.handleRef.current!.startThread(1, 'e_slide2')).toBe(true)
      await flush()
    })
    const box = slot.querySelector('textarea')!
    await act(async () => {
      nativeValue.call(box, 'Số liệu slide này cần cập nhật')
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await flush()
    })
    expect(h.server.ops()).not.toContain('create')
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
    const creates = h.server.calls.filter((c) => c.op === 'create')
    expect(creates).toEqual([
      {
        op: 'create',
        input: {
          path: '/work/deck.pptx',
          kind: 'comment',
          body: 'Số liệu slide này cần cập nhật',
          anchor: {
            format: 'pptx',
            v: 1,
            slide_id: '257',
            slide_index: 1,
            object_id: 'e_slide2',
          },
          baseVersionId: 'v7',
        },
      },
    ])
  })

  it('versionId null: no new thread, the save-first line, replying still works; a Save receipt unlocks it', async () => {
    const slides = deck('slide1')
    const h = await mountHost({ slides, rows: [rootRow('x1', anchorOn(slides, 0))] })
    expect(h.handleRef.current!.startThread(0)).toBe(false)
    expect(slot.querySelector('.comments-server-hint')?.textContent).toBe(
      paneStrings.zh.paneCommentsSaveFirst,
    )
    expect(h.statuses).toEqual([paneStrings.zh.paneCommentsSaveFirst])
    expect(h.server.ops()).not.toContain('create')
    // the first Save receipt gives the open version: the hint goes, a thread can start
    await h.save('v1')
    expect(slot.querySelector('.comments-server-hint')).toBeNull()
    await act(async () => {
      expect(h.handleRef.current!.startThread(0)).toBe(true)
      await flush()
    })
    expect(h.statuses).toHaveLength(1)
  })

  it('a saved push for another document is ignored', async () => {
    const slides = deck('slide1')
    const h = await mountHost({
      slides,
      versionId: 'v1',
      rows: [rootRow('x1', anchorOn(slides, 0))],
    })
    await h.save('v9', '/work/other.pptx')
    expect(h.server.ops()).not.toContain('anchors')
    await act(async () => {
      h.handleRef.current!.startThread(0)
      await flush()
    })
    const box = slot.querySelector('textarea')!
    await act(async () => {
      nativeValue.call(box, 'x')
      box.dispatchEvent(new Event('input', { bubbles: true }))
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
    expect(h.server.calls.find((c) => c.op === 'create')?.input).toMatchObject({
      baseVersionId: 'v1',
    })
  })

  it('anchor_version_invalid: nothing thrown, no reload, the shown anchors stay, the next Save sends again', async () => {
    const slides = deck('slide1', 'slide2')
    const fake: FakeOpts = {
      anchorsFail: { code: 'malformed', detailsCode: 'anchor_version_invalid' },
    }
    const h = await mountHost({
      slides,
      versionId: 'v1',
      rows: [rootRow('x1', anchorOn(slides, 0))],
      fake,
    })
    await h.render({ slides: [slides[1]!, slides[0]!] })
    await h.save('v2')
    expect(h.server.ops().filter((o) => o === 'anchors')).toHaveLength(1)
    expect(h.server.ops().slice(-1)).toEqual(['anchors'])
    expect(slot.textContent).toContain('Lê Thu Hà')
    // the server accepts the next receipt: the map is rebuilt from the live deck and sent again
    delete fake.anchorsFail
    await h.save('v3')
    const rounds = h.server.calls.filter((c) => c.op === 'anchors')
    expect(rounds).toHaveLength(2)
    expect(rounds[1]!.input).toMatchObject({
      versionId: 'v3',
      anchors: [{ commentId: 'x1', state: 'exact', anchor: { slide_id: '256', slide_index: 1 } }],
    })
  })

  it('reorder then Save: comments.anchors goes after the receipt, with its version and slide_id', async () => {
    const slides = deck('slide1', 'slide2', 'slide3')
    const h = await mountHost({
      slides,
      versionId: 'v1',
      rows: [rootRow('x1', anchorOn(slides, 0)), rootRow('x22', anchorOn(slides, 2))],
    })
    await h.render({ slides: [slides[2]!, slides[1]!, slides[0]!] })
    expect(h.server.ops()).not.toContain('anchors')
    await h.save('v2')
    const round = h.server.calls.filter((c) => c.op === 'anchors')
    expect(round).toHaveLength(1)
    expect(round[0]!.input).toEqual({
      path: '/work/deck.pptx',
      versionId: 'v2',
      anchors: [
        // in the list's order: by where each slide is now
        {
          commentId: 'x22',
          state: 'exact',
          anchor: { format: 'pptx', v: 1, slide_id: '258', slide_index: 0 },
        },
        {
          commentId: 'x1',
          state: 'exact',
          anchor: { format: 'pptx', v: 1, slide_id: '256', slide_index: 2 },
        },
      ],
    })
    // a round that changed rows is followed by a full reload
    expect(h.server.ops().slice(-2)).toEqual(['anchors', 'list'])
    // the saved version is the base of the next new thread
    await act(async () => {
      h.handleRef.current!.startThread(0)
      await flush()
    })
    const box = slot.querySelector('textarea')!
    await act(async () => {
      nativeValue.call(box, 'next')
      box.dispatchEvent(new Event('input', { bubbles: true }))
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
    expect(h.server.calls.find((c) => c.op === 'create')?.input).toMatchObject({
      baseVersionId: 'v2',
    })
  })

  it('delete a slide then Save: the thread is lost, still readable, with the lost label', async () => {
    const slides = deck('slide1', 'slide2')
    const h = await mountHost({
      slides,
      versionId: 'v1',
      rows: [rootRow('x1', anchorOn(slides, 1), 'Xem lại biểu đồ')],
    })
    await h.render({ slides: [slides[0]!] })
    await h.save('v2')
    const round = h.server.calls.find((c) => c.op === 'anchors')!.input as {
      anchors: Array<{ state: string; anchor: { slide_id: string } }>
    }
    expect(round.anchors.map((a) => [a.state, a.anchor.slide_id])).toEqual([['lost', '257']])
    expect(h.server.rows[0]!.anchor_state).toBe('lost')
    const zh = collabStrings('zh')
    expect(slot.textContent).toContain(zh.collabAnchorLost)
    expect(slot.textContent).toContain('Xem lại biểu đồ')
  })

  it('the file’s own comments show read-only and server actions never write the file', async () => {
    const slides = deck('slide1', 'slide2')
    const fileComment: SlideComment = {
      authorId: 0,
      idx: 1,
      author: 'User',
      initials: '',
      dt: '2026-10-01T08:00:00Z',
      text: 'Ghi chú cũ trong tệp',
    } as SlideComment
    const addComment = vi.fn()
    const deleteComment = vi.fn()
    vi.stubGlobal('slidesApi', { addComment, deleteComment })
    const h = await mountHost({
      slides,
      versionId: 'v1',
      rows: [rootRow('x1', anchorOn(slides, 0))],
      fileComments: [[], [fileComment]],
    })
    expect(h.readFileComments).toHaveBeenCalledWith(0)
    expect(h.readFileComments).toHaveBeenCalledWith(1)
    const zh = collabStrings('zh')
    const toggle = [...slot.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(zh.collabInFileSection),
    )!
    await act(async () => {
      toggle.click()
      await flush()
    })
    const infile = slot.querySelector('.comments-infile')!
    expect(infile.textContent).toContain('Ghi chú cũ trong tệp')
    // read-only: no buttons and no composer on a file comment
    expect(infile.querySelectorAll('button, textarea')).toHaveLength(0)
    // a server action goes to the bridge only
    const resolve = [...slot.querySelectorAll('button')].find(
      (b) => b.textContent === zh.collabResolve,
    )!
    await act(async () => {
      resolve.click()
      await flush()
    })
    expect(h.server.ops()).toContain('resolve')
    expect(addComment).not.toHaveBeenCalled()
    expect(deleteComment).not.toHaveBeenCalled()
  })
})

describe('local pane', () => {
  it('an unbound file keeps the old add/delete pane', async () => {
    const onAdd = vi.fn()
    await act(async () => {
      root.render(
        createElement(CommentsPane, {
          slideIndex: 0,
          comments: [],
          onAdd,
          onDelete: () => {},
          onCollapse: () => {},
        }),
      )
      await flush()
    })
    expect(host.querySelector('.comment-new textarea')).not.toBeNull()
    expect(host.querySelector('.collab-panel')).toBeNull()
  })
})

describe('21-locale parity', () => {
  it('the new pane copy exists, non-empty and translated, in every locale', () => {
    expect(LANGS).toHaveLength(21)
    const en = paneStrings.en.paneCommentsSaveFirst
    for (const lang of LANGS) {
      const text = paneStrings[lang].paneCommentsSaveFirst
      expect(text, lang).toBeTruthy()
      if (lang !== 'en') expect(text, lang).not.toBe(en)
      // product copy carries no internal codes
      expect(text, lang).not.toMatch(/G8|UNI-\d|git/i)
      // the shared panel keys this pane reads exist too
      const c = collabStrings(lang)
      for (const key of ['collabAnchorSlide', 'collabAnchorLost', 'collabInFileSection'] as const) {
        expect(c[key], `${lang}:${key}`).toBeTruthy()
      }
    }
  })
})
