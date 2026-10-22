import { useCallback, useEffect, useRef, type RefObject } from 'react'

/**
 * Load more unmounts with the last page, and the focus that sat on it would fall to the page
 * body. Call the returned function when Load more is pressed; once that read has finished and
 * no further page follows, the first appended row (or the last row when the page came back
 * empty) takes the focus. The rows are `tabIndex={-1}` children of `listRef`. Focus that went
 * somewhere else on purpose is left alone.
 */
export function useFocusAfterLastPage(
  listRef: RefObject<HTMLElement | null>,
  rowCount: number,
  hasMore: boolean,
  loadingMore: boolean,
): () => void {
  const from = useRef<number | null>(null)
  const rowCountRef = useRef(rowCount)
  rowCountRef.current = rowCount

  useEffect(() => {
    const start = from.current
    if (start === null || loadingMore) return
    from.current = null
    if (hasMore) return
    const active = document.activeElement
    if (active && active !== document.body) return
    const rows = listRef.current?.children
    const row = rows?.[Math.min(start, (rows?.length ?? 1) - 1)]
    if (row instanceof HTMLElement) row.focus()
  }, [rowCount, hasMore, loadingMore, listRef])

  return useCallback(() => {
    from.current = rowCountRef.current
  }, [])
}
