/**
 * G6-12 URL fetch (docs insert_image / insert_picture / set_watermark image /
 * generate_image results): every AI-supplied URL goes through the shell-wide
 * `ai:fetch-image` handler, which keeps the SSRF guard (http(s) only, no
 * private / loopback / link-local target, every redirect hop re-checked) and
 * the 50 MB size cap. The real handler runs here with electron mocked and the
 * gate's transport stubbed, so no request leaves the machine: the guard dials
 * undici's `fetch` (it pins every hop through a per-hop undici Agent), not the
 * global `fetch`. The URL policy itself is unchanged (Product question); this
 * only pins the guard.
 */
import { tmpdir } from 'node:os'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown
const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}))

// safe-remote-url.ts imports `fetch` from the undici package (the same module
// whose Agent pins the connection), so stubbing the global fetch would leave
// the guard resolving and dialing for real. Keep the rest of undici actual,
// so a hostname hop still builds its pinned dispatcher.
const { undiciFetch } = vi.hoisted(() => ({ undiciFetch: vi.fn() }))

vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetch: undiciFetch,
}))

vi.mock('@genoffice/ai-search', () => ({}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => tmpdir()),
    on: vi.fn(),
    once: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn(() => new Promise(() => {})),
    isPackaged: false,
    getVersion: () => '0.0.0',
    getName: () => 'test',
  },
  BrowserWindow: class {
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
  dialog: { showSaveDialog: vi.fn(), showMessageBox: vi.fn(), showOpenDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    on: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler)),
    once: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  shell: { openExternal: vi.fn(), showItemInFolder: vi.fn() },
  session: { defaultSession: {} },
  net: { fetch: vi.fn() },
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() },
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1000, height: 800 } }) },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  nativeTheme: { on: vi.fn(), shouldUseDarkColors: false },
  clipboard: {},
  webContents: { fromId: vi.fn() },
  WebContentsView: class {},
}))

import { MAX_REMOTE_IMAGE_BYTES } from '@genoffice/electron-utils'
import { registerAiIpc } from '../src/main/docs-main'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
/** a literal public address: no DNS lookup, so the test stays offline */
const PUBLIC = 'http://93.184.216.34'

type Fetched = { base64: string; mime: string } | null
const fetchImage = (url: string): Promise<Fetched> =>
  Promise.resolve(handlers.get('ai:fetch-image')!({ sender: {} }, url)) as Promise<Fetched>

beforeAll(() => registerAiIpc())
afterEach(() => undiciFetch.mockReset())

function stubFetch(respond: (url: string) => Response) {
  undiciFetch.mockImplementation(async (input: unknown) => respond(String(input)))
  return undiciFetch
}

describe('docs ai:fetch-image keeps the SSRF guard', () => {
  it('refuses private, loopback, link-local and non-http targets without a request', async () => {
    const fetchMock = stubFetch(() => new Response(PNG, { status: 200 }))
    for (const url of [
      'http://127.0.0.1/a.png',
      'http://localhost/a.png',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5/a.png',
      'http://192.168.1.10/a.png',
      'http://[::1]/a.png',
      'ftp://93.184.216.34/a.png',
      'file:///etc/passwd',
      'data:image/png;base64,iVBORw0KGgo=',
    ]) {
      expect(await fetchImage(url), url).toBeNull()
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('re-checks a redirect hop and refuses one that lands on a private host', async () => {
    const fetchMock = stubFetch((url) =>
      url.startsWith(PUBLIC)
        ? new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin.png' } })
        : new Response(PNG, { status: 200 }),
    )
    expect(await fetchImage(`${PUBLIC}/a.png`)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('downloads a public image (the guard is not a blanket refusal)', async () => {
    stubFetch(() => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }))
    const got = await fetchImage(`${PUBLIC}/a.png`)
    expect(got).toEqual({ base64: Buffer.from(PNG).toString('base64'), mime: 'image/png' })
  })
})

describe('docs ai:fetch-image keeps the size cap', () => {
  it('is 50 MB', () => {
    expect(MAX_REMOTE_IMAGE_BYTES).toBe(50 * 1024 * 1024)
  })

  it('refuses a body whose Content-Length is over the cap', async () => {
    stubFetch(
      () =>
        new Response(PNG, {
          status: 200,
          headers: { 'content-length': String(MAX_REMOTE_IMAGE_BYTES + 1) },
        }),
    )
    expect(await fetchImage(`${PUBLIC}/big.png`)).toBeNull()
  })

  it('refuses a streamed body that grows past the cap without a Content-Length', async () => {
    const chunk = new Uint8Array(4 * 1024 * 1024)
    let sent = 0
    stubFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (sent > MAX_REMOTE_IMAGE_BYTES + chunk.byteLength) return controller.close()
              sent += chunk.byteLength
              controller.enqueue(chunk)
            },
          }),
          { status: 200 },
        ),
    )
    expect(await fetchImage(`${PUBLIC}/stream.png`)).toBeNull()
    expect(sent).toBeLessThanOrEqual(MAX_REMOTE_IMAGE_BYTES + 2 * chunk.byteLength)
  })
})
