/**
 * Contract shared by the six editor preload tests (UNI-1339 group 5): a
 * preload that ran installAiRunBridge exposes window.uniworkAiRun, and what its
 * reportAiRun sends is exactly what the shell registry accepts. Each app's test
 * mocks electron with `aiRunElectronMock(capture)` (vi.mock is hoisted per file)
 * and then calls `expectAiRunContract(capture, importPreload)`.
 */
import { expect } from 'vitest'
import { AI_RUN_BRIDGE_KEY, AI_RUN_CHANNEL } from '@genoffice/electron-utils/ai-run'
import type { AiRunBridge } from '@genoffice/electron-utils/ai-run'
import type { WebContents } from 'electron'
import { isAiRunning, noteAiRun, resetAiRunRegistry } from '../../src/main/ai-run-registry'

export interface AiRunCapture {
  exposed: Map<string, unknown>
  sent: Array<{ channel: string; payload: unknown }>
}

/** the electron module a preload sees: records exposeInMainWorld and ipcRenderer.send */
export function aiRunElectronMock(capture: AiRunCapture): Record<string, unknown> {
  return {
    contextBridge: {
      exposeInMainWorld: (name: string, value: unknown) => capture.exposed.set(name, value),
    },
    ipcRenderer: {
      invoke: async () => undefined,
      on: () => undefined,
      once: () => undefined,
      send: (channel: string, payload: unknown) => capture.sent.push({ channel, payload }),
      sendSync: () => undefined,
      removeListener: () => undefined,
      removeAllListeners: () => undefined,
    },
    webUtils: { getPathForFile: () => '' },
  }
}

/** a webContents stand-in the registry can watch; `destroy()` fires 'destroyed' */
export function fakeSender(id: number): WebContents & { destroy(): void } {
  const handlers = new Map<string, Array<() => void>>()
  let destroyed = false
  const add = (event: string, fn: () => void) => {
    handlers.set(event, [...(handlers.get(event) ?? []), fn])
  }
  return {
    id,
    isDestroyed: () => destroyed,
    once: (event: string, fn: () => void) => add(event, fn),
    on: (event: string, fn: () => void) => add(event, fn),
    emit: (event: string) => handlers.get(event)?.forEach((fn) => fn()),
    destroy() {
      destroyed = true
      handlers.get('destroyed')?.forEach((fn) => fn())
    },
  } as unknown as WebContents & { destroy(): void }
}

export async function expectAiRunContract(
  capture: AiRunCapture,
  importPreload: () => Promise<unknown>,
): Promise<void> {
  resetAiRunRegistry()
  await importPreload()
  const bridge = capture.exposed.get(AI_RUN_BRIDGE_KEY) as AiRunBridge | undefined
  expect(typeof bridge?.reportAiRun).toBe('function')

  const sender = fakeSender(4242)
  const deliver = () => {
    const last = capture.sent.at(-1)!
    expect(last.channel).toBe(AI_RUN_CHANNEL)
    expect(noteAiRun(sender, last.payload)).toBe(true)
  }

  bridge!.reportAiRun({ state: 'running', runId: 'turn-1' })
  deliver()
  expect(isAiRunning(sender.id)).toBe(true)

  bridge!.reportAiRun({ state: 'idle', runId: 'turn-1' })
  deliver()
  expect(isAiRunning(sender.id)).toBe(false)

  // the view goes away mid-run (tab closed): the flag goes with it
  bridge!.reportAiRun({ state: 'running' })
  deliver()
  expect(isAiRunning(sender.id)).toBe(true)
  sender.destroy()
  expect(isAiRunning(sender.id)).toBe(false)
  resetAiRunRegistry()
}
