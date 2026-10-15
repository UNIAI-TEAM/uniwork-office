// @vitest-environment jsdom
// G6-09 W6: the assistant message shows where the run wrote and how many cells with data it overwrote,
// next to the existing Undo that reverts the whole run.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { defaultAiSettings } from '@genoffice/ai-provider'
import { AiChatPanel, type AiChatMessage } from '../src/renderer/ai/AiChatPanel'
import { LocaleProvider, type Lang } from '../src/renderer/i18n/locale'

function bridgeProxy(): Record<string, ReturnType<typeof vi.fn>> {
  const stubs: Record<string, ReturnType<typeof vi.fn>> = {}
  return new Proxy(stubs, {
    get(target, prop: string) {
      if (!(prop in target)) {
        target[prop] = /^on[A-Z]/.test(prop)
          ? vi.fn(() => () => {})
          : prop === 'getAiSettings'
            ? vi.fn(async () => defaultAiSettings())
            : vi.fn(async () => undefined)
      }
      return target[prop]
    },
  })
}

const user: AiChatMessage = { role: 'user', text: 'fill it', tools: [] }

function entry(applyFootprint: AiChatMessage['applyFootprint'], undoSteps = 2): AiChatMessage {
  return {
    role: 'assistant',
    text: 'Done.',
    tools: [],
    autoApplied: { opCount: 6, undoSteps },
    applyFootprint,
  }
}

describe('sheets panel: run footprint on the applied message', () => {
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

  async function show(
    last: AiChatMessage,
    lang: Lang = 'en',
    onUndo: (steps: number) => void = () => {},
  ): Promise<HTMLElement> {
    vi.stubGlobal('desktopApi', bridgeProxy())
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(
          LocaleProvider,
          { initial: lang, children: null },
          createElement(AiChatPanel, {
            isOpen: true,
            hasContent: true,
            chat: [user, last],
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
            onSend: () => {},
            onStop: () => {},
            onNewChat: () => {},
            onUndo,
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
    })
    await act(async () => {})
    return container
  }

  const meta = (c: HTMLElement): string => c.querySelector('.ai-apply-footprint')?.textContent ?? ''

  it('names the range and the overwritten count, and Undo still reverts the whole run', async () => {
    const onUndo = vi.fn()
    const c = await show(
      entry({ ranges: ['A1:B3'], overwritten: 4, overwrittenExact: true }, 3),
      'en',
      onUndo,
    )
    expect(meta(c)).toBe('Range: A1:B3 · Cells with data overwritten: 4')
    ;(c.querySelector('.ai-undo-btn') as HTMLButtonElement).click()
    expect(onUndo).toHaveBeenCalledWith(3)
  })

  it('lists several ranges, capped with +N more', async () => {
    const c = await show(
      entry({
        ranges: ['A1:B3', "'Q3 Budget'!D5", 'F1', 'G2', 'H3'],
        overwritten: 1,
        overwrittenExact: true,
      }),
    )
    expect(meta(c)).toContain("Range: A1:B3, 'Q3 Budget'!D5, F1 +2 more")
  })

  it('a new-cells-only run says plainly that nothing was overwritten', async () => {
    const c = await show(entry({ ranges: ['A1:B3'], overwritten: 0, overwrittenExact: true }))
    expect(meta(c)).toBe('Range: A1:B3 · No existing data overwritten')
  })

  it('a bulk run with an unknown overwrite count is a lower bound, and zero is not claimed', async () => {
    const atLeast = await show(
      entry({ ranges: ['A2:A9'], overwritten: 3, overwrittenExact: false }),
    )
    expect(meta(atLeast)).toBe('Range: A2:A9 · Cells with data overwritten: at least 3')
    act(() => root!.unmount())
    atLeast.remove()
    const unknown = await show(
      entry({ ranges: ['A2:A9'], overwritten: 0, overwrittenExact: false }),
    )
    expect(meta(unknown)).toBe('Range: A2:A9')
  })

  it('reads naturally in Vietnamese', async () => {
    const c = await show(entry({ ranges: ['A1:B3'], overwritten: 4, overwrittenExact: true }), 'vi')
    expect(meta(c)).toBe('Vùng ghi: A1:B3 · Ô có dữ liệu bị ghi đè: 4')
  })

  it('a run without a footprint (merge, read-only) shows the old line only', async () => {
    const c = await show(entry(undefined))
    expect(c.querySelector('.ai-apply-footprint')).toBeNull()
    expect(c.querySelector('.ai-auto-applied')).not.toBeNull()
  })

  it('the visible text carries it (not colour only): the line is plain text inside the message', async () => {
    const c = await show(entry({ ranges: ['A1'], overwritten: 0, overwrittenExact: true }))
    expect(c.querySelector('.ai-apply-footprint')?.getAttribute('aria-hidden')).toBeNull()
  })
})
