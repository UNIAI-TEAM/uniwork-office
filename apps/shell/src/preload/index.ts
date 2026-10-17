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
import {
  installUniworkAiFlagBridge,
  installUniworkCloudStatusBridge,
} from '@genoffice/electron-utils/uniwork-ai-flag-bridge'
import { installUniworkDiscussionBridge } from '@genoffice/electron-utils/discussion-bridge'
import type { UpdateUiState } from '../shared/update-api'
import { normalizeAiPanelPrefs } from '@genoffice/ui/ai-panel-prefs'
import type {
  AccountLoginEvent,
  DeskDraft,
  DeskToolResult,
  AiConnectionTestResult,
  AccountSetServerResult,
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
  UniworkConflictReply,
  UniworkConflictView,
  UniworkCreateDocInput,
  UniworkCreateFolderInput,
  UniworkDocActionResult,
  UniworkDocErrorCode,
  UniworkDocListPage,
  UniworkDocLock,
  UniworkDocProperties,
  UniworkDocRenamedEvent,
  UniworkDocStatus,
  UniworkDocSummary,
  UniworkFolderChildren,
  UniworkFolderNode,
  UniworkFolderQuery,
  UniworkLaunchEvent,
  UniworkMoveDocumentInput,
  UniworkMoveResult,
  UniworkQueuePopoverRequest,
  UniworkRemoteBar,
  UniworkRemoteAction,
  UniworkResult,
  UniworkSearchPage,
  UniworkSearchQuery,
  UniworkSharedPage,
  UniworkSharedQuery,
  UniworkTreeChangedEvent,
  UniworkUploadDocInput,
  UniworkUploadProgress,
  UniworkWorkspaceRef,
  SignOutPlan,
  SignOutProgress,
  SignOutPromptRequest,
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
import { UNIWORK_WORK_CHANNELS } from '../shared/uniwork-work-api'
import type {
  UniworkWorkApi,
  UniworkWorkResult,
  WorkCalendarEvent,
  WorkHomeSummary,
  WorkPerson,
  WorkTask,
  WorkTaskStatus,
} from '../shared/uniwork-work-api'
import { asSyncCenterSnapshot, UNIWORK_SYNC_CENTER_CHANNELS } from '../shared/sync-center'
import type { SyncCenterActionResult, UniworkSyncCenterApi } from '../shared/sync-center'
import type {
  OfflineDocState,
  OfflineResult,
  OfflineUnpinResult,
  UniworkOfflineLibraryApi,
} from '../shared/offline-library'
import { createLaunchReplay } from './launch-replay'

// subscribed at preload time: a cold-start launch event can arrive before the
// renderer subscribes, and is then held for the first subscriber
const uniworkLaunches = createLaunchReplay<UniworkLaunchEvent>()
ipcRenderer.on(
  UNIWORK_DOC_CHANNELS.launchEvent,
  (_event: IpcRendererEvent, event: UniworkLaunchEvent) => uniworkLaunches.deliver(event),
)
// a lock can be pushed before the renderer subscribes (a cold-start open); the
// shell also reads uniworkLocks() when it mounts, so a missed push is not lost
// and a dismissed lock is never resurrected
const uniworkLockSubscribers = new Set<(lock: UniworkDocLock) => void>()
ipcRenderer.on(UNIWORK_DOC_CHANNELS.lock, (_event: IpcRendererEvent, raw: unknown) => {
  const lock = asUniworkLock(raw)
  if (!lock) return
  for (const cb of [...uniworkLockSubscribers]) cb(lock)
})
// the whole list when it changes in main (a keystore lock cleared): the shell
// replaces its list instead of waiting for the next unrelated push
const uniworkLocksSubscribers = new Set<(locks: UniworkDocLock[]) => void>()
ipcRenderer.on(UNIWORK_DOC_CHANNELS.locksChanged, (_event: IpcRendererEvent, raw: unknown) => {
  // not a list: ignore it, an empty one would replace (and so clear) every panel
  if (!Array.isArray(raw)) return
  const locks = asUniworkLocks(raw)
  for (const cb of [...uniworkLocksSubscribers]) cb(locks)
})
// S18: a document's title changed (renamed here or elsewhere); no replay is
// needed - the library reads titles again on open, this only updates a row
// already on screen and drives the polite announce
const docRenamedSubscribers = new Set<(event: UniworkDocRenamedEvent) => void>()
ipcRenderer.on(UNIWORK_DOC_CHANNELS.docRenamed, (_event: IpcRendererEvent, raw: unknown) => {
  const event = asDocRenamed(raw)
  if (!event) return
  for (const cb of [...docRenamedSubscribers]) cb(event)
})
// FD-11: a workspace's document tree changed in the server's view (a feed page
// or one of this app's own folder actions), coalesced in main. No replay: the
// browser re-reads the tree and the open folder when it hears it, and window
// focus covers a push missed while nothing was mounted.
const treeChangedSubscribers = new Set<(event: UniworkTreeChangedEvent) => void>()
ipcRenderer.on(UNIWORK_DOC_CHANNELS.treeChanged, (_event: IpcRendererEvent, raw: unknown) => {
  const event = asUniworkTreeChanged(raw)
  if (!event) return
  for (const cb of [...treeChangedSubscribers]) cb(event)
})
// S18: upload bytes sent of the total, while the dialog is open
const uploadProgressSubscribers = new Set<(event: UniworkUploadProgress) => void>()
ipcRenderer.on(UNIWORK_DOC_CHANNELS.uploadProgress, (_event: IpcRendererEvent, raw: unknown) => {
  const event = asUploadProgress(raw)
  if (!event) return
  for (const cb of [...uploadProgressSubscribers]) cb(event)
})
// G5-11: sign-out progress (`waiting` while an in-flight save settles, `done` after)
const signOutProgressSubscribers = new Set<(event: SignOutProgress) => void>()
ipcRenderer.on(UNIWORK_DOC_CHANNELS.signOutProgress, (_event: IpcRendererEvent, raw: unknown) => {
  const event = asSignOutProgress(raw)
  if (!event) return
  for (const cb of [...signOutProgressSubscribers]) cb(event)
})
// G5-11 D5: main-initiated sign-out prompt (account switch / deployment switch)
const signOutPromptSubscribers = new Set<(request: SignOutPromptRequest) => void>()
ipcRenderer.on(UNIWORK_DOC_CHANNELS.signOutPrompt, (_event: IpcRendererEvent, raw: unknown) => {
  const request = asSignOutPromptRequest(raw)
  if (!request) return
  for (const cb of [...signOutPromptSubscribers]) cb(request)
})

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

/**
 * An S18 action result from main: the same shape as UniworkResult, but its
 * error union also carries the two field errors and a cancelled upload. Both
 * branches are checked the way the other pushes are checked - an `ok:true` must
 * carry an object `value` (the renderer dereferences `value.title`) and an
 * `ok:false` a string `error` - so a shape main never meant to send is
 * `malformed_response` here instead of a crash in the renderer.
 */
function asUniworkActionResult<T>(result: unknown): UniworkDocActionResult<T> {
  if (result && typeof result === 'object') {
    const r = result as { ok?: unknown; value?: unknown; error?: unknown }
    if (r.ok === true && r.value && typeof r.value === 'object' && !Array.isArray(r.value)) {
      return result as UniworkDocActionResult<T>
    }
    if (r.ok === false && typeof r.error === 'string' && r.error) {
      return result as UniworkDocActionResult<T>
    }
  }
  return { ok: false, error: 'malformed_response' }
}

/** a lock from main: path, reason and name only; anything else is dropped */
function asUniworkLock(result: unknown): UniworkDocLock | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Partial<UniworkDocLock>
  if (typeof r.path !== 'string' || !r.path) return null
  if (r.reason !== 'store_newer' && r.reason !== 'keystore_locked' && r.reason !== 'signed_out') {
    return null
  }
  return { path: r.path, reason: r.reason, name: typeof r.name === 'string' ? r.name : '' }
}

