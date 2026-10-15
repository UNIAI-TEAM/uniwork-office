/**
 * Main half of the UniWork AI availability flag (see electron-utils uniwork-ai-flag): answers a
 * renderer's pull with the process flag and broadcasts every change to all webContents, so each
 * renderer's own provider list shows or hides the `uniwork` entry. The flag itself is computed in
 * uniwork-auth (S7 conditions) and set with setUniworkAiAvailable.
 */
import type { IpcMain, WebContents } from 'electron'
import { uniworkAiAvailable } from '@genoffice/ai-provider'
import {
  UNIWORK_AI_FLAG_CHANGED,
  UNIWORK_AI_FLAG_GET,
} from '@genoffice/electron-utils/uniwork-ai-flag'

export function registerUniworkAiFlagIpc(
  ipc: Pick<IpcMain, 'handle'>,
  get: () => boolean = uniworkAiAvailable,
): void {
  ipc.handle(UNIWORK_AI_FLAG_GET, () => get())
}

export function broadcastUniworkAiFlag(
  available: boolean,
  targets: readonly Pick<WebContents, 'isDestroyed' | 'send'>[],
): void {
  for (const wc of targets) if (!wc.isDestroyed()) wc.send(UNIWORK_AI_FLAG_CHANGED, available)
}

export {
  broadcastUniworkCloudStatus,
  registerUniworkCloudStatusIpc,
  type UniworkCloudStatusIpcDeps,
} from './uniwork-cloud-status'
