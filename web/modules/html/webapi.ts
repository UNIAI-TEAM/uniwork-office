/**
 * window.htmlApi on the web (GO-B4 H-1/H-2, UNI-1014): the HtmlApi preload contract
 * (apps/html/src/shared/ipc.ts) over the frame protocol. File members come from the shared
 * text-module bridge (../shared/text-webapi.ts); this file maps the HTML-specific ones.
 *
 * Preview with scripts, like the app (CONTRACT C15(1)): the desktop serves the buffer on
 * html-preview:// to a sandboxed opaque frame; here `getPreviewInfo` names the bundle's
 * preview.html (served with its own sandboxed policy, see web/docs/build/modules.ts) and
 * `connectPreview` hands the latest copy (pictures inlined, ./preview-copy.ts) to it over a
 * MessagePort (./preview-channel.ts). Visual edit (inspector, float toolbar, style panel) runs on
 * that port and needs the host's `save` grant. The static copy (../shared/static-html.ts: no
 * scripts, handlers, refresh, <base>, remote loads, `onStaticPreview`) remains the fallback when
 * preview.html does not start, and is what print uses. Hidden on the web (capability keys):
 * presentNewTab, exportDocx, the AI family.
 *
 * Exports: PDF = the browser print dialog over the same static copy (lane decision 5);
 * single-file HTML = in-frame download with document pictures inlined; Word = hidden.
 */
import type { HtmlApi } from '../../../apps/html/src/shared/ipc'
import aiStubs, { aiUnavailableMessage } from '../../docs/bridge/ai'
import type { ModuleBridgeContext } from '../../docs/bridge/module-bridge'
import { printHtmlDocument } from '../shared/print'
import { toStaticHtml } from '../shared/static-html'
import type { Capabilities } from '../../docs/protocol/types'
import { textModuleGrants } from '../shared/capabilities'
import { createTextWebApi, type TextWebApiOptions } from '../shared/text-webapi'
import { openPreviewChannel } from './preview-channel'
import { inlineAssetsForPreview } from './preview-copy'

/** keys the HTML renderer hides on the web besides the shared text-module ones */
export const HTML_WEB_CAPABILITIES = Object.freeze({
  // scripts run in the sandboxed preview.html (opaque origin, credentialless)
  htmlPreviewScripts: true,
  // the preview's policy blocks fetch/XHR and nested frames (the renderer shows one note)
  htmlPreviewNetwork: false,
  // visual edit writes the source: on with the host's `save` grant (./install.ts)
  htmlVisualEdit: false,
  // a chrome-free shell tab; the in-frame present mode stays
  presentNewTab: false,
  // html2docx drives a hidden browser window (desktop main process)
  exportDocx: false,
})

/** host grants -> entries: the text-module ones, and visual edit only where the user may save */
export function htmlModuleGrants(granted: Capabilities | undefined): Record<string, unknown> {
  return { ...textModuleGrants(granted), htmlVisualEdit: granted?.save === true }
}

const NO_ATTACHMENTS = { accepted: [], rejected: [] }

