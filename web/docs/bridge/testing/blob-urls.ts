/**
 * jsdom has no object URLs: a registry-backed URL.createObjectURL so tests can
 * read back the bytes behind an OpenFileResult.dataUrl.
 */
import { vi } from 'vitest'

const blobs = new Map<string, Blob>()

export function installBlobUrls(): void {
  blobs.clear()
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:fake-${blobs.size + 1}`
    blobs.set(url, blob)
    return url
  })
  URL.revokeObjectURL = vi.fn((url: string) => void blobs.delete(url))
}

/** the bytes an object URL serves (throws for an unknown or revoked URL) */
export async function bytesAt(url: string): Promise<Uint8Array> {
  const blob = blobs.get(url)
  if (!blob) throw new Error(`no blob behind ${url}`)
  // jsdom's Blob has no stream(): read it the way the page would before fetch existed
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
  return new Uint8Array(buffer)
}
