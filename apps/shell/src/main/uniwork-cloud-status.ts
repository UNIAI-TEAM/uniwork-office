/**
 * Main half of the UniWork cloud status bridge for editor renderers (see
 * electron-utils uniwork-cloud-status): answers a renderer's pull with the
 * current token-free cloud status + organization identity snapshot, handles
 * "Chi tiết" (open Settings > Account) and "Đăng nhập" (sign in), and
 * broadcasts every status change to all webContents.
 */
import type { IpcMain, WebContents } from 'electron'
import {
  UNIWORK_CLOUD_STATUS_CHANGED,
  UNIWORK_CLOUD_STATUS_GET,
  UNIWORK_CLOUD_STATUS_OPEN_ACCOUNT,
  UNIWORK_CLOUD_STATUS_SIGN_IN,
  type UniworkCloudStatusSnapshot,
} from '@genoffice/electron-utils/uniwork-ai-flag'

export interface UniworkCloudStatusIpcDeps {
  get(): UniworkCloudStatusSnapshot | null
  openAccountSettings?(): void | Promise<void>
  signIn?(): void | Promise<void>
}

export function registerUniworkCloudStatusIpc(
  ipc: Pick<IpcMain, 'handle'>,
  deps: UniworkCloudStatusIpcDeps,
): void {
  ipc.handle(UNIWORK_CLOUD_STATUS_GET, () => deps.get())
  ipc.handle(UNIWORK_CLOUD_STATUS_OPEN_ACCOUNT, async () => {
    await deps.openAccountSettings?.()
  })
  ipc.handle(UNIWORK_CLOUD_STATUS_SIGN_IN, async () => {
    await deps.signIn?.()
  })
}

export function broadcastUniworkCloudStatus(
  status: UniworkCloudStatusSnapshot | null,
  targets: readonly Pick<WebContents, 'isDestroyed' | 'send'>[],
): void {
  for (const wc of targets) if (!wc.isDestroyed()) wc.send(UNIWORK_CLOUD_STATUS_CHANGED, status)
}
