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
  parseCommentsCreateInput,
  parseCommentsIdInput,
  parseCommentsListInput,
  parseCommentsReveal,
  parseCommentsUpdateInput,
  parseMentionsSearchInput,
  readCommentsPath,
} from '../src/comments-ipc'
import { COMMENTS_POLL_INTERVAL_MS, createCommentsPoll } from '../src/comments-poll'

describe('the comments IPC channel contract', () => {
  it('names one channel per frame request kind plus the reveal push', () => {
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
    expect(parseCommentsCreateInput({ path: 'p', kind: 'comment', body: 'hi' })).toEqual({
      path: 'p',
      kind: 'comment',
      body: 'hi',
    })
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

  it('comments.anchors: 1..500 items, state exact|lost only', () => {
    const item = { commentId: 'c1', anchor: { format: 'docx', v: 1 }, state: 'exact' as const }
    expect(parseCommentsAnchorsInput({ path: 'p', versionId: 'v1', anchors: [item] })).toEqual({
      path: 'p',
      versionId: 'v1',
      anchors: [item],
    })
    expect(parseCommentsAnchorsInput({ path: 'p', versionId: 'v1', anchors: [] })).toBeNull()
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
})
