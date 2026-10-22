import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateUiState } from '../src/shared/update-api'

/**
 * The settings-facing update surface (src/main/update-window.ts): the dialog
 * is non-modal, its state is broadcast to the shell window for the About row,
 * and open-for-update re-surfaces a minimized dialog, starting a download
 * that never began.
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
const sent: Array<{ channel: string; state: UpdateUiState | null }> = []
const winOptions: Array<Record<string, unknown>> = []
/** every window the module created, in order, so a test can fire a given window's `closed` late */
const created: FakeBrowserWindow[] = []
const shown = vi.fn()
const focused = vi.fn()

class FakeWebContents {
  send(channel: string, state: UpdateUiState | null): void {
    sent.push({ channel, state })
  }
}

class FakeBrowserWindow {
  webContents = new FakeWebContents()
  closedListeners: Array<() => void> = []
  constructor(options: Record<string, unknown>) {
    winOptions.push(options)
    created.push(this)
  }
  isDestroyed(): boolean {
    return false
  }
  show(): void {
    shown()
  }
  focus(): void {
    focused()
  }
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

const UPDATE_CHANNELS_REGISTERED = [
  'update:get-state',
  'update:open-for-update',
  'update:download',
  'update:install',
  'update:later',
  'update:open-download',
]

const state = (phase: UpdateUiState['phase']): UpdateUiState =>
  ({
    phase,
    version: '1.2.3',
    currentVersion: '1.2.2',
    percent: 0,
    lang: 'zh',
    strings: {
      title: 't',
      headline: 'h',
      desc: 'd',
      download: 'dl',
      later: 'min',
      install: 'in',
      downloading: 'ing',
      failed: 'f',
      retry: 'r',
      manualDesc: 'm',
      openDownload: 'o',
      notifyDesc: 'n',
      notifyDownload: 'd',
    },
  }) as UpdateUiState

const actions = () => ({
  onDownload: vi.fn(),
  onInstall: vi.fn(),
  onLater: vi.fn(),
  onOpenDownload: vi.fn(),
})

const parent = new FakeBrowserWindow() as unknown as Electron.BrowserWindow

beforeEach(() => {
  vi.resetModules()
  handlers.clear()
  rawHandlers.clear()
  sent.length = 0
  winOptions.length = 0
  created.length = 0
  shown.mockClear()
  focused.mockClear()
})

/** a fresh module with the six update:* channels registered on the fake ipc, as the shell composition does */
async function loadModule() {
  const mod = await import('../src/main/update-window')
  mod.registerUpdateIpc(fakeIpc)
  return mod
}

describe('update window — settings-facing surface', () => {
  it('opens non-modal (never blocks the shell window)', async () => {
    const mod = await loadModule()
    mod.showUpdateWindow(parent, state('available'), actions())
    expect(winOptions[0]!.modal).toBeUndefined()
    expect(winOptions[0]!.parent).toBe(parent)
  })

  it('broadcasts every state push to the shell window', async () => {
    const mod = await loadModule()
    mod.showUpdateWindow(parent, state('downloading'), actions())
    mod.pushUpdateState({ percent: 42 })
    const pushes = sent.filter((s) => s.channel === 'update:state-changed')
    expect(pushes).toHaveLength(2)
    expect(pushes[1]!.state!.percent).toBe(42)
  })

  it('open-for-update surfaces the dialog and starts a download that never began', async () => {
    const mod = await loadModule()
    const act = actions()
    mod.showUpdateWindow(parent, state('available'), act)
    // the dialog was minimized (window gone); About re-opens it
    mod.closeUpdateWindow()
    sent.length = 0
    const ok = handlers.get('update:open-for-update')!()
    expect(ok).toBe(true)
    expect(act.onDownload).toHaveBeenCalledTimes(1)
    // re-opening also re-broadcasts for the About row
    expect(sent.some((s) => s.channel === 'update:state-changed')).toBe(true)
  })

  it('open-for-update never restarts an in-flight or finished download', async () => {
    const mod = await loadModule()
    for (const phase of ['downloading', 'downloaded'] as const) {
      const act = actions()
      mod.showUpdateWindow(parent, state(phase), act)
      handlers.get('update:open-for-update')!()
      expect(act.onDownload).not.toHaveBeenCalled()
      mod.closeUpdateWindow()
    }
  })

  it('open-for-update reports false while no update is known', async () => {
    // Settings → About invokes these on mount, so the handlers have to answer
    // on a fresh module with no dialog ever shown — that is the common case
    // (a fresh launch with nothing known). Asserting `handlers.has(...)` only
    // proves a registration call ran, not that the invoke resolves, which is
    // how this shipped broken: the channel existed, but only after a dialog
    // had opened, so the real invoke rejected with "No handler registered".
    const mod = await loadModule()
    expect(mod.currentUpdateUiState()).toBeNull()
    expect(handlers.get('update:get-state')!()).toBeNull()
    expect(handlers.get('update:open-for-update')!()).toBe(false)
    // the pre-fix bug threw here: handlers.get(...) was undefined
    expect(handlers.get('update:open-for-update')).toBeTypeOf('function')
  })

  it('resolves the shell window through the getter, not the cached parent', async () => {
    const mod = await loadModule()
    mod.showUpdateWindow(parent, state('available'), actions())
    mod.closeUpdateWindow()
    const recreated = new FakeBrowserWindow({}) as unknown as Electron.BrowserWindow
    mod.setUpdateParentWindow(() => recreated)
    winOptions.length = 0
    expect(handlers.get('update:open-for-update')!()).toBe(true)
    expect(winOptions[0]!.parent).toBe(recreated)
  })

  it('a channel switch clears the known update and tells the About row', async () => {
    const mod = await loadModule()
    mod.showUpdateWindow(parent, state('downloaded'), actions())
    sent.length = 0
    mod.clearUpdateState()
    expect(mod.currentUpdateUiState()).toBeNull()
    expect(handlers.get('update:get-state')!()).toBeNull()
    expect(handlers.get('update:open-for-update')!()).toBe(false)
    const last = sent.filter((s) => s.channel === 'update:state-changed').at(-1)
    expect(last?.state).toBeNull()
  })

  it('exposes the freshest state for the settings row', async () => {
    const mod = await loadModule()
    expect(mod.currentUpdateUiState()).toBeNull()
    const s = state('available')
    mod.showUpdateWindow(parent, s, actions())
    expect(mod.currentUpdateUiState()).toBe(s)
  })

  it('registers every update:* channel on the given ipc and nothing on the global ipcMain', async () => {
    await loadModule()
    expect([...handlers.keys()].sort()).toEqual(Object.values(UPDATE_CHANNELS_REGISTERED).sort())
    expect(rawHandlers.size).toBe(0)
  })

  it('does not register at module load or on the first showUpdateWindow', async () => {
    const mod = await import('../src/main/update-window')
    mod.showUpdateWindow(parent, state('available'), actions())
    expect(handlers.size).toBe(0)
    expect(rawHandlers.size).toBe(0)
  })

  it('keeps the dialog channels total while no actions were ever set', async () => {
    await loadModule()
    for (const channel of ['update:download', 'update:install', 'update:later']) {
      expect(handlers.get(channel)!()).toBeUndefined()
    }
    expect(handlers.get('update:open-download')!()).toBeUndefined()
  })

  it('updateWindowContents is null with no window and the live webContents while shown', async () => {
    const mod = await loadModule()
    expect(mod.updateWindowContents()).toBeNull()
    mod.showUpdateWindow(parent, state('available'), actions())
    const live = mod.updateWindowContents()
    expect(live).toBeInstanceOf(FakeWebContents)
    expect(mod.updateWindowContents()).toBe(live)
    mod.closeUpdateWindow()
    expect(mod.updateWindowContents()).toBeNull()
  })

  it('a late `closed` of a closed window keeps the reopened window tracked', async () => {
    const mod = await loadModule()
    const act = actions()
    mod.showUpdateWindow(parent, state('available'), act)
    const first = created.at(-1)!
    mod.closeUpdateWindow()
    mod.showUpdateWindow(parent, state('available'), act)
    const second = created.at(-1)!
    expect(second).not.toBe(first)
    for (const fire of first.closedListeners) fire()
    expect(mod.updateWindowContents()).toBe(second.webContents)
    expect(mod.isUpdateWindowOpen()).toBe(true)
    // the programmatic close of the first window is not a "later" click on the second
    expect(act.onLater).not.toHaveBeenCalled()
  })
})
