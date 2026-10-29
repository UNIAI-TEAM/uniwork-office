import type { AiPanelPrefs } from '@genoffice/ui'
import { contextBridge, ipcRenderer } from 'electron'
import type { Lang } from '@genoffice/i18n'
import type { AiStreamChunk } from '@genoffice/ai-provider'
import { installAiRunBridge } from '@genoffice/electron-utils/ai-run-bridge'
import { installUniworkAiFlagBridge } from '@genoffice/electron-utils/uniwork-ai-flag-bridge'
import { installUniworkCloudStatusBridge } from '@genoffice/electron-utils/uniwork-cloud-status-bridge'
import { installUniworkAskUniDocBridge } from '@genoffice/ai-provider/askuni'
import { installUniworkCommentsBridge } from '@genoffice/electron-utils/comments-bridge'
import { installDropOpenBridge } from '@genoffice/electron-utils/drop-open'
import { AI_CHANNELS, PDF_CHANNELS } from '../shared/ipc'
import type { PdfApi, UiTheme } from '../shared/ipc'

const api: PdfApi = {
  consumePending: () => ipcRenderer.invoke(PDF_CHANNELS.consumePending),
  consumeAiPreset: () => ipcRenderer.invoke(PDF_CHANNELS.consumeAiPreset),
  onAiPreset: (handler) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      preset: { text: string; autoRun?: boolean; displayText?: string },
    ) => handler(preset)
    ipcRenderer.on('my-ai:ai-preset', listener)
    return () => ipcRenderer.removeListener('my-ai:ai-preset', listener)
  },
  readFile: (path) => ipcRenderer.invoke(PDF_CHANNELS.readFile, path),
  save: (request) => ipcRenderer.invoke(PDF_CHANNELS.save, request),
  requestRedactionCopy: (path) => ipcRenderer.invoke(PDF_CHANNELS.requestRedactionCopy, path),
  autoRename: (path, baseName) => ipcRenderer.invoke(PDF_CHANNELS.autoRename, path, baseName),
  isUntitled: (path) => ipcRenderer.invoke(PDF_CHANNELS.isUntitled, path),
  uniworkState: (path) => ipcRenderer.invoke(PDF_CHANNELS.uniworkState, path),
  onUniworkStateChanged: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (
        payload &&
        typeof payload === 'object' &&
        'path' in payload &&
        typeof payload.path === 'string'
      ) {
        cb(payload.path)
      }
    }
    ipcRenderer.on('uniwork:doc-state-changed', listener)
    return () => ipcRenderer.removeListener('uniwork:doc-state-changed', listener)
  },
  uniworkReadOnlySave: (path) => ipcRenderer.invoke(PDF_CHANNELS.uniworkReadOnlySave, path),
  validateTextEdits: (request) => ipcRenderer.invoke(PDF_CHANNELS.validateTextEdits, request),
  listEditFonts: () => ipcRenderer.invoke(PDF_CHANNELS.listEditFonts),
  canDrawText: (text, font, bold, italic) =>
    ipcRenderer.invoke(PDF_CHANNELS.canDrawText, text, font, bold, italic),
  listPageImages: (path) => ipcRenderer.invoke(PDF_CHANNELS.listPageImages, path),
  listStaticFormFills: (path) => ipcRenderer.invoke(PDF_CHANNELS.listStaticFormFills, path),
  ocrPage: (png) => ipcRenderer.invoke(PDF_CHANNELS.ocrPage, png),
  pageImagePng: (request) => ipcRenderer.invoke(PDF_CHANNELS.pageImagePng, request),
  pagePreviewPng: (request) => ipcRenderer.invoke(PDF_CHANNELS.pagePreviewPng, request),
  extractPages: (request) => ipcRenderer.invoke(PDF_CHANNELS.extractPages, request),
  insertPdf: (request) => ipcRenderer.invoke(PDF_CHANNELS.insertPdf, request),
  compareReadPdf: () => ipcRenderer.invoke(PDF_CHANNELS.compareReadPdf),
  compareReadOpen: (path: string) => ipcRenderer.invoke(PDF_CHANNELS.compareReadOpen, path),
  reduceFileSize: (path) => ipcRenderer.invoke(PDF_CHANNELS.reduceFileSize, path),
  insertBlankPage: (request) => ipcRenderer.invoke(PDF_CHANNELS.insertBlankPage, request),
  splitPdf: (request) => ipcRenderer.invoke(PDF_CHANNELS.splitPdf, request),
  mergePdf: (request) => ipcRenderer.invoke(PDF_CHANNELS.mergePdf, request),
  mergePages: (request) => ipcRenderer.invoke(PDF_CHANNELS.mergePages, request),
  replacePages: (request) => ipcRenderer.invoke(PDF_CHANNELS.replacePages, request),
  setPageSize: (request) => ipcRenderer.invoke(PDF_CHANNELS.setPageSize, request),
  splitPages: (request) => ipcRenderer.invoke(PDF_CHANNELS.splitPages, request),
  cropPages: (request) => ipcRenderer.invoke(PDF_CHANNELS.cropPages, request),
  exportImages: (request) => ipcRenderer.invoke(PDF_CHANNELS.exportImages, request),
  convertOffice: (format) => ipcRenderer.invoke(PDF_CHANNELS.convertOffice, format),
  convertCancel: () => ipcRenderer.invoke(PDF_CHANNELS.convertCancel),
  onConvertProgress: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: unknown) => {
      if (!payload || typeof payload !== 'object') return
      const p = payload as Record<string, unknown>
      const format = p.format
      if (format !== 'docx' && format !== 'xlsx' && format !== 'pptx') return
      const done = p.done === true
      const page = typeof p.page === 'number' && Number.isFinite(p.page) ? p.page : 0
      const total = typeof p.total === 'number' && Number.isFinite(p.total) ? p.total : 0
      handler(done ? { format, page, total, done: true } : { format, page, total })
    }
    ipcRenderer.on(PDF_CHANNELS.convertProgress, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.convertProgress, listener)
  },
  createDocument: (request) => ipcRenderer.invoke(PDF_CHANNELS.createDocument, request),
  imageSearch: (query, maxResults) =>
    ipcRenderer.invoke(AI_CHANNELS.imageSearch, query, maxResults),
  fetchImage: (url) => ipcRenderer.invoke(AI_CHANNELS.fetchImage, url),
  generateImage: (op) => ipcRenderer.invoke(PDF_CHANNELS.generateImage, op),
  listDigitalSignatures: (path) => ipcRenderer.invoke(PDF_CHANNELS.listDigitalSignatures, path),
  pickCertificate: () => ipcRenderer.invoke(PDF_CHANNELS.pickCertificate),
  listSystemCertificates: (storePassword) =>
    ipcRenderer.invoke(PDF_CHANNELS.listSystemCertificates, storePassword),
  releaseCertificate: (certId) => ipcRenderer.send(PDF_CHANNELS.releaseCertificate, certId),
  inspectCertificate: (certId, password, storePassword) =>
    ipcRenderer.invoke(PDF_CHANNELS.inspectCertificate, certId, password, storePassword),
  signWithCertificate: (request) => ipcRenderer.invoke(PDF_CHANNELS.signWithCertificate, request),
  listSavedSignatures: () => ipcRenderer.invoke(PDF_CHANNELS.listSignatures),
  addSavedSignature: (data) => ipcRenderer.invoke(PDF_CHANNELS.addSignature, data),
  removeSavedSignature: (id) => ipcRenderer.invoke(PDF_CHANNELS.removeSignature, id),
  getUsername: () => ipcRenderer.invoke(PDF_CHANNELS.getUsername),
  onCommentAuthorChanged: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('uniwork:comment-author-changed', listener)
    return () => ipcRenderer.removeListener('uniwork:comment-author-changed', listener)
  },
  setDirty: (dirty) => ipcRenderer.send(PDF_CHANNELS.dirtyChanged, dirty),
  onCloseSaveRequest: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, request?: { origin?: unknown }) =>
      handler({ origin: request?.origin === 'internal' ? 'internal' : 'user' })
    ipcRenderer.on(PDF_CHANNELS.closeSaveRequest, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.closeSaveRequest, listener)
  },
  sendCloseSaveResult: (ok) => ipcRenderer.send(PDF_CHANNELS.closeSaveResult, ok),
  onSaveAsRequest: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, targetPath: string) => handler(targetPath)
    ipcRenderer.on(PDF_CHANNELS.saveAsRequest, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.saveAsRequest, listener)
  },
  sendSaveAsResult: (ok) => ipcRenderer.send(PDF_CHANNELS.saveAsResult, ok),
  onSaveAsFlow: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, inFlight: boolean) => handler(inFlight)
    ipcRenderer.on(PDF_CHANNELS.saveAsFlow, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.saveAsFlow, listener)
  },
  onPrintRequest: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(PDF_CHANNELS.printRequest, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.printRequest, listener)
  },
  onFileRenamed: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, newPath: string) => handler(newPath)
    ipcRenderer.on(PDF_CHANNELS.fileRenamed, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.fileRenamed, listener)
  },
  getLanguage: () => ipcRenderer.invoke(PDF_CHANNELS.getLanguage),
  onLanguageChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, lang: Lang) => handler(lang)
    ipcRenderer.on(PDF_CHANNELS.languageChanged, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.languageChanged, listener)
  },
  getTheme: () => ipcRenderer.invoke(PDF_CHANNELS.getTheme),
  onThemeChanged: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, theme: UiTheme) => handler(theme)
    ipcRenderer.on(PDF_CHANNELS.themeChanged, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.themeChanged, listener)
  },
  getAiPanelPrefs: () => ipcRenderer.invoke(PDF_CHANNELS.getAiPanelPrefs),
  setAiPanelPrefs: (patch) => ipcRenderer.invoke('app:set-ai-panel-prefs', patch),
  onAiPanelPrefsChanged: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, prefs: AiPanelPrefs) => handler(prefs)
    ipcRenderer.on(PDF_CHANNELS.aiPanelPrefsChanged, listener)
    return () => ipcRenderer.removeListener(PDF_CHANNELS.aiPanelPrefsChanged, listener)
  },
  onChromePressed: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('app:chrome-pressed', listener)
    return () => ipcRenderer.removeListener('app:chrome-pressed', listener)
  },
  getAiSettings: () => ipcRenderer.invoke(AI_CHANNELS.getSettings),
  setAiSettings: (settings, options) =>
    ipcRenderer.invoke(AI_CHANNELS.setSettings, settings, options),
  onAiSettingsChanged: (handler) => {
    const listener = () => handler()
    ipcRenderer.on(AI_CHANNELS.settingsChanged, listener)
    return () => ipcRenderer.removeListener(AI_CHANNELS.settingsChanged, listener)
  },
  openAiModelSettings: () => ipcRenderer.invoke(AI_CHANNELS.openModelSettings),
  gskStatus: () => ipcRenderer.invoke(AI_CHANNELS.gskStatus),
  aiStream: (request) => ipcRenderer.invoke(AI_CHANNELS.stream, request),
  aiStreamCancel: (requestId) => ipcRenderer.invoke(AI_CHANNELS.streamCancel, requestId),
  onAiStream: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, chunk: AiStreamChunk) => handler(chunk)
    ipcRenderer.on(AI_CHANNELS.streamChunk, listener)
    return () => ipcRenderer.removeListener(AI_CHANNELS.streamChunk, listener)
  },
}

