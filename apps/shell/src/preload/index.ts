import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import {
  AI_PROVIDERS,
  AI_SEARCH_PROVIDERS,
  getProviderAdapter,
  normalizeAiTestFailureKind,
  normalizeUniworkCloudStatus,
  setUniworkCloudStatus,
  visibleMediaProviders,
} from '@genoffice/ai-provider/browser'
import type {
  AiSettings,
  CodexModelCatalog,
  UniworkCloudStatus,
} from '@genoffice/ai-provider/browser'
import type { AiStreamChunk, AiStreamRequest } from '@genoffice/ai-provider'
import { installDropOpenBridge } from '@genoffice/electron-utils/drop-open'
import type { UpdateUiState } from '../shared/update-api'
import { normalizeAiPanelPrefs } from '@genoffice/ui/ai-panel-prefs'
import type {
  AccountLoginEvent,
  AiConnectionTestResult,
  AccountStatus,
  AttachmentAddResult,
  AttachmentImageResult,
  AttachmentReadResult,
  CliLinkState,
  DefaultAppStatus,
  FolderListing,
  FolderRoot,
  MoveResult,
  ProjectHomeApi,
  ProjectSummaryEntry,
  TimelineEntryItem,
  HomeApi,
  RecentEntry,
  RecentPage,
  RenameResult,
  UiLanguage,
  FileSearchPage,
  FileSearchRerank,
  FileSearchSettings,
  UniworkDocErrorCode,
  UniworkDocListPage,
  UniworkDocStatus,
  UniworkLaunchEvent,
  UniworkResult,
  UniworkWorkspaceRef,
} from '../shared/home-api'
import { HOME_CHANNELS, PROJECT_CHANNELS, UNIWORK_DOC_CHANNELS } from '../shared/home-api'
import { INTEGRATIONS_CHANNELS } from '../shared/integrations-api'
import type {
  IntegrationsApi,
  IntegrationsStatus,
  SkillInstallState,
} from '../shared/integrations-api'
import type { TabsApi, TabSummary } from '../shared/tabs-api'
import { TABS_CHANNELS } from '../shared/tabs-api'
import { createLaunchReplay } from './launch-replay'

// subscribed at preload time: a cold-start launch event can arrive before the
// renderer subscribes, and is then held for the first subscriber
const uniworkLaunches = createLaunchReplay<UniworkLaunchEvent>()
ipcRenderer.on(
  UNIWORK_DOC_CHANNELS.launchEvent,
  (_event: IpcRendererEvent, event: UniworkLaunchEvent) => uniworkLaunches.deliver(event),
)

const UI_LANGUAGES: readonly UiLanguage[] = [
  'zh',
  'en',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'th',
  'id',
  'ru',
  'ar',
  'pt',
  'it',
  'pl',
  'cs',
  'nl',
  'ms',
  'he',
  'hi',
  'zh-TW',
  'vi',
]

function isUiLanguage(value: unknown): value is UiLanguage {
  return UI_LANGUAGES.includes(value as UiLanguage)
}

const EMPTY_PAGE: RecentPage = { entries: [], total: 0, totalAll: 0 }

function asRecentPage(result: unknown): RecentPage {
  if (result && typeof result === 'object' && Array.isArray((result as RecentPage).entries)) {
    return result as RecentPage
  }
  return EMPTY_PAGE
}

const EMPTY_SEARCH: FileSearchPage = {
  hits: [],
  total: 0,
  index: { indexed: 0, pending: 0, scanning: false },
}

function asSearchPage(result: unknown): FileSearchPage {
  if (result && typeof result === 'object' && Array.isArray((result as FileSearchPage).hits)) {
    return result as FileSearchPage
  }
  return EMPTY_SEARCH
}

function normalizeDefaultAppStatus(result: unknown): DefaultAppStatus {
  const r = (result ?? {}) as Partial<DefaultAppStatus>
  const state = r.state
  return {
    state: state === 'default' || state === 'other' || state === 'unknown' ? state : 'unsupported',
    others: Array.isArray(r.others) ? r.others.filter((x) => typeof x === 'string') : [],
    manualOnly: r.manualOnly === true,
  }
}

function normalizeCliLinkState(result: unknown): CliLinkState {
  const r = (result ?? {}) as Partial<CliLinkState>
  const state = r.state
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
  return {
    state: state === 'absent' || state === 'present' || state === 'blocked' ? state : 'unsupported',
    ...(str(r.location) ? { location: str(r.location) } : {}),
    ...(str(r.pathHint) ? { pathHint: str(r.pathHint) } : {}),
    ...(str(r.manual) ? { manual: str(r.manual) } : {}),
  }
}