function asUniworkLocks(result: unknown): UniworkDocLock[] {
  if (!Array.isArray(result)) return []
  return result.map(asUniworkLock).filter((lock): lock is UniworkDocLock => lock !== null)
}

function asSignOutPlan(raw: unknown): SignOutPlan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SignOutPlan>
  const nonNegInt = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
  return {
    count: nonNegInt(r.count),
    waiting: nonNegInt(r.waiting),
    keystoreLocked: r.keystoreLocked === true,
    ramOnly: nonNegInt(r.ramOnly),
  }
}

function asSignOutProgress(raw: unknown): SignOutProgress | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<SignOutProgress>
  const phase = r.phase
  if (phase !== 'waiting' && phase !== 'done') return null
  const captureFailed =
    phase === 'done' &&
    typeof r.captureFailed === 'number' &&
    Number.isFinite(r.captureFailed) &&
    r.captureFailed > 0
      ? Math.floor(r.captureFailed)
      : undefined
  return captureFailed !== undefined ? { phase, captureFailed } : { phase }
}

function asSignOutPromptRequest(raw: unknown): SignOutPromptRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<SignOutPromptRequest>
  if (typeof r.requestId !== 'string' || !r.requestId) return null
  const plan = asSignOutPlan(r.plan)
  // `mode` must cross: without it the renderer shows the account-switch notice as the confirm
  return r.mode === 'confirm' || r.mode === 'notice'
    ? { requestId: r.requestId, plan, mode: r.mode }
    : { requestId: r.requestId, plan }
}

