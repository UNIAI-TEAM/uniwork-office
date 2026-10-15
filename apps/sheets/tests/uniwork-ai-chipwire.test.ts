// @vitest-environment jsdom
// UniWork AI result chip wiring in the Sheets panel (G6-05u visual r1 F1, F2, F3, F5, F6, F11): an error
// turn offers its labelled action, the announcement is the line on screen, dropped calls read Chưa hỗ
// trợ, the chip opens the answer paragraph and the edited hint shows one platform shortcut.
import { aiUniworkText } from '@genoffice/ui'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { AiChatPanel, type AiChatMessage } from '../src/renderer/ai/AiChatPanel'
import { LocaleProvider } from '../src/renderer/i18n/locale'

const ui = (key: Parameters<typeof aiUniworkText>[1], params?: Record<string, string | number>) =>
  aiUniworkText('vi', key, params)

describe('UniWork AI chip wiring (sheets panel)', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null
  let desktopApi: Record<string, ReturnType<typeof vi.fn>> = {}
  const onSend = vi.fn()

  beforeAll(() => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollTo ??= () => {}
  })
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    root = null
    container = null
    onSend.mockReset()
    vi.unstubAllGlobals()
  })

  const user: AiChatMessage = { role: 'user', text: 'sum column B', tools: [] }
  const mount = async (chat: readonly AiChatMessage[]): Promise<HTMLElement> => {
    desktopApi = {}
    vi.stubGlobal(
      'desktopApi',
      new Proxy(desktopApi, {
        get: (target, prop: string) => {
          if (!(prop in target)) {
            target[prop] =
              prop === 'getAiSettings'
                ? vi.fn(() => Promise.resolve({ provider: 'uniwork', providers: {} }))
                : /^on[A-Z]/.test(prop)
                  ? vi.fn(() => () => {})
                  : vi.fn(() => Promise.resolve(undefined))
          }
          return target[prop]
        },
      }),
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
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
            prompt: '',
            preview: null,
            aiBusy: false,
            onPromptChange: () => {},
            onSend,
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
      )
      await Promise.resolve()
    })
    return container
  }
  const errorTurn = (text: string): readonly AiChatMessage[] => [
    user,
    { role: 'assistant', text, tools: [], isError: true, streaming: false },
  ]

  it.each([
    ['aiErrCredits', 'aiRunChooseOther'],
    ['aiErrSession', 'acctSignInAgain'],
    ['aiErrUnavailable', 'aiRunRetry'],
    ['aiErrRunLimit', 'aiRunAskAgain'],
  ] as const)(
    'F1/F2/F11: a %s error turn shows its labelled action and announces the line it shows',
    async (errKey, actionKey) => {
      const c = await mount(errorTurn(ui(errKey)))
      expect(c.querySelector('.ai-result-chip')?.textContent).toBe(ui('aiResultError'))
      expect(
        [...c.querySelectorAll<HTMLButtonElement>('.ai-error-action button')].map(
          (b) => b.textContent,
        ),
      ).toEqual([ui(actionKey)])
      expect(c.querySelector('.ai-sr-status')?.textContent).toBe(
        `${ui('aiResultError')}. ${ui(errKey)}`,
      )
      const copy = c.querySelector('.ai-msg-answer .ai-md p')!.cloneNode(true) as HTMLElement
      copy.querySelectorAll('.ai-result-chip, .ai-result-chip-sep').forEach((n) => n.remove())
      expect(copy.textContent?.trim()).toBe(ui(errKey))
    },
  )

  it('F1: a generic error offers no action', async () => {
    const c = await mount(errorTurn('weird provider text'))
    expect(c.querySelector('.ai-error-action')).toBeNull()
  })

  it('F1: Thử lại sends the question again, Chọn nhà cung cấp khác opens the model settings', async () => {
    const c = await mount(errorTurn(ui('aiErrUnavailable')))
    // a send entry refuses until the UniWork disclosure is acknowledged (S8)
    const ack = c.querySelector<HTMLButtonElement>('[role="region"] button')
    if (ack) await act(async () => ack.click())
    await act(async () => c.querySelector<HTMLButtonElement>('.ai-error-action button')!.click())
    expect(onSend).toHaveBeenCalledWith('sum column B', [], 0)
    act(() => root!.unmount())
    container!.remove()
    const c2 = await mount(errorTurn(ui('aiErrCredits')))
    await act(async () => c2.querySelector<HTMLButtonElement>('.ai-error-action button')!.click())
    expect(desktopApi.openAiSettings).toHaveBeenCalled()
  })

  it('F3: dropped calls on the turn read Chưa hỗ trợ with their reason', async () => {
    const c = await mount([
      user,
      {
        role: 'assistant',
        text: '',
        tools: [],
        streaming: false,
        droppedToolCalls: [{ name: 'edit', reason: 'view_only', module: 'Sheets' }],
      },
    ])
    expect(c.querySelector('.ai-result-chip')?.getAttribute('data-chip')).toBe('unsupported')
    expect(c.querySelector('.ai-result-chip')?.textContent).toBe(ui('aiResultUnsupported'))
    expect(c.querySelector('.ai-sr-status')?.textContent).toBe(
      `${ui('aiResultUnsupported')}. ${ui('aiErrViewOnlyEdit')}`,
    )
    act(() => root!.unmount())
    container!.remove()
    const c2 = await mount([
      user,
      {
        role: 'assistant',
        text: '',
        tools: [],
        streaming: false,
        droppedToolCalls: [{ name: 'x', reason: 'not_allowlisted', module: 'Sheets' }],
      },
    ])
    expect(c2.querySelector('.ai-sr-status')?.textContent).toBe(
      `${ui('aiResultUnsupported')}. ${ui('aiErrUnsupported', { module: 'Sheets' })}`,
    )
  })

  it('F6: the chip is the first word of the answer paragraph, in the same node as the text', async () => {
    const c = await mount([
      user,
      { role: 'assistant', text: 'Tổng cột B là 12.', tools: [], streaming: false },
    ])
    const chip = c.querySelector('.ai-result-chip')!
    const paragraph = chip.parentElement!
    expect(paragraph.tagName).toBe('P')
    expect(paragraph.textContent!.startsWith(ui('aiResultAnswer'))).toBe(true)
    expect(paragraph.textContent).toContain('Tổng cột B là 12.')
  })

  it('F5: the edited hint shows one shortcut, never Ctrl/Ctrl+Z', async () => {
    const c = await mount([
      user,
      {
        role: 'assistant',
        text: 'Đã cập nhật 12 ô.',
        tools: [
          { name: 'propose_operations', summary: 'Wrote 12 cells in Sheet1!B4:C9', isError: false },
        ],
        streaming: false,
        autoApplied: { opCount: 12, undoSteps: 1 },
      },
    ])
    const hint = c.querySelector('.ai-result-edited-hint')?.textContent
    expect(hint).not.toContain('Ctrl/')
    expect(hint).toBe('Chưa lưu — hoàn tác bằng Ctrl+Z hoặc bấm Lưu khi đã ổn.')
  })
})
