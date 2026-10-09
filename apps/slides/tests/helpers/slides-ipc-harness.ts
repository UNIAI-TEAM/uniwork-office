/**
 * Fake Electron surface for the slides session characterisation harness.
 *
 * Drives the real main-process IPC handlers without Electron: ipcMain records the
 * registered handlers, webContents are plain objects that log what main sends them,
 * and dialogs/clipboard/nativeImage answer from scripted queues. Everything the
 * handlers ask the platform for is logged, so a refactor that changes a dialog title,
 * filter list or event payload shows up in the trace.
 */
import { createHash } from 'node:crypto'

type Handler = (event: unknown, ...args: unknown[]) => unknown
type Listener = (event: unknown, ...args: unknown[]) => void

export interface SentMessage {
  wc: number
  channel: string
  args: unknown[]
}

export interface PlatformCall {
  kind: string
  detail: unknown
}

export const harness = {
  handlers: new Map<string, Handler>(),
  listeners: new Map<string, Listener[]>(),
  sent: [] as SentMessage[],
  platform: [] as PlatformCall[],
  openDialogQueue: [] as Array<{ canceled: boolean; filePaths: string[] }>,
  saveDialogQueue: [] as Array<{ canceled: boolean; filePath?: string }>,
  messageBoxQueue: [] as number[],
  clipboard: {
    buffers: new Map<string, Uint8Array>(),
    text: '',
    imagePng: null as Uint8Array | null,
  },
  userData: '',
  draftsDir: '',
  tempDir: '',
}

export interface FakeWebContents {
  id: number
  send: (channel: string, ...args: unknown[]) => void
  isDestroyed: () => boolean
  cut: () => void
  copy: () => void
  paste: () => void
  on: () => void
  once: () => void
  setWindowOpenHandler: () => void
  focus: () => void
}

const contents = new Map<number, FakeWebContents>()

export function fakeWebContents(id: number): FakeWebContents {
  let wc = contents.get(id)
  if (!wc) {
    wc = {
      id,
      send: (channel, ...args) => harness.sent.push({ wc: id, channel, args }),
      isDestroyed: () => false,
      cut: () => harness.platform.push({ kind: 'wc.cut', detail: id }),
      copy: () => harness.platform.push({ kind: 'wc.copy', detail: id }),
      paste: () => harness.platform.push({ kind: 'wc.paste', detail: id }),
      on: () => {},
      once: () => {},
      setWindowOpenHandler: () => {},
      focus: () => {},
    }
    contents.set(id, wc)
  }
  return wc
}

class FakeImage {
  constructor(
    private readonly size: { width: number; height: number },
    private readonly png: Uint8Array,
  ) {}
  isEmpty(): boolean {
    return this.size.width === 0
  }
  getSize(): { width: number; height: number } {
    return { ...this.size }
  }
  toPNG(): Buffer {
    return Buffer.from(this.png)
  }
}

/** 1x1 opaque PNG used wherever the fake platform hands out an image. */
export const TINY_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
)

class FakeBrowserWindow {
  static getFocusedWindow(): null {
    return null
  }
  static fromWebContents(): null {
    return null
  }
  static getAllWindows(): never[] {
    return []
  }
}

export const electronModule = {
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      harness.handlers.set(channel, fn)
    },
    removeHandler: (channel: string) => {
      harness.handlers.delete(channel)
    },
    on: (channel: string, fn: Listener) => {
      const list = harness.listeners.get(channel) ?? []
      list.push(fn)
      harness.listeners.set(channel, list)
    },
  },
  webContents: {
    fromId: (id: number) => fakeWebContents(id),
    getAllWebContents: () => [...contents.values()],
  },
  BrowserWindow: FakeBrowserWindow,
  WebContentsView: class {},
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  app: {
    getPath: (name: string) => (name === 'temp' ? harness.tempDir : harness.userData),
    whenReady: () => new Promise<void>(() => {}),
    isPackaged: true,
    isReady: () => false,
    on: () => {},
    getAppMetrics: () => [],
    getGPUFeatureStatus: () => ({}),
    getLocale: () => 'en',
    commandLine: { appendSwitch: () => {} },
  },
  dialog: {
    showMessageBox: async (...args: unknown[]) => {
      const options = args[args.length - 1]
      harness.platform.push({ kind: 'dialog.showMessageBox', detail: options })
      return { response: harness.messageBoxQueue.shift() ?? 0 }
    },
  },
  clipboard: {
    writeBuffer: (format: string, buf: Uint8Array) => {
      harness.platform.push({ kind: 'clipboard.writeBuffer', detail: format })
      harness.clipboard.buffers.set(format, new Uint8Array(buf))
    },
    readBuffer: (format: string) => Buffer.from(harness.clipboard.buffers.get(format) ?? []),
    readImage: () =>
      harness.clipboard.imagePng
        ? new FakeImage({ width: 1, height: 1 }, harness.clipboard.imagePng)
        : new FakeImage({ width: 0, height: 0 }, new Uint8Array()),
    readText: () => harness.clipboard.text,
    availableFormats: () => (harness.clipboard.imagePng ? ['image/png'] : []),
  },
  nativeImage: {
    createFromPath: (path: string) => {
      harness.platform.push({ kind: 'nativeImage.createFromPath', detail: basename(path) })
      return new FakeImage({ width: 400, height: 300 }, TINY_PNG)
    },
    createFromBuffer: () => new FakeImage({ width: 400, height: 300 }, TINY_PNG),
    createThumbnailFromPath: async (path: string, size: unknown) => {
      harness.platform.push({
        kind: 'nativeImage.createThumbnailFromPath',
        detail: { file: basename(path), size },
      })
      return new FakeImage({ width: 16, height: 9 }, TINY_PNG)
    },
  },
  session: { defaultSession: { setDisplayMediaRequestHandler: () => {} } },
  shell: {
    openExternal: async () => {},
    showItemInFolder: (path: string) =>
      harness.platform.push({ kind: 'shell.showItemInFolder', detail: basename(path) }),
  },
  desktopCapturer: { getSources: async () => [] },
  net: { fetch: async () => new Response(null, { status: 404 }) },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({}) },
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** Platform paths are temp dirs; keep only the file name so traces are machine-independent. */
function relPath(path: unknown): unknown {
  return typeof path === 'string' ? basename(path) : path
}

