/**
 * Wraps a streaming `Response` body so that aborting `signal` mid-stream
 * immediately rejects any pending `reader.read()` and cancels the underlying stream.
 */
export function bindResponseToSignal(
  res: Response,
  signal: AbortSignal,
  onDone: () => void,
): Response {
  const body = res.body
  if (!body) {
    onDone()
    return res
  }
  const reader = body.getReader()
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    signal.removeEventListener('abort', onAbort)
    onDone()
  }
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
  const abortError = () => {
    const err = new Error('The operation was aborted.')
    err.name = 'AbortError'
    return err
  }
  const onAbort = () => {
    finish()
    void reader.cancel().catch(() => undefined)
    try {
      streamController?.error(abortError())
    } catch {
      // already closed
    }
  }
  if (signal.aborted) {
    finish()
    void reader.cancel().catch(() => undefined)
    const wrapped = new ReadableStream<Uint8Array>({
      start(c) {
        c.error(abortError())
      },
    })
    return new Response(wrapped, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    })
  }
  signal.addEventListener('abort', onAbort, { once: true })
  const wrapped = new ReadableStream<Uint8Array>(
    {
      start(c) {
        streamController = c
      },
      async pull(c) {
        if (signal.aborted) {
          finish()
          c.error(abortError())
          return
        }
        try {
          const { done, value } = await reader.read()
          if (signal.aborted) {
            finish()
            c.error(abortError())
            return
          }
          if (done) {
            finish()
            c.close()
            return
          }
          c.enqueue(value)
        } catch (err) {
          finish()
          c.error(err)
        }
      },
      cancel(reason) {
        finish()
        return reader.cancel(reason)
      },
    },
    { highWaterMark: 0 },
  )
  return new Response(wrapped, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
}
