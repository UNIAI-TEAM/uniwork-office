// @vitest-environment jsdom
// A picked UniWork AI that is not offered keeps every send entry closed (spec S7 / RF1-4 / RF3-3):
// AiChatPanel's queue submit must refuse to dequeue when the model-need hint is on, and App.tsx's
// handleSend (which cannot be mounted in jsdom because of Univer) is pinned from source to return
// false on the same hint.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  aiUniworkText,
  clearUniworkAcks,
  createUniworkSendGate,
  setAiModelNeedHint,
} from '@genoffice/ui'
import { AiChatPanel, type AiChatMessage } from '../src/renderer/ai/AiChatPanel'
import { LocaleProvider } from '../src/renderer/i18n/locale'

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('sheets panel send entry and queue submit with model-need hint (RF3-3)', () => {
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
    clearUniworkAcks()
    vi.unstubAllGlobals()
  })

  it('a queued item stays queued and sends no request when the model-need hint turns on before settle (RF3-3)', async () => {
    const runs: string[] = []
    vi.stubGlobal(
      'desktopApi',
      new Proxy(
        {},
        {
          get: (_t, prop: string) =>
            prop === 'getAiSettings'
              ? () => Promise.resolve({ provider: 'openai', providers: {} })
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

    act(() => setAiModelNeedHint('Choose a model to send'))
    render(false, '')
    await flush()
    await flush()

    expect(runs).toEqual([])
    expect(container.querySelector('.ai-queue-strip')).not.toBeNull()
  })

  it('a queued item stays queued while UniWork AI is picked with an unacknowledged disclosure, and sends after the ack (RF4-1)', async () => {
    const runs: string[] = []
    let saved = 'openai'
    const changed: Array<() => void> = []
    vi.stubGlobal(
      'desktopApi',
      new Proxy(
        {},
        {
          get: (_t, prop: string) =>
            prop === 'getAiSettings'
              ? () => Promise.resolve({ provider: saved, providers: {} })
              : prop === 'onAiSettingsChanged'
                ? (handler: () => void) => {
                    changed.push(handler)
                    return () => {}
                  }
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

    act(() => setAiModelNeedHint('Choose a model to send'))
    render(false, '')
    await flush()

    // the user picks UniWork AI: the saved settings change and the panel is told
    saved = 'uniwork'
    act(() => changed.forEach((handler) => handler()))
    await flush()
    act(() => setAiModelNeedHint(null))
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

  it('retry of an undelivered message with UniWork AI picked and the disclosure unacknowledged sends nothing, focuses the disclosure, and goes through after the ack (core4b)', async () => {
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
    expect(shell).toMatch(
      /const onSend: typeof onSendRaw = [^{]*\{\s*if \(uniworkSendGate\.refuse\(\)\) return\s*onSendRaw\(/,
    )
    expect(shell).toContain('sendGate={uniworkSendGate}')
    // no entry calls the raw prop around the gate
    expect(shell.match(/onSendRaw\(/g)).toHaveLength(1)
  })

  it('App.tsx handleSend returns false while needModelHint is set (App.tsx cannot be mounted in jsdom)', () => {
    const app = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/App.tsx'),
      'utf8',
    )
    const start = app.indexOf('  function handleSend(')
    expect(start).toBeGreaterThan(-1)
    const body = app.slice(start, app.indexOf('runToolsRef.current = []', start))
    expect(body).toMatch(/if \(needModelHint !== null \|\| !instruction \|\| aiBusy\) return false/)
  })
})
