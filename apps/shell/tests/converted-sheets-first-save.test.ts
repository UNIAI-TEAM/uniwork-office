/**
 * R1-1 / R1-7 / R1-19 on the real registered Sheets handlers.
 * R1-19: the first Save to UniWork of a converted legacy .xls, through the real registered Sheets
 * save handler and the installed user-save wrapper (withSourceViews), with the clean payload the
 * renderer sends. Only the sidecar and its package writer are faked. The converted copy is an
 * unsaved-new workbook: the flush must write it in place without a dialog (the electron `dialog`
 * is empty, so any chooser would throw) and complete the first-save hook exactly once.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
const { handlers, views, hooks, userData } = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  views: { nextId: 1, lastId: 0, last: null as unknown },
  hooks: {
    duringWrite: null as null | (() => void),
    picked: '',
    savePicked: null as string | null,
    opened: [] as string[],
    converted: [] as string[],
    sent: [] as Array<{ channel: string; payload: unknown }>,
    dialogOptions: [] as Array<{ filters?: Array<{ extensions: string[] }> }>,
  },
  userData: { dir: '' },
}))

vi.mock('electron', () => {
  const webContentsStub = () =>
    (views.last = {
      id: (views.lastId = views.nextId++),
      once: vi.fn(),
      on: vi.fn(),
      send: vi.fn(
        (channel: string, payload: unknown) => void hooks.sent.push({ channel, payload }),
      ),
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
      showOpenDialog: vi.fn(async (...args: unknown[]) => {
        const opts = (args.length > 1 ? args[1] : args[0]) as {
          filters?: Array<{ extensions: string[] }>
        }
        hooks.dialogOptions.push(opts)
        return { canceled: false, filePaths: hooks.picked ? [hooks.picked] : [] }
      }),
      showSaveDialog: vi.fn(async () => {
        if (hooks.savePicked === null) throw new Error('unexpected showSaveDialog')
        return { canceled: !hooks.savePicked, filePath: hooks.savePicked }
      }),
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

vi.mock('../../sheets/src/main/xlsx-sidecar-client', () => ({
  XlsxSidecarClient: class {
    start() {}
    onProcessExit() {}
    async convertWorkbook(request: unknown) {
      hooks.converted.push(JSON.stringify(request))
      throw new Error('values-only conversion reached')
    }
    async open(path: string) {
      hooks.opened.push(path)
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
    writeFileSync(input.targetPath, 'saved in place')
    return { ok: true }
  }),
}))

import {
  createSheetsView,
  markSheetsUnsavedNew,
  queueWorkbookForView,
  setSheetsLegacyOpenHook,
  setSheetsUserSaveHook,
  setUniworkDocumentPolicy,
  sheetsFileRenamed,
} from '../../sheets/src/main/sheets-main'
import { setUiLang } from '@genoffice/i18n'
import { IPC_CHANNELS } from '../../sheets/src/shared/ipc-channels'
import { workbookSaveRequestSchema } from '../../sheets/src/shared/desktop-api'
import { handleSave } from '../../sheets/src/renderer/save-actions'
import { createEditJournal } from '../../sheets/src/renderer/edit-journal'
import { SourceViewRegistry, withSourceViews } from '../src/main/uniwork-docs/source-view'

const SESSION = '00000000-0000-4000-8000-000000000001'
let dir = ''

afterEach(() => {
  setSheetsUserSaveHook(null)
  setSheetsLegacyOpenHook(null)
  setUniworkDocumentPolicy(null)
  hooks.savePicked = null
  hooks.opened.length = 0
  hooks.converted.length = 0
  hooks.sent.length = 0
  hooks.dialogOptions.length = 0
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/** the request the real renderer sends for the untouched converted workbook's Save */
async function flushRequest(inPlace: boolean) {
  const send = vi.fn(async () => ({ canceled: true }))
  ;(globalThis as unknown as { window: unknown }).window = {
    desktopApi: { saveWorkbookEdits: send },
  }
  await handleSave(
    {
      univerRef: { current: null },
      stashViewRestore: () => {},
      lazyWorkbookRef: {
        current: {
          editJournal: createEditJournal(),
          recalc: {
            timer: null,
            generation: 0,
            failed: false,
            formulaCells: new Map(),
            overlay: new Map(),
          },
          file: { sessionId: SESSION, unsavedNew: true, needsSaveAs: true, readOnly: false },
        },
      } as never,
      setMessage: () => {},
      openLazyWorkbook: () => {},
    },
    'save',
    false,
    undefined,
    inPlace,
  )
  return workbookSaveRequestSchema.parse((send.mock.calls[0] as unknown[])[0])
}

