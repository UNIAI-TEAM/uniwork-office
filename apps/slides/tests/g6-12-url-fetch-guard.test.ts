import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// G6-12 #26 (spec §6.3 (b)): every slides path that downloads a model-chosen URL —
// insert_web_image, replace_image, the generate_deck / regenerate_slide page pipeline
// and analyze_media — goes through the SSRF guard (no loopback / private / link-local
// target, every redirect hop revalidated) and a byte cap. These tests drive the real
// main-process handlers with the gate's transport stubbed (undici's fetch): a blocked target never reaches
// the network, and an oversized body never lands in the deck. No policy change.

const env = vi.hoisted(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  return { dir: '', handlers: new Map<string, (...args: never[]) => unknown>() }
})

// safe-remote-url.ts imports `fetch` from the undici package (the same module whose
// Agent pins the connection), so stubbing the global fetch leaves the gate dialing for
// real. Keep the rest of undici actual so a hostname hop still builds its pinned dispatcher.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))

vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetch: fetchMock,
}))

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => join(env.dir, name),
    getName: () => 'slides-test',
    getVersion: () => '0',
    whenReady: () => Promise.resolve(),
    once: () => {},
  },
  dialog: {},
  clipboard: { writeBuffer: () => {} },
  ipcMain: {
    handle: (channel: string, fn: (...args: never[]) => unknown) => env.handlers.set(channel, fn),
    on: () => {},
    removeHandler: () => {},
  },
  BrowserWindow: class {
    static getFocusedWindow() {
      return null
    }
  },
  webContents: { getAllWebContents: () => [], fromId: () => null },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  session: {
    defaultSession: { protocol: {}, setDisplayMediaRequestHandler: () => {} },
  },
  nativeImage: {
    createFromBuffer: () => ({
      getSize: () => ({ width: 4, height: 4 }),
      isEmpty: () => false,
      toPNG: () => Buffer.alloc(0),
    }),
  },
  net: { fetch: async () => new Response(null, { status: 599 }) },
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

import { addPicture, createBlankPptx, openPptx } from '@genoffice/pptx-engine'
import { MAX_REMOTE_IMAGE_BYTES } from '@genoffice/electron-utils'
import { registerSlidesIpc } from '../src/main/slides-main'
import { sessions, type Session } from '../src/main/session-state'

const WC = 11
const FIT = 1280
/** A public literal address: the guard passes it without a DNS lookup. */
const PUBLIC = 'http://93.184.216.34'
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** Targets the guard must refuse before any request leaves the process. */
const BLOCKED = [
  'http://127.0.0.1/a.png',
  'http://localhost/a.png',
  'http://10.0.0.5/a.png',
  'http://192.168.1.1/a.png',
  'http://169.254.169.254/latest/meta-data/a.png',
  'http://[::1]/a.png',
  'http://[::ffff:127.0.0.1]/a.png',
  'http://printer.local/a.png',
  'ftp://93.184.216.34/a.png',
]

function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = env.handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  const event = { sender: { id: WC, isDestroyed: () => false, send: () => {} } }
  return Promise.resolve((fn as (...a: unknown[]) => unknown)(event, ...args))
}

/** A response claiming a body one byte over `cap` (the cap refuses it from the header). */
function oversized(cap: number, type = 'image/png'): Response {
  return new Response(TINY_PNG, {
    status: 200,
    headers: { 'content-type': type, 'content-length': String(cap + 1) },
  })
}

let session: Session
let pictureId: string

beforeAll(() => {
  env.dir = mkdtempSync(join(tmpdir(), 'slides-g6-12-url-'))
  registerSlidesIpc()
})

afterAll(() => {
  vi.useRealTimers()
  rmSync(env.dir, { recursive: true, force: true })
})

beforeEach(async () => {
  fetchMock.mockReset()
  sessions.clear()
  const opened = await openPptx(await createBlankPptx())
  const slide = opened.deck.slides[0]!
  const el = addPicture(opened, slide, {
    bytes: new Uint8Array(TINY_PNG),
    ext: 'png',
    offset: { x: 0, y: 0, cx: 914400, cy: 914400 },
  })
  pictureId = el!.id
  session = {
    path: join(env.dir, 'deck.pptx'),
    fitWidthPx: FIT,
    undoStack: [],
    redoStack: [],
    opened,
  }
  sessions.set(WC, session)
})

afterEach(() => fetchMock.mockReset())

const insertOp = (url: string) => ({
  slideIndex: 0,
  url,
  xPx: 10,
  yPx: 10,
  wPx: 100,
  hPx: 100,
  fitWidthPx: FIT,
})
const replaceOp = (url: string) => ({ slideIndex: 0, sourceId: pictureId, url })
const elementCount = () => session.opened.deck.slides[0]!.elements.length

