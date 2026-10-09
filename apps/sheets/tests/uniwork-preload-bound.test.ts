/**
 * UniWork seam (sheets): the preload rebuilds every WorkbookFile field by field,
 * so a flag it does not name never reaches the renderer. `uniworkBound` is what
 * makes an explicit Save of a clean bound workbook write (the chip's Retry), and
 * it has to survive both the open result and the post-save result the renderer
 * reopens from.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

const SESSION = '3f2b8c1e-5d4a-4e6b-9a7c-1b2d3e4f5a6b'

const bridge = vi.hoisted(() => ({
  api: undefined as Record<string, (...args: unknown[]) => Promise<unknown>> | undefined,
  reply: undefined as unknown,
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, value: unknown) => {
      if (name === 'desktopApi') bridge.api = value as typeof bridge.api
    },
  },
  ipcRenderer: {
    invoke: async () => bridge.reply,
    on: () => undefined,
    send: () => undefined,
    removeListener: () => undefined,
  },
  webUtils: { getPathForFile: () => '' },
}))
vi.mock('@genoffice/electron-utils/drop-open', () => ({ installDropOpenBridge: () => undefined }))

function wireFile(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    sessionId: SESSION,
    name: 'budget.xlsx',
    path: 'C:/Users/u/UniWork/budget.xlsx',
    sha256: 'a'.repeat(64),
    fileBytes: 1024,
    entryCount: 1,
    sheets: [
      {
        id: 'sheet-1',
        name: 'Sheet1',
        rowCount: 10,
        columnCount: 5,
        columnWidths: [],
        hidden: false,
        tabColor: null,
        showGridLines: true,
        tables: [],
        comments: [],
        pivotRanges: [],
      },
    ],
    styles: [],
    dxfStyles: [],
    visuals: [],
    definedNames: [],
    readOnly: false,
    ...extra,
  }
}

function saveRequest(): Record<string, unknown> {
  return {
    sessionId: SESSION,
    mode: 'save',
    forceWrite: true,
    origin: 'user',
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
    pivotCacheRefreshPaths: [],
    pivotRefreshUpdates: [],
    sheetProtections: [],
    definedNamesState: null,
    themeState: null,
    workbookProtectionState: null,
    protectedRangeStates: [],
  }
}

function call(method: string, ...args: unknown[]): Promise<unknown> {
  const fn = bridge.api?.[method]
  if (!fn) throw new Error(`desktopApi.${method} is not exposed`)
  return fn(...args)
}

beforeAll(async () => {
  await import('../src/preload/index')
})

describe('preload keeps uniworkBound on a workbook file', () => {
  it('open result of a bound workbook', async () => {
    bridge.reply = wireFile({ uniworkBound: true })
    const file = (await call('reopenWorkbook', 'C:/Users/u/UniWork/budget.xlsx')) as {
      uniworkBound?: boolean
    }
    expect(file.uniworkBound).toBe(true)
  })

  it('save result of a bound workbook (the file the renderer reopens from)', async () => {
    bridge.reply = { canceled: false, touchedEntries: [], file: wireFile({ uniworkBound: true }) }
    const result = (await call('saveWorkbookEdits', saveRequest())) as {
      file: { uniworkBound?: boolean }
    }
    expect(result.file.uniworkBound).toBe(true)
  })

  it('an unbound workbook stays unflagged', async () => {
    bridge.reply = wireFile({})
    const file = (await call('reopenWorkbook', 'C:/Users/u/Desktop/copy.xlsx')) as object
    expect('uniworkBound' in file).toBe(false)
  })

  it('rejects a non-boolean flag', async () => {
    bridge.reply = wireFile({ uniworkBound: 'yes' })
    await expect(call('reopenWorkbook', 'C:/Users/u/UniWork/budget.xlsx')).rejects.toThrow(
      'Invalid workbook response.',
    )
  })
})
