// @vitest-environment jsdom
// Sheets answers without UniWork AI: while it is not offered, the fixed planner does (UNI-2309), so
// no need hint closes Send, the queue or App.tsx's handleSend (which cannot be mounted in jsdom
// because of Univer, so it is pinned from source). UniWork AI is the one provider, so its
// disclosure gates every send entry.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { setUniworkAiAvailable } from '@genoffice/ai-provider'
import { ack, aiUniworkText, createUniworkSendGate, setAiModelNeedHint } from '@genoffice/ui'
import { InMemoryWorkbookAdapter } from '@genoffice/xlsx-gateway/domain/in-memory-workbook'
import { AiChatPanel, type AiChatMessage } from '../src/renderer/ai/AiChatPanel'
import { agentConfigured } from '../src/renderer/ai/agent-configured'
import { LocaleProvider } from '../src/renderer/i18n/locale'
import { runDeterministicPlan, type PlanContext } from '../src/renderer/plan-operations'
import {
  ackUniworkDisclosureInFile,
  resetUniworkAi,
} from '../../../packages/ui/tests/helpers/uniwork-ack'

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('sheets panel send entry and queue submit (RF3-3)', () => {
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
    act(() => setAiModelNeedHint(null))
    // the in-memory empty-account ack must not leak into the next test
    resetUniworkAi()
    vi.unstubAllGlobals()
  })

  it('UniWork AI not offered holds no queued item: it goes out on settle for the fixed planner (RF3-3)', async () => {
    const runs: string[] = []
    // not offered (the default here), the disclosure acknowledged
    ackUniworkDisclosureInFile()
    vi.stubGlobal(
      'desktopApi',
      new Proxy(
        {},
        {
          get: (_t, prop: string) =>
            prop === 'getAiSettings'
              ? () => Promise.resolve({ provider: 'uniwork', providers: {} })
              : /^on[A-Z]/.test(prop)
                ? () => () => {}
                : () => Promise.resolve(undefined),
        },
      ),
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    const chat: AiChatMessage[] = [
      { role: 'user', text: 'first turn', tools: [] },
      { role: 'assistant', text: '', tools: [], streaming: true },
    ]
    let currentPrompt = 'queued follow-up'
    const render = (aiBusy: boolean, promptText = currentPrompt) => {
      currentPrompt = promptText
      act(() =>
        root!.render(
          createElement(
            LocaleProvider,
            { initial: 'en', children: null },
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
              prompt: currentPrompt,
              preview: null,
              aiBusy,
              onPromptChange: (next) => {
                currentPrompt = next
              },
              onSend: (text) => {
                if (text) runs.push(text)
              },
              // matches ExcelShell.tsx's onSendQueued wrapper around onSend
              onSendQueued: (text) => {
                if (aiBusy) return false
                runs.push(text)
                return true
              },
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
    }

    render(true, 'queued follow-up')
    await flush()

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea.ai-input')!
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(container.querySelector('.ai-queue-strip')).not.toBeNull()
    expect(runs).toEqual([])

    render(false, '')
    await flush()
    await flush()

    expect(runs).toEqual(['queued follow-up'])
  })

  it('a queued item stays queued while the disclosure is unacknowledged, and sends after the ack (RF4-1)', async () => {
    const runs: string[] = []
    setUniworkAiAvailable(true)
    const snapshot = (accountId: string) => ({
      state: 'ready',
      signedIn: true,
      accountId,
      orgId: 'org-1',
      orgName: 'Acme',
    })
    let push: ((snap: unknown) => void) | null = null
    vi.stubGlobal('uniworkCloudStatus', {
      get: vi.fn(async () => snapshot('acc-1')),
      onChange: (handler: (snap: unknown) => void) => {
        push = handler
        return () => {}
      },
      signIn: vi.fn(),
    })
    // the first account has acknowledged the disclosure for the workbook
    ack({ account: 'acc-1', org: 'org-1', document: 'local' })
    vi.stubGlobal(
      'desktopApi',
      new Proxy(
        {},
        {
          get: (_t, prop: string) =>
            prop === 'getAiSettings'
              ? () => Promise.resolve({ provider: 'uniwork', providers: {} })
              : /^on[A-Z]/.test(prop)
                ? () => () => {}
                : () => Promise.resolve(undefined),
        },
      ),
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    const chat: AiChatMessage[] = [
      { role: 'user', text: 'first turn', tools: [] },
      { role: 'assistant', text: '', tools: [], streaming: true },
    ]
    let currentPrompt = 'queued follow-up'
    const render = (aiBusy: boolean, promptText = currentPrompt) => {
      currentPrompt = promptText
      act(() =>
        root!.render(
          createElement(
            LocaleProvider,
            { initial: 'en', children: null },
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
              prompt: currentPrompt,
              preview: null,
              aiBusy,
              onPromptChange: (next) => {
                currentPrompt = next
              },
              onSend: (text) => {
                if (text) runs.push(text)
              },
              // matches ExcelShell.tsx's onSendQueued wrapper around onSend
              onSendQueued: (text) => {
                if (aiBusy) return false
                runs.push(text)
                return true
              },
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
    }

    render(true, 'queued follow-up')
    await flush()

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea.ai-input')!
    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(container.querySelector('.ai-queue-strip')).not.toBeNull()
    expect(runs).toEqual([])

    // another account signs in while the run is going: its disclosure is not acknowledged yet
    act(() => push?.(snapshot('acc-2')))
    await flush()
    render(false, '')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900))
    })

    expect(container.querySelector('[role="region"]')).not.toBeNull()
    expect(runs).toEqual([])
    expect(container.querySelector('.ai-queue-strip')).not.toBeNull()

    act(() => {
      container!.querySelector<HTMLButtonElement>('[role="region"] button')!.click()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900))
    })
    expect(runs).toEqual(['queued follow-up'])
  })

  it('retry of an undelivered message with the disclosure unacknowledged sends nothing, focuses the disclosure, and goes through after the ack (core4b)', async () => {
    const sent: string[] = []
    vi.stubGlobal(
      'desktopApi',
      new Proxy(
        {},
        {
          get: (_t, prop: string) =>
            prop === 'getAiSettings'
              ? () => Promise.resolve({ provider: 'uniwork', providers: {} })
              : /^on[A-Z]/.test(prop)
                ? () => () => {}
                : () => Promise.resolve(undefined),
        },
      ),
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const chat: AiChatMessage[] = [
      { role: 'user', text: 'first turn', tools: [], undelivered: true },
    ]
    act(() =>
      root!.render(
        createElement(
          LocaleProvider,
          { initial: 'en', children: null },
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
            prompt: '',
            preview: null,
            aiBusy: false,
            onPromptChange: () => {},
            onSend: (text) => {
              if (text) sent.push(text)
              return true
            },
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
    await flush()
    await flush()

    const region = container.querySelector<HTMLElement>('[role="region"]')
    expect(region).not.toBeNull()
    act(() => {
      container!.querySelector<HTMLButtonElement>('.ai-retry-btn')!.click()
    })
    expect(sent).toEqual([])
    expect(document.activeElement).toBe(region)

    act(() => {
      region!.querySelector<HTMLButtonElement>('button')!.click()
    })
    act(() => {
      container!.querySelector<HTMLButtonElement>('.ai-retry-btn')!.click()
    })
    expect(sent).toEqual(['first turn'])
  })

  it('an AI entry that fires while the panel is collapsed expands it, then announces the needs-ack line and focuses the disclosure; nothing is sent (RF5-1)', async () => {
    const sent: string[] = []
    const expand = vi.fn()
    // the shell owns the gate and hands it down; its onSend wrapper refuses through it
    const gate = createUniworkSendGate()
    vi.stubGlobal(
      'desktopApi',
      new Proxy(
        {},
        {
          get: (_t, prop: string) =>
            prop === 'getAiSettings'
              ? () => Promise.resolve({ provider: 'uniwork', providers: {} })
              : /^on[A-Z]/.test(prop)
                ? () => () => {}
                : () => Promise.resolve(undefined),
        },
      ),
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const render = (isOpen: boolean) =>
      act(() =>
        root!.render(
          createElement(
            LocaleProvider,
            { initial: 'en', children: null },
            createElement(AiChatPanel, {
              isOpen,
              sendGate: gate,
              hasContent: true,
              chat: [],
              attachments: [],
              attachNotice: null,
              onPickAttachments: () => {},
              onAddAttachmentPaths: () => {},
              onAddPastedImage: () => {},
              onRemoveAttachment: () => {},
              prompt: '',
              preview: null,
              aiBusy: false,
              onPromptChange: () => {},
              onSend: (text) => {
                if (text) sent.push(text)
                return true
              },
              onStop: () => {},
              onNewChat: () => {},
              onUndo: () => {},
              scopeRange: null,
              scopeColumns: null,
              scopeLocked: false,
              onScopeDismiss: () => {},
              onCitation: () => {},
              onExpand: expand,
              onCollapse: () => {},
            }),
          ),
        ),
      )
    render(true)
    await flush()
    await flush()
    render(false)
    await flush()

    // a ribbon run or preset while collapsed: the shell wrapper asks the gate first
    expect(gate.refuse()).toBe(true)
    expect(expand).toHaveBeenCalledTimes(1)
    expect(sent).toEqual([])

    render(true)
    await flush()
    await flush()
    const region = container.querySelector<HTMLElement>('[role="region"]')
    expect(region).not.toBeNull()
    expect(document.activeElement).toBe(region)
    const spoken = [...container.querySelectorAll('.ai-uniwork-sr-only')].map((n) => n.textContent)
    expect(spoken).toContain(aiUniworkText('en', 'aiUniworkSendNeedsAck'))
    expect(expand).toHaveBeenCalledTimes(1)
    expect(sent).toEqual([])
  })

  it('ExcelShell routes every AI entry (Send, retry, presets, ribbon runs, selection ask) through one UniWork gate (core4b, pinned from source: ExcelShell cannot be mounted in jsdom)', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const shell = readFileSync(join(here, '../src/renderer/ExcelShell.tsx'), 'utf8')
    expect(shell).toContain('const uniworkSendGate = useUniworkSendGate()')
    // it answers whether the send went out (a preset that did not waits in the composer, UNI-2264)
    expect(shell).toMatch(
      /const onSend: typeof onSendRaw = [^{]*\{\s*if \(uniworkSendGate\.refuse\(\)\) return false\s*return onSendRaw\(/,
    )
    expect(shell).toContain('sendGate={uniworkSendGate}')
    // no entry calls the raw prop around the gate
    expect(shell.match(/onSendRaw\(/g)).toHaveLength(1)
  })

  it('App.tsx handleSend reads no need hint: without UniWork AI the fixed planner answers (App.tsx cannot be mounted in jsdom)', () => {
    const app = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/App.tsx'),
      'utf8',
    )
    expect(app).not.toContain('needModelHint')
    expect(app).not.toContain('useAiModelNeedHint')
    const start = app.indexOf('  function handleSend(')
    expect(start).toBeGreaterThan(-1)
    const body = app.slice(start, app.indexOf('runToolsRef.current = []', start))
    expect(body).toMatch(/if \(!instruction \|\| aiBusy\) return false/)
    expect(app.slice(start)).toMatch(
      /if \(agentConfigured\) \{\s*runAgent\(instruction, sentAtts\)[\s\S]*?runDeterministicPlan\(instruction\)/,
    )
  })

  it('UniWork AI not offered: Send stays open, the composer sends, and the fixed planner answers in the panel', async () => {
    // not offered (the default here), the settings loaded, the disclosure acknowledged
    ackUniworkDisclosureInFile()
    const settings = { provider: 'uniwork', providers: {} }
    vi.stubGlobal(
      'desktopApi',
      new Proxy(
        {},
        {
          get: (_t, prop: string) =>
            prop === 'getAiSettings'
              ? () => Promise.resolve(settings)
              : /^on[A-Z]/.test(prop)
                ? () => () => {}
                : () => Promise.resolve(undefined),
        },
      ),
    )
    // App's handleSend, without its Univer runtime: no agent, so the regex planner answers
    const planCtx: PlanContext = {
      adapterRef: {
        current: new InMemoryWorkbookAdapter({
          revision: 0,
          sheets: [{ id: 'sheet-1', name: 'Sheet1', cells: {} }],
        }),
      },
      univerRef: { current: null },
      lazyWorkbookRef: { current: null },
      lazyPreviewRef: { current: null },
      setPreview: () => {},
      autoApplySafePlan: async () => ({ ok: true }),
    }
    let chat: AiChatMessage[] = []
    let prompt = 'set A1 to 5'
    const replies: Array<{ text: string; isError?: boolean }> = []
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const render = () =>
      act(() =>
        root!.render(
          createElement(
            LocaleProvider,
            { initial: 'en', children: null },
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
              prompt,
              preview: null,
              aiBusy: false,
              onPromptChange: (next) => {
                prompt = next
              },
              onSend: (text) => {
                const instruction = (text ?? prompt).trim()
                expect(agentConfigured(settings as never)).toBe(false)
                const outcome = runDeterministicPlan(planCtx, instruction)
                replies.push(outcome)
                chat = [
                  ...chat,
                  { role: 'user', text: instruction, tools: [] },
                  { role: 'assistant', text: outcome.text, tools: [], isError: outcome.isError },
                ]
                prompt = ''
                return true
              },
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
    render()
    await flush()
    await flush()

    const send = container.querySelector<HTMLButtonElement>('.ai-send-btn')!
    expect(send.disabled).toBe(false)
    expect(container.querySelector('.ai-input-need')).toBeNull()
    act(() => send.click())
    render()
    await flush()

    // the planner made a preview for the instruction, and its reply is the answer on screen
    expect(replies).toHaveLength(1)
    expect(replies[0]!.isError).toBeFalsy()
    expect(container.querySelector('.ai-msg-answer')?.textContent).toContain(replies[0]!.text)
  })

  it('App.tsx handleSend sends nothing (no bubble, no regex planner) while the settings are unread or a run is busy or starting (UNI-2264)', () => {
    const app = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/App.tsx'),
      'utf8',
    )
    const start = app.indexOf('  function handleSend(')
    // everything before the first side effect: the caller keeps the text (a preset waits in the composer)
    const body = app.slice(start, app.indexOf('runToolsRef.current = []', start))
    expect(body).toContain('if (!aiSettingsRef.current) return false')
    expect(body).toMatch(
      /if \(agentConfigured && \(!loop \|\| loop\.busy \|\| runStartingRef\.current\)\) return false/,
    )
  })
})
