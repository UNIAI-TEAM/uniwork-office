/**
 * window.htmlApi on the web (GO-B4 H-1/H-2, UNI-1014): the HtmlApi preload contract
 * (apps/html/src/shared/ipc.ts) over the frame protocol. File members come from the shared
 * text-module bridge (../shared/text-webapi.ts); this file maps the HTML-specific ones.
 *
 * Preview = lane decision P1 (static): the desktop serves the buffer on html-preview:// to a frame
 * that runs scripts with network access; that cannot be safe in a frame that is same-origin with
 * UniWork. Here `updatePreview(text)` turns the instrumented buffer into a static copy
 * (../shared/static-html.ts: no scripts, handlers, refresh, <base>, remote loads) and hands it to
 * the renderer's PreviewFrame (`onStaticPreview`), which shows it in `srcdoc` with `sandbox=""`
 * (+ `credentialless`). Hidden on the web (capability keys): htmlPreviewScripts, htmlVisualEdit
 * (inspector, visual edit, style panel, float toolbar), presentNewTab, exportDocx, the AI family.
 *
 * Exports: PDF = the browser print dialog over the same static copy (lane decision 5);
 * single-file HTML = in-frame download with document pictures inlined; Word = hidden.
 */
import type { HtmlApi } from '../../../apps/html/src/shared/ipc'
import aiStubs, { aiUnavailableMessage } from '../../docs/bridge/ai'
import type { ModuleBridgeContext } from '../../docs/bridge/module-bridge'
import { toStaticHtml } from '../shared/static-html'
import { createTextWebApi, type TextWebApiOptions } from '../shared/text-webapi'

/** keys the HTML renderer hides on the web besides the shared text-module ones */
export const HTML_WEB_CAPABILITIES = Object.freeze({
  // option P2 (preview origin + nonce'd inspector) is a later lane; until then the preview is static
  htmlPreviewScripts: false,
  htmlVisualEdit: false,
  // a chrome-free shell tab; the in-frame present mode stays
  presentNewTab: false,
  // html2docx drives a hidden browser window (desktop main process)
  exportDocx: false,
})

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

  let preview = ''
  const previewListeners = new Set<(html: string) => void>()

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
      preview = toStaticHtml(text, web.resolveAssetUrl)
      for (const l of previewListeners) l(preview)
    },
    // no preview URL on the web: PreviewFrame takes the static copy from onStaticPreview
    getPreviewInfo: async () => ({ url: '' }),
    setPresentFullScreen: async () => {},
    presentInNewTab: async () => false,

    save: web.save,
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

    getAiPanelPrefs: aiStubs.getAiPanelPrefs,
    onAiPanelPrefsChanged: () => () => {},
    onChromePressed: () => () => {},
    getAiSettings: aiStubs.getAiSettings,
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
      if (preview) handler(preview)
      return () => {
        previewListeners.delete(handler)
      }
    },
    resolveAssetUrl: web.resolveAssetUrl,
    unresolveAssetUrl: web.unresolveAssetUrl,
  })
}