async function openedConverted() {
  dir = mkdtempSync(join(tmpdir(), 'sheets-converted-first-save-'))
  userData.dir = join(dir, 'userData')
  const tempDir = join(dir, 'genoffice-imports', 'u1')
  mkdirSync(tempDir, { recursive: true })
  const tempPath = join(tempDir, 'Budget.xlsx')
  writeFileSync(tempPath, 'PK\u0003\u0004 converted')
  markSheetsUnsavedNew(tempPath, join(dir, 'Budget.xlsx'), tempDir)
  createSheetsView({ includeAiHandlers: false })
  const event = { sender: views.last as never }
  await handlers.get(IPC_CHANNELS.reopenWorkbook)!(event, tempPath)
  return { event, tempPath }
}

describe('the first Save to UniWork of a converted .xls', () => {
  it('writes the temp copy in place, no dialog, and completes the hook once through the installed wrapper', async () => {
    const onUserSave = vi.fn()
    const seam = withSourceViews({ onUserSave } as never, new SourceViewRegistry())
    setSheetsUserSaveHook((path) => seam.onUserSave(path))
    const { event, tempPath } = await openedConverted()

    const res = (await handlers.get(IPC_CHANNELS.saveWorkbook)!(
      event,
      await flushRequest(true),
    )) as {
      canceled: boolean
    }

    expect(res.canceled).toBe(false)
    expect(readFileSync(tempPath, 'utf8')).toBe('saved in place')
    expect(onUserSave).toHaveBeenCalledExactlyOnceWith(tempPath)
    // the original is never offered a write, and no chooser opened
    expect(existsSync(join(dir, 'Budget.xlsx'))).toBe(false)
  })

  it('localizes the Save As refusal message when a legacy or OpenDocument name is picked (ODF-V1)', async () => {
    const { event, tempPath } = await openedConverted()
    const odsAnswer = join(dir, 'Budget.ods')
    hooks.savePicked = odsAnswer
    const req = { ...(await flushRequest(true)), mode: 'save-as' as const }
    try {
      setUiLang('en')
      await expect(handlers.get(IPC_CHANNELS.saveWorkbook)!(event, req)).rejects.toThrow(
        "Save it as a .xlsx file. This app can't save in the original file's format.",
      )

      setUiLang('vi')
      await expect(handlers.get(IPC_CHANNELS.saveWorkbook)!(event, req)).rejects.toThrow(
        'Hãy lưu thành tệp .xlsx. Ứng dụng không lưu được ở định dạng của tệp gốc.',
      )
    } finally {
      setUiLang('zh')
    }
    expect(existsSync(odsAnswer)).toBe(false)
    expect(readFileSync(tempPath, 'utf8')).toBe('PK\u0003\u0004 converted')
  })

  it('uses .xlsm in the localized Save As refusal for a macro-enabled workbook (ODF-V1)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sheets-converted-xlsm-save-'))
    userData.dir = join(dir, 'userData')
    const tempDir = join(dir, 'genoffice-imports', 'u1')
    mkdirSync(tempDir, { recursive: true })
    const tempPath = join(tempDir, 'Macros.xlsm')
    writeFileSync(tempPath, 'PK\u0003\u0004 converted xlsm')
    markSheetsUnsavedNew(tempPath, join(dir, 'Macros.xlsm'), tempDir)
    createSheetsView({ includeAiHandlers: false })
    const event = { sender: views.last as never }
    await handlers.get(IPC_CHANNELS.reopenWorkbook)!(event, tempPath)

    hooks.savePicked = join(dir, 'Macros.ods')
    const req = { ...(await flushRequest(true)), mode: 'save-as' as const }
    try {
      setUiLang('en')
      await expect(handlers.get(IPC_CHANNELS.saveWorkbook)!(event, req)).rejects.toThrow(
        "Save it as a .xlsm file. This app can't save in the original file's format.",
      )

      setUiLang('vi')
      await expect(handlers.get(IPC_CHANNELS.saveWorkbook)!(event, req)).rejects.toThrow(
        'Hãy lưu thành tệp .xlsm. Ứng dụng không lưu được ở định dạng của tệp gốc.',
      )
    } finally {
      setUiLang('zh')
    }
  })
})

