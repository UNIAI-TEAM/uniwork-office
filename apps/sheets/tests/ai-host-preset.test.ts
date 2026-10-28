// @vitest-environment jsdom
// UNI-2264: the shell runs a preset from outside (the desktop shell's, or the job a web host hands
// over with `ai.start`) once the workbook has opened, word for word and only once; one that cannot be
// sent now waits in the composer.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { AiChatPanel, type AiChatMessage } from '../src/renderer/ai/AiChatPanel'
import { resetForTest } from '../src/renderer/capabilities'
import { ExcelShell } from '../src/renderer/ExcelShell'
import { LocaleProvider } from '../src/renderer/i18n/locale'

const JOB = 'Build this workbook from the job:  Plan\n- Goals'
const noop = () => {}

/** the shell's required props (as in web-capabilities.test.ts), AI hidden so no panel gate applies */
const baseProps = {
  openingWorkbook: false,
  prompt: '',
  preview: null,
  selectionFormat: null,
  formatPainterActive: false,
  sheetHasContent: true,
  aiBusy: false,
  chat: [],
  attachments: [],
  attachNotice: null,
  onPickAttachments: noop,
  onAddAttachmentPaths: noop,
  onAddPastedImage: noop,
  onRemoveAttachment: noop,
  onPromptChange: noop,
  onSend: noop,
  onStop: noop,
  onNewChat: noop,
  onUndo: noop,
  aiScopeRange: null,
  aiScopeColumns: null,
  aiScopeLocked: false,
  aiSelectionAskAnchor: null,
  onAiSelectionAskDismiss: noop,
  onAiScopeDismiss: noop,
  onAiCitation: noop,
  onCommand: noop,
  onIsCellEditing: () => false,
  statusMessage: 'Ready',
  emptyCsvNotice: false,
  onOpenWorkbook: noop,
  onDismissEmptyCsvNotice: noop,
  zoomPercent: 100,
  statusBarFuncs: [] as const,
  onToggleStatusBarFunc: noop,
  canSave: false,
  onSave: noop,
  canSaveAs: true,
  onSaveAs: noop,
  onRedo: noop,
  canUndo: false,
  canRedo: false,
  autoSave: false,
  onAutoSaveChange: noop,
  aiViewOnly: false,
  selectedChart: null,
  selectedShape: null,
  selectedVisualKind: null,
  selectedTable: null,
  outlineSummary: { below: true, right: true },
  tableCreatedSeq: 0,
  onGetCreateTableRange: () => 'A1:B2',
  onGetSortColumns: () => [],
  onGetSheetProtection: () => null,
  onProtectSheet: async () => null,
  onUnprotectSheet: async () => null,
  sheetTabActions: null,
  onGetWorkbookProtection: () => null,
  formulaBarVisible: true,
  crossHighlightVisible: false,
  onGetProtectedRanges: () => ({ ranges: [], error: null }),
  onApplyProtectedRanges: () => null,
  onGetDefinedNames: () => ({ names: [], sheets: [], activeSheetId: 's1' }),
  onDefinedNameAction: () => null,
  onGetPivotFields: () => [],
  onGetSourceRange: () => 'A1:B2',
  onCreatePivot: () => null,
  onGetPivotEditSeed: () => null,
  onEditPivot: () => null,
  onGetPivotFieldMembers: () => [],
  pivotSelectionKey: null,
  onRefreshPivot: () => null,
  onIsSelectionInPivot: () => false,
  onGetActiveCell: () => 'A1',
  onGetAnchorValue: () => null,
  activeCellA1: 'A1',
  onGoToReference: () => null,
  onListDefinedNames: () => [],
  onReadPasteSpecialSource: async () => ({ kind: 'none' as const }),
  onPasteSpecial: async () => null,
  functionArguments: {
    readTarget: async () => null,
    write: () => null,
    evaluate: async () => [],
    observeRangePick: () => noop,
    cancel: noop,
  },
  onListFunctions: () => [],
  onCreateSubtotal: () => null,
  onCreateConsolidate: () => null,
  onGetConsolidateDefault: () => '',
  onApplyHeaderFooter: () => null,
  printHost: null,
  onClosePrint: noop,
  pageLayout: {
    showGridlines: true,
    showHeadings: true,
    rightToLeft: false,
  },
  calcManual: false,
  onGoalSeek: async () => ({
    found: false,
    reached: 0,
    solution: 0,
    iterations: 0,
  }),
  onFillSeries: () => null,
  onGetFillSeriesContext: () => ({
    singleCell: true,
    direction: 'columns' as const,
    date1904: false,
  }),
}

