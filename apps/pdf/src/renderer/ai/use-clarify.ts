import { useCallback, useRef, useState } from 'react'
import type { ClarifyQuestion } from './tools'

export interface ClarifyReply {
  answers: string
  cancelled?: boolean
}

export interface ClarifyReceipt {
  /** index of the user message the answered card belongs to */
  afterIdx: number
  qa: Array<{ q: string; a: string }>
}

const CANCELLED: ClarifyReply = { answers: '', cancelled: true }

/**
 * Panel side of ask_clarification: `ask` parks the run on a promise and exposes the
 * questions as `active` for the card; the user's answer, a skip, a stop / new chat
 * (`dismiss`) or an aborted run settles it. Every callback is stable, so the agent
 * loop (built once) can hold on to `ask`.
 */
export function useClarify() {
  const [active, setActive] = useState<ClarifyQuestion[] | null>(null)
  const [receipts, setReceipts] = useState<ClarifyReceipt[]>([])
  const resolverRef = useRef<((r: ClarifyReply) => void) | null>(null)

  const settle = useCallback((reply: ClarifyReply) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setActive(null)
    resolve?.(reply)
  }, [])

  const ask = useCallback(
    (questions: ClarifyQuestion[], signal?: AbortSignal): Promise<ClarifyReply> =>
      new Promise((resolve) => {
        if (signal?.aborted) {
          resolve(CANCELLED)
          return
        }
        // a second card replaces the first: the earlier run is answered as skipped
        resolverRef.current?.(CANCELLED)
        const mine = (r: ClarifyReply) => resolve(r)
        resolverRef.current = mine
        setActive(questions)
        signal?.addEventListener(
          'abort',
          () => {
            if (resolverRef.current === mine) settle(CANCELLED)
          },
          { once: true },
        )
      }),
    [settle],
  )

  const submit = useCallback(
    (answers: string, qa: ClarifyReceipt['qa'], afterIdx: number) => {
      setReceipts((prev) => [...prev, { afterIdx, qa }])
      settle({ answers })
    },
    [settle],
  )
  const skip = useCallback(() => settle(CANCELLED), [settle])
  /** stop / new chat / unmount: leave no promise dangling */
  const dismiss = skip
  const clearReceipts = useCallback(() => setReceipts([]), [])

  return { active, receipts, ask, submit, skip, dismiss, clearReceipts }
}
