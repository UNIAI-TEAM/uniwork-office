import type { MenuItemConstructorOptions } from 'electron'
import type { OfflineDocState } from '../../../shared/offline-library'

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
