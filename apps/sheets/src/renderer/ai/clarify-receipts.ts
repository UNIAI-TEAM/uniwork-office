/**
 * Answered ask_clarification receipts (G6-12). After the user answers a card the panel keeps
 * the questions and answers as a view-only receipt under the user message that started the
 * run (html / pdf / slides do the same). The receipt rides on that message, so
 * a chat trim or restored history cannot shift it onto another message; a skip leaves none.
 */
export interface ClarifyQa {
  readonly q: string
  readonly a: string
}

interface WithReceipts {
  readonly role: string
  readonly clarifyReceipts?: readonly (readonly ClarifyQa[])[] | undefined
}

/** attach an answered card to the newest user message (no user message: unchanged) */
export function withReceipt<T extends WithReceipts>(
  chat: readonly T[],
  qa: readonly ClarifyQa[],
): T[] {
  const idx = chat.map((entry) => entry.role).lastIndexOf('user')
  if (idx < 0 || qa.length === 0) return chat as T[]
  const next = chat.slice()
  const entry = next[idx]!
  next[idx] = { ...entry, clarifyReceipts: [...(entry.clarifyReceipts ?? []), qa] }
  return next
}

/** drop every receipt (another document opened, restored history landed): the same array when none */
export function withoutReceipts<T extends WithReceipts>(chat: readonly T[]): T[] {
  if (!chat.some((entry) => entry.clarifyReceipts)) return chat as T[]
  return chat.map(({ clarifyReceipts: _dropped, ...rest }) => rest as unknown as T)
}