/** main answers every UniWork call with a result; anything else is a broken reply */
function asUniworkResult<T>(result: unknown): UniworkResult<T> {
  if (
    result &&
    typeof result === 'object' &&
    typeof (result as { ok?: unknown }).ok === 'boolean'
  ) {
    return result as UniworkResult<T>
  }
  return { ok: false, error: 'malformed_response' satisfies UniworkDocErrorCode }
}

function asUniworkStatus(result: unknown): UniworkDocStatus | null {
  return result &&
    typeof result === 'object' &&
    typeof (result as UniworkDocStatus).path === 'string'
    ? (result as UniworkDocStatus)
    : null
}

/** a connection test answer for the renderer: the failure kind only, never the provider's raw text (that stays in the main process log) */
function testResultOf(raw: unknown): AiConnectionTestResult {
  const r = (raw ?? {}) as { ok?: unknown; errorKind?: unknown }
  return r.ok === true
    ? { ok: true }
    : { ok: false, errorKind: normalizeAiTestFailureKind(r.errorKind) }
}

const homeApi: HomeApi = {
  async recents(query) {
    return asRecentPage(await ipcRenderer.invoke(HOME_CHANNELS.recents, query))
  },
  async searchFiles(query) {
    return asSearchPage(await ipcRenderer.invoke(HOME_CHANNELS.searchFiles, query))
  },
  async rerankSearch(query) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.rerankSearch, query)
    return result && typeof result === 'object' && Array.isArray((result as FileSearchRerank).order)
      ? (result as FileSearchRerank)
      : null
  },
  async getFileSearchSettings() {
    return (await ipcRenderer.invoke(HOME_CHANNELS.getFileSearchSettings)) as FileSearchSettings
  },
  async setFileSearchSettings(patch) {
    return (await ipcRenderer.invoke(
      HOME_CHANNELS.setFileSearchSettings,
      patch,
    )) as FileSearchSettings
  },
  async testFileSearchRerank(input) {
    return testResultOf(await ipcRenderer.invoke(HOME_CHANNELS.testFileSearchRerank, input))
  },
  async starred(query) {
    return asRecentPage(await ipcRenderer.invoke(HOME_CHANNELS.starred, query))
  },
  async statPaths(paths) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.statPaths, paths)
    return Array.isArray(result) ? (result as RecentEntry[]) : []
  },
  async toggleStar(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.toggleStar, path)
  },
  async openPath(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.openPath, path)
  },
  async fileExcerpts(paths) {
    if (!Array.isArray(paths)) return []
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.fileExcerpts, paths)
    return Array.isArray(result) ? (result as import('../shared/file-excerpt').FileExcerpt[]) : []
  },
  async activeOfficeTab() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.activeOfficeTab)
    if (!result || typeof result !== 'object') return null
    const tab = result as { id?: unknown; kind?: unknown; title?: unknown; path?: unknown }
    if (
      typeof tab.id !== 'string' ||
      typeof tab.kind !== 'string' ||
      typeof tab.title !== 'string'
    ) {
      return null
    }
    return {
      id: tab.id,
      kind: tab.kind,
      title: tab.title,
      ...(typeof tab.path === 'string' ? { path: tab.path } : {}),
    }
  },
  async pushAiPreset(input) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.pushAiPreset, input)
    return (result ?? { ok: false }) as {
      ok: boolean
      tabId?: string
      kind?: string
      title?: string
      path?: string
    }
  },
  async browse() {
    await ipcRenderer.invoke(HOME_CHANNELS.browse)
  },
  async probeAiHub(opts) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.probeAiHub, opts)) as {
      ok: boolean
      message: string
      balanceText?: string
      modelCount?: number
    }
  },
  onAgentIntent(handler) {
    const listener = (
      _event: IpcRendererEvent,
      intent: import('../shared/home-api').AgentIntentDto,
    ) => handler(intent)
    ipcRenderer.on(HOME_CHANNELS.agentIntentEvent, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.agentIntentEvent, listener)
  },
  async agentIntentAck(intentId, status) {
    await ipcRenderer.invoke(HOME_CHANNELS.agentIntentAck, intentId, status)
  },
  async resolveAgentIntent(text) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.resolveAgentIntent, text)
    return (result ?? null) as import('../shared/home-api').AgentIntentDto | null
  },
  async submitAgentIntent(intent) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.submitAgentIntent, intent)
    return result === true
  },
  async exportLessonPack(projectId) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.exportLessonPack, projectId)) as {
      ok: boolean
      path?: string
      error?: string
      canceled?: boolean
    }
  },
  async newDoc(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newDoc, opts)
  },
  async newSheet(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newSheet, opts)
  },
  async newSlide(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newSlide, opts)
  },
  async newMarkdown(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newMarkdown, opts)
  },
  async newHtml(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newHtml, opts)
  },
  async newPdf(opts) {
    await ipcRenderer.invoke(HOME_CHANNELS.newPdf, opts)
  },
  async removeRecent(paths) {
    await ipcRenderer.invoke(HOME_CHANNELS.removeRecent, paths)
  },
  async revealPath(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.revealPath, path)
  },
  async renameFile(path, newName) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.renameFile, path, newName)
    return (result ?? { ok: false, error: 'Rename failed' }) as RenameResult
  },
  async duplicateFile(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.duplicateFile, path)
  },
  async deleteFiles(paths) {
    await ipcRenderer.invoke(HOME_CHANNELS.deleteFiles, paths)
  },
  async folderRoots() {
    return (await ipcRenderer.invoke(HOME_CHANNELS.folderRoots)) as FolderRoot[]
  },
  async addFolderRoot() {
    return (await ipcRenderer.invoke(HOME_CHANNELS.addFolderRoot)) as FolderRoot | null
  },
  async dropFolderRoots(paths) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.dropFolderRoots, paths)) as FolderRoot[]
  },
  async removeFolderRoot(path) {
    await ipcRenderer.invoke(HOME_CHANNELS.removeFolderRoot, path)
  },
  pathForFile(file) {
    return webUtils.getPathForFile(file)
  },
  async listFolder(dir) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.listFolder, dir)) as FolderListing
  },
  async createFolder(parent, name) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.createFolder, parent, name)) as RenameResult
  },
  async renameFolder(dir, newName) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.renameFolder, dir, newName)) as RenameResult
  },
  async movePaths(paths, targetDir, onConflict) {
    return (await ipcRenderer.invoke(
      HOME_CHANNELS.movePaths,
      paths,
      targetDir,
      onConflict,
    )) as MoveResult
  },
  async deleteFolder(dir) {
    await ipcRenderer.invoke(HOME_CHANNELS.deleteFolder, dir)
  },
  onFolderChanged(handler) {
    const listener = (_event: IpcRendererEvent, dirs: unknown) => {
      if (Array.isArray(dirs)) handler(dirs.filter((d): d is string => typeof d === 'string'))
    }
    ipcRenderer.on(HOME_CHANNELS.folderChanged, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.folderChanged, listener)
  },
  async openTrash() {
    await ipcRenderer.invoke(HOME_CHANNELS.openTrash)
  },
  async getLanguage() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getLanguage)
    return isUiLanguage(result) ? result : 'zh'
  },
  async setLanguage(lang) {
    if (!isUiLanguage(lang)) throw new Error('Invalid language.')
    await ipcRenderer.invoke(HOME_CHANNELS.setLanguage, lang)
  },
  async getUpdateChannel() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getUpdateChannel)
    return result === 'beta' ? 'beta' : 'stable'
  },
  async setUpdateChannel(channel) {
    // validated inline: a runtime import from ../shared/update-api would be
    // shared with the update.ts preload entry and get split into a chunk,
    // which sandboxed preload scripts cannot load (window.aiOffice would
    // silently disappear). Preload entries must stay single-file bundles.
    if (channel !== 'stable' && channel !== 'beta') throw new Error('Invalid update channel.')
    await ipcRenderer.invoke(HOME_CHANNELS.setUpdateChannel, channel)
  },
  async accountStatus() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.accountStatus)
    return (result ?? { loggedIn: false, state: 'signed-out' }) as AccountStatus
  },
  async accountLogin() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.accountLogin)
    return result === true
  },
  onOpenSettings(handler) {
    const listener = (_event: IpcRendererEvent, target: { section: string }) => handler(target)
    ipcRenderer.on(HOME_CHANNELS.openSettings, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.openSettings, listener)
  },
  onAccountLogin(handler) {
    const listener = (_event: IpcRendererEvent, ev: AccountLoginEvent) => handler(ev)
    ipcRenderer.on(HOME_CHANNELS.accountLoginEvent, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.accountLoginEvent, listener)
  },
  async openLoginUrl() {
    await ipcRenderer.invoke(HOME_CHANNELS.accountLoginOpenUrl)
  },
  async accountLogout() {
    await ipcRenderer.invoke(HOME_CHANNELS.accountLogout)
  },
  onAccountStatus(handler) {
    const listener = (_event: IpcRendererEvent, status: AccountStatus) => handler(status)
    ipcRenderer.on(HOME_CHANNELS.accountStatusEvent, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.accountStatusEvent, listener)
  },
  async accountCancelLogin() {
    await ipcRenderer.invoke(HOME_CHANNELS.accountCancelLogin)
  },
  async accountRetry() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.accountRetry)
    return (result ?? { loggedIn: false, state: 'signed-out' }) as AccountStatus
  },
  async accountSelectOrg(orgId) {
    if (typeof orgId !== 'string' || !orgId) throw new Error('Invalid organization id.')
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.accountSelectOrg, orgId)
    return (result ?? { loggedIn: false, state: 'signed-out' }) as AccountStatus
  },
  async uniworkCloudStatus() {
    return normalizeUniworkCloudStatus(await ipcRenderer.invoke(HOME_CHANNELS.uniworkCloudStatus))
  },
  async uniworkCloudRefresh() {
    return normalizeUniworkCloudStatus(await ipcRenderer.invoke(HOME_CHANNELS.uniworkCloudRefresh))
  },
  onUniworkCloudStatus(handler) {
    const listener = (_event: IpcRendererEvent, status: unknown) =>
      handler(normalizeUniworkCloudStatus(status))
    ipcRenderer.on(HOME_CHANNELS.uniworkCloudStatusEvent, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.uniworkCloudStatusEvent, listener)
  },
  onOpenSettingsEvent(handler) {
    const listener = (_event: IpcRendererEvent, section: unknown) => {
      handler(typeof section === 'string' && section ? section : 'account')
    }
    ipcRenderer.on(HOME_CHANNELS.openSettingsEvent, listener)
    return () => ipcRenderer.removeListener(HOME_CHANNELS.openSettingsEvent, listener)
  },
  async getAppVersion() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getAppVersion)
    return typeof result === 'string' ? result : ''
  },
  async getUpdateState() {
    const result: unknown = await ipcRenderer.invoke('update:get-state')
    return (result as UpdateUiState | null) ?? null
  },
  async openUpdateDialog() {
    const result: unknown = await ipcRenderer.invoke('update:open-for-update')
    return result === true
  },
  async openLegalDoc(doc) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.openLegalDoc, doc)
    return result === true
  },
  onUpdateStateChanged(handler: (state: UpdateUiState) => void) {
    const listener = (_e: IpcRendererEvent, state: UpdateUiState) => handler(state)
    ipcRenderer.on('update:state-changed', listener)
    return () => ipcRenderer.removeListener('update:state-changed', listener)
  },
  async onboardingSeen() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.onboardingSeen)
    return result === true
  },
  async setOnboardingSeen() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.setOnboardingSeen)
    return result === true
  },
  async getTheme() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getTheme)
    return result === 'dark' || result === 'light' ? result : 'system'
  },
  async setTheme(theme) {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'system')
      throw new Error('Invalid theme.')
    await ipcRenderer.invoke(HOME_CHANNELS.setTheme, theme)
  },
  async getDocumentTheme() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getDocumentTheme)
    return result === 'dark' || result === 'light' ? result : 'follow'
  },
  async setDocumentTheme(theme) {
    if (theme !== 'light' && theme !== 'dark' && theme !== 'follow')
      throw new Error('Invalid document theme.')
    await ipcRenderer.invoke(HOME_CHANNELS.setDocumentTheme, theme)
  },
  async getAutoSaveDefault() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getAutoSaveDefault)
    const r = result as { on?: unknown; updatedAt?: unknown } | null
    return {
      on: r?.on === true,
      updatedAt: typeof r?.updatedAt === 'number' ? r.updatedAt : 0,
    }
  },
  async setAutoSaveDefault(on) {
    if (typeof on !== 'boolean') throw new Error('Invalid AutoSave default.')
    await ipcRenderer.invoke(HOME_CHANNELS.setAutoSaveDefault, on)
  },
  async getMcpStatus() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getMcpStatus)
    const r = result as {
      running?: unknown
      enabled?: unknown
      port?: unknown
      background?: unknown
      logging?: unknown
      url?: unknown
      capabilities?: unknown
      error?: unknown
    } | null
    return {
      running: r?.running === true,
      enabled: r?.enabled === true,
      port: typeof r?.port === 'number' ? r.port : 3093,
      background: r?.background === true,
      logging: r?.logging === true,
      url: typeof r?.url === 'string' ? r.url : null,
      capabilities: Array.isArray(r?.capabilities)
        ? r.capabilities.filter((c): c is string => typeof c === 'string')
        : ['docs'],
      ...(typeof r?.error === 'string' ? { error: r.error } : {}),
    }
  },
  async setMcpSettings(patch: {
    enabled?: boolean
    port?: number
    background?: boolean
    logging?: boolean
  }) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.setMcpSettings, patch)
    const r = result as {
      running?: unknown
      enabled?: unknown
      port?: unknown
      background?: unknown
      logging?: unknown
      url?: unknown
      capabilities?: unknown
      error?: unknown
    } | null
    return {
      running: r?.running === true,
      enabled: r?.enabled === true,
      port: typeof r?.port === 'number' ? r.port : 3093,
      background: r?.background === true,
      logging: r?.logging === true,
      url: typeof r?.url === 'string' ? r.url : null,
      capabilities: Array.isArray(r?.capabilities)
        ? r.capabilities.filter((c): c is string => typeof c === 'string')
        : ['docs'],
      ...(typeof r?.error === 'string' ? { error: r.error } : {}),
    }
  },
  async getMcpLogs() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getMcpLogs)
    return Array.isArray(result) ? result.filter((l): l is string => typeof l === 'string') : []
  },
  async clearMcpLogs() {
    await ipcRenderer.invoke(HOME_CHANNELS.clearMcpLogs)
  },
  async openMcpLogFile() {
    await ipcRenderer.invoke(HOME_CHANNELS.openMcpLogFile)
  },
  async getAiPanelPrefs() {
    return normalizeAiPanelPrefs(await ipcRenderer.invoke(HOME_CHANNELS.getAiPanelPrefs))
  },
  async setAiPanelPrefs(patch) {
    return normalizeAiPanelPrefs(await ipcRenderer.invoke(HOME_CHANNELS.setAiPanelPrefs, patch))
  },
  async getDefaultSaveDir() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getDefaultSaveDir)
    return typeof result === 'string' ? result : ''
  },
  async getDefaultAppStatus() {
    return normalizeDefaultAppStatus(await ipcRenderer.invoke(HOME_CHANNELS.getDefaultAppStatus))
  },
  async setDefaultApp() {
    return normalizeDefaultAppStatus(await ipcRenderer.invoke(HOME_CHANNELS.setDefaultApp))
  },
  async getCliLinkStatus() {
    return normalizeCliLinkState(await ipcRenderer.invoke(HOME_CHANNELS.getCliLinkStatus))
  },
  async installCliLink() {
    return normalizeCliLinkState(await ipcRenderer.invoke(HOME_CHANNELS.installCliLink))
  },
  async pickDefaultSaveDir() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.pickDefaultSaveDir)
    return typeof result === 'string' && result ? result : null
  },
  onThemeChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, theme: unknown) => {
      if (theme === 'light' || theme === 'dark' || theme === 'system') handler(theme)
    }
    ipcRenderer.on('app:theme-changed', listener)
    return () => ipcRenderer.removeListener('app:theme-changed', listener)
  },
  onDocumentThemeChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, theme: unknown) => {
      if (theme === 'light' || theme === 'dark' || theme === 'follow') handler(theme)
    }
    ipcRenderer.on('app:document-theme-changed', listener)
    return () => ipcRenderer.removeListener('app:document-theme-changed', listener)
  },
  async openCreditUsage() {
    await ipcRenderer.invoke(HOME_CHANNELS.openCreditUsage)
  },
  // AI settings channels are registered once by the shell's aggregated docs handlers
  onAiSettingsChanged(handler) {
    const listener = () => handler()
    ipcRenderer.on('ai:settings-changed', listener)
    return () => ipcRenderer.removeListener('ai:settings-changed', listener)
  },
  async getAiSettings() {
    return (await ipcRenderer.invoke('ai:get-settings')) as AiSettings
  },
  async setAiSettings(settings) {
    await ipcRenderer.invoke('ai:set-settings', settings)
  },
  getAiProviders() {
    return AI_PROVIDERS.map((meta) => {
      let defaultBaseUrl = ''
      // genspark routes by model and custom has no default — both stay ''
      if (meta.id !== 'genspark' && !meta.needsBaseUrl && !meta.needsCliPath) {
        defaultBaseUrl = getProviderAdapter(meta.id).resolveEndpoint({
          apiKey: '',
          model: meta.defaultModel,
        }).baseUrl
      }
      return { ...meta, defaultBaseUrl }
    })
  },
  async getCodexModels(cliPath) {
    return (await ipcRenderer.invoke('ai:codex-models', cliPath)) as CodexModelCatalog
  },
  async getCustomModels(baseUrl, apiKey) {
    return (await ipcRenderer.invoke('ai:custom-models', { baseUrl, apiKey })) as CodexModelCatalog
  },
  async testAiSettings(settings) {
    return testResultOf(
      await ipcRenderer.invoke('ai:settings-test', {
        settings,
        system: 'You are a connectivity test. Reply with the single word OK.',
        user: 'ping',
      }),
    )
  },
  async probeOpenRouterKey(apiKey) {
    return (await ipcRenderer.invoke(
      'ai:openrouter-key-status',
      apiKey,
    )) as import('@genoffice/ai-provider').OpenRouterKeyStatus
  },
  async aiChat(input) {
    const settings = input.settings ?? ((await ipcRenderer.invoke('ai:get-settings')) as AiSettings)
    const result: unknown = await ipcRenderer.invoke('ai:chat', {
      settings,
      system: input.system,
      user: input.user,
    })
    const raw = (result ?? {}) as { ok?: unknown; content?: unknown; error?: unknown }
    if (raw.ok === true) {
      return {
        ok: true,
        ...(typeof raw.content === 'string' ? { content: raw.content } : {}),
      }
    }
    return {
      ok: false,
      error: typeof raw.error === 'string' ? raw.error : 'AI request failed',
    }
  },
  aiStream(request: AiStreamRequest) {
    return ipcRenderer.invoke('ai:stream', request) as Promise<void>
  },
  aiStreamCancel(requestId: string) {
    return ipcRenderer.invoke('ai:stream-cancel', requestId) as Promise<void>
  },
  onAiStream(handler: (chunk: AiStreamChunk) => void) {
    const listener = (_event: IpcRendererEvent, chunk: AiStreamChunk) => handler(chunk)
    ipcRenderer.on('ai:stream-chunk', listener)
    return () => ipcRenderer.removeListener('ai:stream-chunk', listener)
  },
  pickAttachments() {
    return ipcRenderer.invoke('files:pick') as Promise<AttachmentAddResult | null>
  },
  addAttachmentPaths(paths: string[]) {
    return ipcRenderer.invoke('files:add', paths) as Promise<AttachmentAddResult>
  },
  addPastedImage(data: ArrayBuffer, ext: string) {
    return ipcRenderer.invoke('files:add-pasted-image', data, ext) as Promise<AttachmentAddResult>
  },
  readAttachment(path: string, offset: number, maxChars: number) {
    return ipcRenderer.invoke('files:read', path, offset, maxChars) as Promise<AttachmentReadResult>
  },
  readAttachmentImage(path: string) {
    return ipcRenderer.invoke('files:read-image', path) as Promise<AttachmentImageResult>
  },
  getPathForFile(file: File) {
    return webUtils.getPathForFile(file)
  },
  getAiMediaProviders() {
    return visibleMediaProviders()
  },
  getAiSearchProviders() {
    return AI_SEARCH_PROVIDERS
  },
  async testAiSearchSettings(input) {
    return testResultOf(await ipcRenderer.invoke('ai:search-test', input))
  },
  async testAiMediaSettings(input) {
    return testResultOf(await ipcRenderer.invoke('ai:media-test', input))
  },
  wb: {
    async loadAll() {
      const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.wbLoadAll)
      if (result && typeof result === 'object') {
        const r = result as { keys?: unknown; keyCount?: unknown; dbPath?: unknown }
        return {
          keys:
            r.keys && typeof r.keys === 'object' && !Array.isArray(r.keys)
              ? (r.keys as Record<string, string>)
              : {},
          keyCount: typeof r.keyCount === 'number' ? r.keyCount : 0,
          dbPath: typeof r.dbPath === 'string' ? r.dbPath : '',
        }
      }
      return { keys: {}, keyCount: 0, dbPath: '' }
    },
    async getKey(key) {
      const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.wbGetKey, key)
      return typeof result === 'string' ? result : null
    },
    async setKey(key, value) {
      await ipcRenderer.invoke(HOME_CHANNELS.wbSetKey, key, value)
    },
    async removeKey(key) {
      await ipcRenderer.invoke(HOME_CHANNELS.wbRemoveKey, key)
    },
    async importKeys(keys) {
      const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.wbImportKeys, keys)
      const imported =
        result &&
        typeof result === 'object' &&
        typeof (result as { imported?: unknown }).imported === 'number'
          ? (result as { imported: number }).imported
          : 0
      return { imported }
    },
    async exportBackup(media) {
      return (await ipcRenderer.invoke(HOME_CHANNELS.wbExportBackup, media ?? null)) as {
        ok: boolean
        path?: string
        error?: string
        canceled?: boolean
      }
    },
    async importBackup() {
      return (await ipcRenderer.invoke(HOME_CHANNELS.wbImportBackup)) as {
        ok: boolean
        keyCount?: number
        keys?: Record<string, string>
        media?: import('../shared/home-api').WorkbenchIdbMediaDump
        error?: string
        canceled?: boolean
      }
    },
  },
  async uniworkListWorkspaces() {
    return asUniworkResult<UniworkWorkspaceRef[]>(
      await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.listWorkspaces),
    )
  },
  async uniworkListDocuments(query) {
    return asUniworkResult<UniworkDocListPage>(
      await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.listDocuments, query),
    )
  },
  async uniworkOpenDocument(documentId) {
    return asUniworkResult<{ path: string }>(
      await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.openDocument, documentId),
    )
  },
  async uniworkDocStatus(path) {
    return asUniworkStatus(await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.docStatus, path))
  },
  async uniworkActiveDocStatus() {
    return asUniworkStatus(await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.activeDocStatus))
  },
  onUniworkDocStatus(cb) {
    const listener = (_event: IpcRendererEvent, status: UniworkDocStatus) => cb(status)
    ipcRenderer.on(UNIWORK_DOC_CHANNELS.docStatusEvent, listener)
    return () => ipcRenderer.removeListener(UNIWORK_DOC_CHANNELS.docStatusEvent, listener)
  },
  async uniworkSave(path) {
    return asUniworkStatus(await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.save, path))
  },
  async uniworkResolveConflict(path) {
    return asUniworkStatus(await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.resolveConflict, path))
  },
  onUniworkLaunch(cb) {
    return uniworkLaunches.subscribe(cb)
  },
}

