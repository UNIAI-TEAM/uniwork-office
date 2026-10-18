import { useEffect, useState } from 'react'
import type { PdfUniworkState } from '../shared/ipc'

/** A plain local file: not bound, editable */
export const PLAIN_PDF_STATE: PdfUniworkState = { bound: false, readOnly: false }

/**
 * Ask main whether `path` is a UniWork copy. The browser harness may not
 * expose the method, and the call may fail: either answer reads as a plain
 * local file (main still refuses a write it must not allow).
 */
export async function queryPdfUniworkState(
  api: { uniworkState?: (path: string) => Promise<PdfUniworkState> },
  path: string,
): Promise<PdfUniworkState> {
  try {
    const state = await api.uniworkState?.(path)
    return { bound: state?.bound === true, readOnly: state?.readOnly === true }
  } catch {
    return PLAIN_PDF_STATE
  }
}

/**
 * EL-1(b) fix10: whether an open editor box with typed text counts as unsaved
 * for the close guard. `platformReadOnly` is view-only / encrypted, never the
 * UniWork lock: a box typed before the lock was lost in place keeps its text,
 * so closing must still ask.
 */
export function openBoxesCountAsDirty(
  platformReadOnly: boolean,
  hasDraft: boolean,
  pendingOpen: () => boolean,
): boolean {
  return !platformReadOnly && hasDraft ? pendingOpen() : false
}

export interface PdfUniworkSeam {
  uniworkState?(path: string): Promise<PdfUniworkState>
  onUniworkStateChanged?(cb: (path: string) => void): () => void
}

/** Query main for `filePath` and re-query when the lock ping names that path. */
export function usePdfUniworkState(
  api: PdfUniworkSeam | null | undefined,
  filePath: string | null | undefined,
): PdfUniworkState {
  const [uniwork, setUniwork] = useState<PdfUniworkState>(PLAIN_PDF_STATE)
  useEffect(() => {
    let live = true
    if (!filePath) {
      setUniwork(PLAIN_PDF_STATE)
      return
    }
    const query = () => {
      void queryPdfUniworkState(api ?? {}, filePath).then((state) => {
        if (live) setUniwork(state)
      })
    }
    query()
    // EL-1(b): the edit lock makes readOnly change while the PDF stays open;
    // the shell pings the affected path, and only a ping for this file re-queries.
    const unsubscribe = api?.onUniworkStateChanged?.((p) => {
      if (p === filePath) query()
    })
    return () => {
      live = false
      unsubscribe?.()
    }
  }, [api, filePath])
  return uniwork
}