export const electronUtilsModule = {
  appMenuLabels: () => ({}),
  configuredDefaultSaveDir: () => harness.draftsDir,
  contextMenuLabels: () => ({}),
  fetchRemoteImage: async () => null,
  installContextMenu: () => {},
  installNavigationGuard: () => {},
  isHeadlessMode: () => false,
  safeExternalUrl: () => null,
  saveAsSuggestion: (path: string, name: string) => {
    harness.platform.push({ kind: 'saveAsSuggestion', detail: [relPath(path), name] })
    return name
  },
  showOpenDialogWithMemory: async (_dialog: unknown, _parent: unknown, options: unknown) => {
    harness.platform.push({ kind: 'showOpenDialog', detail: options })
    return harness.openDialogQueue.shift() ?? { canceled: true, filePaths: [] }
  },
  showSaveDialogWithMemory: async (
    _dialog: unknown,
    _parent: unknown,
    options: unknown,
    fallbackDir: unknown,
  ) => {
    harness.platform.push({
      kind: 'showSaveDialog',
      detail: { options, fallbackDir: relPath(fallbackDir) },
    })
    return harness.saveDialogQueue.shift() ?? { canceled: true }
  },
  toggleDevToolsItem: () => ({}),
  installRendererProtocol: () => {},
  registerRendererScheme: () => {},
  rendererUrl: () => '',
}

/** Invoke a registered handler as if the renderer with webContents `wc` called it. */
export async function invoke(wc: number, channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = harness.handlers.get(channel)
  if (!fn) throw new Error(`no handler registered for ${channel}`)
  return await fn({ sender: fakeWebContents(wc) }, ...args)
}

/** Let coalesced setImmediate notifications (history-changed, deck-changed) fire. */
export async function flushDeferred(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise<void>((r) => setImmediate(r))
}

const sha = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex')

/**
 * Canonical JSON: object keys sorted, byte arrays and long strings (data URLs, base64)
 * replaced by their length + hash, so the trace stays small but still pins every byte.
 */
export function canonical(value: unknown): unknown {
  if (value instanceof Uint8Array) return `#bytes:${value.length}:${sha(value).slice(0, 16)}`
  if (typeof value === 'string')
    return value.length > 160 ? `#str:${value.length}:${sha(value).slice(0, 16)}` : value
  if (value instanceof Map)
    return { '#map': [...value.entries()].map(([k, v]) => [k, canonical(v)]) }
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = canonical(v)
    }
    return out
  }
  return value
}

export function digest(value: unknown): string {
  return sha(JSON.stringify(canonical(value) ?? null)).slice(0, 16)
}

/** Small, human-readable shape of a handler result (the digest pins the content). */
export function shape(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') return value
  if (Array.isArray(value)) return `array(${value.length})`
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const v = (value as Record<string, unknown>)[key]
    if (v === undefined) continue
    out[key] = Array.isArray(v)
      ? `array(${v.length})`
      : v && typeof v === 'object'
        ? 'object'
        : canonical(v)
  }
  return out
}

/** Drain the logs since the last call into one trace entry's side-effect fields. */
export function drainSideEffects(): { sent?: unknown[]; platform?: unknown[] } {
  const sent = harness.sent.splice(0).map((m) => ({
    wc: m.wc,
    channel: m.channel,
    digest: digest(m.args.map(relPath)),
  }))
  const platform = harness.platform.splice(0).map((p) => ({
    kind: p.kind,
    detail: canonical(p.detail),
  }))
  return {
    ...(sent.length ? { sent } : {}),
    ...(platform.length ? { platform } : {}),
  }
}

export function fileDigest(bytes: Uint8Array): string {
  return `#bytes:${bytes.length}:${sha(bytes)}`
}