export function createHtmlWebApi(ctx: ModuleBridgeContext, opts: TextWebApiOptions = {}) {
  const web = createTextWebApi(
    ctx.client,
    { module: 'html', ext: '.html', extPattern: /\.(html?|xhtml)$/i, mimeType: 'text/html' },
    {
      capabilities: ctx.capabilities,
      printable: (html, resolve) => toStaticHtml(html, resolve),
      ...opts,
    },
  )

  /** the latest instrumented buffer (scripts preview) and its static copy (fallback, on demand) */
  let source = ''
  let preview = ''
  const previewListeners = new Set<(html: string) => void>()
  const inlined = new Map<string, string>()
  /** mapped sibling stylesheets / scripts (src -> text), kept per frame like the picture cache */
  const inlinedText = new Map<string, string>()

  // fresh URLs / a picture that became missing (api.assets.resolve): the static copy follows. The scripts
  // preview takes its copy at the handshake with pictures as data: URIs, so it picks them up on its next load
  web.onAssetsChanged(() => {
    if (!source || previewListeners.size === 0) return
    preview = toStaticHtml(source, web.resolveAssetUrl)
    for (const l of previewListeners) l(preview)
  })

  const api = {
    consumePending: web.consumePending,
    consumeRecovered: web.consumeRecovered,
    provideText: web.provideText,
    async consumeHeadlessExport() {
      return null
    },
    headlessExportDone: web.headlessExportDone,
    readFile: web.readFile,

    updatePreview(text: string): void {
      if (typeof text !== 'string') return
      source = text
      preview = previewListeners.size ? toStaticHtml(text, web.resolveAssetUrl) : ''
      for (const l of previewListeners) l(preview)
    },
    // the bundle's preview document, next to index.html (PreviewFrame adds ?v=<reload>)
    getPreviewInfo: async () => ({
      url: new URL('preview.html', location.href).href.split('?')[0],
    }),
    setPresentFullScreen: async () => {},
    presentInNewTab: async () => false,

    save: web.save,
    // the frame is the UniWork document: no desktop working-copy state, view-only comes from the host grant
    uniworkState: async () => ({ bound: false, readOnly: false }),
    setDirty: web.setDirty,
    onSaveRequest: web.onSaveRequest,
    sendSaveRequestAck: web.sendSaveRequestAck,
    onCloseSaveRequest: web.onCloseSaveRequest,
    sendCloseSaveResult: web.sendCloseSaveResult,
    onFileRenamed: web.onFileRenamed,
    // AI-only trigger (provisional name of an untitled document); AI is hidden on the web
    setProvisionalTitle: () => {},

    pickImage: web.pickImage,
    saveImage: web.saveImage,
    readImage: web.readImage,

    pickAttachments: async () => null,
    addAttachmentPaths: async () => NO_ATTACHMENTS,
    addPastedImage: async () => NO_ATTACHMENTS,
    readAttachment: async () => ({ ok: false, error: aiUnavailableMessage('attachments') }),
    readAttachmentImage: async () => ({ ok: false, error: aiUnavailableMessage('attachments') }),
    getPathForFile: web.getPathForFile,

    onExportRequest: web.onExportRequest,
    onPrintRequest: web.onPrintRequest,
    exportDocx: async () => ({
      ok: false as const,
      error: 'Word export is not available on the web',
    }),
    exportPdf: web.exportPdf,
    exportHtml: web.exportHtml,
    // Print = the browser print dialog over the static copy (no scripts, handlers or remote loads)
    printHtml: async ({ html }) => {
      const r = await printHtmlDocument(toStaticHtml(html, web.resolveAssetUrl))
      return r.ok ? { ok: true as const } : { ok: false as const, error: r.error ?? 'print failed' }
    },
    // MCP read-text is a desktop shell feature
    onReadTextRequest: () => () => {},
    sendReadTextResult: () => {},

    getAiPanelPrefs: aiStubs.getAiPanelPrefs,
    onAiPanelPrefsChanged: () => () => {},
    onChromePressed: () => () => {},
    getAiSettings: aiStubs.getAiSettings,
    setAiSettings: async () => {},
    onAiSettingsChanged: () => () => {},
    openAiModelSettings: async () => {},
    setAiPanelPrefs: aiStubs.getAiPanelPrefs,
    aiGskStatus: aiStubs.aiGskStatus,
    aiStream: aiStubs.aiStream,
    aiStreamCancel: aiStubs.aiStreamCancel,
    onAiStream: aiStubs.onAiStream,
    webSearch: aiStubs.webSearch,
    imageSearch: aiStubs.imageSearch,
    // only the (hidden) Word export fetches remote pictures
    fetchImage: async () => null,
    aiGenerateImage: aiStubs.aiGenerateImage,
  } satisfies Omit<
    HtmlApi,
    | 'getLanguage'
    | 'onLanguageChanged'
    | 'getTheme'
    | 'onThemeChanged'
    | 'getAutoSaveDefault'
    | 'onAutoSaveDefaultChanged'
  >

  return Object.assign(api, {
    /** web-only (renderer PreviewFrame, static mode): the latest static preview, now and on change */
    onStaticPreview(handler: (html: string) => void): () => void {
      previewListeners.add(handler)
      if (!preview && source) preview = toStaticHtml(source, web.resolveAssetUrl)
      if (preview) handler(preview)
      return () => {
        previewListeners.delete(handler)
      }
    },
    /** web-only (renderer PreviewFrame, scripts on): see HtmlApi.connectPreview */
    connectPreview(
      target: Window,
      handlers: { onMessage: (data: unknown) => void; onFailed: () => void },
    ) {
      return openPreviewChannel(target, {
        html: () =>
          inlineAssetsForPreview(source, web.resolveAssetUrl, web.readImage, inlined, {
            read: web.readAssetText,
            cache: inlinedText,
          }),
        ...handlers,
      })
    },
    resolveAssetUrl: web.resolveAssetUrl,
    unresolveAssetUrl: web.unresolveAssetUrl,
    onAssetsChanged: web.onAssetsChanged,
    openInDesktopApp: web.openInDesktopApp,
  })
}