// Mirror the cloud status into this preload's seam, so getAiMediaProviders()
// lists the UniWork cloud entry only while the user is signed in + entitled.
const mirrorCloudStatus = (status: unknown) =>
  setUniworkCloudStatus(normalizeUniworkCloudStatus(status) satisfies UniworkCloudStatus)
ipcRenderer.on(HOME_CHANNELS.uniworkCloudStatusEvent, (_event, status: unknown) =>
  mirrorCloudStatus(status),
)
void ipcRenderer
  .invoke(HOME_CHANNELS.uniworkCloudStatus)
  .then(mirrorCloudStatus)
  .catch(() => undefined)

contextBridge.exposeInMainWorld('aiOffice', homeApi)

const projectApi: ProjectHomeApi = {
  async listProjects() {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.list)
    return Array.isArray(result) ? (result as ProjectSummaryEntry[]) : []
  },
  async listFiles(projectId) {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.files, { projectId })
    return Array.isArray(result)
      ? result.filter((path): path is string => typeof path === 'string')
      : []
  },
  async createProject(name) {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.create, { name })
    return result as ProjectSummaryEntry
  },
  async createEducationProject(args) {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.createEducation, args)
    return result as ProjectSummaryEntry
  },
  async getEduMeta(projectId) {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.getEduMeta, { projectId })
    if (!result || typeof result !== 'object') return null
    return result as NonNullable<ProjectSummaryEntry['edu']>
  },
  async patchEduMeta(args) {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.patchEduMeta, args)
    return result as NonNullable<ProjectSummaryEntry['edu']>
  },
  async createPracticeProject(args) {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.createPractice, args)
    return result as ProjectSummaryEntry
  },
  async getPracticeMeta(projectId) {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.getPracticeMeta, {
      projectId,
    })
    if (!result || typeof result !== 'object') return null
    return result as NonNullable<ProjectSummaryEntry['practice']>
  },
  async patchPracticeMeta(args) {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.patchPracticeMeta, args)
    return result as NonNullable<ProjectSummaryEntry['practice']>
  },
  async renameProject(id, name) {
    await ipcRenderer.invoke(PROJECT_CHANNELS.rename, { id, name })
  },
  async deleteProject(id) {
    await ipcRenderer.invoke(PROJECT_CHANNELS.delete, { id })
  },
  async moveFile(filePath, projectId) {
    await ipcRenderer.invoke(PROJECT_CHANNELS.moveFile, { filePath, projectId })
  },
  async getTimeline(projectId, limit) {
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.timeline, {
      projectId,
      limit,
    })
    return Array.isArray(result) ? (result as TimelineEntryItem[]) : []
  },
}

