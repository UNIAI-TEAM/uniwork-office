// UniWork AI notices in the Sheets panel (G6-05 review G05FE-5/8): Sheets folds the notices into the
// one text of the assistant message, so the run's notice state lives in ai/run-notices.ts and App.tsx
// only forwards the loop's events to it. These tests drive the same events the loop sends (wait,
// reset + text, restarted + done, dropped call, off) and read the text the chat bubble would show.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMPLETED_VIA_TOOLS_TEXT } from '@genoffice/agent-core'
import { aiUniworkText } from '@genoffice/ui'
import { describe, expect, it } from 'vitest'

import { createRunNotices, type RunCopy } from '../src/renderer/ai/run-notices'

const tr = (key: Parameters<typeof aiUniworkText>[1], params?: Record<string, string | number>) =>
  aiUniworkText('vi', key, params)
const copy: RunCopy = {
  stopped: '(stopped)',
  noSummary: '(done, no summary)',
  noAction: '(no action)',
  turnLimit: '(turn limit)',
  truncated: '(truncated)',
}
const done = (
  text = '',
  extra: Partial<Parameters<ReturnType<typeof createRunNotices>['finish']>[0]> = {},
) => ({
  text,
  cancelled: false,
  turnLimit: false,
  truncated: false,
  toolSummaries: '',
  mutated: false,
  copy,
  ...extra,
})

describe('UniWork AI notices (sheets panel text)', () => {
  it('a wait is a status line in the text; the resend resets it and the answer streams in', () => {
    const run = createRunNotices()
    expect(run.notice({ kind: 'rate-limit-wait', seconds: 120, attempt: 1 }, tr, 'Sheets')).toBe(
      'Bạn đang gửi quá nhanh. Thử lại sau 120 giây.',
    )
    expect(
      run.notice({ kind: 'rate-limit-wait', seconds: 120, attempt: 1 }, tr, 'Sheets'),
    ).not.toBeNull()
    expect(run.reset()).toBe('')
    expect(run.text('the answer')).toBe('the answer')
    expect(run.text('the answer, longer')).toBe('the answer, longer')
    expect(run.finish(done('the answer, longer')).display).toBe('the answer, longer')
  })

  it('a partial answer dropped by a reset does not come back as the fallback of a tools-only resend (G05FE-8)', () => {
    const run = createRunNotices()
    run.text('partial answer that the 429 dropped')
    run.notice({ kind: 'rate-limit-wait', seconds: 10, attempt: 1 }, tr, 'Sheets')
    run.reset()
    // the resend only runs tools: the final turn has no prose
    const final = run.finish(
      done(COMPLETED_VIA_TOOLS_TEXT, { toolSummaries: 'Set B2', mutated: true }),
    )
    expect(final.persisted).toBe('Set B2')
    expect(final.display).not.toContain('partial answer')
    // and with neither tools nor prose the "no action" line, never the dropped text
    const run2 = createRunNotices()
    run2.text('dropped too')
    run2.reset()
    expect(run2.finish(done('')).persisted).toBe('(no action)')
  })

  it('a restarted conversation: the note is the whole answer, quiet end, not an empty-reply fallback', () => {
    const run = createRunNotices()
    expect(run.notice({ kind: 'conversation-restarted' }, tr, 'Sheets')).toBe(
      tr('aiConversationRestarted'),
    )
    expect(run.quiet()).toBe(true)
    const final = run.finish(done(''))
    expect(final.display).toBe(tr('aiConversationRestarted'))
    expect(final.persisted).toBe('')
    expect(final.display).not.toContain('(no action)')
  })

  it('a dropped tool call and a provider boundary are notes above the answer', () => {
    const run = createRunNotices()
    run.notice({ kind: 'conversation-boundary', provider: 'uniwork' }, tr, 'Sheets')
    run.notice(
      {
        kind: 'dropped-tool-calls',
        calls: [
          { index: 0, name: 'edit', reason: 'view_only' },
          { index: 1, name: 'x', reason: 'not_allowlisted' },
        ],
      },
      tr,
      'Sheets',
    )
    const shown = run.text('partial')
    expect(shown.split('\n\n')).toEqual([
      tr('aiConversationBoundary', { provider: tr('aiUniworkProvider') }),
      tr('aiErrViewOnlyEdit'),
      tr('aiErrUnsupported', { module: 'Sheets' }),
      'partial',
    ])
    expect(run.finish(done('answer')).display.endsWith('answer')).toBe(true)
  })

  it('UniWork AI off: one note, a quiet end, no no-action fallback and nothing persisted', () => {
    const run = createRunNotices()
    expect(run.notice({ kind: 'uniwork-off' }, tr, 'Sheets')).toBe(tr('aiUniworkOff'))
    // the same notice again changes nothing
    expect(run.notice({ kind: 'uniwork-off' }, tr, 'Sheets')).toBeNull()
    const final = run.finish(done(''))
    expect(final.display).toBe(tr('aiUniworkOff'))
    expect(final.persisted).toBe('')
  })

  it('a new run starts clean (clear)', () => {
    const run = createRunNotices()
    run.notice({ kind: 'uniwork-off' }, tr, 'Sheets')
    run.text('x')
    run.clear()
    expect(run.quiet()).toBe(false)
    expect(run.finish(done('')).persisted).toBe('(no action)')
  })

  it('a stop keeps the stopped line; the turn-limit and truncated lines are added to the answer', () => {
    const run = createRunNotices()
    run.text('earlier narration')
    expect(run.finish(done('', { cancelled: true })).persisted).toBe('(stopped)')
    const run2 = createRunNotices()
    expect(run2.finish(done('answer', { turnLimit: true, truncated: true })).persisted).toBe(
      'answer\n\n(turn limit)\n\n(truncated)',
    )
  })

  it('App.tsx forwards the loop events to the run notices and clears them on reset', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/App.tsx'),
      'utf8',
    )
    expect(source).toContain('runNoticesRef.current.text(')
    expect(source).toContain('runNoticesRef.current.notice(')
    expect(source).toContain('runNoticesRef.current.reset()')
    expect(source).toContain('runNoticesRef.current.finish(')
    expect(source).toContain('runNoticesRef.current.clear()')
    // a restart puts the unsent question back in the composer
    expect(source).toContain("notice.kind === 'conversation-restarted'")
    expect(source).toContain('setPrompt((current) => current || runQuestionRef.current)')
    // the old split state (a text ref that a reset forgot) is gone
    expect(source).not.toContain('runLastTextRef')
  })
})
