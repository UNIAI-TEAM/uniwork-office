import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * isSlidesAudienceWebContents (src/main/presenter-show.ts): the shell's IPC sender guard
 * trusts the audience window of a multi-screen show as an editor view, so the registry
 * must follow the window's life. Electron and the session state are faked.
 */

const { handlers, audienceWins, FakeWindow } = vi.hoisted(() => {
  const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>()
  const audienceWins: InstanceType<typeof FakeWindow>[] = []
  let nextId = 100
  class FakeWindow {
    webContents = { id: nextId++ }
    handlers = new Map<string, () => void>()
    constructor() {
      audienceWins.push(this)
    }
    once = (event: string, fn: () => void): void => {
      this.handlers.set(event, fn)
    }
    on = (event: string, fn: () => void): void => {
      this.handlers.set(event, fn)
    }
    loadURL = async (): Promise<void> => undefined
    isDestroyed = (): boolean => false
    static fromWebContents = (): null => null
  }
  return { handlers, audienceWins, FakeWindow }
})

vi.mock('electron', () => ({
  BrowserWindow: FakeWindow,
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
    on: (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
  },
  screen: {
    getPrimaryDisplay: () => ({ id: 1, bounds: { x: 0, y: 0, width: 100, height: 100 } }),
    getDisplayMatching: () => ({ id: 1 }),
    getAllDisplays: () => [
      { id: 1, bounds: { x: 0, y: 0, width: 100, height: 100 } },
      { id: 2, bounds: { x: 100, y: 0, width: 100, height: 100 } },
    ],
  },
}))

vi.mock('@genoffice/electron-utils', () => ({ rendererUrl: () => 'genoffice-app://slides/' }))

vi.mock('../src/main/session-state', () => ({
  runtime: { preloadPath: '/p.js', rendererDevUrl: undefined },
  sessions: new Map([[7, {}]]),
  viewerWcIds: new Set<number>(),
  windowRefs: { shellWindow: null },
}))

import { isSlidesAudienceWebContents, registerPresenterIpc } from '../src/main/presenter-show'

beforeEach(() => {
  handlers.clear()
  audienceWins.length = 0
  registerPresenterIpc()
})

describe('isSlidesAudienceWebContents', () => {
  it('is true for the audience window of a live show only', async () => {
    expect(isSlidesAudienceWebContents(7)).toBe(false)
    const presenter = { id: 7, once: vi.fn() }
    await handlers.get('slides:presenter-start')!({ sender: presenter })
    const audienceId = audienceWins[0]!.webContents.id
    expect(isSlidesAudienceWebContents(audienceId)).toBe(true)
    // the presenter itself is an ordinary editor view, not an audience window
    expect(isSlidesAudienceWebContents(7)).toBe(false)
    audienceWins[0]!.handlers.get('closed')!()
    expect(isSlidesAudienceWebContents(audienceId)).toBe(false)
  })
})
