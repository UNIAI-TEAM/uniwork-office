/**
 * The workbook each tab opened last, kept per tab (webContents id) after the
 * open consumed its one-shot queue entry: the opening screen's Retry queues it
 * again. Shell-queued opens and picker opens both record here, so Retry always
 * restarts the open the user is looking at, never an earlier one.
 */
export interface OpenRetryPaths {
  /** `onFirst` runs the first time a tab is remembered (cleanup registration) */
  remember(tabId: number, path: string, onFirst?: () => void): void
  get(tabId: number): string | undefined
  forget(tabId: number): void
}

export function createOpenRetryPaths(): OpenRetryPaths {
  const paths = new Map<number, string>()
  return {
    remember(tabId, path, onFirst) {
      if (!paths.has(tabId)) onFirst?.()
      paths.set(tabId, path)
    },
    get: (tabId) => paths.get(tabId),
    forget: (tabId) => {
      paths.delete(tabId)
    },
  }
}
