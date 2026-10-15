/**
 * G5-11 d2-5 (UNI-1358): the crash-recovery write in flight while the shell's
 * sign-out sweep clears the workbook's recovery copy must not leave the file
 * behind (stale-recovery race). Driven through the registered
 * `writeWorkbookRecovery` handler; only the sidecar and its package writer are
 * faked, and the "sweep" runs the real exported `clearWorkbookRecovery` while
 * the writer is mid-flight.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
const { handlers, views, hooks, userData } = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  views: { nextId: 1, lastId: 0 },
  hooks: { duringWrite: null as null | (() => void) },
  userData: { dir: '' },
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
    dialog: {},
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

// the package writer: lands the workbook bytes at the target, after the
// "sweep" hook had its chance to run while the write is still in flight
vi.mock('@genoffice/xlsx-gateway/gateway/xlsx-package-io', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveWorkbookViaSidecar: vi.fn(async (input: { targetPath: string }) => {
    hooks.duringWrite?.()
    mkdirSync(dirname(input.targetPath), { recursive: true })
    writeFileSync(input.targetPath, 'workbook plaintext')
    return { ok: true }
  }),
}))

import { clearWorkbookRecovery, createSheetsView } from '../src/main/sheets-main'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'
import { workbookSaveRequestSchema } from '../src/shared/desktop-api'

const SESSION = '00000000-0000-4000-8000-000000000001'
let dir = ''

afterEach(() => {
  hooks.duringWrite = null
  if (dir) rmSync(dir, { recursive: true, force: true })
})

function recoveryRequest() {
  return workbookSaveRequestSchema.parse({
    sessionId: SESSION,
    mode: 'save',
    edits: [{ sheetId: 'sheet-1', row: 0, column: 0, writeValue: true, value: 'x' }],
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
  dir = mkdtempSync(join(tmpdir(), 'sheets-recovery-race-'))
  userData.dir = join(dir, 'userData')
  const file = join(dir, 'Budget.xlsx')
  writeFileSync(file, 'PK\u0003\u0004')
  createSheetsView({ includeAiHandlers: false })
  const event = { sender: { id: views.lastId, isDestroyed: () => false } }
  await handlers.get(IPC_CHANNELS.reopenWorkbook)!(event, file)
  return { event, file }
}

describe('a recovery write racing the sign-out sweep (G5-11 d2-5)', () => {
  it('leaves no recovery copy when the copy was cleared while the write was in flight', async () => {
    const { event, file } = await openedWorkbook()
    hooks.duringWrite = () => clearWorkbookRecovery(file)

    const res = await handlers.get(IPC_CHANNELS.writeWorkbookRecovery)!(event, recoveryRequest())

    expect(res).toEqual({ ok: false })
    expect(existsSync(join(userData.dir, 'sheets-autosave'))).toBe(true)
    const leftovers = readdirSync(join(userData.dir, 'sheets-autosave'))
    expect(leftovers).toEqual([])
  })

  it('keeps the recovery copy of a write nothing raced', async () => {
    const { event } = await openedWorkbook()

    const res = await handlers.get(IPC_CHANNELS.writeWorkbookRecovery)!(event, recoveryRequest())

    expect(res).toEqual({ ok: true })
    const names = readdirSync(join(userData.dir, 'sheets-autosave'))
    expect(names).toHaveLength(1)
  })
})
