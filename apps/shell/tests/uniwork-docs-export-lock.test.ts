/**
 * G5-03a W4: a locked working copy (the server revoked or deleted it while it
 * is open) exports nothing — no export, no Save As copy, no print. Every module
 * policy carries the shell's lock answer (service.isLocked through the module
 * seam) and each module's export / Save As / print entry point asks it before
 * it opens a dialog, writes bytes or prints.
 *
 * The per-module helpers, the seam forwarding, the service's own verdict, and
 * every module's export / Save As / print entry points run for real here with
 * Electron stubbed (A4, UNI-1362).
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  setUniworkDocumentPolicy as setDocsPolicy,
  uniworkIsLocked as docsIsLocked,
} from '../../docs/src/main/uniwork-policy'
import {
  setUniworkDocumentPolicy as setSheetsPolicy,
  uniworkIsLocked as sheetsIsLocked,
} from '../../sheets/src/main/uniwork-policy'
import {
  setUniworkDocumentPolicy as setSlidesPolicy,
  uniworkIsLocked as slidesIsLocked,
} from '../../slides/src/main/uniwork-policy'
import {
  setUniworkDocumentPolicy as setPdfPolicy,
  uniworkIsLocked as pdfIsLocked,
} from '../../pdf/src/main/uniwork-policy'
import {
  setUniworkDocumentPolicy as setMarkdownPolicy,
  uniworkIsLocked as markdownIsLocked,
} from '../../markdown/src/main/uniwork-policy'
import {
  setUniworkDocumentPolicy as setHtmlPolicy,
  uniworkIsLocked as htmlIsLocked,
} from '../../html/src/main/uniwork-policy'
import { BINDING_FILE } from '../src/main/uniwork-docs/binding-store'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown

interface FakeWebContents {
  id: number
  once: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  isDestroyed: () => boolean
  setWindowOpenHandler: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  print: ReturnType<typeof vi.fn>
  printToPDF: ReturnType<typeof vi.fn>
}

const env = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>()
  const dialogCalls = {
    showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
    showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
    showMessageBox: vi.fn(async () => ({ response: 0 })),
  }
  const state = {
    userDataDir: '',
    nextWcId: 100,
    lastWc: null as FakeWebContents | null,
  }
  const makeWc = (): FakeWebContents => {
    const wc: FakeWebContents = {
      id: state.nextWcId++,
      once: vi.fn(),
      on: vi.fn(),
      send: vi.fn(),
      isDestroyed: () => false,
      setWindowOpenHandler: vi.fn(),
      loadURL: vi.fn(async () => undefined),
      loadFile: vi.fn(async () => undefined),
      print: vi.fn(),
      printToPDF: vi.fn(async () => Buffer.from('pdf')),
    }
    state.lastWc = wc
    return wc
  }
  return { handlers, dialogCalls, state, makeWc }
})

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => env.state.userDataDir || tmpdir()),
    getAppPath: vi.fn(() => tmpdir()),
    getSystemLocale: vi.fn(() => 'en-US'),
    on: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn(() => Promise.withResolvers<void>().promise),
    isPackaged: false,
    getVersion: () => '0.0.0',
    getName: () => 'test',
  },
  BrowserWindow: class {
    webContents = env.makeWc()
    static fromWebContents() {
      return null
    }
    static getFocusedWindow() {
      return null
    }
    static getAllWindows() {
      return []
    }
  },
  WebContentsView: class {
    webContents = env.makeWc()
  },
  dialog: {
    showSaveDialog: (...args: unknown[]) => env.dialogCalls.showSaveDialog(...args),
    showOpenDialog: (...args: unknown[]) => env.dialogCalls.showOpenDialog(...args),
    showMessageBox: (...args: unknown[]) => env.dialogCalls.showMessageBox(...args),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      env.handlers.set(channel, handler)
    }),
    on: vi.fn((channel: string, handler: IpcHandler) => {
      env.handlers.set(channel, handler)
    }),
    once: vi.fn(),
    removeHandler: vi.fn((channel: string) => {
      env.handlers.delete(channel)
    }),
    removeAllListeners: vi.fn(),
  },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn(), openPath: vi.fn(async () => '') },
  session: { defaultSession: { protocol: {}, setDisplayMediaRequestHandler: () => {} } },
  net: { fetch: vi.fn() },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1000, height: 800 } }) },
  Menu: { buildFromTemplate: vi.fn(() => ({})), setApplicationMenu: vi.fn() },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
  nativeImage: {},
  clipboard: { writeBuffer: vi.fn() },
  desktopCapturer: { getSources: async () => [] },
  systemPreferences: {},
  webContents: { getAllWebContents: () => [], fromId: () => null },
}))

vi.mock('@genoffice/ai-search', () => ({
  gskSlideGenerate: vi.fn(),
  generateImageTool: vi.fn(),
  documentMediaRoots: () => [],
  localMediaRoots: () => [],
}))

vi.mock('../../slides/src/main/shaped-metrics', () => ({
  shapedMetricsReady: async () => {},
  refineComplexWidths: async () => {},
  complexScriptOf: () => null,
  initShapedMetrics: () => {},
  gtMeasure: (t: string) => ({ width: t.length * 8 }),
  shapedFamily: () => null,
  shapedMeasure: () => ({ width: 0 }),
}))

vi.mock('../../sheets/src/main/xlsx-sidecar-client', () => ({
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

import {
  docsFileRenamed,
  registerDocsIpc,
} from '../../docs/src/main/docs-main'
import { createSheetsView } from '../../sheets/src/main/sheets-main'
import { IPC_CHANNELS as SHEETS_CHANNELS } from '../../sheets/src/shared/ipc-channels'
import { createBlankPptx } from '@genoffice/pptx-engine'
import { registerSlidesIpc } from '../../slides/src/main/slides-main'
import { sessions as slidesSessions } from '../../slides/src/main/session-state'
import {
  createPdfView,
  requestPdfSaveAs,
  sendPdfPrintRequest,
} from '../../pdf/src/main/pdf-main'
import { PDF_CHANNELS } from '../../pdf/src/shared/ipc'
import { PDF_UNIWORK_VIEW_ONLY } from '../../pdf/src/shared/uniwork-refusal'
import {
  createMarkdownView,
  sendMarkdownExportRequest,
  sendMarkdownPrintRequest,
} from '../../markdown/src/main/markdown-main'
import { MARKDOWN_CHANNELS } from '../../markdown/src/shared/ipc'
import {
  createHtmlView,
  sendHtmlExportRequest,
  sendHtmlPrintRequest,
} from '../../html/src/main/html-main'
import { HTML_CHANNELS } from '../../html/src/shared/ipc'
import { installUniworkModuleSeams } from '../src/main/uniwork-docs/modules'
const LOCKED = 'C:/u/uniwork-documents/dep/acc/doc1/Plan.docx'
const LOCAL = 'C:/Users/me/Documents/notes.txt'

type Policy = {
  isBound(path: string): boolean
  isReadOnly(path: string): boolean
  isLocked?(path: string): boolean
}
type SetPolicy = (next: Policy | null) => void
type IsLocked = (path: string | null | undefined) => boolean

const MODULES: Array<[string, SetPolicy, IsLocked]> = [
  ['docs', setDocsPolicy, docsIsLocked],
  ['sheets', setSheetsPolicy, sheetsIsLocked],
  ['slides', setSlidesPolicy, slidesIsLocked],
  ['pdf', setPdfPolicy, pdfIsLocked],
  ['markdown', setMarkdownPolicy, markdownIsLocked],
  ['html', setHtmlPolicy, htmlIsLocked],
]

afterEach(() => {
  for (const [, setPolicy] of MODULES) setPolicy(null)
})

function invoke(channel: string, wc: FakeWebContents, ...args: unknown[]): Promise<unknown> {
  const fn = env.handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({ sender: wc }, ...args))
}
// ── the helper, one per module ─────────────────────────────

describe('uniworkIsLocked (one helper per module)', () => {
  it.each(MODULES)('%s: locks only the path the policy names', (_name, setPolicy, isLocked) => {
    // no policy installed (standalone app, or the shell before sign-in wiring)
    expect(isLocked(LOCKED)).toBe(false)
    setPolicy({
      isBound: () => true,
      isReadOnly: () => true,
      isLocked: (path) => path === LOCKED,
    })
    expect(isLocked(LOCKED)).toBe(true)
    // an unlocked bound copy and a plain local file are unaffected
    expect(isLocked(LOCAL)).toBe(false)
    expect(isLocked(null)).toBe(false)
    expect(isLocked(undefined)).toBe(false)
  })

  it.each(MODULES)(
    '%s: unlocked bound and plain local never refuse; a missing or throwing isLocked reads as unlocked',
    (_name, setPolicy, isLocked) => {
      setPolicy({ isBound: (path) => path === LOCKED, isReadOnly: () => false })
      // the pdf / markdown / html shape: only isBound and isReadOnly
      expect(isLocked(LOCKED)).toBe(false)
      expect(isLocked(LOCAL)).toBe(false)
      // a broken policy must not break a local export
      setPolicy({
        isBound: () => true,
        isReadOnly: () => false,
        isLocked: () => {
          throw new Error('boom')
        },
      })
      expect(isLocked(LOCKED)).toBe(false)
    },
  )
})

describe('installUniworkModuleSeams forwards the lock answer', () => {
  it('every module policy asks the seam through isLocked', () => {
    const isLocked = vi.fn((path: string) => path === LOCKED)
    installUniworkModuleSeams({
      isBound: () => false,
      isReadOnly: () => false,
      isLocked,
      onUserSave: () => undefined,
      refuseLockedPath: () => false,
    })
    // docs, sheets, slides, pdf, markdown, html
    for (const [, , moduleIsLocked] of MODULES) {
      expect(moduleIsLocked(LOCKED)).toBe(true)
      expect(moduleIsLocked(LOCAL)).toBe(false)
    }
    expect(isLocked).toHaveBeenCalledTimes(12)
    // null restores genoffice behaviour: no policy, so nothing is locked
    installUniworkModuleSeams(null)
    for (const [, , moduleIsLocked] of MODULES) {
      expect(moduleIsLocked(LOCKED)).toBe(false)
    }
  })

  it('a seam without isLocked never locks, and modules.ts installs the forwarding', () => {
    installUniworkModuleSeams({
      isBound: () => false,
      isReadOnly: () => false,
      onUserSave: () => undefined,
      refuseLockedPath: () => false,
    })
    for (const [, , moduleIsLocked] of MODULES) {
      expect(moduleIsLocked(LOCKED)).toBe(false)
    }
  })
})

// ── the service's own verdict ──────────────────────────────

const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const DOC_DELETED = '01J8X4DOC0N1P2Q3R4S5T6U8'
const DOC_HEALTHY = '01J8X4DOC0N1P2Q3R4S5T6U9'
const sha256Hex = (bytes: string) => createHash('sha256').update(bytes).digest('hex')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-export-lock-'))
  env.state.userDataDir = dir
  env.dialogCalls.showSaveDialog.mockClear()
  env.dialogCalls.showOpenDialog.mockClear()
  env.dialogCalls.showMessageBox.mockClear()
})
afterEach(() => {
  slidesSessions.clear()
  rmSync(dir, { recursive: true, force: true })
})

/** the working copy of one document, with an optional blocked verdict */
function seedCopy(documentId: string, over: Record<string, unknown> = {}): string {
  const documentDir = join(dir, 'uniwork-documents', 'default', 'acc_1', documentId)
  mkdirSync(documentDir, { recursive: true })
  const filePath = join(documentDir, 'Plan.docx')
  const bytes = `working copy of ${documentId}`
  writeFileSync(filePath, bytes)
  writeFileSync(
    join(documentDir, BINDING_FILE),
    `${JSON.stringify(
      {
        schema: 2,
        documentId,
        workspaceId: 'ws_1',
        orgId: 'org_a',
        title: 'Plan.docx',
        filename: 'Plan.docx',
        format: 'docx',
        access: 'edit',
        baseRevision: '9',
        baseVersion: 3,
        baseChecksum: sha256Hex(bytes),
        state: 'saved',
        min_store_level: 2,
        min_app_version: '0.11.0',
        ...over,
      },
      null,
      2,
    )}\n`,
  )
  return filePath
}

