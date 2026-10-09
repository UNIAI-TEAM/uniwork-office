/**
 * UniWork document seam (sheets): the workbook:save gate in main, the save
 * origin / forced write the renderer sends, and the AutoSave lock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  notifyUniworkUserSave,
  setUniworkDocumentPolicy,
  setUniworkUserSaveHook,
  uniworkSaveDecision,
  type UniworkSaveInput,
} from '../src/main/uniwork-policy'
import {
  handleSave,
  saveOrigin,
  uniworkAutoSaveLocked,
  uniworkForcesWrite,
  type SaveContext,
} from '../src/renderer/save-actions'
import { createEditJournal, recordSetRangeValues } from '../src/renderer/edit-journal'
import { workbookSaveRequestSchema } from '../src/shared/desktop-api'

const DOC = 'C:/Users/u/UniWork/Budget.xlsx'
const VIEW = 'C:/Users/u/UniWork/Readonly.xlsx'
const LOCAL = 'C:/Users/u/Desktop/copy.xlsx'

function installPolicy(): void {
  setUniworkDocumentPolicy({
    isBound: (path) => path === DOC || path === VIEW,
    isReadOnly: (path) => path === VIEW,
  })
}

function decide(over: Partial<UniworkSaveInput>) {
  return uniworkSaveDecision({
    mode: 'save',
    origin: 'user',
    documentPath: DOC,
    targetPath: DOC,
    mcp: false,
    ...over,
  })
}

afterEach(() => {
  setUniworkDocumentPolicy(null)
  setUniworkUserSaveHook(null)
})

describe('uniworkSaveDecision (main workbook:save gate)', () => {
  beforeEach(installPolicy)

  it('an explicit Save to the same path writes and fires the hook exactly once', () => {
    const hook = vi.fn()
    setUniworkUserSaveHook(hook)
    const decision = decide({})
    expect(decision).toEqual({ write: true, fireHook: true })
    if (decision.fireHook) notifyUniworkUserSave(DOC)
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith(DOC)
  })

  it('AutoSave never writes a bound document', () => {
    expect(decide({ origin: 'auto' })).toEqual({ write: false, fireHook: false })
  })

  it('AutoSave of an unbound file writes as before, without the hook', () => {
    expect(decide({ origin: 'auto', documentPath: LOCAL, targetPath: LOCAL })).toEqual({
      write: true,
      fireHook: false,
    })
  })

  it('Save As to another path writes but does not fire', () => {
    expect(decide({ mode: 'save-as', targetPath: LOCAL })).toEqual({
      write: true,
      fireHook: false,
    })
  })

  it('first save of a new / converted workbook does not fire', () => {
    expect(decide({ documentPath: null, targetPath: DOC })).toEqual({
      write: true,
      fireHook: false,
    })
  })

  it('an MCP save-to (even onto the same path) does not fire', () => {
    expect(decide({ mode: 'save-as', origin: undefined, mcp: true })).toEqual({
      write: true,
      fireHook: false,
    })
  })

  it('a request without an origin saves as before and does not fire', () => {
    expect(decide({ origin: undefined })).toEqual({ write: true, fireHook: false })
  })

  it('read-only: Save is refused (no write, no hook)', () => {
    expect(decide({ documentPath: VIEW, targetPath: VIEW })).toEqual({
      write: false,
      fireHook: false,
    })
    // nor can a Save As / MCP write land on it
    expect(decide({ mode: 'save-as', targetPath: VIEW })).toEqual({
      write: false,
      fireHook: false,
    })
    expect(decide({ mode: 'save-as', mcp: true, origin: undefined, targetPath: VIEW }).write).toBe(
      false,
    )
  })

  it('read-only: Save As to a plain local path stays allowed', () => {
    expect(decide({ mode: 'save-as', documentPath: VIEW, targetPath: LOCAL })).toEqual({
      write: true,
      fireHook: false,
    })
  })

  it('a throwing policy reads as a plain local file', () => {
    setUniworkDocumentPolicy({
      isBound: () => {
        throw new Error('boom')
      },
      isReadOnly: () => {
        throw new Error('boom')
      },
    })
    expect(decide({ origin: 'auto' }).write).toBe(true)
  })
})

describe('null policy = unchanged', () => {
  it('every save writes; autosave is not locked', () => {
    expect(decide({ origin: 'auto' }).write).toBe(true)
    expect(decide({ documentPath: VIEW, targetPath: VIEW }).write).toBe(true)
    expect(uniworkAutoSaveLocked({ readOnly: false })).toBe(false)
    expect(uniworkForcesWrite({ readOnly: false })).toBe(false)
  })
})

describe('renderer seam helpers', () => {
  it('quiet saves are AutoSave, others are the user', () => {
    expect(saveOrigin(true)).toBe('auto')
    expect(saveOrigin(false)).toBe('user')
  })

  it('a bound or view-only workbook locks AutoSave', () => {
    expect(uniworkAutoSaveLocked({ readOnly: false, uniworkBound: true })).toBe(true)
    expect(uniworkAutoSaveLocked({ readOnly: true })).toBe(true)
    expect(uniworkAutoSaveLocked(null)).toBe(false)
  })

  it('only a bound, editable workbook forces the write', () => {
    expect(uniworkForcesWrite({ readOnly: false, uniworkBound: true })).toBe(true)
    expect(uniworkForcesWrite({ readOnly: true, uniworkBound: true })).toBe(false)
  })
})

describe('workbookSaveRequestSchema forceWrite / origin', () => {
  const empty = {
    sessionId: '5d4f6f7a-1c2b-4e3d-9a8f-0b1c2d3e4f5a',
    mode: 'save' as const,
    edits: [],
    structuralOps: [],
    chartEdits: [],
    visualEdits: [],
    visualAdditions: [],
    tableAdditions: [],
    pivotAdditions: [],
    sheetOps: [],
    sheetOrder: [],
    filterStates: [],
    hyperlinkEdits: [],
    cfStates: [],
    dvStates: [],
    pageSetupStates: [],
    noteStates: [],
    formulaValues: [],
    pivotCacheRefreshPaths: [],
    pivotRefreshUpdates: [],
    sheetProtections: [],
    sparklineAdditions: [],
    definedNamesState: null,
  }

  it('a clean plain save is still rejected, a forced bound save is accepted', () => {
    expect(() => workbookSaveRequestSchema.parse(empty)).toThrow()
    expect(
      workbookSaveRequestSchema.parse({ ...empty, forceWrite: true, origin: 'user' }).origin,
    ).toBe('user')
  })
})

// ---- renderer handleSave payload ----

const saveWorkbookEdits = vi.fn()
const writeWorkbookRecovery = vi.fn()

function ctxWith(opts: { dirty: boolean; uniworkBound?: boolean; readOnly?: boolean }): {
  ctx: SaveContext
  messages: string[]
} {
  const journal = createEditJournal()
  if (opts.dirty) recordSetRangeValues(journal, 'sheet-1', { 0: { 0: { v: 'edited' } } })
  const messages: string[] = []
  return {
    messages,
    ctx: {
      univerRef: { current: null },
      stashViewRestore: () => {},
      lazyWorkbookRef: {
        current: {
          editJournal: journal,
          recalc: {
            timer: null,
            generation: 0,
            failed: false,
            formulaCells: new Map(),
            overlay: new Map(),
          },
          file: {
            sessionId: '11111111-1111-4111-8111-111111111111',
            readOnly: opts.readOnly === true,
            ...(opts.uniworkBound ? { uniworkBound: true } : {}),
          },
        },
      } as never,
      setMessage: (m: string) => messages.push(m),
      openLazyWorkbook: () => {},
    },
  }
}

describe('handleSave carries the UniWork origin', () => {
  beforeEach(() => {
    saveWorkbookEdits.mockReset().mockResolvedValue({ canceled: true })
    writeWorkbookRecovery.mockReset().mockResolvedValue({ ok: true })
    ;(globalThis as unknown as { window: unknown }).window = {
      desktopApi: { saveWorkbookEdits, writeWorkbookRecovery },
    }
  })

  const payload = () => saveWorkbookEdits.mock.calls[0]![0] as Record<string, unknown>

  it('explicit Save sends origin user', async () => {
    await handleSave(ctxWith({ dirty: true }).ctx, 'save')
    expect(payload().origin).toBe('user')
    expect(payload().forceWrite).toBeUndefined()
  })

  it('AutoSave sends origin auto', async () => {
    await handleSave(ctxWith({ dirty: true }).ctx, 'save', true)
    expect(payload().origin).toBe('auto')
  })

  it('MCP save-to sends no origin', async () => {
    await handleSave(ctxWith({ dirty: true }).ctx, 'save-as', true, {
      path: LOCAL,
      overwrite: false,
    })
    expect(payload()).not.toHaveProperty('origin')
  })

  it('the recovery copy is untouched by the seam', async () => {
    await handleSave(ctxWith({ dirty: true, uniworkBound: true }).ctx, 'recovery')
    expect(writeWorkbookRecovery).toHaveBeenCalledTimes(1)
    expect(writeWorkbookRecovery.mock.calls[0]![0]).not.toHaveProperty('origin')
    expect(saveWorkbookEdits).not.toHaveBeenCalled()
  })

  it('a clean bound workbook still writes on explicit Save', async () => {
    await handleSave(ctxWith({ dirty: false, uniworkBound: true }).ctx, 'save')
    expect(saveWorkbookEdits).toHaveBeenCalledTimes(1)
    expect(payload().forceWrite).toBe(true)
  })

  it('a clean unbound workbook keeps the "nothing to save" short-circuit', async () => {
    await handleSave(ctxWith({ dirty: false }).ctx, 'save')
    expect(saveWorkbookEdits).not.toHaveBeenCalled()
  })

  it('a clean bound workbook is not force-written by AutoSave', async () => {
    await handleSave(ctxWith({ dirty: false, uniworkBound: true }).ctx, 'save', true)
    expect(saveWorkbookEdits).not.toHaveBeenCalled()
  })
})
