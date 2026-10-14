import { describe, expect, it } from 'vitest'
import { noticePatch, type NoticeKey } from '../src'

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
