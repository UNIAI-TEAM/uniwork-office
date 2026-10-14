/// Preload half of the UniWork AI availability flag (see ./uniwork-ai-flag): exposes
/// window.uniworkAiFlag { get, onChange } to the renderer. Called once from every editor preload
/// and the shell preload; the renderer mirrors the value into its own provider list.
import { contextBridge, ipcRenderer } from 'electron'
import {
  UNIWORK_AI_FLAG_BRIDGE_KEY,
  UNIWORK_AI_FLAG_CHANGED,
  UNIWORK_AI_FLAG_GET,
  parseUniworkAiFlag,
} from './uniwork-ai-flag'
import type { UniworkAiFlagBridge } from './uniwork-ai-flag'

/** the ipcRenderer surface the bridge uses (a test hands a fake) */
export interface UniworkAiFlagIpc {
  invoke(channel: string): Promise<unknown>
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void
  off(channel: string, listener: (event: unknown, payload: unknown) => void): void
}

export function createUniworkAiFlagBridge(ipc: UniworkAiFlagIpc): UniworkAiFlagBridge {
  return {
    get: async () => parseUniworkAiFlag(await ipc.invoke(UNIWORK_AI_FLAG_GET)),
    onChange: (handler) => {
      const listener = (_event: unknown, payload: unknown) => handler(parseUniworkAiFlag(payload))
      ipc.on(UNIWORK_AI_FLAG_CHANGED, listener)
      return () => ipc.off(UNIWORK_AI_FLAG_CHANGED, listener)
    },
  }
}

export function installUniworkAiFlagBridge(): void {
  contextBridge.exposeInMainWorld(
    UNIWORK_AI_FLAG_BRIDGE_KEY,
    createUniworkAiFlagBridge({
      invoke: (channel) => ipcRenderer.invoke(channel),
      on: (channel, listener) => ipcRenderer.on(channel, listener),
      off: (channel, listener) => void ipcRenderer.removeListener(channel, listener),
    }),
  )
}
