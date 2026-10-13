/**
 * G8-08 (UNI-1403): the shared comments IPC contract — channel names, request
 * validators and the reveal push — and the pure reload scheduler (contract
 * §4.7/§7: poll only while the panel is open AND the tab is visible, send
 * `since_token`, replace the whole list on any non-`unchanged` answer).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  COMMENTS_BRIDGE_KEY,
  COMMENTS_CHANNELS,
  parseCommentsAnchorsInput,
  parseCommentsContextInput,
  parseCommentsContextResult,
  parseCommentsCreateInput,
  parseCommentsSaved,
  parseCommentsIdInput,
  parseCommentsListInput,
  parseCommentsReveal,
  parseCommentsUpdateInput,
  parseMentionsSearchInput,
  readCommentsPath,
  DISCUSSION_BRIDGE_KEY,
  DISCUSSION_CHANNELS,
  DISCUSSION_PANEL_LIMITS,
  clampDiscussionPanelWidth,
  parseDiscussionCreateInput,
  parseDiscussionListInput,
  parseDiscussionPanelInput,
  parseDiscussionRevealRequest,
} from '../src/comments-ipc'
import { COMMENTS_POLL_INTERVAL_MS, createCommentsPoll } from '../src/comments-poll'

describe('the comments IPC channel contract', () => {
  it('names one channel per frame request kind plus the reveal push and its pending pull', () => {
    expect(COMMENTS_CHANNELS).toEqual({
      list: 'uniwork:comments:list',
      create: 'uniwork:comments:create',
      update: 'uniwork:comments:update',
      remove: 'uniwork:comments:delete',
      resolve: 'uniwork:comments:resolve',
      reopen: 'uniwork:comments:reopen',
      revisions: 'uniwork:comments:revisions',
      anchors: 'uniwork:comments:anchors',
      searchMentions: 'uniwork:comments:search-mentions',
      reveal: 'uniwork:comments:reveal',
      revealPending: 'uniwork:comments:reveal:pending',
    })
    expect(COMMENTS_BRIDGE_KEY).toBe('uniworkComments')
  })

  it('every request needs the working-copy path', () => {
    expect(readCommentsPath({ path: '/w/Plan.docx' })).toBe('/w/Plan.docx')
    expect(readCommentsPath({})).toBeNull()
    expect(readCommentsPath({ path: '' })).toBeNull()
    expect(readCommentsPath({ path: 7 })).toBeNull()
  })

  it('comments.list: optional kind + sinceToken, both validated', () => {
    expect(parseCommentsListInput({ path: 'p' })).toEqual({ path: 'p' })
    expect(parseCommentsListInput({ path: 'p', kind: 'comment', sinceToken: 'lt1:aa' })).toEqual({
      path: 'p',
      kind: 'comment',
      sinceToken: 'lt1:aa',
    })
    expect(parseCommentsListInput({ path: 'p', kind: 'note' })).toBeNull()
    expect(parseCommentsListInput({ path: 'p', sinceToken: 3 })).toBeNull()
  })

  it('comments.create: kind + non-empty body, optional parent/anchor/baseVersionId', () => {
    const anchor = { format: 'xlsx', v: 1, sheet: 'S1', range: 'B7' }
    // OQ-C2: root comment = anchor + base version; reply = no anchor; discussion = no anchor
    expect(parseCommentsCreateInput({ path: 'p', kind: 'discussion', body: 'hi' })).toEqual({
      path: 'p',
      kind: 'discussion',
      body: 'hi',
    })
    expect(
      parseCommentsCreateInput({ path: 'p', kind: 'comment', parentId: 'c1', body: 'hi' }),
    ).toEqual({ path: 'p', kind: 'comment', parentId: 'c1', body: 'hi' })
    expect(parseCommentsCreateInput({ path: 'p', kind: 'comment', body: 'hi' })).toBeNull()
    expect(parseCommentsCreateInput({ path: 'p', kind: 'comment', body: 'hi', anchor })).toBeNull()
    expect(
      parseCommentsCreateInput({
        path: 'p',
        kind: 'comment',
        parentId: 'c1',
        body: 'hi',
        anchor,
        baseVersionId: 'v1',
      }),
    ).toBeNull()
    expect(
      parseCommentsCreateInput({
        path: 'p',
        kind: 'comment',
        parentId: 'c1',
        body: 'hi',
        baseVersionId: 'v1',
      }),
    ).toBeNull()
    expect(
      parseCommentsCreateInput({ path: 'p', kind: 'comment', body: 'hi', baseVersionId: 'v1' }),
    ).toBeNull()
    expect(
      parseCommentsCreateInput({
        path: 'p',
        kind: 'discussion',
        body: 'hi',
        anchor,
        baseVersionId: 'v1',
      }),
    ).toBeNull()
    expect(
      parseCommentsCreateInput({
        path: 'p',
        kind: 'comment',
        body: 'hi',
        anchor,
        baseVersionId: 'v1',
      }),
    ).toEqual({ path: 'p', kind: 'comment', body: 'hi', anchor, baseVersionId: 'v1' })
    expect(parseCommentsCreateInput({ path: 'p', body: 'hi' })).toBeNull()
    expect(parseCommentsCreateInput({ path: 'p', kind: 'comment', body: '' })).toBeNull()
    expect(
      parseCommentsCreateInput({ path: 'p', kind: 'comment', body: 'hi', parentId: '' }),
    ).toBeNull()
  })

  it('id-based requests and mentions.search', () => {
    expect(parseCommentsIdInput({ path: 'p', commentId: 'c1' })).toEqual({
      path: 'p',
      commentId: 'c1',
    })
    expect(parseCommentsIdInput({ path: 'p' })).toBeNull()
    expect(parseCommentsUpdateInput({ path: 'p', commentId: 'c1', body: 'new' })).toEqual({
      path: 'p',
      commentId: 'c1',
      body: 'new',
    })
    expect(parseCommentsUpdateInput({ path: 'p', commentId: 'c1', body: '' })).toBeNull()
    expect(parseMentionsSearchInput({ path: 'p', q: '' })).toEqual({ path: 'p', q: '' })
    expect(parseMentionsSearchInput({ path: 'p', q: 'x', limit: 20 })).toEqual({
      path: 'p',
      q: 'x',
      limit: 20,
    })
    expect(parseMentionsSearchInput({ path: 'p' })).toBeNull()
  })

  it('comments.anchors: 0..500 items, state exact|lost only', () => {
    const item = { commentId: 'c1', anchor: { format: 'docx', v: 1 }, state: 'exact' as const }
    expect(parseCommentsAnchorsInput({ path: 'p', versionId: 'v1', anchors: [item] })).toEqual({
      path: 'p',
      versionId: 'v1',
      anchors: [item],
    })
    // an empty round is a server no-op (contract §2.6: the field must be present, not non-empty)
    expect(parseCommentsAnchorsInput({ path: 'p', versionId: 'v1', anchors: [] })).toEqual({
      path: 'p',
      versionId: 'v1',
      anchors: [],
    })
    const many = Array.from({ length: 501 }, () => item)
    expect(parseCommentsAnchorsInput({ path: 'p', versionId: 'v1', anchors: many })).toBeNull()
    expect(
      parseCommentsAnchorsInput({
        path: 'p',
        versionId: 'v1',
        anchors: [{ ...item, state: 'stale' }],
      }),
    ).toBeNull()
    expect(parseCommentsAnchorsInput({ path: 'p', anchors: [item] })).toBeNull()
  })

  it('the reveal push needs a path and a comment id', () => {
    expect(parseCommentsReveal({ path: '/w/Plan.docx', commentId: 'c1' })).toEqual({
      path: '/w/Plan.docx',
      commentId: 'c1',
    })
    expect(parseCommentsReveal({ path: 'p' })).toBeNull()
    expect(parseCommentsReveal({ path: 'p', commentId: '' })).toBeNull()
    expect(parseCommentsReveal(null)).toBeNull()
  })
})

describe('the comments reload scheduler (contract §4.7)', () => {
  function harness() {
    const timers: Array<{ fn: () => void; ms: number }> = []
    const onChanged = vi.fn()
    const onError = vi.fn()
    type Answer = { unchanged: true; listToken: string } | { unchanged: false; listToken: string }
    const fetch = vi.fn(async (): Promise<Answer> => ({ unchanged: false, listToken: 'lt1:1' }))
    const poll = createCommentsPoll({
      fetch,
      onChanged,
      onError,
      setTimer: (fn, ms) => {
        timers.push({ fn, ms })
        return timers.length as unknown as ReturnType<typeof setTimeout>
      },
      clearTimer: () => undefined,
    })
    const tick = async () => {
      const next = timers.splice(0)
      for (const t of next) t.fn()
      await Promise.resolve()
      await Promise.resolve()
    }
    return { poll, fetch, onChanged, onError, timers, tick }
  }

  it('does nothing while the panel is closed or the tab is hidden', async () => {
    const { poll, fetch } = harness()
    poll.setVisible(false) // a hidden tab
    poll.setPanelOpen(true) // opening the panel on a hidden tab does not poll
    expect(poll.active()).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    poll.setVisible(true) // becoming visible with the panel open polls
    await Promise.resolve()
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('polls on open, sends since_token and replaces the whole list on change', async () => {
    const { poll, fetch, onChanged } = harness()
    poll.setPanelOpen(true) // visible defaults true
    await Promise.resolve()
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledWith({ sinceToken: null })
    expect(onChanged).toHaveBeenCalledWith('lt1:1')
  })

  it('an unchanged answer draws nothing', async () => {
    const { poll, fetch, onChanged } = harness()
    fetch.mockResolvedValueOnce({ unchanged: true, listToken: 'lt1:1' })
    poll.setPanelOpen(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('uses the received list_token as the next since_token', async () => {
    const { poll, fetch } = harness()
    fetch
      .mockResolvedValueOnce({ unchanged: false, listToken: 'lt1:1' })
      .mockResolvedValueOnce({ unchanged: false, listToken: 'lt1:2' })
    poll.setPanelOpen(true)
    await Promise.resolve()
    await Promise.resolve()
    poll.reload()
    await Promise.resolve()
    await Promise.resolve()
    expect(fetch).toHaveBeenNthCalledWith(2, { sinceToken: 'lt1:1' })
  })

  it('a failure keeps the list (no redraw) and reports the error', async () => {
    const { poll, fetch, onChanged, onError } = harness()
    fetch.mockRejectedValueOnce(new Error('offline'))
    poll.setPanelOpen(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(onChanged).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalled()
  })

  it('closing the panel stops the 30 s poll; the interval is 30 s', () => {
    const { poll, timers } = harness()
    poll.setPanelOpen(true)
    expect(timers[0]?.ms).toBe(COMMENTS_POLL_INTERVAL_MS)
    poll.setPanelOpen(false)
    expect(poll.active()).toBe(false)
  })

  it('reload() while active lists at once with since_token = the last list_token (focus / comments.changed)', async () => {
    const { poll, fetch, onChanged } = harness()
    fetch
      .mockResolvedValueOnce({ unchanged: false, listToken: 'lt1:1' })
      .mockResolvedValueOnce({ unchanged: false, listToken: 'lt1:2' })
      .mockResolvedValueOnce({ unchanged: true, listToken: 'lt1:2' })
    poll.setPanelOpen(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(1)
    // a focus / comments.changed reload lists immediately, no timer tick needed
    poll.reload()
    await Promise.resolve()
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenNthCalledWith(2, { sinceToken: 'lt1:1' })
    expect(onChanged).toHaveBeenLastCalledWith('lt1:2')
    // and the next reload carries the token the previous one returned
    poll.reload()
    await Promise.resolve()
    await Promise.resolve()
    expect(fetch).toHaveBeenNthCalledWith(3, { sinceToken: 'lt1:2' })
  })

  it('reload() restarts the 30 s timer so a focus reload is not doubled by a near tick', async () => {
    const { poll, timers } = harness()
    poll.setPanelOpen(true)
    await Promise.resolve()
    await Promise.resolve()
    const before = timers.length
    poll.reload()
    expect(timers.length).toBe(before + 1)
    expect(timers[timers.length - 1]?.ms).toBe(COMMENTS_POLL_INTERVAL_MS)
  })

  it('reload() does nothing while the panel is closed', async () => {
    const { poll, fetch, timers } = harness()
    poll.reload() // panel closed from the start
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
    expect(timers).toHaveLength(0)
    poll.setPanelOpen(true)
    await Promise.resolve()
    await Promise.resolve()
    poll.setPanelOpen(false)
    fetch.mockClear()
    poll.reload() // closed again
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reload() does nothing while the tab is hidden', async () => {
    const { poll, fetch, timers } = harness()
    poll.setPanelOpen(true)
    await Promise.resolve()
    await Promise.resolve()
    poll.setVisible(false)
    fetch.mockClear()
    const timersBefore = timers.length
    poll.reload()
    await Promise.resolve()
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
    expect(timers.length).toBe(timersBefore)
    // focus back: the visibility change itself lists once, with the kept token
    poll.setVisible(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledWith({ sinceToken: 'lt1:1' })
  })
})

describe('the discussion bridge contract (G8-11)', () => {
  it('names its own channels and global, apart from the comments ones', () => {
    expect(DISCUSSION_BRIDGE_KEY).toBe('uniworkDiscussion')
    const names = Object.values(DISCUSSION_CHANNELS)
    expect(names.every((n) => n.startsWith('uniwork:discussion:'))).toBe(true)
    expect(new Set(names).size).toBe(names.length)
  })

  it('list forces kind discussion and refuses any other kind', () => {
    expect(parseDiscussionListInput({ path: 'p' })).toEqual({ path: 'p', kind: 'discussion' })
    expect(parseDiscussionListInput({ path: 'p', sinceToken: 't', kind: 'discussion' })).toEqual({
      path: 'p',
      kind: 'discussion',
      sinceToken: 't',
    })
    expect(parseDiscussionListInput({ path: 'p', kind: 'comment' })).toBeNull()
    expect(parseDiscussionListInput({ path: '' })).toBeNull()
  })

  it('create forces kind discussion and refuses an anchor or base version', () => {
    expect(parseDiscussionCreateInput({ path: 'p', body: 'b', parentId: 'c1' })).toEqual({
      path: 'p',
      kind: 'discussion',
      body: 'b',
      parentId: 'c1',
    })
    expect(parseDiscussionCreateInput({ path: 'p', body: 'b', kind: 'comment' })).toBeNull()
    expect(parseDiscussionCreateInput({ path: 'p', body: 'b', anchor: {} })).toBeNull()
    expect(parseDiscussionCreateInput({ path: 'p', body: 'b', baseVersionId: 'v' })).toBeNull()
    expect(parseDiscussionCreateInput({ path: 'p', body: '' })).toBeNull()
  })

  it('panel input needs a boolean open and a finite width', () => {
    expect(parseDiscussionPanelInput({ open: true, width: 320 })).toEqual({
      open: true,
      width: 320,
    })
    expect(parseDiscussionPanelInput({ open: 1, width: 320 })).toBeNull()
    expect(parseDiscussionPanelInput({ open: true, width: Infinity })).toBeNull()
    expect(parseDiscussionRevealRequest({ path: 'p' })).toEqual({ path: 'p' })
    expect(parseDiscussionRevealRequest({})).toBeNull()
  })

  it('clamps the panel width to [min, max] and leaves the editor its minimum', () => {
    const { min, max, editorMin } = DISCUSSION_PANEL_LIMITS
    expect(clampDiscussionPanelWidth(320, 1400)).toBe(320)
    expect(clampDiscussionPanelWidth(10, 1400)).toBe(min)
    expect(clampDiscussionPanelWidth(5000, 1400)).toBe(max)
    expect(clampDiscussionPanelWidth(5000, 800)).toBe(800 - editorMin)
    expect(clampDiscussionPanelWidth(320, 500)).toBe(500 - editorMin)
    expect(clampDiscussionPanelWidth(320, 300)).toBe(0)
    expect(clampDiscussionPanelWidth(Number.NaN, 1400)).toBe(0)
  })
})

describe('the comments context + saved seam (G8-12 §3.1)', () => {
  it('names the two new channels next to the others', () => {
    expect(COMMENTS_CHANNELS.context).toBe('uniwork:comments:context')
    expect(COMMENTS_CHANNELS.saved).toBe('uniwork:comments:saved')
  })

  it('context takes only the path; anything the renderer adds is dropped', () => {
    expect(parseCommentsContextInput({ path: '/w/Plan.docx' })).toEqual({ path: '/w/Plan.docx' })
    // a renderer-supplied document or version id is never trusted
    expect(
      parseCommentsContextInput({ path: '/w/Plan.docx', documentId: 'd', versionId: 'v' }),
    ).toEqual({ path: '/w/Plan.docx' })
    expect(parseCommentsContextInput({ path: '' })).toBeNull()
    expect(parseCommentsContextInput(null)).toBeNull()
    expect(parseCommentsContextInput('/w/Plan.docx')).toBeNull()
  })

  it('a saved push needs a path and a bounded version id', () => {
    expect(parseCommentsSaved({ path: '/w/Plan.docx', versionId: 'ver_4' })).toEqual({
      path: '/w/Plan.docx',
      versionId: 'ver_4',
    })
    expect(parseCommentsSaved({ path: '/w/Plan.docx', versionId: 'ver_4', extra: 1 })).toEqual({
      path: '/w/Plan.docx',
      versionId: 'ver_4',
    })
    expect(parseCommentsSaved({ path: '/w/Plan.docx' })).toBeNull()
    expect(parseCommentsSaved({ path: '/w/Plan.docx', versionId: '' })).toBeNull()
    expect(parseCommentsSaved({ path: '/w/Plan.docx', versionId: 'x'.repeat(129) })).toBeNull()
    expect(parseCommentsSaved({ path: '', versionId: 'v' })).toBeNull()
    expect(parseCommentsSaved([])).toBeNull()
  })

  it('a context result keeps documentId, versionId (or null), a known level and myUserId', () => {
    expect(
      parseCommentsContextResult({
        documentId: 'd1',
        versionId: 'v3',
        level: 'manage',
        myUserId: 'u1',
      }),
    ).toEqual({ documentId: 'd1', versionId: 'v3', level: 'manage', myUserId: 'u1' })
    expect(parseCommentsContextResult({ documentId: 'd1', versionId: null })).toEqual({
      documentId: 'd1',
      versionId: null,
    })
    // an unknown level reads as "unknown" (own-comments-only rule), never as a grant
    expect(
      parseCommentsContextResult({ documentId: 'd1', versionId: 'v', level: 'owner' }),
    ).toEqual({ documentId: 'd1', versionId: 'v' })
    expect(parseCommentsContextResult({ documentId: '', versionId: 'v' })).toBeNull()
    expect(parseCommentsContextResult({ documentId: 'd1' })).toBeNull()
    expect(parseCommentsContextResult({ documentId: 'd1', versionId: 3 })).toBeNull()
  })
})