// Shared project chat store (registered app-wide by the shell's main init):
// AI PDF conversations persist per file, like Docs/Sheets
const projectApi = {
  resolveChat: (args: { filePath: string | null; tempChatId?: string }) =>
    ipcRenderer.invoke('project:resolveChat', args),
  appendChat: (args: unknown) => ipcRenderer.invoke('project:appendChat', args),
  loadChat: (args: { projectId: string; chatId: string; limit?: number }) =>
    ipcRenderer.invoke('project:loadChat', args),
  rebindChat: (args: { projectId: string; tempChatId: string; newFilePath: string }) =>
    ipcRenderer.invoke('project:rebindChat', args),
}

contextBridge.exposeInMainWorld('pdfApi', api)
contextBridge.exposeInMainWorld('projectApi', projectApi)

// open documents dragged from the OS onto this tab as a new shell tab
installDropOpenBridge()

// window.uniworkAiRun.reportAiRun: the shell learns when an AI turn runs here
installUniworkCommentsBridge()
installAiRunBridge()
// window.uniworkAiFlag: whether the shell offers UniWork AI (this renderer's provider list mirrors it)
installUniworkAiFlagBridge()
installUniworkCloudStatusBridge()
// window.uniworkAskUniDoc: Ask UNI about this document (ids are derived in main, never sent from here)
installUniworkAskUniDocBridge({ contextBridge, ipcRenderer })
