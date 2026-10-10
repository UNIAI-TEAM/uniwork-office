import { onJournalSuppressionChange } from './univer-state'

/// The slice of Univer's workbook facade the lock drives.
export interface EditableWorkbook {
  setEditable(value: boolean): unknown
}

/**
 * View-only UniWork documents block editing through Univer's workbook
 * permission. That permission also vetoes the loader's own set-range-values
 * installs, so a workbook locked before its first range streams in rendered as
 * an empty grid. Every programmatic install runs under journalSuppression:
 * the lock opens for exactly that window and closes again after, so user
 * commands stay blocked while file content still reaches the grid.
 */
export interface ViewOnlyLock {
  /** Locks `workbook` (null releases the previous lock); a fresh load calls this every time. */
  set(workbook: EditableWorkbook | null): void
}

export function createViewOnlyLock(
  subscribe: (listener: (active: boolean) => void) => () => void = onJournalSuppressionChange,
): ViewOnlyLock {
  let locked: EditableWorkbook | null = null
  let installing = false
  const apply = (workbook: EditableWorkbook, editable: boolean): void => {
    try {
      workbook.setEditable(editable)
    } catch {
      // best effort: Save stays refused in main
    }
  }
  subscribe((active) => {
    installing = active
    if (locked) apply(locked, active)
  })
  return {
    set(workbook) {
      locked = workbook
      if (workbook) apply(workbook, installing)
    },
  }
}

export const viewOnlyLock: ViewOnlyLock = createViewOnlyLock()
