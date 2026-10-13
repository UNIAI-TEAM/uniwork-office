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
import type {
  CommentsRevealPayload,
  UniworkCommentsApi,
} from '@genoffice/electron-utils/comments-ipc'
import {
  anchorUpdatesAfterSave,
  createSlidesAnchorAdapter,
  loadCommentsContext,
  pptxAnchorFor,
  selectedObjectId,
  wantsServerComments,
  type SlideIdentity,
  type SlidesCommentsContextApi,
} from '../src/renderer/server-comments'
import {
  CommentsPane,
  ServerCommentsHost,
  type ServerCommentsHandle,
} from '../src/renderer/components/CommentsPane'
import { paneStrings } from '../src/renderer/i18n/strings-panes'
import type { SlideComment } from '../src/shared/ipc'

/* ---------- a deck ---------- */

const deck = (...ids: string[]): SlideIdentity[] =>
  ids.map((id) => ({
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

function fakeBridge(seed: Row[] = []) {
  const rows = [...seed]
  const calls: Array<{ op: string; input: unknown }> = []
  let seq = 0
  let token = 0
  const revealHandlers = new Set<(p: CommentsRevealPayload) => void>()
  // the rows are structurally the protocol's DocumentComment; the reply type is the bridge's own
  const ok = (value: unknown) => Promise.resolve({ ok: true, value }) as Promise<never>
  const at = () => `2026-10-13T10:00:${String(seq).padStart(2, '0')}Z`
  const find = (id: string) => rows.find((r) => r.id === id)!
  const bridge: UniworkCommentsApi = {
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
  }
  return {
    bridge,
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
    expect(onB.slide_id).toBe('ppt/slides/slide2.xml')
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
  })

  it('a deleted object leaves the thread on its slide without object_id', () => {
    const before = deck('slide1')
    const a = anchorOn(before, 0, 'e_slide1')
    const after: SlideIdentity[] = [{ partPath: 'ppt/slides/slide1.xml', nodes: [] }]
    const [u] = anchorUpdatesAfterSave([{ id: 'a', document_id: 'd', body: 'x', anchor: a }], after)
    expect(u).toEqual({
      commentId: 'a',
      state: 'exact',
      anchor: { format: 'pptx', v: 1, slide_id: 'ppt/slides/slide1.xml', slide_index: 0 },
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

  it('the context falls back to view / edit from the read-only flag without the shell call', async () => {
    expect(await loadCommentsContext(undefined, '/p.pptx', false)).toEqual({
      documentId: '/p.pptx',
      level: 'edit',
    })
    expect(await loadCommentsContext({}, '/p.pptx', true)).toEqual({
      documentId: '/p.pptx',
      level: 'view',
    })
    const api: SlidesCommentsContextApi = {
      uniworkCommentsContext: async () => ({
        documentId: 'doc-1',
        versionId: 'v1',
        userId: 'me',
        level: 'manage',
      }),
    }
    expect(await loadCommentsContext(api, '/p.pptx', false)).toEqual({
      documentId: 'doc-1',
      versionId: 'v1',
      userId: 'me',
      level: 'manage',
    })
    // a read-only copy never writes
    expect((await loadCommentsContext(api, '/p.pptx', true)).level).toBe('view')
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
}

async function mountHost(o: MountOpts) {
  const server = fakeBridge(o.rows)
  const saved = new Set<(r: { versionId: string }) => void>()
  const contextApi: SlidesCommentsContextApi = {
    onUniworkSaved: (h) => {
      saved.add(h)
      return () => saved.delete(h)
    },
  }
  const goTo = vi.fn()
  const onOpen = vi.fn()
  const handleRef =
    createRef<ServerCommentsHandle>() as MutableRefObject<ServerCommentsHandle | null>
  const readFileComments = vi.fn(async (i: number) => o.fileComments?.[i] ?? [])
  const props = {
    bridge: server.bridge,
    path: '/work/deck.pptx',
    context: {
      documentId: 'doc-1',
      level: 'edit' as const,
      userId: 'me',
      ...(o.versionId ? { versionId: o.versionId } : {}),
    },
    contextApi,
    slides: o.slides,
    slot: o.open === false ? null : slot,
    goTo,
    onOpen,
    onCollapse: () => {},
    readFileComments,
    fileCommentsNonce: 0,
    handleRef,
    onOpenCount: () => {},
  }
  const render = async (patch: Partial<typeof props> = {}) => {
    Object.assign(props, patch)
    await act(async () => {
      root.render(createElement(ServerCommentsHost, { ...props }))
      await flush()
    })
  }
  await render()
  const save = async (versionId: string) =>
    act(async () => {
      saved.forEach((h) => h({ versionId }))
      await flush()
      await flush()
    })
  return { server, goTo, onOpen, handleRef, render, save, readFileComments }
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
            slide_id: 'ppt/slides/slide2.xml',
            slide_index: 1,
            object_id: 'e_slide2',
          },
          baseVersionId: 'v7',
        },
      },
    ])
  })

  it('without a document version no thread starts and the pane says so', async () => {
    const h = await mountHost({ slides: deck('slide1') })
    expect(h.handleRef.current!.startThread(0)).toBe(false)
    expect(slot.querySelector('.comments-server-hint')).not.toBeNull()
    expect(h.server.ops()).not.toContain('create')
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
          anchor: { format: 'pptx', v: 1, slide_id: 'ppt/slides/slide3.xml', slide_index: 0 },
        },
        {
          commentId: 'x1',
          state: 'exact',
          anchor: { format: 'pptx', v: 1, slide_id: 'ppt/slides/slide1.xml', slide_index: 2 },
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
      anchors: Array<{ state: string }>
    }
    expect(round.anchors.map((a) => a.state)).toEqual(['lost'])
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
    const en = paneStrings.en.paneCommentsNewUnavailable
    for (const lang of LANGS) {
      const text = paneStrings[lang].paneCommentsNewUnavailable
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