describe('insert_web_image (ai:insert-image-url)', () => {
  it.each(BLOCKED)('refuses %s without a request and leaves the deck alone', async (url) => {
    const before = elementCount()
    expect(await call('ai:insert-image-url', insertOp(url))).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(elementCount()).toBe(before)
    expect(session.undoStack).toHaveLength(0)
  })

  it('revalidates a redirect hop: a public URL bouncing to the metadata address is refused', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/x.png' } }),
    )
    expect(await call('ai:insert-image-url', insertOp(`${PUBLIC}/a.png`))).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'manual' })
    expect(session.undoStack).toHaveLength(0)
  })

  it(`refuses a body over the ${MAX_REMOTE_IMAGE_BYTES}-byte cap`, async () => {
    expect(MAX_REMOTE_IMAGE_BYTES).toBe(50 * 1024 * 1024)
    fetchMock.mockResolvedValueOnce(oversized(MAX_REMOTE_IMAGE_BYTES))
    const before = elementCount()
    expect(await call('ai:insert-image-url', insertOp(`${PUBLIC}/a.png`))).toBeNull()
    expect(elementCount()).toBe(before)
    expect(session.undoStack).toHaveLength(0)
  })

  it('control: a public image within the cap is inserted', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(TINY_PNG, { status: 200, headers: { 'content-type': 'image/png' } }),
    )
    const before = elementCount()
    const r = (await call('ai:insert-image-url', insertOp(`${PUBLIC}/a.png`))) as {
      sourceId?: string
    } | null
    expect(r?.sourceId).toBeTruthy()
    expect(elementCount()).toBe(before + 1)
  })
})

describe('replace_image (ai:replace-picture-url)', () => {
  it.each(BLOCKED)('refuses %s without a request', async (url) => {
    expect(await call('ai:replace-picture-url', replaceOp(url))).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(session.undoStack).toHaveLength(0)
  })

  it('refuses a body over the cap', async () => {
    fetchMock.mockResolvedValueOnce(oversized(MAX_REMOTE_IMAGE_BYTES))
    expect(await call('ai:replace-picture-url', replaceOp(`${PUBLIC}/a.png`))).toBeNull()
    expect(session.undoStack).toHaveLength(0)
  })
})

describe('generate_deck / regenerate_slide page pipeline (slides:local-page-generate)', () => {
  const pageWith = (url: string) =>
    JSON.stringify({ elements: [{ type: 'image', url, x: 0, y: 0, w: 640, h: 360 }] })

  it.each(BLOCKED.filter((u) => u.startsWith('http')))(
    'reports %s as an image failure without a request',
    async (url) => {
      const r = (await call('slides:local-page-generate', { specJson: pageWith(url) })) as {
        ok: boolean
        imageFailures?: string[]
      }
      expect(fetchMock).not.toHaveBeenCalled()
      // the page is still built, without the blocked image
      expect(r.ok).toBe(true)
      expect(r.imageFailures).toEqual([url])
    },
  )

  it('reports an oversized image as a failure', async () => {
    fetchMock.mockResolvedValueOnce(oversized(MAX_REMOTE_IMAGE_BYTES))
    const url = `${PUBLIC}/big.png`
    const r = (await call('slides:local-page-generate', { specJson: pageWith(url) })) as {
      ok: boolean
      imageFailures?: string[]
    }
    expect(r.ok).toBe(true)
    expect(r.imageFailures).toEqual([url])
  })
})

describe('analyze_media (ai:analyze-media)', () => {
  beforeEach(() => {
    // a BYOK media provider, so the references are loaded locally (the guarded path)
    const userData = join(env.dir, 'userData')
    mkdirSync(userData, { recursive: true })
    writeFileSync(
      join(userData, 'ai-settings.json'),
      JSON.stringify({
        provider: 'gemini',
        providers: { gemini: { apiKey: 'k', model: 'test-model' } },
        media: {
          provider: 'gemini',
          providers: { gemini: { apiKey: 'k', analysisModel: 'm', imageModel: 'i' } },
        },
      }),
    )
  })

  it.each(BLOCKED.filter((u) => u.startsWith('http')))(
    'refuses %s without a request',
    async (url) => {
      const r = (await call('ai:analyze-media', {
        mediaUrls: [url],
        requirements: 'describe',
      })) as { text?: string; error?: string }
      expect(r.error).toMatch(/Could not download/)
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('refuses a body over the media cap', async () => {
    fetchMock.mockResolvedValueOnce(oversized(200 * 1024 * 1024))
    const r = (await call('ai:analyze-media', {
      mediaUrls: [`${PUBLIC}/big.png`],
      requirements: 'describe',
    })) as { error?: string }
    expect(r.error).toMatch(/too large/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses a local file outside the deck folder', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'slides-g6-12-outside-'))
    const file = join(outside, 'secret.png')
    writeFileSync(file, TINY_PNG)
    try {
      const r = (await call('ai:analyze-media', {
        mediaUrls: [file],
        requirements: 'describe',
      })) as { error?: string }
      expect(r.error).toMatch(/outside the allowed directories/)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