/** a renamed push from main: a document id and its new title only */
function asDocRenamed(raw: unknown): UniworkDocRenamedEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<UniworkDocRenamedEvent>
  if (typeof r.documentId !== 'string' || !r.documentId) return null
  if (typeof r.title !== 'string' || !r.title) return null
  return { documentId: r.documentId, title: r.title }
}

/** FD-11: a push whose payload is not a workspace id is ignored, never thrown */
function asUniworkTreeChanged(raw: unknown): UniworkTreeChangedEvent | null {
  if (!raw || typeof raw !== 'object' || !('workspaceId' in raw)) return null
  const workspaceId = raw.workspaceId
  return typeof workspaceId === 'string' && workspaceId ? { workspaceId } : null
}

/** an upload-progress push: the upload's own id, a local path and finite, non-negative byte counts */
function asUploadProgress(raw: unknown): UniworkUploadProgress | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<UniworkUploadProgress>
  if (typeof r.uploadId !== 'string' || !r.uploadId) return null
  if (typeof r.path !== 'string' || !r.path) return null
  if (typeof r.loaded !== 'number' || !Number.isFinite(r.loaded) || r.loaded < 0) return null
  if (typeof r.total !== 'number' || !Number.isFinite(r.total) || r.total < 0) return null
  return { uploadId: r.uploadId, path: r.path, loaded: r.loaded, total: r.total }
}

/**
 * The S6 bar of a status from main: a known kind, and an integer version where
 * the kind carries one. Anything else is dropped (the renderer then shows no
 * bar) rather than dereferenced.
 */
function asUniworkRemoteBar(raw: unknown): UniworkRemoteBar | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { kind?: unknown; version?: unknown; wait?: unknown }
  const version = (): number | null =>
    Number.isSafeInteger(r.version) ? (r.version as number) : null
  switch (r.kind) {
    case 'updated': {
      if (r.version === null || r.version === undefined) return { kind: 'updated', version: null }
      const v = version()
      return v === null ? null : { kind: 'updated', version: v }
    }
    case 'newer-dirty': {
      const v = version()
      if (v === null) return null
      if (r.wait === 'commit' || r.wait === 'stuck') {
        return { kind: 'newer-dirty', version: v, wait: r.wait }
      }
      return r.wait === undefined ? { kind: 'newer-dirty', version: v } : null
    }
    case 'newer-ai':
    case 'now-clean':
    case 'reload-failed': {
      const v = version()
      return v === null ? null : { kind: r.kind, version: v }
    }
    case 'revoked':
    case 'deleted':
      return { kind: r.kind }
    default:
      return null
  }
}

function asUniworkStatus(result: unknown): UniworkDocStatus | null {
  if (
    result &&
    typeof result === 'object' &&
    typeof (result as UniworkDocStatus).path === 'string'
  ) {
    const status = result as UniworkDocStatus
    const { remote, ...rest } = status
    if (remote === undefined) return status
    const bar = asUniworkRemoteBar(remote)
    return bar ? { ...rest, remote: bar } : rest
  }
  return null
}