contextBridge.exposeInMainWorld('aiOfficeProject', projectApi)

const integrationsApi: IntegrationsApi = {
  async status() {
    return (await ipcRenderer.invoke(INTEGRATIONS_CHANNELS.status)) as IntegrationsStatus
  },
  async installSkill(target) {
    return (await ipcRenderer.invoke(
      INTEGRATIONS_CHANNELS.installSkill,
      target,
    )) as SkillInstallState
  },
  async uninstallSkill(agentId) {
    return (await ipcRenderer.invoke(
      INTEGRATIONS_CHANNELS.uninstallSkill,
      agentId,
    )) as SkillInstallState
  },
  async pickSkillDir(title) {
    const r: unknown = await ipcRenderer.invoke(INTEGRATIONS_CHANNELS.pickSkillDir, title)
    return typeof r === 'string' ? r : null
  },
  async saveSkillZip(title) {
    const r: unknown = await ipcRenderer.invoke(INTEGRATIONS_CHANNELS.saveSkillZip, title)
    return typeof r === 'string' ? r : null
  },
  async copyText(text) {
    await ipcRenderer.invoke(INTEGRATIONS_CHANNELS.copyText, text)
  },
}
contextBridge.exposeInMainWorld('aiOfficeIntegrations', integrationsApi)

