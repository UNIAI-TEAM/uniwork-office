/**
 * G8-02 (UNI-1397), BE-7: the registered `user:display-name` handler answers
 * for the workbook session the renderer names — opened through the real open
 * IPC, with only the sidecar process faked — and the preload forwards that
 * session id. A bound workbook answers the signed-in display name, a local one
 * "User", and an unknown/stale session "User"; never the OS account name.
 */
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { userInfo, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
const { handlers, views, invoked } = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  views: { nextId: 1, lastId: 0 },
  invoked: [] as unknown[][],
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
      getPath: () => tmpdir(),
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
    contextBridge: { exposeInMainWorld: vi.fn() },
    ipcRenderer: {
      invoke: vi.fn(async (...args: unknown[]) => void invoked.push(args)),
      on: vi.fn(),
      send: vi.fn(),
      removeListener: vi.fn(),
    },
    webUtils: { getPathForFile: () => '' },
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => void handlers.set(channel, handler)),
      on: vi.fn((channel: string, handler: IpcHandler) => void handlers.set(channel, handler)),
      removeHandler: vi.fn(),
    },
  }
})

// the sidecar process: open answers a one-sheet workbook with a fresh session
vi.mock('../src/main/xlsx-sidecar-client', () => ({
  XlsxSidecarClient: class {
    private next = 0
    start() {}
    onProcessExit() {}
    async open(path: string) {
      this.next += 1
      return {
        sessionId: `00000000-0000-4000-8000-00000000000${this.next}`,
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

import { createSheetsView } from '../src/main/sheets-main'
import { setUniworkDocumentPolicy } from '../src/main/uniwork-policy'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'

const NAME = 'Nguyễn An'
const OS_ACCOUNT = userInfo().username

function workbook(dir: string, name: string): string {
  const path = join(dir, name)
  writeFileSync(path, 'PK\u0003\u0004')
  return path
}

afterEach(() => setUniworkDocumentPolicy(null))

describe('user:display-name (registered handler, BE-7)', () => {
  it('answers for the session the renderer names; a stale or unknown session is "User"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sheets-comment-author-'))
    const bound = workbook(dir, 'Budget.xlsx')
    const local = join(dir, 'Budget copy.xlsx')
    copyFileSync(bound, local)
    let signedIn: string | null = NAME
    setUniworkDocumentPolicy({
      isBound: (p) => p === bound,
      isReadOnly: () => false,
      commentAuthor: (p) => (p === bound && signedIn ? signedIn : 'User'),
    })

    createSheetsView({ includeAiHandlers: false })
    const event = { sender: { id: views.lastId, isDestroyed: () => false } }
    const open = handlers.get(IPC_CHANNELS.reopenWorkbook)!
    const author = handlers.get(IPC_CHANNELS.userDisplayName)!

    const boundFile = (await open(event, bound)) as { sessionId: string }
    const localFile = (await open(event, local)) as { sessionId: string }
    expect(author(event, boundFile.sessionId)).toBe(NAME)
    expect(author(event, localFile.sessionId)).toBe('User')
    expect(author(event, 'not-a-session')).toBe('User')
    expect(author(event, undefined)).toBe('User')

    signedIn = null // the session expires while the bound workbook stays open
    expect(author(event, boundFile.sessionId)).toBe('User')
    for (const id of [boundFile.sessionId, localFile.sessionId]) {
      expect(author(event, id)).not.toBe(OS_ACCOUNT)
    }
  })

  it('the preload forwards the renderer session id to the handler', async () => {
    let api: { getUserDisplayName(sessionId?: string): Promise<string> } | undefined
    const { contextBridge } = await import('electron')
    vi.mocked(contextBridge.exposeInMainWorld).mockImplementation((name, value) => {
      if (name === 'desktopApi') api = value as typeof api
    })
    await import('../src/preload/index')
    await api!.getUserDisplayName('session-7')
    expect(invoked.at(-1)).toEqual([IPC_CHANNELS.userDisplayName, 'session-7'])
  })
})

describe('EL-1(b) fix6: sheets:uniwork-state and sheets:uniwork-read-only-save', () => {
  it('answers { bound, readOnly } for the sender workbook path and forwards read-only save only for a path the sender owns', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sheets-uniwork-state-'))
    const bound = workbook(dir, 'Budget.xlsx')
    const other = workbook(dir, 'Other.xlsx')
    let readOnly = true
    const readOnlySaves: string[] = []
    const policy = {
      isBound: (p: string) => p === bound,
      isReadOnly: (p: string) => p === bound && readOnly,
      readOnlySave: (p: string) => void readOnlySaves.push(p),
    }
    setUniworkDocumentPolicy(policy)

    createSheetsView({ includeAiHandlers: false })
    const event = { sender: { id: views.lastId, isDestroyed: () => false } }
    const unknownEvent = { sender: { id: 99999, isDestroyed: () => false } }
    const open = handlers.get(IPC_CHANNELS.reopenWorkbook)!
    const stateHandler = handlers.get('sheets:uniwork-state')
    const roSaveHandler = handlers.get('sheets:uniwork-read-only-save')
    expect(typeof stateHandler).toBe('function')
    expect(typeof roSaveHandler).toBe('function')
    if (!stateHandler || !roSaveHandler) return

    // Before opening a workbook -> unbound, editable
    expect(stateHandler(event)).toEqual({ bound: false, readOnly: false })
    expect(stateHandler(unknownEvent)).toEqual({ bound: false, readOnly: false })

    await open(event, bound)
    expect(stateHandler(event)).toEqual({ bound: true, readOnly: true })

    readOnly = false
    expect(stateHandler(event)).toEqual({ bound: true, readOnly: false })

    // Read-only save with sender's path or pathless -> forwards; foreign path or unknown sender -> ignored
    roSaveHandler(event, bound)
    roSaveHandler(event)
    roSaveHandler(event, other)
    roSaveHandler(unknownEvent, bound)
    expect(readOnlySaves).toEqual([bound, bound])
  })
})
