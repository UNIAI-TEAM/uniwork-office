// @vitest-environment jsdom
// UNI-1016: renderer-side capability gating and the web engine's typed failure.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { cap, isViewOnly, platform, resetForTest } from '../src/renderer/capabilities'
import { ENGINE_UNAVAILABLE, isEngineUnavailableError } from '../src/renderer/web-engine'
import { ExcelShell } from '../src/renderer/ExcelShell'
import { LocaleProvider } from '../src/renderer/i18n/locale'

function installDesktopApi(capabilities?: Record<string, unknown>): void {
  Object.assign(window, {
    desktopApi: {
      onLanguageChanged: () => () => undefined,
      ...(capabilities === undefined ? {} : { capabilities }),
    },
  })
  resetForTest()
}

afterEach(() => {
  Object.assign(window, { desktopApi: undefined })
  resetForTest()
})

describe('cap()', () => {
  it('desktop (no capability object): everything stays on, not view-only', () => {
    installDesktopApi()
    expect(cap('ai')).toBe(true)
    expect(cap('xlsxEngine')).toBe(true)
    expect(cap('recalcFallback')).toBe(true)
    expect(isViewOnly()).toBe(false)
    expect(platform()).toBeUndefined()
  })

  it('web frame: explicit false hides, host grants assigned later are seen', () => {
    const caps: Record<string, unknown> = {
      platform: 'web',
      ai: false,
      save: false,
      xlsxEngine: false,
    }
    installDesktopApi(caps)
    expect(platform()).toBe('web')
    expect(cap('ai')).toBe(false)
    expect(cap('xlsxEngine')).toBe(false)
    expect(isViewOnly()).toBe(true)
    // the bridge assigns the host grants into the same object after `init`
    caps.save = true
    expect(isViewOnly()).toBe(false)
  })
})

describe('isEngineUnavailableError', () => {
  it('matches the code on an error object or the message prefix, nothing else', () => {
    expect(isEngineUnavailableError({ code: ENGINE_UNAVAILABLE })).toBe(true)
    expect(isEngineUnavailableError(new Error(`${ENGINE_UNAVAILABLE}: open`))).toBe(true)
    expect(isEngineUnavailableError(new Error('XLSX sidecar failed to start'))).toBe(false)
    expect(isEngineUnavailableError(null)).toBe(false)
  })
})

describe('ExcelShell view-only ribbon (UNI-1876 SVF-1)', () => {
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
  })

  const noop = () => {}
  const shellProps = (aiViewOnly: boolean, onCommand: (command: string) => void = noop) => ({
    openingWorkbook: false,
    prompt: '',
    preview: null,
    selectionFormat: null,
    formatPainterActive: false,
    sheetHasContent: true,
    aiBusy: false,
    spellcheckOn: true,
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
    onCommand,
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
    aiViewOnly,
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
    passwordProtected: false,
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
    onDataTable: async () => ({ kind: 'column' as const, cells: 0 }),
    onGetDataTableRange: () => '',
    onFillSeries: () => null,
    onGetFillSeriesContext: () => ({
      singleCell: true,
      direction: 'columns' as const,
      date1904: false,
    }),
  })

  async function renderShell(
    caps: Record<string, unknown>,
    aiViewOnly = false,
    onCommand?: (command: string) => void,
  ): Promise<HTMLElement> {
    installDesktopApi(caps)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        createElement(LocaleProvider, {
          initial: 'en',
          children: createElement(ExcelShell, shellProps(aiViewOnly, onCommand)),
        }),
      )
    })
    return container
  }

  it('shows only the View tab and hides edit ribbon tabs when the web frame withholds save', async () => {
    const el = await renderShell({ platform: 'web', ai: false, save: false, saveAs: true })
    const tabs = [...el.querySelectorAll('.ribbon-tab')].map((b) => b.textContent)
    expect(tabs).toEqual(['View'])
    expect(el.textContent).not.toContain('Paste')
    expect(el.textContent).toContain('Normal')
  })

  it('shows only the View tab on a view-only UniWork workbook (aiViewOnly)', async () => {
    const el = await renderShell({ ai: false }, true)
    const tabs = [...el.querySelectorAll('.ribbon-tab')].map((b) => b.textContent)
    expect(tabs).toEqual(['View'])
    expect(el.textContent).not.toContain('Paste')
  })

  it('view-only View tab keeps Find and it opens the find panel (UNI-1876 RFW4-3)', async () => {
    const commands: string[] = []
    const el = await renderShell(
      { platform: 'web', ai: false, save: false, saveAs: true },
      false,
      (c) => commands.push(c),
    )
    expect([...el.querySelectorAll('.ribbon-tab')].map((b) => b.textContent)).toEqual(['View'])
    const editing = [...el.querySelectorAll('.ribbon-group')].find(
      (g) => g.getAttribute('aria-label') === 'Editing',
    )
    const find = editing?.querySelector('button.labeled') as HTMLButtonElement | null
    expect(find?.textContent).toContain('Find')
    await act(async () => {
      find!.click()
    })
    expect(commands).toEqual(['find'])
  })
})