const tabsApi: TabsApi = {
  async list() {
    const result: unknown = await ipcRenderer.invoke(TABS_CHANNELS.list)
    return Array.isArray(result) ? (result as TabSummary[]) : []
  },
  async activate(id) {
    await ipcRenderer.invoke(TABS_CHANNELS.activate, id)
  },
  async close(id) {
    await ipcRenderer.invoke(TABS_CHANNELS.close, id)
  },
  async showMenu(x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showMenu, x, y)
  },
  async showNewMenu(x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showNewMenu, x, y)
  },
  async showTabMenu(id, x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showTabMenu, id, x, y)
  },
  async detach(id) {
    await ipcRenderer.invoke(TABS_CHANNELS.detach, id)
  },
  async tearOff(id, screenX, screenY) {
    const result: unknown = await ipcRenderer.invoke(TABS_CHANNELS.tearOff, id, screenX, screenY)
    return result === true
  },
  dragTornWindow(screenX, screenY) {
    ipcRenderer.send(TABS_CHANNELS.dragTornWindow, screenX, screenY)
  },
  async dockTornWindow(index) {
    await ipcRenderer.invoke(TABS_CHANNELS.dockTornWindow, index)
  },
  async endTornDrag() {
    await ipcRenderer.invoke(TABS_CHANNELS.endTornDrag)
  },
  onDockPreview(handler) {
    const listener = (_event: IpcRendererEvent, preview: { x: number } | null) =>
      handler(preview && typeof preview.x === 'number' ? { x: preview.x } : null)
    ipcRenderer.on(TABS_CHANNELS.dockPreview, listener)
    return () => ipcRenderer.removeListener(TABS_CHANNELS.dockPreview, listener)
  },
  reportDockIndex(index) {
    ipcRenderer.send(TABS_CHANNELS.dockIndex, index)
  },
  async showAppMenu(x, y) {
    await ipcRenderer.invoke(TABS_CHANNELS.showAppMenu, x, y)
  },
  async reorder(id, toIndex) {
    await ipcRenderer.invoke(TABS_CHANNELS.reorder, id, toIndex)
  },
  onChanged(handler) {
    const listener = (_event: IpcRendererEvent, tabs: TabSummary[]) => handler(tabs)
    ipcRenderer.on(TABS_CHANNELS.changed, listener)
    return () => ipcRenderer.removeListener(TABS_CHANNELS.changed, listener)
  },
  notifyChromePressed() {
    ipcRenderer.send(TABS_CHANNELS.chromePressed)
  },
  onChromePressed(handler) {
    const listener = () => handler()
    ipcRenderer.on('app:chrome-pressed', listener)
    return () => ipcRenderer.removeListener('app:chrome-pressed', listener)
  },
}

contextBridge.exposeInMainWorld('aiOfficeTabs', tabsApi)

// open documents dragged from the OS anywhere over Home or the tab strip
installDropOpenBridge()
