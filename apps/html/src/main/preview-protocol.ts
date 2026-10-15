import { DOCX_MEDIA_SCHEME_PRIVILEGE, RENDERER_SCHEME_PRIVILEGE } from '@genoffice/electron-utils'
import { protocol } from 'electron'
import { ASSET_SCHEME, PREVIEW_SCHEME, buildPreviewDocument } from './preview-document'

export { assetBaseHref, previewUrlFor } from './preview-document'

/** Must run before app ready, and only once per process, so the renderer scheme
 * rides along. Both html schemes are secure: a secure preview document loading
 * stylesheets and scripts from a non-secure scheme would be blocked as mixed content. */
export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    RENDERER_SCHEME_PRIVILEGE,
    DOCX_MEDIA_SCHEME_PRIVILEGE,
    {
      scheme: PREVIEW_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
    {
      scheme: ASSET_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ])
}

/**
 * Policy of the preview document, the desktop twin of the web preview's own policy
 * (web/docs/build/modules.ts, html `documents`): the page's scripts, styles and pictures run
 * and load as before, but nothing talks to the network (connect-src), nothing embeds another
 * page (frame-src), no form leaves the preview. No 'self': relative assets arrive through
 * html-asset://, the one extra source the web side does not need.
 */
export const PREVIEW_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' https: html-asset:",
  "style-src 'unsafe-inline' https: html-asset:",
  'img-src data: blob: https: html-asset:',
  'font-src data: https: html-asset:',
  'media-src data: blob: https: html-asset:',
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  'base-uri https: html-asset:',
  "form-action 'none'",
].join('; ')

function previewHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    ...extra,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': PREVIEW_CONTENT_SECURITY_POLICY,
  }
}

export function registerPreviewProtocol(
  resolve: (webContentsId: number) => { text: string; baseHref: string | null } | null,
): void {
  protocol.handle(PREVIEW_SCHEME, (request) => {
    let host: string
    try {
      host = new URL(request.url).host
    } catch {
      return new Response(null, { status: 400, headers: previewHeaders() })
    }
    const match = /^view-(\d+)$/.exec(host)
    const entry = match ? resolve(Number(match[1])) : null
    if (!entry) return new Response(null, { status: 404, headers: previewHeaders() })
    return new Response(buildPreviewDocument(entry.text, entry.baseHref), {
      headers: previewHeaders({ 'Content-Type': 'text/html; charset=utf-8' }),
    })
  })
}