describe('ExcelShell: a preset from outside', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  beforeAll(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    root = null
    container?.remove()
    container = null
    Object.assign(window, { desktopApi: undefined })
    resetForTest()
  })

  function mount() {
    Object.assign(window, {
      desktopApi: { onLanguageChanged: () => () => undefined, capabilities: { ai: false } },
    })
    resetForTest()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const sends: unknown[][] = []
    const prompts: string[] = []
    let answer = true
    const render = async (props: Record<string, unknown>) => {
      await act(async () => {
        root!.render(
          createElement(LocaleProvider, {
            initial: 'en',
            children: createElement(ExcelShell, {
              ...baseProps,
              onSend: (...args: unknown[]) => {
                sends.push(args)
                return answer
              },
              onPromptChange: (p: string) => prompts.push(p),
              ...props,
            } as never),
          }),
        )
      })
    }
    const wait = async (ms: number) => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, ms))
      })
    }
    return {
      render,
      wait,
      sends,
      prompts,
      refuse: () => {
        answer = false
      },
    }
  }

  it('waits while the workbook opens, then sends the text once with its display words', async () => {
    const shell = mount()
    const aiPreset = { text: JOB, nonce: 3, autoRun: true, displayText: 'Build it' }
    await shell.render({ openingWorkbook: true, aiPreset })
    await shell.wait(200)
    expect(shell.sends).toEqual([])
    await shell.render({ openingWorkbook: false, aiPreset })
    await shell.wait(200)
    expect(shell.sends).toEqual([[JOB, undefined, undefined, 'Build it']])
    // the same preset again (another open, a re-render) never sends twice
    await shell.render({ openingWorkbook: true, aiPreset })
    await shell.render({ openingWorkbook: false, aiPreset })
    await shell.wait(200)
    expect(shell.sends).toHaveLength(1)
    expect(shell.prompts).toEqual([])
  })

  it('a preset the send refuses waits in the composer, word for word', async () => {
    const shell = mount()
    shell.refuse()
    await shell.render({ aiPreset: { text: JOB, nonce: 4, autoRun: true } })
    await shell.wait(200)
    expect(shell.sends).toHaveLength(1)
    expect(shell.prompts).toEqual([JOB])
  })
})

describe('AiChatPanel: Retry of a bubble that shows other words than it sent', () => {
  let root: Root | null = null
  let container: HTMLElement | null = null

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    root = null
    container?.remove()
    container = null
    Object.assign(window, { desktopApi: undefined })
  })

  it('sends the sent text again and keeps the bubble words', async () => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollTo ??= () => {}
    Object.assign(window, {
      desktopApi: new Proxy(
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
    })
    const chat: AiChatMessage[] = [
      { role: 'user', text: 'Build it', instruction: JOB, tools: [], undelivered: true },
      { role: 'assistant', text: 'network down', tools: [], isError: true },
    ]
    const sends: unknown[][] = []
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
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
            onPickAttachments: noop,
            onAddAttachmentPaths: noop,
            onAddPastedImage: noop,
            onRemoveAttachment: noop,
            prompt: '',
            preview: null,
            aiBusy: false,
            onPromptChange: noop,
            onSend: (...args: unknown[]) => {
              sends.push(args)
            },
            onStop: noop,
            onNewChat: noop,
            onUndo: noop,
            scopeRange: null,
            scopeColumns: null,
            scopeLocked: false,
            onScopeDismiss: noop,
            onCitation: noop,
            onExpand: noop,
            onCollapse: noop,
          } as never),
        ),
      )
    })
    const retry = container.querySelector<HTMLButtonElement>('.ai-msg-undelivered .ai-retry-btn')!
    await act(async () => retry.click())
    expect(sends).toEqual([[JOB, [], 0, 'Build it']])
  })
})
