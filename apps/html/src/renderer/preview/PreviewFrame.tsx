import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { FromInspector, ToInspector } from './inspector-protocol'
import { parseFromInspector } from './inspector-validate'
import { DraftPreview } from './DraftPreview'
import { cap } from '../capabilities'

export interface PreviewFrameHandle {
  post(msg: ToInspector): void
}

interface Props {
  /** html-preview:// URL bound to this view; null until the main process reports it */
  url: string | null
  /** bump to reload the frame after the buffer was pushed to the main process */
  nonce: number
  zoom: number
  onMessage: (msg: FromInspector) => void
  /** fires for every document the frame loads, link navigations included */
  onLoad?: () => void
  /** page the AI is still writing: mirrored over the frame until it lands */
  draft?: string | null
}

/**
 * The document runs in a sandboxed frame with an opaque origin: scripts and
 * network are allowed (CDN-dependent pages must render), the app itself is out
 * of reach. Reloads go through the src attribute because the frame's window is
 * cross-origin to us; the inspector talks back over postMessage.
 *
 * Web frame, scripts on (`htmlApi.connectPreview`): the same sandbox flags plus
 * `credentialless`; `url` is the bundle's preview.html, served with a policy of its own
 * (opaque even when opened directly, no network to any API, no form posts). On each load of a
 * new src the bridge hands the copy to that document with a MessagePort; inspector traffic uses
 * only that port, never window messages, so a page posting to its parent reaches nothing.
 *
 * Web frame, static (cap 'htmlPreviewScripts' off, or preview.html never answered): the bridge
 * hands over a copy without scripts, handlers or remote loads (`onStaticPreview`), shown through
 * srcdoc in a frame with an empty sandbox (no scripts, no same-origin, no forms, no popups) and
 * `credentialless`. No inspector runs there.
 *
 * Every inspector message goes through the strict parser (inspector-validate.ts): the page's
 * own scripts share the inspector's realm and can forge anything it sends.
 */
export const PreviewFrame = forwardRef<PreviewFrameHandle, Props>(function PreviewFrame(
  { url, nonce, zoom, onMessage, onLoad, draft },
  ref,
) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const src = useMemo(() => (url ? `${url}?v=${nonce}` : 'about:blank'), [url, nonce])
  const connectPreview = window.htmlApi.connectPreview
  // preview.html did not boot (host without its policy): static from then on
  const [fallback, setFallback] = useState(false)
  const staticMode = !cap('htmlPreviewScripts') || fallback
  const portMode = !staticMode && !!connectPreview
  const [staticDoc, setStaticDoc] = useState('')
  const channelRef = useRef<{ post(msg: unknown): void; close(): void } | null>(null)
  const connectedSrcRef = useRef<string | null>(null)

  useEffect(() => {
    if (!staticMode) return
    return window.htmlApi.onStaticPreview?.(setStaticDoc)
  }, [staticMode])

  useEffect(() => {
    // web: the port is the only channel (connectPreview); window messages are never read
    if (connectPreview) return
    const listener = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
      const msg = parseFromInspector(event.data)
      if (msg) onMessageRef.current(msg)
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [connectPreview])

  useEffect(
    () => () => {
      channelRef.current?.close()
      channelRef.current = null
    },
    [],
  )

  const handleLoad = () => {
    // once per src: a later load is the page navigating itself, which must not get the copy
    if (portMode && url && connectedSrcRef.current !== src) {
      connectedSrcRef.current = src
      channelRef.current?.close()
      const win = frameRef.current?.contentWindow
      channelRef.current = win
        ? connectPreview!(win, {
            onMessage: (data) => {
              const msg = parseFromInspector(data)
              if (msg) onMessageRef.current(msg)
            },
            onFailed: () => {
              console.warn('[html] the preview did not start; showing the static preview')
              setFallback(true)
            },
          })
        : null
    }
    onLoad?.()
  }

  useImperativeHandle(ref, () => ({
    post(msg) {
      if (portMode) channelRef.current?.post(msg)
      else frameRef.current?.contentWindow?.postMessage(msg, '*')
    },
  }))

  return (
    <div className="preview-host" style={{ zoom: zoom / 100 }}>
      {staticMode ? (
        <iframe
          ref={frameRef}
          className="preview-frame"
          title="preview"
          srcDoc={staticDoc}
          onLoad={onLoad}
          sandbox=""
          // not in React's attribute list yet: passed through as is
          {...{ credentialless: '' }}
          referrerPolicy="no-referrer"
        />
      ) : (
        <iframe
          ref={frameRef}
          className="preview-frame"
          title="preview"
          src={src}
          onLoad={handleLoad}
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          // web: no cookies or storage of the app in the preview (desktop: no-op)
          {...(portMode ? { credentialless: '' } : {})}
          referrerPolicy="no-referrer"
        />
      )}
      {draft != null && <DraftPreview html={draft} />}
    </div>
  )
})
