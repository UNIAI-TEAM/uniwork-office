import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import {
  AI_MEDIA_PROVIDERS,
  AI_PROVIDERS,
  AI_SEARCH_PROVIDERS,
  getProviderAdapter,
} from '@genoffice/ai-provider/browser'
import type { AiSettings, CodexModelCatalog } from '@genoffice/ai-provider/browser'
import type { AiStreamChunk, AiStreamRequest } from '@genoffice/ai-provider'
import { installDropOpenBridge } from '@genoffice/electron-utils/drop-open'
import { normalizeAiPanelPrefs } from '@genoffice/ui/ai-panel-prefs'
import type {
  AccountLoginEvent,
  AccountStatus,
  AttachmentAddResult,
  AttachmentImageResult,
  AttachmentReadResult,
  CloudProjectsSnapshot,
  HomeApi,
  RecentEntry,
  RecentPage,
  RenameResult,
  ProjectHomeApi,
  ProjectSummaryEntry,
  TimelineEntryItem,
  UiLanguage,
} from '../shared/home-api'
import { HOME_CHANNELS, PROJECT_CHANNELS } from '../shared/home-api'
import { INTEGRATIONS_CHANNELS } from '../shared/integrations-api'
import type {
  IntegrationsApi,
  IntegrationsStatus,
  SkillInstallState,
} from '../shared/integrations-api'
import type { TabsApi, TabSummary } from '../shared/tabs-api'
import { TABS_CHANNELS } from '../shared/tabs-api'

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
  'vi',
  'zh-TW',
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

const homeApi: HomeApi = {
  async recents(query) {
    return asRecentPage(await ipcRenderer.invoke(HOME_CHANNELS.recents, query))
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
    if (typeof tab.id !== 'string' || typeof tab.kind !== 'string' || typeof tab.title !== 'string') {
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
    return (result ?? { loggedIn: false }) as AccountStatus
  },
  async accountLogin() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.accountLogin)
    return result === true
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
  async getAnalyticsEnabled() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getAnalyticsEnabled)
    return result !== false
  },
  async setAnalyticsEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Invalid analytics consent.')
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.setAnalyticsEnabled, enabled)
    return result === true
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
  async openGenTeam() {
    await ipcRenderer.invoke(HOME_CHANNELS.openGenTeam)
  },
  async openCreditUsage() {
    await ipcRenderer.invoke(HOME_CHANNELS.openCreditUsage)
  },
  async openGitHubRepo() {
    await ipcRenderer.invoke(HOME_CHANNELS.openGitHubRepo)
  },
  async githubStars() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.githubStars)
    return typeof result === 'number' && Number.isFinite(result) ? result : null
  },
  async starPromptShouldShow() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.starPromptShouldShow)
    const raw = (result ?? {}) as { show?: unknown; docOpens?: unknown }
    return {
      show: raw.show === true,
      docOpens:
        typeof raw.docOpens === 'number' && Number.isFinite(raw.docOpens) ? raw.docOpens : 0,
    }
  },
  async starPromptAction(action) {
    if (action !== 'starred' && action !== 'later') throw new Error('Invalid star prompt action.')
    await ipcRenderer.invoke(HOME_CHANNELS.starPromptAction, action)
  },
  async cloudProjectsCached() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.cloudProjectsCached)
    return asCloudProjectsSnapshot(result)
  },
  async cloudProjectsSync() {
    // failures (network / CLI) resolve to null so the renderer keeps whatever it has
    try {
      const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.cloudProjects)
      return asCloudProjectsSnapshot(result)
    } catch {
      return null
    }
  },
  async openCloudProject(projectUrl) {
    if (typeof projectUrl !== 'string' || !projectUrl) throw new Error('Invalid project URL.')
    await ipcRenderer.invoke(HOME_CHANNELS.openCloudProject, projectUrl)
  },
  // AI settings channels are registered once by the shell's aggregated docs handlers
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
  async testAiSettings(settings) {
    const result: unknown = await ipcRenderer.invoke('ai:chat', {
      settings,
      system: 'You are a connectivity test. Reply with the single word OK.',
      user: 'ping',
    })
    const raw = (result ?? {}) as { ok?: unknown; error?: unknown }
    return raw.ok === true
      ? { ok: true }
      : { ok: false, error: typeof raw.error === 'string' ? raw.error : 'Connection failed' }
  },
  async probeOpenRouterKey(apiKey) {
    return (await ipcRenderer.invoke('ai:openrouter-key-status', apiKey)) as import('@genoffice/ai-provider').OpenRouterKeyStatus
  },
  async aiChat(input) {
    const settings =
      input.settings ?? ((await ipcRenderer.invoke('ai:get-settings')) as AiSettings)
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
    return AI_MEDIA_PROVIDERS
  },
  getAiSearchProviders() {
    return AI_SEARCH_PROVIDERS
  },
  async testAiSearchSettings(input) {
    const raw = ((await ipcRenderer.invoke('ai:search-test', input)) ?? {}) as {
      ok?: unknown
      error?: unknown
    }
    return raw.ok === true
      ? { ok: true }
      : { ok: false, error: typeof raw.error === 'string' ? raw.error : 'Connection failed' }
  },
  async testAiMediaSettings(input) {
    const raw = ((await ipcRenderer.invoke('ai:media-test', input)) ?? {}) as {
      ok?: unknown
      error?: unknown
    }
    return raw.ok === true
      ? { ok: true }
      : { ok: false, error: typeof raw.error === 'string' ? raw.error : 'Connection failed' }
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
        result && typeof result === 'object' && typeof (result as { imported?: unknown }).imported === 'number'
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
        media?: import('../../shared/home-api').WorkbenchIdbMediaDump
        error?: string
        canceled?: boolean
      }
    },
  },
}

function asCloudProjectsSnapshot(result: unknown): CloudProjectsSnapshot | null {
  if (
    result &&
    typeof result === 'object' &&
    Array.isArray((result as CloudProjectsSnapshot).projects)
  ) {
    return result as CloudProjectsSnapshot
  }
  return null
}

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
    const result: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.getPracticeMeta, { projectId })
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
