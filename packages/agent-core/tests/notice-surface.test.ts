import { describe, expect, it } from 'vitest'
import { createTextNoticeSurface, endsQuietly, noticePatch, type NoticeKey } from '../src'

// the panels translate with aiUniworkText; a keyed echo is enough to pin the mapping
const tr = (key: NoticeKey, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key

describe('noticePatch', () => {
  it('a Retry-After wait is a status line with the seconds rounded up, never an error', () => {
    const patch = noticePatch(
      {},
      { kind: 'rate-limit-wait', seconds: 119.2, attempt: 1 },
      tr,
      'Docs',
    )
    expect(patch).toEqual({ waitLine: 'aiErrRateLimited:{"seconds":120}' })
    expect(patch).not.toHaveProperty('error')
  })

  it('a restart and a provider boundary become notes above the answer', () => {
    const restarted = noticePatch({}, { kind: 'conversation-restarted' }, tr, 'Docs')
    expect(restarted?.notes).toEqual([{ kind: 'restarted', text: 'aiConversationRestarted' }])
    const boundary = noticePatch(
      { notes: restarted!.notes! },
      { kind: 'conversation-boundary', provider: 'uniwork' },
      tr,
      'Docs',
    )
    expect(boundary?.notes?.map((n) => n.kind)).toEqual(['restarted', 'boundary'])
    expect(boundary?.notes?.[1]?.text).toBe(
      'aiConversationBoundary:{"provider":"aiUniworkProvider"}',
    )
  })

  it('dropped calls fall back to text by reason, once per reason', () => {
    const patch = noticePatch(
      {},
      {
        kind: 'dropped-tool-calls',
        calls: [
          { index: 0, name: 'a', reason: 'view_only' },
          { index: 1, name: 'b', reason: 'view_only' },
          { index: 2, name: 'c', reason: 'not_allowlisted' },
        ],
      },
      tr,
      'Sheets',
    )
    expect(patch?.notes?.map((n) => n.text)).toEqual([
      'aiErrViewOnlyEdit',
      'aiErrUnsupported:{"module":"Sheets"}',
    ])
    // the same reason again in a later step adds nothing
    const again = noticePatch(
      { notes: patch!.notes! },
      { kind: 'dropped-tool-calls', calls: [{ index: 0, name: 'a', reason: 'view_only' }] },
      tr,
      'Sheets',
    )
    expect(again).toBeNull()
  })

  it('uniwork-off is a plain note; step and unknown kinds are ignored', () => {
    expect(noticePatch({}, { kind: 'uniwork-off' }, tr, 'Docs')?.notes).toEqual([
      { kind: 'off', text: 'aiUniworkOff' },
    ])
    expect(noticePatch({}, { kind: 'step', step: 1, limit: 5 }, tr, 'Docs')).toBeNull()
    expect(noticePatch({}, { kind: 'from-the-future' } as never, tr, 'Docs')).toBeNull()
  })
})

describe('noticePatch: images left out of a UniWork AI question', () => {
  it('is a one-line note, once per run, and the turn is not quiet', () => {
    const patch = noticePatch({}, { kind: 'images-not-sent' }, tr, 'Docs')
    expect(patch?.notes).toEqual([{ kind: 'images', text: 'aiUniworkImagesNotSent' }])
    expect(noticePatch(patch!, { kind: 'images-not-sent' }, tr, 'Docs')).toBeNull()
    expect(endsQuietly(patch?.notes)).toBe(false)
  })
})

describe('createTextNoticeSurface (single-text chat messages)', () => {
  it('a wait shows as the text, a reset or new text ends it, notes stay above the answer', () => {
    const surface = createTextNoticeSurface()
    expect(surface.notice({ kind: 'rate-limit-wait', seconds: 30, attempt: 1 }, tr, 'Sheets')).toBe(
      'aiErrRateLimited:{"seconds":30}',
    )
    expect(surface.reset()).toBe('')
    expect(
      surface.notice({ kind: 'conversation-boundary', provider: 'uniwork' }, tr, 'Sheets'),
    ).toBe('aiConversationBoundary:{"provider":"aiUniworkProvider"}')
    expect(surface.text('answer')).toBe(
      'aiConversationBoundary:{"provider":"aiUniworkProvider"}\n\nanswer',
    )
    // a wait inside a streaming turn: the line sits between the notes and the answer so far
    surface.notice({ kind: 'rate-limit-wait', seconds: 5, attempt: 2 }, tr, 'Sheets')
    expect(surface.text('again')).toContain('again')
    expect(surface.text('again')).not.toContain('aiErrRateLimited')
    expect(surface.notice({ kind: 'step', step: 1, limit: 3 }, tr, 'Sheets')).toBeNull()
  })

  it('a restart is remembered, compose() puts the notes above the final answer, clear() starts over', () => {
    const surface = createTextNoticeSurface()
    expect(surface.restarted()).toBe(false)
    surface.notice({ kind: 'conversation-restarted' }, tr, 'Sheets')
    expect(surface.restarted()).toBe(true)
    expect(surface.compose('')).toBe('aiConversationRestarted')
    expect(surface.compose('done')).toBe('aiConversationRestarted\n\ndone')
    surface.clear()
    expect(surface.restarted()).toBe(false)
    expect(surface.compose('done')).toBe('done')
  })
})
