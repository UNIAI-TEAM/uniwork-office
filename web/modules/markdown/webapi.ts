/**
 * window.markdownApi on the web (GO-B4 M-1/M-2, UNI-1014): the MarkdownApi preload contract
 * (apps/markdown/src/shared/ipc.ts) over the frame protocol. File members come from the shared
 * text-module bridge (../shared/text-webapi.ts: open/save/conflict/view-only/print/assets); this
 * file maps the Markdown-specific ones:
 *   - exportDocx: the renderer builds the .docx itself (docxExport.ts) -> browser download;
 *     "export and open in Docs" (mode 'openInDocs') is hidden on the web (cap `openInDocs`),
 *   - exportPdf: the renderer's self-contained print HTML -> browser print dialog (no server route,
 *     lane decision 5),
 *   - AI / web search / image search / image generation: stubs, the UI is hidden (cap `ai` & co.).
 * Theme, language and the autosave preference come from module-bridge `sharedMembers()`.
 */
import type { MarkdownApi } from '../../../apps/markdown/src/shared/ipc'
import aiStubs from '../../docs/bridge/ai'
import type { ModuleBridgeContext } from '../../docs/bridge/module-bridge'
import { createTextWebApi, type TextWebApiOptions } from '../shared/text-webapi'

/** keys the Markdown renderer hides on the web besides the shared text-module ones */
export const MARKDOWN_WEB_CAPABILITIES = Object.freeze({
  // the .docx is built in the renderer and downloaded; opening it in Docs needs a desktop shell
  openInDocs: false,
})

export function createMarkdownWebApi(ctx: ModuleBridgeContext, opts: TextWebApiOptions = {}) {
  const web = createTextWebApi(
    ctx.client,
    {
      module: 'markdown',
      ext: '.md',
      extPattern: /\.(md|markdown|mdown|mkd)$/i,
      mimeType: 'text/markdown',
    },
    { capabilities: ctx.capabilities, ...opts },
  )
  const api = {
    consumePending: web.consumePending,
    consumeRecovered: web.consumeRecovered,
    provideText: web.provideText,
    consumeHeadlessExport: web.consumeHeadlessExport,
    headlessExportDone: web.headlessExportDone,
    readFile: web.readFile,
    save: web.save,
    setDirty: web.setDirty,
    onSaveRequest: web.onSaveRequest,
    sendSaveRequestAck: web.sendSaveRequestAck,
    onCloseSaveRequest: web.onCloseSaveRequest,
    sendCloseSaveResult: web.sendCloseSaveResult,
    onFileRenamed: web.onFileRenamed,
    pickImage: web.pickImage,
    saveImage: web.saveImage,
    readImage: web.readImage,
    onExportRequest: web.onExportRequest,
    onPrintRequest: web.onPrintRequest,
    exportPdf: web.exportPdf,
    async exportDocx(request: Parameters<MarkdownApi['exportDocx']>[0]) {
      if (request?.mode === 'openInDocs') {
        return { ok: false as const, error: 'opening in Docs is not available on the web' }
      }
      if (typeof request?.base64 !== 'string' || !request.base64) {
        return { ok: false as const, error: 'empty document' }
      }
      return web.exportDocxBytes(request.suggestedName, web.decodeBase64(request.base64))
    },
    getAiSettings: aiStubs.getAiSettings,
    getAiPanelPrefs: aiStubs.getAiPanelPrefs,
    onAiPanelPrefsChanged: () => () => {},
    onChromePressed: () => () => {},
    aiGskStatus: aiStubs.aiGskStatus,
    aiStream: aiStubs.aiStream,
    aiStreamCancel: aiStubs.aiStreamCancel,
    onAiStream: aiStubs.onAiStream,
    webSearch: aiStubs.webSearch,
    imageSearch: aiStubs.imageSearch,
    fetchImage: aiStubs.fetchImage,
    aiGenerateImage: aiStubs.aiGenerateImage,
  } satisfies Omit<
    MarkdownApi,
    | 'getLanguage'
    | 'onLanguageChanged'
    | 'getTheme'
    | 'onThemeChanged'
    | 'getAutoSaveDefault'
    | 'onAutoSaveDefaultChanged'
  >
  return Object.assign(api, {
    // web-only (renderer: editor/localImage.ts): relative pictures through OpenPayload.assets
    resolveAssetUrl: web.resolveAssetUrl,
    unresolveAssetUrl: web.unresolveAssetUrl,
  })
}