function serviceFor(): UniworkDocsService {
  const ui: ConflictUi = {
    chooseConflict: vi.fn(async () => 'later'),
    confirmDiscard: vi.fn(async () => false),
    pickCopyPath: vi.fn(async () => null),
    showOpenLatestFailed: vi.fn(),
    showCopyFailed: vi.fn(),
    chooseUnsavedClose: vi.fn(async () => 'cancel'),
  }
  return new UniworkDocsService({
    userDataDir: dir,
    appVersion: () => '0.11.0',
    profile: () => ({
      deploymentId: 'default',
      apiOrigin: 'https://uniwork.example',
      clientId: 'uniwork-office',
      channel: 'stable',
    }),
    channel: () => 'stable',
    applyProfile: async () => 'unchanged',
    identity: () => ({ accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }),
    selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
    authorized: <T>(call: (token: string) => Promise<T>) => call('fake-token'),
    openPath: () => false,
    isPathOpen: () => false,
    requestModuleSave: () => false,
    reloadPath: () => undefined,
    activePath: () => undefined,
    ui,
    pushStatus: () => undefined,
    pushLaunch: () => undefined,
    reveal: () => undefined,
  })
}

describe('service.isLocked (the shell answer the modules ask)', () => {
  it('a revoked or deleted binding is locked; a healthy copy and a plain file are not', () => {
    const revoked = seedCopy(DOC, { state: 'blocked', error: 'permission_revoked' })
    const deleted = seedCopy(DOC_DELETED, { state: 'blocked', error: 'document_deleted' })
    const healthy = seedCopy(DOC_HEALTHY)
    const local = join(dir, 'notes.txt')
    writeFileSync(local, 'plain')
    const service = serviceFor()

    expect(service.isLocked(revoked)).toBe(true)
    expect(service.isLocked(deleted)).toBe(true)
    expect(service.isLocked(healthy)).toBe(false)
    expect(service.isLocked(local)).toBe(false)
    expect(service.isLocked(join(dir, 'missing.docx'))).toBe(false)

    // and the same answer reaches every module's policy through the one seam
    installUniworkModuleSeams(service)
    for (const [, , moduleIsLocked] of MODULES) {
      expect(moduleIsLocked(revoked)).toBe(true)
      expect(moduleIsLocked(healthy)).toBe(false)
      expect(moduleIsLocked(local)).toBe(false)
    }
  })
})

