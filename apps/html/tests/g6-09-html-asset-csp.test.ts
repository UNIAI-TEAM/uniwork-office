import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

type SchemeHandler = (request: { url: string; headers: Headers }) => Promise<Response> | Response

const schemeHandlers = new Map<string, SchemeHandler>()
const fetchedFiles = vi.fn()

function makeWebContents() {
  const listeners = new Map<string, () => void>()
  return {
    id: 1,
    listeners,
    isDestroyed: vi.fn(() => false),
    loadFile: vi.fn(),
    loadURL: vi.fn(),
    once: vi.fn((event: string, listener: () => void) => listeners.set(event, listener)),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  }
}

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => tmpdir()),
    on: vi.fn(),
    quit: vi.fn(),
    whenReady: vi.fn(() => new Promise(() => {})),
  },
  BrowserWindow: class {
    static fromWebContents() {
      return null
    }
    static getFocusedWindow() {
      return null
    }
  },
  dialog: { showMessageBox: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  net: {
    fetch: (url: string) => {
      fetchedFiles(url)
      return Promise.resolve(
        new Response('asset body', {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml', 'X-From-Disk': 'yes' },
        }),
      )
    },
  },
  protocol: {
    handle: vi.fn((scheme: string, handler: SchemeHandler) => schemeHandlers.set(scheme, handler)),
    registerSchemesAsPrivileged: vi.fn(),
  },
  shell: { openExternal: vi.fn() },
  WebContentsView: class {
    webContents = makeWebContents()
  },
}))

vi.mock('@genoffice/electron-utils', () => ({
  configuredDefaultSaveDir: vi.fn(() => tmpdir()),
  contextMenuLabels: vi.fn(() => ({})),
  installContextMenu: vi.fn(),
  installNavigationGuard: vi.fn(),
  rendererUrl: vi.fn(() => 'genoffice-app://html/index.html'),
  safeExternalUrl: vi.fn(() => null),
  showOpenDialogWithMemory: vi.fn(),
  showSaveDialogWithMemory: vi.fn(),
}))

import { createHtmlView } from '../src/main/html-main'
import { PREVIEW_CONTENT_SECURITY_POLICY } from '../src/main/preview-protocol'

// G6-09 RBG-HTML-4: html-asset:// is the scheme the preview loads its own pictures, styles and
// scripts from, and an .svg / .js link can be navigated to as a document. Every response of it
// carries the same policy as the html-preview:// document (default-src 'none', no network).
const directories: string[] = []

afterEach(async () => {
  // schemeHandlers stay: the protocols register once per process (registerHtmlIpc is guarded)
  fetchedFiles.mockClear()
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function openDocumentIn(): Promise<{ directory: string; handler: SchemeHandler }> {
  const directory = await mkdtemp(join(tmpdir(), 'html-asset-csp-'))
  directories.push(directory)
  await writeFile(join(directory, 'page.html'), '<img src="logo.svg">')
  await writeFile(join(directory, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  await writeFile(join(directory, 'site.css'), 'h1 { color: red }')
  createHtmlView(join(directory, 'page.html'))
  return { directory, handler: schemeHandlers.get('html-asset') as SchemeHandler }
}

function assetRequest(directory: string, name: string) {
  const path = join(directory, name).replace(/\\/g, '/')
  return { url: `html-asset://local/${encodeURI(path)}`, headers: new Headers() }
}

describe('html-asset response policy (G6-09 RBG-HTML-4)', () => {
  it('serves a document-capable sibling file with the preview policy, body and headers intact', async () => {
    const { directory, handler } = await openDocumentIn()
    const response = await handler(assetRequest(directory, 'logo.svg'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Security-Policy')).toBe(PREVIEW_CONTENT_SECURITY_POLICY)
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml')
    expect(response.headers.get('X-From-Disk')).toBe('yes')
    expect(await response.text()).toBe('asset body')
  })

  it('still serves a stylesheet next to the page (the policy does not block what the page loads)', async () => {
    const { directory, handler } = await openDocumentIn()
    const response = await handler(assetRequest(directory, 'site.css'))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('asset body')
    expect(fetchedFiles).toHaveBeenCalledTimes(1)
    // the page's own style-src / img-src allow this scheme, or the preview would lose its assets
    const csp = response.headers.get('Content-Security-Policy') as string
    expect(csp).toMatch(/style-src [^;]*html-asset:/)
    expect(csp).toMatch(/img-src [^;]*html-asset:/)
  })

  it('refusals carry the policy too: bad URL 400, missing file 404, outside the document folder 403', async () => {
    const { directory, handler } = await openDocumentIn()
    const bad = await handler({ url: 'html-asset://local/%E0%A4%A', headers: new Headers() })
    expect(bad.status).toBe(400)
    const missing = await handler(assetRequest(directory, 'nope.svg'))
    expect(missing.status).toBe(404)
    const other = await mkdtemp(join(tmpdir(), 'html-asset-csp-other-'))
    directories.push(other)
    await writeFile(join(other, 'secret.svg'), '<svg/>')
    const outside = await handler(assetRequest(other, 'secret.svg'))
    expect(outside.status).toBe(403)
    for (const refusal of [bad, missing, outside])
      expect(refusal.headers.get('Content-Security-Policy')).toBe(PREVIEW_CONTENT_SECURITY_POLICY)
  })
})
