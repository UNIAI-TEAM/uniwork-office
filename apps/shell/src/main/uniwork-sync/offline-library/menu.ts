import type { MenuItemConstructorOptions } from 'electron'
import type { OfflineDocState, OfflineUnpinResult } from '../../../shared/offline-library'

/**
 * G5-05u (B8): the "Dùng khi không có mạng" / "Bỏ dùng khi không có mạng" item
 * of a tab's native context menu. Only a UniWork-bound tab gets one; taking a
 * new pin is hidden while the org capability `offline_library` is off
 * (OQ-UX11 a) - removing a pinned copy stays available.
 */
export function offlineTabMenuItem(input: {
  /** the UniWork binding of the tab, or null for a plain local file */
  bound: { documentId: string; workspaceId: string; orgId: string } | null
  /** `offlineState(documentId)`, read before the menu is built */
  state: OfflineDocState
  labels: { pin: string; unpin: string }
  pin(): void
  unpin(): void
}): MenuItemConstructorOptions | null {
  if (!input.bound) return null
  if (input.state.pinned) {
    return { label: input.labels.unpin, click: () => input.unpin() }
  }
  if (!input.state.capabilityOn) return null
  return { label: input.labels.pin, click: () => input.pin() }
}

export interface OfflineTabAccount {
  deploymentId: string
  accountId: string
}

/**
 * G5-05u (B8, BE-R1-3, BE-R2-7): the tab menu's unpin. The engine answers
 * `needs_confirm` while the document still has drafts or intents. A native menu
 * cannot host the renderer's confirm popover, so the caller's own confirm is
 * asked and the call repeated with `confirmed: true`; anything but a confirmed
 * answer, or an account change while the confirm dialog was open (BE-R2-7),
 * leaves the pin, its drafts and its quota untouched - the item never unpins on
 * its own or across accounts.
 */
export async function unpinTabDocument(input: {
  unpin(documentId: string, options?: { confirmed?: boolean }): Promise<OfflineUnpinResult>
  documentId: string
  /** the caller's confirm (a native message box): true = the user accepted */
  confirm(): Promise<boolean>
  /** the active account (deployment + account id): captured before confirm and rechecked after (BE-R2-7) */
  account?(): OfflineTabAccount | null
}): Promise<void> {
  const before = input.account ? input.account() : undefined
  if (before === null) return
  const asked = await input.unpin(input.documentId)
  if (asked.ok || asked.code !== 'needs_confirm') return
  if (!(await input.confirm())) return
  if (input.account) {
    const after = input.account()
    if (
      !after ||
      !before ||
      after.deploymentId !== before.deploymentId ||
      after.accountId !== before.accountId
    ) {
      return
    }
  }
  await input.unpin(input.documentId, { confirmed: true })
}
