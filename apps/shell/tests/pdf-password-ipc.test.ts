import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PdfPasswordUiState } from '../src/shared/pdf-password-api'

/**
 * The pdf-password registrar (src/main/pdf-password-dialog.ts): its three
 * channels go onto the ipc object the composition hands in (the guarded one),
 * never onto the global ipcMain, and the handlers are safe with no prompt open.
 */

type Handler = (event?: unknown, input?: unknown) => unknown

const handlers = new Map<string, Handler>()
/** whatever lands on the global ipcMain: the module must register nothing there */
const rawHandlers = new Map<string, Handler>()
const fakeIpc = {
  handle: (channel: string, handler: Handler) => {
    handlers.set(channel, handler)
  },
}
const sent: Array<{ channel: string; state: PdfPasswordUiState | null }> = []

class FakeWebContents {
  send(channel: string, state: PdfPasswordUiState | null): void {
    sent.push({ channel, state })
  }
}

/** every window the module created, in order, so a test can fire a given window's `closed` late */
const created: FakeBrowserWindow[] = []

class FakeBrowserWindow {
  webContents = new FakeWebContents()
  closedListeners: Array<() => void> = []
  constructor() {
    created.push(this)
  }
  isDestroyed(): boolean {
    return false
  }
  show(): void {}
  focus(): void {}
  once(): void {}
  on(event: string, listener: () => void): void {
    if (event === 'closed') this.closedListeners.push(listener)
  }
  close(): void {}
  loadURL(): Promise<void> {
    return Promise.resolve()
  }
  loadFile(): Promise<void> {
    return Promise.resolve()
  }
}

vi.mock('electron', () => ({
  BrowserWindow: FakeBrowserWindow,
  ipcMain: {
    handle: (channel: string, handler: Handler) => rawHandlers.set(channel, handler),
  },
}))

const state = { strings: { title: 't' } } as unknown as PdfPasswordUiState

beforeEach(() => {
  vi.resetModules()
  handlers.clear()
  rawHandlers.clear()
  sent.length = 0
  created.length = 0
})

async function loadModule() {
  const mod = await import('../src/main/pdf-password-dialog')
  mod.registerPdfPasswordIpc(fakeIpc)
  return mod
}

describe('pdf password dialog — ipc registrar', () => {
  it('registers every pdf-password channel the window calls on the given ipc, nothing on the global ipcMain', async () => {
    await loadModule()
    expect([...handlers.keys()].sort()).toEqual([
      'pdf-password:cancel',
      'pdf-password:get-state',
      'pdf-password:submit',
    ])
    expect(rawHandlers.size).toBe(0)
  })

  it('does not register at module load or when a prompt opens', async () => {
    const mod = await import('../src/main/pdf-password-dialog')
    void mod.promptPdfPassword(null, state)
    expect(handlers.size).toBe(0)
    expect(rawHandlers.size).toBe(0)
  })

  it('handlers are safe with no pending prompt', async () => {
    await loadModule()
    expect(handlers.get('pdf-password:get-state')!()).toBeNull()
    expect(() => handlers.get('pdf-password:submit')!({}, 'secret')).not.toThrow()
    expect(() => handlers.get('pdf-password:submit')!({}, 42)).not.toThrow()
    expect(() => handlers.get('pdf-password:cancel')!()).not.toThrow()
  })

  it('pdfPasswordWindowContents is null with no window and the live webContents while open', async () => {
    const mod = await loadModule()
    expect(mod.pdfPasswordWindowContents()).toBeNull()
    const pending = mod.promptPdfPassword(null, state)
    const live = mod.pdfPasswordWindowContents()
    expect(live).toBeInstanceOf(FakeWebContents)
    handlers.get('pdf-password:submit')!({}, 'pw')
    await expect(pending).resolves.toBe('pw')
    mod.closePdfPasswordDialog()
    expect(mod.pdfPasswordWindowContents()).toBeNull()
  })

  it('a late `closed` of a closed window keeps the reopened prompt tracked and pending', async () => {
    const mod = await loadModule()
    const firstPending = mod.promptPdfPassword(null, state)
    const first = created.at(-1)!
    handlers.get('pdf-password:submit')!({}, 'wrong')
    await expect(firstPending).resolves.toBe('wrong')
    mod.closePdfPasswordDialog()

    const secondPending = mod.promptPdfPassword(null, state)
    const second = created.at(-1)!
    expect(second).not.toBe(first)
    for (const fire of first.closedListeners) fire()

    expect(mod.pdfPasswordWindowContents()).toBe(second.webContents)
    handlers.get('pdf-password:submit')!({}, 'right')
    await expect(secondPending).resolves.toBe('right')
  })
})
