/// Preload half of the UniWork cloud status bridge (see ./uniwork-cloud-status): exposes
/// window.uniworkCloudStatus { get, onChange, openAccountSettings, signIn } to the renderer.
import { contextBridge, ipcRenderer } from 'electron'
import {
  UNIWORK_CLOUD_STATUS_BRIDGE_KEY,
  UNIWORK_CLOUD_STATUS_CHANGED,
  UNIWORK_CLOUD_STATUS_GET,
  UNIWORK_CLOUD_STATUS_OPEN_ACCOUNT,
  UNIWORK_CLOUD_STATUS_SIGN_IN,
  parseUniworkCloudStatusSnapshot,
} from './uniwork-cloud-status'
import type { UniworkCloudStatusBridge } from './uniwork-cloud-status'

/** the ipcRenderer surface the cloud status bridge uses (a test hands a fake) */
export interface UniworkCloudStatusIpc {
  invoke(channel: string): Promise<unknown>
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void
  off(channel: string, listener: (event: unknown, payload: unknown) => void): void
}

export function createUniworkCloudStatusBridge(
  ipc: UniworkCloudStatusIpc,
): UniworkCloudStatusBridge {
  return {
    get: async () => {
      try {
        return parseUniworkCloudStatusSnapshot(await ipc.invoke(UNIWORK_CLOUD_STATUS_GET))
      } catch (error) {
        console.warn('[uniwork-cloud-status] get failed:', error)
        return null
      }
    },
    onChange: (handler) => {
      const listener = (_event: unknown, payload: unknown) =>
        handler(parseUniworkCloudStatusSnapshot(payload))
      ipc.on(UNIWORK_CLOUD_STATUS_CHANGED, listener)
      return () => ipc.off(UNIWORK_CLOUD_STATUS_CHANGED, listener)
    },
    openAccountSettings: async () => {
      try {
        await ipc.invoke(UNIWORK_CLOUD_STATUS_OPEN_ACCOUNT)
      } catch {
        // standalone editor with no shell handler: no-op
      }
    },
    signIn: async () => {
      try {
        await ipc.invoke(UNIWORK_CLOUD_STATUS_SIGN_IN)
      } catch {
        // standalone editor with no shell handler: no-op
      }
    },
  }
}

export function installUniworkCloudStatusBridge(): void {
  contextBridge.exposeInMainWorld(
    UNIWORK_CLOUD_STATUS_BRIDGE_KEY,
    createUniworkCloudStatusBridge({
      invoke: (channel) => ipcRenderer.invoke(channel),
      on: (channel, listener) => ipcRenderer.on(channel, listener),
      off: (channel, listener) => void ipcRenderer.removeListener(channel, listener),
    }),
  )
}