describe("Sheets' own File > Open of a legacy .xls (R1-1)", () => {
  async function pick(path: string, taken: boolean | null) {
    dir = mkdtempSync(join(tmpdir(), 'sheets-legacy-pick-'))
    userData.dir = join(dir, 'userData')
    hooks.picked = join(dir, path)
    writeFileSync(hooks.picked, 'PK\u0003\u0004')
    const handedOver: string[] = []
    if (taken !== null) {
      setSheetsLegacyOpenHook((p) => {
        handedOver.push(p)
        return taken
      })
    }
    createSheetsView({ includeAiHandlers: false })
    const event = { sender: views.last as never }
    const result = await Promise.resolve(handlers.get(IPC_CHANNELS.selectWorkbook)!(event)).catch(
      (err: unknown) => err,
    )
    return { result, handedOver }
  }

  it('hands the picked .xls to the shell converter route and opens nothing itself', async () => {
    const { result, handedOver } = await pick('Old.xls', true)

    expect(handedOver).toEqual([hooks.picked])
    expect(result).toBeNull()
    expect(hooks.opened).toEqual([])
  })
  it.each(['Budget.ods', 'Template.ots'])(
    'hands a picked OpenDocument %s to the shell converter route and opens nothing itself',
    async (fileName) => {
      const { result, handedOver } = await pick(fileName, true)

      expect(handedOver).toEqual([hooks.picked])
      expect(result).toBeNull()
      expect(hooks.opened).toEqual([])
    },
  )

  it('without a taker (no shell, or the shell declined) the local open pipeline stays as it was', async () => {
    const declined = await pick('Declined.xls', false)
    expect(declined.handedOver).toEqual([hooks.picked])
    // the local pipeline ran: the values-only converter was asked for this very file
    expect(hooks.converted).toHaveLength(1)
    expect(hooks.converted[0]).toContain('Declined.xls')
  })

  it('an .xlsx pick never goes to the legacy route', async () => {
    const { result, handedOver } = await pick('Plain.xlsx', true)

    expect(handedOver).toEqual([])
    expect(result).not.toBeNull()
    expect(hooks.converted).toEqual([])
    expect(hooks.opened.length).toBe(1)
  })
  it('refuses an .ods pick when the legacy-open hook declines or is absent instead of reaching the sidecar', async () => {
    const declined = await pick('Declined.ods', false)

    expect(declined.handedOver).toEqual([hooks.picked])
    expect(declined.result).toBeInstanceOf(Error)
    expect((declined.result as Error).message).toContain('Unsupported workbook: ods')
    expect(hooks.converted).toEqual([])
    expect(hooks.opened).toEqual([])
  })

  it('refuses .ods/.ots in reopenWorkbook, openEncryptedWorkbook, and openWorkbooksForMerge without opening a sidecar snapshot', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sheets-odf-native-refusal-'))
    userData.dir = join(dir, 'userData')
    const odsPath = join(__dirname, 'fixtures', 'odf', 'native-calc.ods')
    const otsPath = join(dir, 'Template.ots')
    writeFileSync(otsPath, readFileSync(odsPath))
    const handedOver: string[] = []
    setSheetsLegacyOpenHook((p) => {
      handedOver.push(p)
      return true
    })
    createSheetsView({ includeAiHandlers: false })
    const event = { sender: views.last as never }

    await expect(handlers.get(IPC_CHANNELS.reopenWorkbook)!(event, odsPath)).rejects.toThrow(
      'Unsupported workbook: ods',
    )
    await expect(handlers.get(IPC_CHANNELS.reopenWorkbook)!(event, otsPath)).rejects.toThrow(
      'Unsupported workbook: ots',
    )
    await expect(
      handlers.get(IPC_CHANNELS.openEncryptedWorkbook)!(event, {
        path: odsPath,
        password: 'secret',
      }),
    ).rejects.toThrow('Unsupported workbook: ods')
    await expect(
      handlers.get(IPC_CHANNELS.openWorkbooksForMerge)!(event, [odsPath]),
    ).rejects.toThrow('Unsupported merge source: ods')
    await expect(
      handlers.get(IPC_CHANNELS.openWorkbooksForMerge)!(event, [otsPath]),
    ).rejects.toThrow('Unsupported merge source: ots')

    expect(handedOver).toEqual([])
    expect(hooks.converted).toEqual([])
    expect(hooks.opened).toEqual([])
  })

  it('offers .ods/.ots in the File > Open picker but excludes them from the merge-source picker', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sheets-odf-picker-filters-'))
    userData.dir = join(dir, 'userData')
    hooks.picked = ''
    createSheetsView({ includeAiHandlers: false })
    const event = { sender: views.last as never }

    await handlers.get(IPC_CHANNELS.selectWorkbook)!(event)
    await handlers.get(IPC_CHANNELS.selectWorkbooksForMerge)!(event)

    const openExts = hooks.dialogOptions[0]?.filters?.[0]?.extensions ?? []
    const mergeExts = hooks.dialogOptions[1]?.filters?.[0]?.extensions ?? []
    expect(openExts).toEqual(expect.arrayContaining(['xlsx', 'xls', 'ods', 'ots']))
    expect(mergeExts).toEqual(expect.arrayContaining(['xlsx', 'xls', 'csv', 'tsv']))
    expect(mergeExts).not.toContain('ods')
    expect(mergeExts).not.toContain('ots')
  })

  it('hands a queued .ods path to the shell converter hook or refuses before native preparation', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sheets-odf-queued-'))
    userData.dir = join(dir, 'userData')
    const odsPath = join(__dirname, 'fixtures', 'odf', 'native-calc.ods')
    const handedOver: string[] = []
    setSheetsLegacyOpenHook((p) => {
      handedOver.push(p)
      return true
    })
    createSheetsView({ includeAiHandlers: false })
    const wc = views.last as never
    const event = { sender: wc }

    queueWorkbookForView(wc, odsPath)
    await expect(handlers.get(IPC_CHANNELS.selectWorkbook)!(event)).resolves.toBeNull()
    expect(handedOver).toEqual([odsPath])
    expect(hooks.opened).toEqual([])

    setSheetsLegacyOpenHook(null)
    queueWorkbookForView(wc, odsPath)
    await expect(handlers.get(IPC_CHANNELS.selectWorkbook)!(event)).rejects.toThrow(
      'Unsupported workbook: ods',
    )
    expect(hooks.opened).toEqual([])
  })
})

describe('adoption of the bound working copy (R1-7)', () => {
  it('the rename ping carries the working-copy path so the renderer file can follow', async () => {
    const { event, tempPath } = await openedConverted()
    const bound = join(dir, 'uniwork', 'Budget.xlsx')
    setUniworkDocumentPolicy({ isBound: (p) => p === bound, isReadOnly: () => false })

    sheetsFileRenamed(event.sender as never, tempPath, bound)

    expect(hooks.sent).toContainEqual({
      channel: 'uniwork:doc-state-changed',
      payload: { path: tempPath, newPath: bound },
    })
  })
})
