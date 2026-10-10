/**
 * The html frame's side of the preview handshake (GO-B4, UNI-1014, CONTRACT C15(1)).
 *
 * The preview document (./public/preview.html) runs the user's page with its scripts in an
 * opaque origin. The frame never listens to window messages from it: once the preview page has
 * loaded, the frame posts ONE `init` message with the page source and a MessagePort, and from
 * then on only that port carries inspector traffic. A forged window.postMessage from the page (to
 * the frame or the host) therefore reaches no listener of the html module, and whatever arrives
 * on the port is handed to the renderer unvalidated for its strict parser
 * (apps/html/src/renderer/preview/inspector-validate.ts); nothing from it is ever evaluated.
 *
 * Boot check: preview.html acknowledges the port before it writes the page. Without that answer
 * (a host that serves preview.html under the frame's policy blocks its inline boot script) the
 * caller is told to fall back to the static preview.
 */
export const PREVIEW_NS = 'uniwork.office.html.preview'

/** generous: the boot script runs before anything else in the preview, but the box may be busy */
export const PREVIEW_BOOT_TIMEOUT_MS = 8_000

export interface PreviewChannelOptions {
  /** the page source to show (the latest instrumented copy, pictures inlined) */
  html: () => Promise<string>
  onMessage: (data: unknown) => void
  onFailed: () => void
  bootTimeoutMs?: number
}

export interface PreviewChannel {
  post(msg: unknown): void
  close(): void
}

export function openPreviewChannel(target: Window, opts: PreviewChannelOptions): PreviewChannel {
  const channel = new MessageChannel()
  const port = channel.port1
  let booted = false
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  /** messages the renderer posts before the boot answer (e.g. right after gx:ready) */
  const queue: unknown[] = []

  port.onmessage = (event: MessageEvent) => {
    if (closed) return
    if (!booted) {
      const data = event.data as { ns?: unknown; type?: unknown } | null
      if (data && data.ns === PREVIEW_NS && data.type === 'booted') {
        booted = true
        clearTimeout(timer)
        for (const msg of queue.splice(0)) port.postMessage(msg)
      }
      return
    }
    opts.onMessage(event.data)
  }

  void opts.html().then(
    (html) => {
      if (closed) return
      // the preview's origin is opaque: no target origin can name it. The message goes to the
      // document that loaded in this iframe for this src (the caller connects once per load)
      target.postMessage({ ns: PREVIEW_NS, type: 'init', html }, '*', [channel.port2])
      timer = setTimeout(() => {
        if (!booted && !closed) opts.onFailed()
      }, opts.bootTimeoutMs ?? PREVIEW_BOOT_TIMEOUT_MS)
    },
    (err: unknown) => {
      console.warn('[html] preview copy failed:', err)
      if (!closed) opts.onFailed()
    },
  )

  return {
    post(msg) {
      if (closed) return
      if (booted) port.postMessage(msg)
      else queue.push(msg)
    },
    close() {
      closed = true
      clearTimeout(timer)
      queue.length = 0
      port.onmessage = null
      port.close()
    },
  }
}