function asUniworkConflictView(raw: unknown): UniworkConflictView | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<UniworkConflictView>
  if (typeof r.sessionId !== 'string' || !r.sessionId) return null
  if (typeof r.path !== 'string' || !r.path) return null
  if (typeof r.documentId !== 'string' || !r.documentId) return null
  return raw as UniworkConflictView
}

function asUniworkConflictReply(raw: unknown): UniworkConflictReply {
  if (raw && typeof raw === 'object') {
    const r = raw as { kind?: unknown; view?: unknown }
    if (r.kind === 'closed') return { kind: 'closed' }
    if (r.kind === 'view') {
      const view = asUniworkConflictView(r.view)
      if (view) return { kind: 'view', view }
    }
  }
  return { kind: 'closed' }
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
  async starredGroups() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.starredGroups)
    return Array.isArray(result) ? result.filter((g): g is string => typeof g === 'string') : []
  },
  async setStarredGroup(paths, group) {
    await ipcRenderer.invoke(HOME_CHANNELS.setStarredGroup, paths, group)
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
  async unstarPaths(paths) {
    await ipcRenderer.invoke(HOME_CHANNELS.unstarPaths, paths)
  },
  async revealPath(path) {
    if (typeof path !== 'string' || !path) throw new Error('Invalid path.')
    await ipcRenderer.invoke(HOME_CHANNELS.revealPath, path)
  },
  async listDrafts() {
    return (await ipcRenderer.invoke(HOME_CHANNELS.listDrafts)) as DeskDraft[]
  },
  async runDeskTool(req) {
    return (await ipcRenderer.invoke(HOME_CHANNELS.runDeskTool, req)) as DeskToolResult
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
  async getPinnedUpdateChannel() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.getPinnedUpdateChannel)
    return typeof result === 'string' && result !== '' ? result : null
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
  async accountLogout(options) {
    if (options !== undefined) {
      await ipcRenderer.invoke(
        HOME_CHANNELS.accountLogout,
        options?.confirmed === true ? { confirmed: true } : { confirmed: false },
      )
      return
    }
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
  async accountReplaceLockedSignIn() {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.accountReplaceLockedSignIn)
    return result === true
  },
  async accountSetServer(address) {
    const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.accountSetServer, address)
    const value = (result ?? {}) as Partial<AccountSetServerResult>
    return {
      ok: value.ok === true,
      ...(value.ok === false && value.error ? { error: value.error } : {}),
      status: value.status ?? { loggedIn: false, state: 'signed-out' },
    } as AccountSetServerResult
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
  async getAiSettings(options) {
    return (await ipcRenderer.invoke(
      'ai:get-settings',
      options?.includeUniworkPick ? { includeUniworkPick: true } : undefined,
    )) as AiSettings
  },
  async setAiSettings(settings, options) {
    const sent = {
      ...(options?.includeUniworkPick ? { includeUniworkPick: true } : {}),
      ...(options?.modelPick ? { modelPick: options.modelPick } : {}),
      ...(options?.modelPicks?.length ? { modelPicks: options.modelPicks } : {}),
    }
    await ipcRenderer.invoke(
      'ai:set-settings',
      settings,
      Object.keys(sent).length > 0 ? sent : undefined,
    )
  },
  getAiProviders() {
    return AI_PROVIDERS.map((meta) => {
      let defaultBaseUrl = ''
      // genspark routes by model, uniwork rides the session adapter, custom has no default — all stay ''
      if (
        meta.id !== 'genspark' &&
        meta.id !== 'uniwork' &&
        !meta.needsBaseUrl &&
        !meta.needsCliPath
      ) {
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
      const r = (result && typeof result === 'object' ? result : {}) as {
        keys?: unknown
        keyCount?: unknown
        dbPath?: unknown
        bucket?: unknown
        legacyPending?: unknown
        unavailable?: unknown
      }
      return {
        keys:
          r.keys && typeof r.keys === 'object' && !Array.isArray(r.keys)
            ? (r.keys as Record<string, string>)
            : {},
        keyCount: typeof r.keyCount === 'number' ? r.keyCount : 0,
        dbPath: typeof r.dbPath === 'string' ? r.dbPath : '',
        bucket: typeof r.bucket === 'string' ? r.bucket : '',
        legacyPending: r.legacyPending === true,
        ...(r.unavailable === true || typeof r.bucket !== 'string' ? { unavailable: true } : {}),
      }
    },
    async getKey(key, bucket) {
      const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.wbGetKey, key, bucket)
      return typeof result === 'string' ? result : null
    },
    async setKey(key, value, bucket) {
      await ipcRenderer.invoke(HOME_CHANNELS.wbSetKey, key, value, bucket)
    },
    async removeKey(key, bucket) {
      await ipcRenderer.invoke(HOME_CHANNELS.wbRemoveKey, key, bucket)
    },
    async importKeys(keys, bucket) {
      const result: unknown = await ipcRenderer.invoke(HOME_CHANNELS.wbImportKeys, keys, bucket)
      const imported =
        result &&
        typeof result === 'object' &&
        typeof (result as { imported?: unknown }).imported === 'number'
          ? (result as { imported: number }).imported
          : 0
      return { imported }
    },
    async legacyDone(bucket) {
      await ipcRenderer.invoke(HOME_CHANNELS.wbLegacyDone, bucket)
    },
    onBucketChanged(cb) {
      const listener = (_event: IpcRendererEvent, bucket: unknown) => {
        if (typeof bucket === 'string') cb(bucket)
      }
      ipcRenderer.on(HOME_CHANNELS.wbBucketChanged, listener)
      return () => ipcRenderer.removeListener(HOME_CHANNELS.wbBucketChanged, listener)
    },
    async exportBackup(media, bucket) {
      return (await ipcRenderer.invoke(HOME_CHANNELS.wbExportBackup, media ?? null, bucket)) as {
        ok: boolean
        path?: string
        error?: string
        canceled?: boolean
      }
    },
    async importBackup(bucket) {
      return (await ipcRenderer.invoke(HOME_CHANNELS.wbImportBackup, bucket)) as {
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
  async uniworkListSharedWithMe(query?: UniworkSharedQuery) {
    return asUniworkResult<UniworkSharedPage>(
      await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.listSharedWithMe, query),
    )
  },
  async uniworkDocumentProperties(documentId: string) {
    return asUniworkResult<UniworkDocProperties>(
      await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.documentProperties, documentId),
    )
  },
  async uniworkCreateDocument(input: UniworkCreateDocInput) {
    return asUniworkActionResult<UniworkDocSummary>(
      await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.createDocument, input),
    )
  },
  async uniworkPickUploadFile() {
    const picked = (await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.pickUploadFile)) as unknown
    if (!picked || typeof picked !== 'object') return null
    const r = picked as { path?: unknown; name?: unknown }
    return typeof r.path === 'string' && r.path && typeof r.name === 'string' && r.name
      ? { path: r.path, name: r.name }
      : null
  },
  async uniworkUploadDocument(input: UniworkUploadDocInput) {
    return asUniworkActionResult<UniworkDocSummary>(
      await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.uploadDocument, input),
    )
  },
  onUniworkUploadProgress(cb: (event: UniworkUploadProgress) => void) {
    uploadProgressSubscribers.add(cb)
    return () => {
      uploadProgressSubscribers.delete(cb)
    }
  },
  async uniworkCancelUploadDocument(uploadId: string) {
    if (typeof uploadId !== 'string' || !uploadId) return
    await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.cancelUpload, uploadId)
  },
  async uniworkRenameDocument(documentId: string, name: string) {
    return asUniworkActionResult<UniworkDocSummary>(
      await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.renameDocument, documentId, name),
    )
  },
  async uniworkArchiveDocument(documentId: string) {
    return asUniworkActionResult<UniworkDocSummary>(
      await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.archiveDocument, documentId),
    )
  },
  async uniworkRestoreDocument(documentId: string) {
    return asUniworkActionResult<UniworkDocSummary>(
      await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.restoreDocument, documentId),
    )
  },
  async uniworkFolderTree(workspaceId: string) {
    return asUniworkResult<UniworkFolderNode[]>(
      await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.folderTree, workspaceId),
    )
  },
  async uniworkListChildren(q: UniworkFolderQuery) {
    return asUniworkResult<UniworkFolderChildren>(
      await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.listChildren, q),
    )
  },
  async uniworkSearchDocuments(q: UniworkSearchQuery) {
    return asUniworkResult<UniworkSearchPage>(
      await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.searchDocuments, q),
    )
  },
  async uniworkCreateFolder(i: UniworkCreateFolderInput) {
    return asUniworkActionResult<UniworkDocSummary>(
      await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.createFolder, i),
    )
  },
  async uniworkMoveDocument(i: UniworkMoveDocumentInput) {
    return asUniworkActionResult<UniworkMoveResult>(
      await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.moveDocument, i),
    )
  },
  onUniworkTreeChanged(cb: (event: UniworkTreeChangedEvent) => void) {
    treeChangedSubscribers.add(cb)
    return () => {
      treeChangedSubscribers.delete(cb)
    }
  },
  onUniworkDocRenamed(cb: (event: UniworkDocRenamedEvent) => void) {
    docRenamedSubscribers.add(cb)
    return () => {
      docRenamedSubscribers.delete(cb)
    }
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
  onUniworkQueuePopover(cb) {
    const listener = (_event: IpcRendererEvent, raw: unknown) => {
      const path = raw && typeof raw === 'object' ? (raw as { path?: unknown }).path : undefined
      if (typeof path === 'string' && path) cb({ path } satisfies UniworkQueuePopoverRequest)
    }
    ipcRenderer.on(UNIWORK_DOC_CHANNELS.queuePopover, listener)
    return () => ipcRenderer.removeListener(UNIWORK_DOC_CHANNELS.queuePopover, listener)
  },
  async uniworkSave(path) {
    return asUniworkStatus(await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.save, path))
  },
  async uniworkSaveLocalCopy(path) {
    if (typeof path !== 'string' || !path) return false
    return (await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.saveLocalCopy, path)) === true
  },
  async uniworkResolveConflict(path) {
    return asUniworkStatus(await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.resolveConflict, path))
  },
  onUniworkConflict(cb) {
    const listener = (_event: IpcRendererEvent, raw: unknown) => {
      const view = asUniworkConflictView(raw)
      if (view) cb(view)
    }
    ipcRenderer.on(UNIWORK_DOC_CHANNELS.conflictOpen, listener)
    return () => ipcRenderer.removeListener(UNIWORK_DOC_CHANNELS.conflictOpen, listener)
  },
  onUniworkConflictClosed(cb) {
    const listener = (_event: IpcRendererEvent, raw: unknown) => {
      if (raw && typeof raw === 'object') {
        const sessionId = (raw as { sessionId?: unknown }).sessionId
        if (typeof sessionId === 'string' && sessionId) cb(sessionId)
      }
    }
    ipcRenderer.on(UNIWORK_DOC_CHANNELS.conflictClosed, listener)
    return () => ipcRenderer.removeListener(UNIWORK_DOC_CHANNELS.conflictClosed, listener)
  },
  async uniworkConflictAct(sessionId, action) {
    return asUniworkConflictReply(
      await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.conflictAct, sessionId, action),
    )
  },
  async uniworkRemoteAction(path, action: UniworkRemoteAction) {
    return asUniworkStatus(
      await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.remoteAction, path, action),
    )
  },
  async uniworkSetBarInset(heightPx) {
    if (typeof heightPx !== 'number' || !Number.isFinite(heightPx)) return
    await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.barInset, Math.max(0, Math.round(heightPx)))
  },
  onUniworkLaunch(cb) {
    return uniworkLaunches.subscribe(cb)
  },
  onUniworkLock(cb) {
    uniworkLockSubscribers.add(cb)
    return () => {
      uniworkLockSubscribers.delete(cb)
    }
  },
  async uniworkLocks() {
    return asUniworkLocks(await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.locks))
  },
  onUniworkLocksChanged(cb) {
    uniworkLocksSubscribers.add(cb)
    return () => {
      uniworkLocksSubscribers.delete(cb)
    }
  },
  async dismissUniworkLock(path) {
    await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.dismissLock, path)
  },
  async signOutPlan() {
    return asSignOutPlan(await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.signOutPlan))
  },
  onSignOutProgress(cb) {
    signOutProgressSubscribers.add(cb)
    return () => {
      signOutProgressSubscribers.delete(cb)
    }
  },
  onSignOutPrompt(cb) {
    signOutPromptSubscribers.add(cb)
    return () => {
      signOutPromptSubscribers.delete(cb)
    }
  },
  async answerSignOutPrompt(requestId, confirmed) {
    if (typeof requestId !== 'string' || !requestId) return
    await ipcRenderer.invoke(UNIWORK_DOC_CHANNELS.signOutPromptAnswer, {
      requestId,
      confirmed: confirmed === true,
    })
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
// window.uniworkAiFlag: the home renderer's provider list mirrors the shell's UniWork AI flag
installUniworkAiFlagBridge()
installUniworkCloudStatusBridge()

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
  focusActive() {
    ipcRenderer.send(TABS_CHANNELS.focusActive)
  },
  onChromePressed(handler) {
    const listener = () => handler()
    ipcRenderer.on('app:chrome-pressed', listener)
    return () => ipcRenderer.removeListener('app:chrome-pressed', listener)
  },
}

