import * as nodeFs from 'node:fs'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type FsMod = typeof nodeFs
type IpcHandler = (event: { sender: { id: number } }, ...args: unknown[]) => unknown

const handlers = new Map<string, IpcHandler>()
let failNextWriteStream = false

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<FsMod>()
  return {
    ...actual,
    createWriteStream: vi.fn((path: string, options?: unknown) => {
      const stream = actual.createWriteStream(
        path,
        options as Parameters<FsMod['createWriteStream']>[1],
      )
      if (failNextWriteStream) {
        failNextWriteStream = false
        const origWrite = stream.write.bind(stream)
        let seen = false
        stream.write = (() => {
          if (!seen) {
            seen = true
            origWrite(Buffer.from('truncated-partial-bytes'))
            stream.destroy(Object.assign(new Error('EIO: writer died mid-stream'), { code: 'EIO' }))
            return false
          }
          return false
        }) as typeof stream.write
      }
      return stream
    }),
  }
})

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getName: () => 'slides-test',
    getVersion: () => '0',
    whenReady: () => Promise.resolve(),
  },
  dialog: {},
  clipboard: {
    writeBuffer: () => {},
    readBuffer: () => Buffer.alloc(0),
    readImage: () => ({ isEmpty: () => true }),
    readText: () => '',
    availableFormats: () => [],
  },
  ipcMain: {
    handle: (channel: string, fn: IpcHandler) => handlers.set(channel, fn),
    on: () => {},
    removeHandler: () => {},
  },
  BrowserWindow: class {},
  webContents: {
    getAllWebContents: () => [],
    fromId: () => ({ send: () => {} }),
  },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  session: {
    defaultSession: {
      protocol: { handle: () => {} },
      setDisplayMediaRequestHandler: () => {},
    },
  },
  nativeImage: {},
  shell: {},
  desktopCapturer: { getSources: async () => [] },
  WebContentsView: class {},
}))

vi.mock('../src/main/shaped-metrics', () => ({
  shapedMetricsReady: async () => {},
  refineComplexWidths: async () => {},
  complexScriptOf: () => null,
  initShapedMetrics: () => {},
  gtMeasure: (t: string) => ({ width: t.length * 8 }),
  shapedFamily: () => null,
  shapedMeasure: () => ({ width: 0 }),
}))

import { addElement, createBlankPptx, openPptx, savePptx } from '@genoffice/pptx-engine'
import { registerSlidesIpc, saveSessionDeckTo } from '../src/main/slides-main'
import { sessions, type Session } from '../src/main/session-state'
import { sessionDirty } from '../src/session'

const WC = 1
let dir = ''
let session: Session

function call<T = unknown>(channel: string, ...args: unknown[]): T {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`Missing handler for ${channel}`)
  return fn({ sender: { id: WC } }, ...args) as T
}

beforeAll(() => registerSlidesIpc())

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'slides-save-atomic-'))
  failNextWriteStream = false
  sessions.clear()
  session = {
    path: '',
    fitWidthPx: 1280,
    undoStack: [],
    redoStack: [],
    opened: await openPptx(await createBlankPptx()),
  }
  sessions.set(WC, session)
})

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
  sessions.clear()
})

describe('deck saves through Session / HostIO writeDeck and saveSessionDeckTo (R1a-08)', () => {
  it('leaves the previous target bytes intact and the session dirty when the writer fails part-way, then replaces them on a successful save', async () => {
    const target = join(dir, 'deck.pptx')
    const initialBytes = await savePptx(session.opened)
    writeFileSync(target, initialBytes)
    session.path = target

    // Dirty the session by adding a text box on slide 0
    addElement(session.opened.deck.slides[0]!, {
      kind: 'textbox',
      offset: { x: 0, y: 0, cx: 914400, cy: 457200 },
      paragraphs: [{ runs: [{ text: 'Updated slide content' }] }],
    })
    expect(call<boolean>('slides:is-dirty')).toBe(true)

    // 1. Mid-stream writer failure through slides:save (HostIO.writeDeck)
    failNextWriteStream = true
    const failedRes = await call<Promise<{ ok: boolean; error?: string }>>('slides:save')
    expect(failedRes.ok).toBe(false)
    expect(failedRes.error).toContain('EIO')
    expect(Buffer.compare(readFileSync(target), Buffer.from(initialBytes))).toBe(0)
    expect(readdirSync(dir)).toEqual(['deck.pptx'])
    expect(call<boolean>('slides:is-dirty')).toBe(true)
    expect(sessionDirty(session)).toBe(true)

    // 2. Successful save through slides:save replaces target bytes and clears dirty state
    const okRes = await call<Promise<{ ok: boolean; path?: string }>>('slides:save')
    expect(okRes.ok).toBe(true)
    expect(okRes.path).toBe(target)
    expect(readdirSync(dir)).toEqual(['deck.pptx'])
    expect(call<boolean>('slides:is-dirty')).toBe(false)
    const savedDisk = readFileSync(target)
    expect(Buffer.compare(savedDisk, Buffer.from(initialBytes))).not.toBe(0)
    const reopened = await openPptx(new Uint8Array(savedDisk))
    expect(reopened.deck.slides[0]!.elements).toHaveLength(
      session.opened.deck.slides[0]!.elements.length,
    )

    // 3. Mid-stream writer failure on saveSessionDeckTo (MCP/autosave writeDeckFile path) also preserves target
    addElement(session.opened.deck.slides[0]!, {
      kind: 'textbox',
      offset: { x: 0, y: 457200, cx: 914400, cy: 457200 },
      paragraphs: [{ runs: [{ text: 'Second edit' }] }],
    })
    expect(sessionDirty(session)).toBe(true)
    failNextWriteStream = true
    await expect(saveSessionDeckTo(session, target)).rejects.toThrow('EIO')
    expect(Buffer.compare(readFileSync(target), savedDisk)).toBe(0)
    expect(readdirSync(dir)).toEqual(['deck.pptx'])
    expect(sessionDirty(session)).toBe(true)
  })
})
