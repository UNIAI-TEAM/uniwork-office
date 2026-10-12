import { describe, expect, it, vi } from 'vitest'

import { MAX_AI_IMAGE_BYTES, fetchAiImage } from '../src/main/ai-fetch-image'

// §9 #16: the main-process download behind the sheets `ai:fetch-image` IPC
// (propose_operations add_image with a URL) keeps its SSRF guard and its size
// cap. Literal addresses only, so the guard decides without DNS.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function okResponse(body: BodyInit, headers: Record<string, string> = {}) {
  return new Response(body, { status: 200, headers: { 'content-type': 'image/png', ...headers } })
}

describe('g6-12 sheets ai:fetch-image guard', () => {
  it.each([
    'http://127.0.0.1/a.png',
    'http://10.0.0.5/a.png',
    'http://192.168.1.1/a.png',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/a.png',
    'http://localhost/a.png',
    'file:///etc/passwd',
    'ftp://93.184.216.34/a.png',
  ])('refuses %s without fetching it', async (url) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okResponse(PNG))
    expect(await fetchAiImage(url, { fetchImpl, retryDelaysMs: [] })).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a public URL that redirects to a private address', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret.png' } }),
    )
    expect(
      await fetchAiImage('http://93.184.216.34/a.png', { fetchImpl, retryDelaysMs: [] }),
    ).toBeNull()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('caps the download at 20 MB', () => {
    expect(MAX_AI_IMAGE_BYTES).toBe(20 * 1024 * 1024)
  })

  it('refuses a declared Content-Length above the cap', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      okResponse(PNG, { 'content-length': String(MAX_AI_IMAGE_BYTES + 1) }),
    )
    expect(
      await fetchAiImage('http://93.184.216.34/a.png', { fetchImpl, retryDelaysMs: [] }),
    ).toBeNull()
  })

  it('stops a body without Content-Length once it passes the cap', async () => {
    const chunk = new Uint8Array(4 * 1024 * 1024)
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        // up to 400 MB in 4 MB chunks: the read must stop just past the 20 MB cap
        if (sent >= 100) controller.close()
        else {
          sent += 1
          controller.enqueue(chunk)
        }
      },
    })
    const fetchImpl = vi.fn<typeof fetch>(async () => okResponse(stream))
    expect(
      await fetchAiImage('http://93.184.216.34/a.png', { fetchImpl, retryDelaysMs: [] }),
    ).toBeNull()
    expect(sent).toBeLessThan(10)
  })

  it('returns a small public image as base64', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => okResponse(PNG))
    const result = await fetchAiImage('https://93.184.216.34/a.png', {
      fetchImpl,
      retryDelaysMs: [],
    })
    expect(result).toEqual({ base64: Buffer.from(PNG).toString('base64'), mime: 'image/png' })
  })
})
