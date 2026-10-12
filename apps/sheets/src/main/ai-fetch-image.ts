/**
 * Download behind the sheets `ai:fetch-image` IPC (propose_operations add_image
 * with a URL). Standalone parity with docs-main's shell-wide handler:
 * AI-supplied URLs are prompt-injectable, so fetchRemoteImage refuses non-http
 * schemes and private/link-local targets and validates every redirect hop.
 * Size-capped to match the local add_image limit.
 */
import { fetchRemoteImage } from '@genoffice/electron-utils/remote-image'
import { z } from 'zod'

/// Same ceiling as local add_image (readLocalImage's 20MB check)
export const MAX_AI_IMAGE_BYTES = 20 * 1024 * 1024

export async function fetchAiImage(
  url: unknown,
  options: Parameters<typeof fetchRemoteImage>[1] = {},
): Promise<{ base64: string; mime: string } | null> {
  try {
    const resp = await fetchRemoteImage(z.string().parse(url), options)
    if (!resp || !resp.ok || !resp.body) return null
    const declared = Number(resp.headers.get('content-length') ?? 0)
    if (declared > MAX_AI_IMAGE_BYTES) return null
    // Stream with a running cap: a missing/understated Content-Length must
    // not let a prompt-injected URL buffer unbounded bytes before a
    // post-hoc size check
    const reader = resp.body.getReader()
    const chunks: Buffer[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_AI_IMAGE_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(Buffer.from(value))
    }
    const buf = Buffer.concat(chunks)
    const ct = resp.headers.get('content-type') ?? ''
    const mime = ct.includes('png') ? 'image/png' : ct.includes('gif') ? 'image/gif' : 'image/jpeg'
    return { base64: buf.toString('base64'), mime }
  } catch {
    return null
  }
}