contextBridge.exposeInMainWorld('aiOfficeTabs', tabsApi)

/** main answers every work call with a result; anything else is a broken reply */
function asWorkResult<T>(result: unknown): UniworkWorkResult<T> {
  if (
    result &&
    typeof result === 'object' &&
    typeof (result as { ok?: unknown }).ok === 'boolean'
  ) {
    return result as UniworkWorkResult<T>
  }
  return { ok: false, error: 'server' }
}

const workApi: UniworkWorkApi = {
  async homeSummary(workspaceId) {
    return asWorkResult<WorkHomeSummary>(
      await ipcRenderer.invoke(UNIWORK_WORK_CHANNELS.homeSummary, workspaceId),
    )
  },
  async myTasks(workspaceId) {
    return asWorkResult<WorkTask[]>(
      await ipcRenderer.invoke(UNIWORK_WORK_CHANNELS.myTasks, workspaceId),
    )
  },
  async taskStatuses(workspaceId) {
    return asWorkResult<WorkTaskStatus[]>(
      await ipcRenderer.invoke(UNIWORK_WORK_CHANNELS.taskStatuses, workspaceId),
    )
  },
  async setTaskStatus(taskId, status) {
    return asWorkResult<WorkTask>(
      await ipcRenderer.invoke(UNIWORK_WORK_CHANNELS.setTaskStatus, taskId, status),
    )
  },
  async createTask(input) {
    return asWorkResult<WorkTask>(await ipcRenderer.invoke(UNIWORK_WORK_CHANNELS.createTask, input))
  },
  async calendarEvents(input) {
    return asWorkResult<WorkCalendarEvent[]>(
      await ipcRenderer.invoke(UNIWORK_WORK_CHANNELS.calendarEvents, input),
    )
  },
  async myProfile() {
    return asWorkResult<WorkPerson>(await ipcRenderer.invoke(UNIWORK_WORK_CHANNELS.myProfile))
  },
  async markNotificationsRead(ids) {
    return asWorkResult<null>(
      await ipcRenderer.invoke(UNIWORK_WORK_CHANNELS.markNotificationsRead, ids),
    )
  },
  async openWeb(target) {
    return (await ipcRenderer.invoke(UNIWORK_WORK_CHANNELS.openWeb, target)) === true
  },
}

