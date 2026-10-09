import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { isFromInspector, type FromInspector, type ToInspector } from './inspector-protocol'
import { DraftPreview } from './DraftPreview'
import { useI18n } from '../i18n/locale'
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
 * Web frame (cap 'htmlPreviewScripts' off): the app shares its origin with the
 * host page, so the preview is static instead: the bridge hands over a copy
 * without scripts, handlers or remote loads (`onStaticPreview`), shown through
 * srcdoc in a frame with an empty sandbox (no scripts, no same-origin, no forms,
 * no popups) and `credentialless`. No inspector runs there.
 */
export const PreviewFrame = forwardRef<PreviewFrameHandle, Props>(function PreviewFrame(
  { url, nonce, zoom, onMessage, onLoad, draft },
  ref,
) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const { t } = useI18n()
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage
  const src = useMemo(() => (url ? `${url}?v=${nonce}` : 'about:blank'), [url, nonce])
  const staticMode = !cap('htmlPreviewScripts')
  const [staticDoc, setStaticDoc] = useState('')

  useEffect(() => {
    if (!staticMode) return
    return window.htmlApi.onStaticPreview?.(setStaticDoc)
  }, [staticMode])

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
      if (isFromInspector(event.data)) onMessageRef.current(event.data)
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [])

  useImperativeHandle(ref, () => ({
    post(msg) {
      frameRef.current?.contentWindow?.postMessage(msg, '*')
    },
  }))

  return (
    <div className="preview-host" style={{ zoom: zoom / 100 }}>
      {staticMode ? (
        <iframe
          ref={frameRef}
          className="preview-frame"
          title={t('viewPreview')}
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
          title={t('viewPreview')}
          src={src}
          onLoad={onLoad}
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          referrerPolicy="no-referrer"
        />
      )}
      {draft != null && <DraftPreview html={draft} />}
    </div>
  )
})
