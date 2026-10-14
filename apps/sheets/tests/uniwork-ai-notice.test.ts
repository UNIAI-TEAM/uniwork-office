// @vitest-environment jsdom
// UniWork AI notices in the Sheets panel (G6-05 review G05FE-5/8): Sheets folds the notices into the
// one text of the assistant message, so the run's notice state lives in ai/run-notices.ts and App.tsx
// only forwards the loop's events to it. These tests drive the same events the loop sends (wait,
// reset + text, restarted + done, dropped call, off) and read the text the chat bubble would show.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMPLETED_VIA_TOOLS_TEXT } from '@genoffice/agent-core'
import { aiUniworkText } from '@genoffice/ui'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { AiChatPanel, type AiChatMessage } from '../src/renderer/ai/AiChatPanel'
import { createRunNotices, type RunCopy } from '../src/renderer/ai/run-notices'
import { markRunFailed } from '../src/renderer/ai/run-error'
import { LocaleProvider } from '../src/renderer/i18n/locale'

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

describe('UniWork AI notices are announced through a separate status node (G05FE-7)', () => {
  it('announcement() is the latest notice or wait line, and a reset or a new run empties it', () => {
    const run = createRunNotices()
    expect(run.announcement()).toBe('')
    run.notice({ kind: 'rate-limit-wait', seconds: 30, attempt: 1 }, tr, 'Sheets')
    expect(run.announcement()).toBe(tr('aiErrRateLimited', { seconds: 30 }))
    run.reset()
    expect(run.announcement()).toBe('')
    run.notice({ kind: 'conversation-restarted' }, tr, 'Sheets')
    expect(run.announcement()).toBe(tr('aiConversationRestarted'))
    run.clear()
    expect(run.announcement()).toBe('')
  })

  describe('AiChatPanel', () => {
    let root: Root | null = null
    let container: HTMLElement | null = null
    beforeAll(() => {
      ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
      Element.prototype.scrollTo ??= () => {}
    })
    afterEach(() => {
      if (root) act(() => root!.unmount())
      container?.remove()
      root = null
      container = null
      vi.unstubAllGlobals()
    })
    const props = (chat: readonly AiChatMessage[]) => ({
      isOpen: true,
      hasContent: true,
      chat,
      attachments: [],
      attachNotice: null,
      onPickAttachments: () => {},
      onAddAttachmentPaths: () => {},
      onAddPastedImage: () => {},
      onRemoveAttachment: () => {},
      prompt: '',
      preview: null,
      aiBusy: true,
      onPromptChange: () => {},
      onSend: () => {},
      onStop: () => {},
      onNewChat: () => {},
      onUndo: () => {},
      scopeRange: null,
      scopeColumns: null,
      scopeLocked: false,
      onScopeDismiss: () => {},
      onCitation: () => {},
      onExpand: () => {},
      onCollapse: () => {},
    })
    const render = (chat: readonly AiChatMessage[]) =>
      act(() =>
        root!.render(
          createElement(
            LocaleProvider,
            { initial: 'en', children: null },
            createElement(AiChatPanel, props(chat)),
          ),
        ),
      )

    it('the live status node exists, empty, before the notice, and the notice text lands in the same node', () => {
      vi.stubGlobal(
        'desktopApi',
        new Proxy(
          {},
          {
            get: (_t, prop: string) =>
              /^on[A-Z]/.test(prop) ? () => () => {} : () => Promise.resolve(undefined),
          },
        ),
      )
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
      const user: AiChatMessage = { role: 'user', text: 'sum it', tools: [] }
      const streaming: AiChatMessage = { role: 'assistant', text: '', tools: [], streaming: true }
      render([user, streaming])
      const live = container.querySelector('.ai-sr-status')
      expect(live, 'status node before any notice').not.toBeNull()
      expect(live!.getAttribute('aria-live')).toBe('polite')
      expect(live!.getAttribute('aria-atomic')).toBe('true')
      // the role would collide with the workbook status (e2e getByRole('status') must stay unique)
      expect(live!.hasAttribute('role')).toBe(false)
      expect(live!.textContent).toBe('')
      render([user, { ...streaming, text: 'wait text', status: 'Try again in 30 s.' }])
      expect(container.querySelector('.ai-sr-status')).toBe(live)
      expect(live!.textContent).toBe('Try again in 30 s.')
      // the visible note stays in the message text, not in a second live region
      expect(container.querySelectorAll('[aria-live]')).toHaveLength(1)
      render([user, { ...streaming, text: 'the answer', streaming: false }])
      expect(live!.textContent).toBe('')
    })

    it('the AI panel adds no role=status node: a workbook with it mounted keeps exactly one, the workbook status', () => {
      vi.stubGlobal(
        'desktopApi',
        new Proxy(
          {},
          {
            get: (_t, prop: string) =>
              /^on[A-Z]/.test(prop) ? () => () => {} : () => Promise.resolve(undefined),
          },
        ),
      )
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
      const user: AiChatMessage = { role: 'user', text: 'sum it', tools: [] }
      render([
        user,
        {
          role: 'assistant',
          text: 'wait',
          tools: [],
          streaming: true,
          status: 'Try again in 30 s.',
        },
      ])
      expect(container.querySelector('.ai-sr-status')!.textContent).toBe('Try again in 30 s.')
      expect(container.querySelectorAll('[role="status"]')).toHaveLength(0)
      // ExcelShell (which mounts this panel under cap('ai')) owns the one status node of the workbook
      const shell = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/ExcelShell.tsx'),
        'utf8',
      )
      expect(shell).toMatch(/className="workbook-status"\s+role="status"/)
    })
  })
})