contextBridge.exposeInMainWorld('uniworkWork', workApi)

// open documents dragged from the OS anywhere over Home or the tab strip
installDropOpenBridge()

// G8-11: the Discussion panel lives in the shell renderer and talks to the
// UniWork comments client through its own bridge (main checks the sender is
// this shell and the path an open, bound tab of its window)
installUniworkDiscussionBridge()

function asSyncCenterActionResult(result: unknown): SyncCenterActionResult {
  if (
    result &&
    typeof result === 'object' &&
    typeof (result as { ok?: unknown }).ok === 'boolean'
  ) {
    return result as SyncCenterActionResult
  }
  return { ok: false, code: 'other' }
}

/**
 * G5-05u: every offline library action answers `{ ok: true }` or a refusal
 * (`{ ok: false, code, ... }`); anything else is a refusal main never meant to
 * send, so the renderer treats it as one.
 */
function asOfflineResult<T extends { ok: boolean }>(result: unknown, fallback: T): T {
  if (result && typeof result === 'object' && 'ok' in result && typeof result.ok === 'boolean') {
    // main's own answer, validated by its one required field
    return result as T
  }
  return fallback
}

const syncCenterApi: UniworkSyncCenterApi & UniworkOfflineLibraryApi = {
  async getSnapshot() {
    const snapshot = asSyncCenterSnapshot(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.snapshot),
    )
    if (!snapshot) throw new Error('uniwork sync center: malformed snapshot')
    return snapshot
  },
  async syncNow() {
    return asSyncCenterActionResult(await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.syncNow))
  },
  async setSendingPaused(paused) {
    return asSyncCenterActionResult(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.setSendingPaused, paused === true),
    )
  },
  async sendNow(rowId) {
    return asSyncCenterActionResult(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.sendNow, rowId),
    )
  },
  async cancelSave(rowId) {
    return asSyncCenterActionResult(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.cancelSave, rowId),
    )
  },
  async recheck(rowId) {
    return asSyncCenterActionResult(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.recheck, rowId),
    )
  },
  async copySupportCode(rowId) {
    return asSyncCenterActionResult(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.copySupportCode, rowId),
    )
  },
  async discardSave(rowId) {
    return asSyncCenterActionResult(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.discardSave, rowId),
    )
  },
  async openDocument(rowId) {
    return asSyncCenterActionResult(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.openDocument, rowId),
    )
  },
  async openDraft(rowId) {
    return asSyncCenterActionResult(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.openDraft, rowId),
    )
  },
  async discardDraft(rowId) {
    return asSyncCenterActionResult(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.discardDraft, rowId),
    )
  },
  async saveAgain(rowId) {
    return asSyncCenterActionResult(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.saveAgain, rowId),
    )
  },
  async saveMyCopy(rowId) {
    return asSyncCenterActionResult(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.saveMyCopy, rowId),
    )
  },
  async retryStore() {
    return asSyncCenterActionResult(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.retryStore),
    )
  },
  async offlinePin(input) {
    return asOfflineResult<OfflineResult>(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.offlinePin, input),
      { ok: false, code: 'unknown' },
    )
  },
  async offlineUnpin(documentId, options) {
    return asOfflineResult<OfflineUnpinResult>(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.offlineUnpin, documentId, options),
      { ok: false, code: 'unknown' },
    )
  },
  async offlineCancel(documentId) {
    return asOfflineResult<OfflineResult>(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.offlineCancel, documentId),
      { ok: false, code: 'unknown' },
    )
  },
  async offlineDownloadNow(documentId) {
    return asOfflineResult<OfflineResult>(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.offlineDownloadNow, documentId),
      { ok: false, code: 'unknown' },
    )
  },
  async offlineOpen(documentId) {
    return asOfflineResult<OfflineResult>(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.offlineOpen, documentId),
      { ok: false, code: 'unknown' },
    )
  },
  async offlineOpenFolder() {
    return asOfflineResult<OfflineResult>(
      await ipcRenderer.invoke(UNIWORK_SYNC_CENTER_CHANNELS.offlineOpenFolder),
      { ok: false, code: 'unknown' },
    )
  },
  async offlineState(documentId) {
    const result: unknown = await ipcRenderer.invoke(
      UNIWORK_SYNC_CENTER_CHANNELS.offlineState,
      documentId,
    )
    if (result && typeof result === 'object' && 'pinned' in result) {
      return result as OfflineDocState
    }
    return { pinned: false, state: null, capabilityOn: false }
  },
  subscribe(cb) {
    const listener = (_event: IpcRendererEvent, value: unknown) => {
      const snapshot = asSyncCenterSnapshot(value)
      if (snapshot) cb(snapshot)
    }
    ipcRenderer.on(UNIWORK_SYNC_CENTER_CHANNELS.changedEvent, listener)
    return () => ipcRenderer.removeListener(UNIWORK_SYNC_CENTER_CHANNELS.changedEvent, listener)
  },
}

contextBridge.exposeInMainWorld('uniworkSyncCenter', syncCenterApi)
