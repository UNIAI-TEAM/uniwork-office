/**
 * Resolves a handoff URL to bytes without a network fetch. Returns undefined for
 * a URL it does not own, so fetchDocBytes falls through to fetch(). Desktop
 * registers none; the web bridge registers one for its in-page handles because
 * the frame CSP's connect-src (no blob:/data:) refuses fetch() of them.
 */
export type DocBytesResolver = (url: string) => Uint8Array | undefined

let resolver: DocBytesResolver | null = null

/** install (or clear with null) the in-page resolver consulted before fetch() */
export function setDocBytesResolver(next: DocBytesResolver | null): void {
  resolver = next
}

/** Fetch the bytes behind a one-shot handoff URL from the main process (see main/byte-handoff.ts). */
export async function fetchDocBytes(url: string): Promise<Uint8Array> {
  const local = resolver?.(url)
  if (local) return local
  const res = await fetch(url)
  if (!res.ok) throw new Error(`document bytes unavailable (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}