// ── each module's entry points ask before they act ─────────

describe('every export / Save As / print entry point refuses a locked source', () => {
  it('docs: save-as, save-new, save-to, export-pdf/html, print, buffered/merged PDF and image exports refuse a locked document before any dialog or print', async () => {
    registerDocsIpc()
    const wc = env.makeWc()
    docsFileRenamed(wc as never, LOCKED, LOCKED)
    setDocsPolicy({
      isBound: () => true,
      isReadOnly: () => true,
      isLocked: (path) => path === LOCKED,
    })
    const payload = new Uint8Array([1, 2, 3]).buffer

    expect(await invoke('docs:save-as', wc, 'Plan.docx', payload, LOCKED)).toEqual({ ok: false })
    expect(await invoke('docs:save-new', wc, 'Plan.docx', payload)).toEqual({ ok: false })
    expect(await invoke('docs:save-to', wc, join(dir, 'out.docx'), payload, true)).toEqual({
      ok: false,
    })
    expect(await invoke('docs:export-pdf', wc, 'Plan.docx', 12240, 15840)).toEqual({ ok: false })
    expect(await invoke('docs:export-html', wc, 'Plan.docx', '<p>hi</p>')).toEqual({ ok: false })
    expect(await invoke('docs:print', wc)).toEqual({ ok: false })
    expect(await invoke('docs:print-pdf-buffer', wc, 12240, 15840)).toEqual({ ok: false })
    expect(await invoke('docs:save-merged-pdf', wc, 'Plan.docx', [])).toEqual({ ok: false })
    expect(await invoke('docs:save-image-as', wc, 'data:image/png;base64,AAAA')).toEqual({
      ok: false,
    })
    expect(await invoke('docs:pick-export-images-target', wc)).toBeNull()
    expect(await invoke('docs:write-export-image', wc, dir, 'page-1.png', 'AAAA')).toEqual({
      ok: false,
    })
    expect(env.dialogCalls.showSaveDialog).not.toHaveBeenCalled()
    expect(env.dialogCalls.showOpenDialog).not.toHaveBeenCalled()
    expect(wc.print).not.toHaveBeenCalled()
    expect(wc.printToPDF).not.toHaveBeenCalled()
  })

  it('sheets: export-pdf, print, export-csv and Save As refuse when any session on the tab holds a locked document', async () => {
    const file = join(dir, 'Budget.xlsx')
    writeFileSync(file, 'PK\u0003\u0004')
    createSheetsView({ includeAiHandlers: false })
    const wc = env.state.lastWc!
    await invoke(SHEETS_CHANNELS.reopenWorkbook, wc, file)
    setSheetsPolicy({
      isBound: () => true,
      isReadOnly: () => true,
      isLocked: (path) => path === file,
    })

    expect(
      await invoke(SHEETS_CHANNELS.exportPdf, wc, {
        workbookName: 'Budget.xlsx',
        sheets: [{ name: 'Sheet1', html: '<p>x</p>' }],
      }),
    ).toEqual({ canceled: true })
    expect(
      await invoke(SHEETS_CHANNELS.printWorkbook, wc, {
        workbookName: 'Budget.xlsx',
        sheets: [{ name: 'Sheet1', html: '<p>x</p>' }],
      }),
    ).toEqual({ ok: false })
    expect(
      await invoke(SHEETS_CHANNELS.exportCsv, wc, {
        workbookName: 'Budget.xlsx',
        sheetName: 'Sheet1',
        csv: 'a,b',
        hasFormulas: true,
        sheetCount: 1,
      }),
    ).toEqual({ canceled: true })
    expect(
      await invoke(SHEETS_CHANNELS.saveWorkbook, wc, {
        sessionId: '00000000-0000-4000-8000-000000000001',
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
      }),
    ).toEqual({ canceled: true })
    expect(env.dialogCalls.showSaveDialog).not.toHaveBeenCalled()
    expect(env.dialogCalls.showMessageBox).not.toHaveBeenCalled()
  })

  it('slides: export-pdf, print, export-images, save-picture and save-as refuse a locked session path', async () => {
    registerSlidesIpc()
    const wc = env.makeWc()
    const deckPath = join(dir, 'Deck.pptx')
    slidesSessions.set(wc.id, {
      opened: await createBlankPptx(),
      path: deckPath,
      fitWidthPx: 1280,
      undoStack: [],
      redoStack: [],
      journal: [],
    })
    setSlidesPolicy({
      isBound: () => true,
      isReadOnly: () => true,
      isLocked: (path) => path === deckPath,
    })

    expect(
      await invoke('slides:export-images', wc, {
        dir,
        baseName: 'Deck',
        pngsBase64: ['AAAA'],
      }),
    ).toEqual({ ok: false })
    expect(
      await invoke('slides:save-picture', wc, {
        defaultName: 'slide-1',
        pngBase64: 'AAAA',
      }),
    ).toEqual({ ok: false })
    expect(
      await invoke('slides:export-pdf', wc, {
        outPath: join(dir, 'Deck.pdf'),
        widthPx: 960,
        heightPx: 540,
        pngsBase64: ['AAAA'],
      }),
    ).toEqual({ ok: false })
    expect(
      await invoke('slides:print', wc, {
        widthPx: 960,
        heightPx: 540,
        pngsBase64: ['AAAA'],
      }),
    ).toEqual({ ok: false })
    expect(await invoke('slides:save-as', wc, 'Deck.pptx')).toEqual({ ok: false })
    expect(env.dialogCalls.showSaveDialog).not.toHaveBeenCalled()
  })

  it('pdf: Save As, redaction copy, print and export-images refuse a locked document before any dialog or write', async () => {
    const pdfPath = join(dir, 'Doc.pdf')
    writeFileSync(pdfPath, '%PDF-1.4\n')
    createPdfView(pdfPath)
    const wc = env.state.lastWc!
    // grant a Save As target while still unlocked, then lock the document: the
    // save handler's own lock guard refuses writing to the granted target
    const copyTarget = join(dir, 'Copy.pdf')
    setPdfPolicy({
      isBound: () => true,
      isReadOnly: () => false,
      isLocked: () => false,
    })
    void requestPdfSaveAs(wc as never, copyTarget)
    expect(wc.send).toHaveBeenCalledWith(PDF_CHANNELS.saveAsRequest, copyTarget)

    setPdfPolicy({
      isBound: () => true,
      isReadOnly: () => false,
      isLocked: (path) => path === pdfPath,
    })

    wc.send.mockClear()
    sendPdfPrintRequest(wc as never)
    expect(wc.send).not.toHaveBeenCalled()
    expect(await requestPdfSaveAs(wc as never, join(dir, 'Copy2.pdf'))).toBe(false)
    expect(await invoke(PDF_CHANNELS.requestRedactionCopy, wc, pdfPath)).toBe(false)
    expect(
      await invoke(PDF_CHANNELS.exportImages, wc, {
        images: ['AAAA'],
        pageNumbers: [1],
        baseName: 'Doc',
      }),
    ).toEqual({ ok: true, canceled: true })
    expect(
      await invoke(PDF_CHANNELS.save, wc, {
        path: pdfPath,
        targetPath: copyTarget,
        markups: [],
        drawings: [],
        formValues: [],
        stamps: [],
      }),
    ).toEqual({ ok: false, error: PDF_UNIWORK_VIEW_ONLY })
    expect(env.dialogCalls.showOpenDialog).not.toHaveBeenCalled()
    expect(env.dialogCalls.showSaveDialog).not.toHaveBeenCalled()
  })

  it('markdown: export-docx/pdf, image export, save-image-as, save-as and the menu entries refuse a locked document', async () => {
    const mdPath = join(dir, 'Note.md')
    writeFileSync(mdPath, '# hi\n')
    createMarkdownView(mdPath)
    const wc = env.state.lastWc!
    setMarkdownPolicy({
      isBound: () => true,
      isReadOnly: () => false,
      isLocked: (path) => path === mdPath,
    })

    wc.send.mockClear()
    sendMarkdownExportRequest(wc as never, 'pdf')
    sendMarkdownPrintRequest(wc as never)
    expect(wc.send).not.toHaveBeenCalled()

    expect(
      await invoke(MARKDOWN_CHANNELS.exportDocx, wc, {
        base64: 'AAAA',
        suggestedName: 'Note',
      }),
    ).toEqual({ ok: false, error: 'markdown: this document is view only' })
    expect(
      await invoke(MARKDOWN_CHANNELS.exportPdf, wc, {
        html: '<p>hi</p>',
        suggestedName: 'Note',
      }),
    ).toEqual({ ok: false, error: 'markdown: this document is view only' })
    expect(
      await invoke(MARKDOWN_CHANNELS.prepareImageExport, wc, {
        html: '<p>hi</p>',
        suggestedName: 'Note',
      }),
    ).toEqual({ ok: false, error: 'markdown: this document is view only' })
    expect(await invoke(MARKDOWN_CHANNELS.saveImageAs, wc, 'data:image/png;base64,AAAA')).toEqual({
      ok: false,
      error: 'markdown: this document is view only',
    })
    expect(
      await invoke(MARKDOWN_CHANNELS.save, wc, {
        text: '# hi',
        imageSources: [],
        mode: 'saveAs',
      }),
    ).toEqual({ ok: false, error: 'markdown: this document is view only' })
    expect(env.dialogCalls.showSaveDialog).not.toHaveBeenCalled()
    expect(env.dialogCalls.showOpenDialog).not.toHaveBeenCalled()
  })

  it('html: export-docx/pdf/html, print-html, save-as and the menu entries refuse a locked document', async () => {
    const htmlPath = join(dir, 'Page.html')
    writeFileSync(htmlPath, '<p>hi</p>')
    createHtmlView(htmlPath)
    const wc = env.state.lastWc!
    setHtmlPolicy({
      isBound: () => true,
      isReadOnly: () => false,
      isLocked: (path) => path === htmlPath,
    })

    wc.send.mockClear()
    sendHtmlExportRequest(wc as never, 'pdf')
    sendHtmlPrintRequest(wc as never)
    expect(wc.send).not.toHaveBeenCalled()

    expect(
      await invoke(HTML_CHANNELS.exportDocx, wc, {
        html: '<p>hi</p>',
        suggestedName: 'Page',
      }),
    ).toEqual({ ok: false, error: 'html: this document is view only' })
    expect(
      await invoke(HTML_CHANNELS.exportPdf, wc, {
        html: '<p>hi</p>',
        suggestedName: 'Page',
      }),
    ).toEqual({ ok: false, error: 'html: this document is view only' })
    expect(
      await invoke(HTML_CHANNELS.exportHtml, wc, {
        html: '<p>hi</p>',
        suggestedName: 'Page',
      }),
    ).toEqual({ ok: false, error: 'html: this document is view only' })
    expect(
      await invoke(HTML_CHANNELS.printHtml, wc, {
        html: '<p>hi</p>',
      }),
    ).toEqual({ ok: false, error: 'html: this document is view only' })
    expect(
      await invoke(HTML_CHANNELS.save, wc, {
        text: '<p>hi</p>',
        imageSources: [],
        mode: 'saveAs',
      }),
    ).toEqual({ ok: false, error: 'html: this document is view only' })
    expect(env.dialogCalls.showSaveDialog).not.toHaveBeenCalled()
    expect(env.dialogCalls.showOpenDialog).not.toHaveBeenCalled()
  })
})
