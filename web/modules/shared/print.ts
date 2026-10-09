/**
 * Print a self-contained HTML document through the browser print dialog (GO-B4: Markdown and
 * HTML "Export PDF" / host `print` on the web = print dialog, lane decision 5, no server route).
 *
 * The document goes into a hidden `srcdoc` iframe with `sandbox="allow-same-origin allow-modals"`:
 * same-origin so the bridge can call `print()` on it and wait for `afterprint`, but WITHOUT
 * allow-scripts, so nothing in the document can run even though it shares the frame's origin.
 * The srcdoc inherits the frame CSP (no remote loads). Callers pass trusted print HTML (Markdown:
 * built from the editor DOM) or a static copy (HTML: ./static-html.ts).
 */

/** how long a print may stay open before the promise settles anyway (Firefox/Safari return at once) */
const PRINT_TIMEOUT_MS = 10 * 60_000

export function printHtmlDocument(html: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals')
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    Object.assign(frame.style, {
      position: 'fixed',
      right: '100%',
      bottom: '100%',
      width: '0',
      height: '0',
      border: '0',
    })
    let timer = 0
    let done = false
    const finish = (result: { ok: boolean; error?: string }) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      frame.remove()
      resolve(result)
    }
    frame.addEventListener('load', () => {
      void (async () => {
        const win = frame.contentWindow
        const doc = frame.contentDocument
        if (!win || !doc) return finish({ ok: false, error: 'print frame unavailable' })
        await Promise.all([...doc.images].map((img) => img.decode().catch(() => {})))
        win.addEventListener('afterprint', () => finish({ ok: true }))
        timer = window.setTimeout(() => finish({ ok: true }), PRINT_TIMEOUT_MS)
        try {
          win.focus()
          win.print()
        } catch (err) {
          finish({ ok: false, error: String(err) })
        }
      })()
    })
    frame.srcdoc = html
    document.body.appendChild(frame)
  })
}
