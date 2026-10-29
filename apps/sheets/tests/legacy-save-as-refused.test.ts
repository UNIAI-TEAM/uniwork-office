/**
 * A sheets Save As answered with a legacy name (.xls) is refused like docs and slides: nothing is
 * written, no `<name>.xls.xlsx` appears beside the original, and the thrown message is the one the
 * renderer shows as the save-error toast. Driven through the registered `workbook:save` handler;
 * only the sidecar and its package writer are faked.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
const { handlers, views, hooks, userData, saveDialog } = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  views: { nextId: 1, lastId: 0 },
  hooks: { writes: [] as string[] },
  userData: { dir: '' },
  saveDialog: { answer: '' },
}))

vi.mock('electron', () => {
  const webContentsStub = () => ({
    id: (views.lastId = views.nextId++),
    once: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
    isDestroyed: () => false,
    setWindowOpenHandler: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    loadFile: vi.fn(async () => undefined),
  })
  return {
    app: {
      on: vi.fn(),
      whenReady: vi.fn(() => new Promise(() => {})),
      getPath: () => userData.dir,
      getAppPath: () => tmpdir(),
      getSystemLocale: () => 'en-US',
      isPackaged: false,
    },
    BrowserWindow: class {
      static fromWebContents = () => null
      static getAllWindows = () => []
    },
    WebContentsView: class {
      webContents = webContentsStub()
    },
    desktopCapturer: {},
    dialog: {
      showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: saveDialog.answer })),
    },
    Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
    net: {},
    screen: {},
    session: {},
    shell: {},
    systemPreferences: {},
    webContents: { getAllWebContents: () => [], fromId: () => null },
    nativeTheme: { shouldUseDarkColors: false, on: vi.fn() },
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => void handlers.set(channel, handler)),
      on: vi.fn((channel: string, handler: IpcHandler) => void handlers.set(channel, handler)),
      removeHandler: vi.fn(),
    },
  }
})

vi.mock('../src/main/xlsx-sidecar-client', () => ({
  XlsxSidecarClient: class {
    start() {}
    onProcessExit() {}
    async open(path: string) {
      return {
        sessionId: '00000000-0000-4000-8000-000000000001',
        name: path.split(/[\\/]/).pop(),
        path,
        entryCount: 1,
        sheets: [
          {
            id: 'sheet-1',
            name: 'Sheet1',
            rowCount: 10,
            columnCount: 5,
            columnWidths: [],
            defaultRowHeight: null,
            defaultColumnWidth: null,
            freeze: null,
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
      }
    }
    async close() {}
  },
}))

// the package writer records where the workbook bytes would land
vi.mock('@genoffice/xlsx-gateway/gateway/xlsx-package-io', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveWorkbookViaSidecar: vi.fn(async (input: { targetPath: string }) => {
    hooks.writes.push(input.targetPath)
    mkdirSync(dirname(input.targetPath), { recursive: true })
    writeFileSync(input.targetPath, 'workbook plaintext')
    return { ok: true }
  }),
}))

import { setUiLang } from '@genoffice/i18n'
import { createSheetsView } from '../src/main/sheets-main'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'
import { workbookSaveRequestSchema } from '../src/shared/desktop-api'

const SESSION = '00000000-0000-4000-8000-000000000001'
let dir = ''

afterEach(() => {
  hooks.writes.length = 0
  if (dir) rmSync(dir, { recursive: true, force: true })
})

function saveAsRequest() {
  return workbookSaveRequestSchema.parse({
    sessionId: SESSION,
    mode: 'save-as',
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
    protectedRangeStates: [],
  })
}

async function openedWorkbook() {
  dir = mkdtempSync(join(tmpdir(), 'sheets-legacy-save-as-'))
  userData.dir = join(dir, 'userData')
  const file = join(dir, 'Budget.xlsx')
  writeFileSync(file, 'PK\u0003\u0004')
  createSheetsView({ includeAiHandlers: false })
  const event = { sender: { id: views.lastId, isDestroyed: () => false } }
  await handlers.get(IPC_CHANNELS.reopenWorkbook)!(event, file)
  return event
}

describe('sheets Save As answered with a legacy name', () => {
  it('refuses a .xls answer: nothing is written, nothing is retargeted to <name>.xls.xlsx', async () => {
    const event = await openedWorkbook()
    setUiLang('en')
    saveDialog.answer = join(dir, 'Original.xls')
    writeFileSync(`${saveDialog.answer}.xlsx`, 'someone else')

    await expect(handlers.get(IPC_CHANNELS.saveWorkbook)!(event, saveAsRequest())).rejects.toThrow(
      /Save it as a \.xlsx file/,
    )

    expect(hooks.writes).toEqual([])
    expect(existsSync(saveDialog.answer)).toBe(false)
  })

  it('still writes an .xlsx answer, and appends the extension to a bare name', async () => {
    const event = await openedWorkbook()
    saveDialog.answer = join(dir, 'Copy.xlsx')
    await handlers.get(IPC_CHANNELS.saveWorkbook)!(event, saveAsRequest())
    saveDialog.answer = join(dir, 'Bare')
    await handlers.get(IPC_CHANNELS.saveWorkbook)!(event, saveAsRequest())

    expect(hooks.writes).toEqual([join(dir, 'Copy.xlsx'), join(dir, 'Bare.xlsx')])
  })
})
