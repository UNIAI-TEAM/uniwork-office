import type { IpcMain } from 'electron'
import { createIpcSenderGuard, trustedUrlRules } from '../src/main/ipc-sender-guard'

/**
 * UNI-2076 s8-guard: the Ask UNI registrars get the real UNI-2073 sender guard
 * in tests, the way index.ts hands them `guardedIpc`. A fake ipcMain records
 * the guarded listeners; `call` runs one like a renderer invoke (a refusal is
 * a rejected promise with IPC_SENDER_REFUSED).
 */

export const SHELL_URL = 'file:///app/out/renderer/index.html'
export const EDITOR_URL = 'genoffice-app://docs/index.html'
export const FOREIGN_URL = 'https://evil.example/index.html'

type Listener = (event: unknown, ...args: unknown[]) => unknown

export interface GuardedFakeIpc {
  /** the guarded object: hand it to the registrar under test */
  ipcMain: IpcMain
  /** the guarded listeners by channel (tests clear it between registrations) */
  handlers: Map<string, Listener>
  call(channel: string, event: unknown, ...args: unknown[]): Promise<unknown>
}

export function createGuardedFakeIpc(deps: {
  /** the shell window's webContents, read on every call */
  shell(): unknown
  /** webContents ids of editor views */
  editors?: ReadonlySet<number>
}): GuardedFakeIpc {
  const handlers = new Map<string, Listener>()
  const guard = createIpcSenderGuard({
    shellContents: () => deps.shell() as never,
    isTrustedEditorContents: (id) => deps.editors?.has(id) === true,
    ...trustedUrlRules({ env: {}, shellRendererDir: '/app/out/renderer' }),
    log: () => undefined,
  })
  const raw = { handle: (channel: string, fn: Listener) => void handlers.set(channel, fn) }
  return {
    ipcMain: guard.guarded(raw) as unknown as IpcMain,
    handlers,
    call: async (channel, event, ...args) => handlers.get(channel)!(event, ...args),
  }
}

/** a webContents-like with a main frame at `url`; `send` and the listeners are recorded where a run needs them */
export function fakeView(id: number, url: string) {
  const sent: unknown[] = []
  let destroyed = false
  const listeners = new Set<() => void>()
  const view = {
    id,
    sent,
    mainFrame: { name: `main-${id}`, url },
    isDestroyed: () => destroyed,
    send: (_channel: string, ev: unknown) => void sent.push(ev),
    once: (_name: string, fn: () => void) => void listeners.add(fn),
    on: () => undefined,
    removeListener: (_name: string, fn: () => void) => void listeners.delete(fn),
    destroy() {
      destroyed = true
      for (const fn of [...listeners]) fn()
    },
  }
  return view
}
export type FakeView = ReturnType<typeof fakeView>

/** the event ipcMain hands a handler for a call from the view's main frame */
export const fromMainFrame = (view: FakeView) => ({ sender: view, senderFrame: view.mainFrame })