describe('a refused UniWork AI question (too long, rejected): no Retry, the question goes back to the composer', () => {
  const user: AiChatMessage = { role: 'user', text: 'sum column B', tools: [] }
  const streaming: AiChatMessage = { role: 'assistant', text: '', tools: [], streaming: true }

  it.each([['aiErrQuestionTooLong'], ['aiErrQuestionRejected']] as const)(
    '%s ends the run with the error and the user message is not marked undelivered',
    (key) => {
      const failed = markRunFailed([user, streaming], tr(key))
      expect(failed[1]).toMatchObject({ isError: true, text: tr(key) })
      expect(failed[0]!.undelivered).toBeUndefined()
    },
  )

  it('another failure still marks the message undelivered (control)', () => {
    expect(markRunFailed([user, streaming], 'server fell over')[0]!.undelivered).toBe(true)
  })

  it('App.tsx puts the refused question back in the composer', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/App.tsx'),
      'utf8',
    )
    expect(source).toMatch(
      /if \(isUniworkQuestionRefusal\(error\)\)\s+setPrompt\(\(current\) => current \|\| runQuestionRef\.current\)/,
    )
  })

  describe('AiChatPanel', () => {
    let root: Root | null = null
    let container: HTMLElement | null = null
    beforeAll(() => {
      ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
      Element.prototype.scrollTo ??= () => {}
    })
    afterEach(() => {
      if (root) act(() => root!.unmount())
      container?.remove()
      root = null
      container = null
      vi.unstubAllGlobals()
    })
    const mount = (chat: readonly AiChatMessage[]) => {
      vi.stubGlobal(
        'desktopApi',
        new Proxy(
          {},
          {
            get: (_t, prop: string) =>
              /^on[A-Z]/.test(prop) ? () => () => {} : () => Promise.resolve(undefined),
          },
        ),
      )
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
      act(() =>
        root!.render(
          createElement(
            LocaleProvider,
            { initial: 'vi', children: null },
            createElement(AiChatPanel, {
              isOpen: true,
              hasContent: true,
              chat,
              attachments: [],
              attachNotice: null,
              onPickAttachments: () => {},
              onAddAttachmentPaths: () => {},
              onAddPastedImage: () => {},
              onRemoveAttachment: () => {},
              prompt: 'sum column B',
              preview: null,
              aiBusy: false,
              onPromptChange: () => {},
              onSend: () => {},
              onStop: () => {},
              onNewChat: () => {},
              onUndo: () => {},
              scopeRange: null,
              scopeColumns: null,
              scopeLocked: false,
              onScopeDismiss: () => {},
              onCitation: () => {},
              onExpand: () => {},
              onCollapse: () => {},
            }),
          ),
        ),
      )
      return container
    }

    it('the refusal shows its error with no Retry; the composer holds the question', () => {
      const c = mount(markRunFailed([user, streaming], tr('aiErrQuestionTooLong')))
      expect(c.textContent).toContain(tr('aiErrQuestionTooLong'))
      expect(c.querySelector('.ai-retry-btn')).toBeNull()
      expect(c.querySelector('textarea')?.value).toBe('sum column B')
    })

    it('another failure shows Retry (control)', () => {
      const c = mount(markRunFailed([user, streaming], 'server fell over'))
      expect(c.querySelector('.ai-retry-btn')).not.toBeNull()
    })
  })
})
