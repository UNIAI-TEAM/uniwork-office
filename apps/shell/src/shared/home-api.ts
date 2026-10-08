import type {
  AiChatResponse,
  AiMediaProviderConfig,
  AiMediaProviderId,
  AiMediaProviderMeta,
  AiProviderMeta,
  AiSearchProviderId,
  AiSearchProviderMeta,
  AiSettings,
  AiStreamChunk,
  AiStreamRequest,
  CodexModelCatalog,
  OpenRouterKeyStatus,
} from '@genoffice/ai-provider'
import type { UpdateChannel, UpdateUiState } from './update-api'

/** Legal files shipped beside the app and opened from Settings > About. */
export type LegalDoc = 'license' | 'notice' | 'modifications' | 'thirdParty'

/** Image attachment extensions — multimodal base64 on send (mirrors docs). */
export const ATTACHMENT_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp'])

export interface AttachmentMeta {
  path: string
  name: string
  /** lowercased extension without the dot */
  ext: string
  sizeBytes: number
}

export interface AttachmentAddResult {
  accepted: AttachmentMeta[]
  rejected: string[]
}

export interface AttachmentReadResult {
  ok: boolean
  error?: string
  name?: string
  totalChars?: number
  text?: string
  offset?: number
}

export interface AttachmentImageResult {
  ok: boolean
  base64?: string
  mime?: string
  error?: string
}
import type { AiPanelPrefs } from '@genoffice/ui/ai-panel-prefs'
import type { FileExcerpt } from './file-excerpt'

/** UI language; kept self-contained here (mirrors Lang in @genoffice/i18n) */

export type UiLanguage =
  | 'zh'
  | 'en'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'th'
  | 'id'
  | 'ru'
  | 'ar'
  | 'pt'
  | 'it'
  | 'pl'
  | 'cs'
  | 'nl'
  | 'ms'
  | 'he'
  | 'hi'
  | 'vi'
  | 'zh-TW'

/** UI theme preference */
export type UiTheme = 'light' | 'dark' | 'system'

/**
 * Document page theme preference (genoffice#1811): what the editors' canvas/paper does
 * relative to the UI theme. 'follow' reproduces the previous single-theme
 * behavior; 'light'/'dark' pin the paper regardless of the UI theme.
 */
export type DocTheme = 'follow' | 'light' | 'dark'

/** shell-wide AutoSave default for every editor; updatedAt is 0 until first set */
export interface AutoSaveDefault {
  on: boolean
  updatedAt: number
}

/** local MCP server state (persisted in userData/app-settings.json) */
export interface McpStatus {
  running: boolean
  enabled: boolean
  port: number
  /** headless generation (create_docx without opening the UI) is allowed */
  background: boolean
  /** server/tool activity is recorded to the local log file */
  logging: boolean
  /** base URL when running, else null */
  url: string | null
  /** capability families the running build exposes, e.g. ['docs', 'slides'] */
  capabilities: string[]
  /** present when the last start attempt failed (e.g. port in use) */
  error?: string
}

/** a recent file entry shown on the home screen; type derives from the extension */
export interface RecentEntry {
  path: string
  name: string
  /** lowercased extension without the dot ('docx' | 'xlsx' | 'pptx') */
  ext: string
  /** last-modified time, ms since epoch */
  mtimeMs: number
  /** file size in bytes */
  sizeBytes: number
  /** whether the user starred this file */
  starred: boolean
  /** the path failed to stat (disconnected drive, moved, deleted) — kept
      listed like Word's recents instead of silently dropped (r158) */
  missing?: boolean
}

/** paged query for the home file lists */
export interface RecentQuery {
  /** number of entries to skip (default 0) */
  offset?: number
  /** page size; 0 returns no entries but still reports totals (default 50) */
  limit?: number
  /** restrict to one extension ('docx' | 'xlsx' | 'pptx'); omit for all */
  ext?: string
}

export interface RecentPage {
  entries: RecentEntry[]
  /** total matching the query's ext filter */
  total: number
  /** total ignoring the ext filter (for the sidebar counters) */
  totalAll: number
}

/** local file search over names, folders and extracted text */
export interface FileSearchQuery {
  q: string
  /** sidebar filter key ('docx' | 'xlsx' | ...); omit for all */
  ext?: string
  offset?: number
  limit?: number
}

export interface FileSearchSnippetPart {
  text: string
  hit: boolean
}

export interface FileSearchHit extends RecentEntry {
  /** excerpt around the first content match; null when only the name or folder matched */
  snippet: FileSearchSnippetPart[] | null
  /** folded query fragments the file matched; highlight them in the name and folder */
  needles: string[]
}

/**
 * Endpoints the search reranker can judge against. The hosted Jev routes are
 * OpenRouter and TypeSafe's own API; Perplexity and Cloudflare host their own
 * decision models; Kev and Rizzo Flow are local /v1/systemone servers;
 * `custom` points at any other /v1/systemone-compatible server.
 */
export type DecisionEndpoint =
  'openrouter' | 'direct' | 'perplexity' | 'cloudflare' | 'kev' | 'rizzo' | 'custom'

/** home search options persisted in app-settings.json under `fileSearch` */
export interface FileSearchSettings {
  /** send the top local hits to a decision model for reranking; default off */
  rerank: boolean
  endpoint: DecisionEndpoint
  /** one API key per endpoint; local endpoints (kev/rizzo/custom) may stay empty */
  keys: Record<DecisionEndpoint, string>
  /** `custom` endpoint only: base URL of a /v1/systemone-compatible server */
  customBaseUrl: string
  /** `custom` endpoint only: model id the server expects */
  customModel: string
  /** `cloudflare` endpoint only: Workers AI account id */
  cloudflareAccountId: string
  /** `cloudflare` endpoint only: Workers AI model path, e.g. @cf/cloudflare/clef */
  cloudflareModel: string
}

export interface FileSearchRerank {
  /** paths in the decision model's order, most relevant first; paths not judged keep their local order after these */
  order: string[]
  /** calibrated 0–2 relevance per judged path */
  scores: Record<string, number>
}

export interface FileSearchPage {
  hits: FileSearchHit[]
  total: number
  index: {
    indexed: number
    pending: number
    scanning: boolean
  }
}

/**
 * Default-app ownership of the Office document types. `others` lists the apps
 * (display names) currently holding at least one type; `manualOnly` means the
 * platform (Windows) only lets us open the system page.
 */
export interface DefaultAppStatus {
  state: 'unsupported' | 'unknown' | 'default' | 'other'
  others: string[]
  manualOnly: boolean
}

export interface HomeApi {
  /** unified recents across document types, newest first (paged) */
  recents(query?: RecentQuery): Promise<RecentPage>
  /** search indexed files by name, folder and content */
  searchFiles(query: FileSearchQuery): Promise<FileSearchPage>
  /** decision-model order for the hits currently shown (≤ 20 paths); null when reranking is off or unavailable */
  rerankSearch(query: { q: string; paths: string[] }): Promise<FileSearchRerank | null>
  getFileSearchSettings(): Promise<FileSearchSettings>
  setFileSearchSettings(patch: Partial<FileSearchSettings>): Promise<FileSearchSettings>
  /** one two-document judgement against the (possibly unsaved) settings */
  testFileSearchRerank(settings: FileSearchSettings): Promise<{ ok: boolean; error?: string }>
  /** starred files (independent of the recent list), newest first (paged) */
  starred(query?: RecentQuery): Promise<RecentPage>
  /** stat a specific set of paths (project view); unstat-able files come back flagged `missing` */
  statPaths(paths: string[]): Promise<RecentEntry[]>
  /** star / unstar a file */
  toggleStar(path: string): Promise<void>
  /** open an existing file, routing to the right module by extension */
  openPath(path: string): Promise<void>
  /**
   * Budget-capped text excerpts for Recent/Starred files (My AI summarize).
   * Paths outside recents/starred are skipped.
   */
  fileExcerpts(paths: string[]): Promise<FileExcerpt[]>
  /** file picker accepting every supported extension, then routes */
  browse(): Promise<void>
  /** open a docs window at its start screen (optional HTML seed for teacher templates) */
  newDoc(opts?: NewDocOptions): Promise<void>
  /** open a sheets window */
  newSheet(opts?: NewSheetOptions): Promise<void>
  /** open a slides tab at its start screen (open-a-pptx) */
  newSlide(opts?: NewSlideOptions): Promise<void>
  /** create a blank PDF (optional AI preset) */
  newPdf(opts?: NewPdfOptions): Promise<void>
  /** Best Office tab for My AI continue/summarize (last editor if Home is active) */
  activeOfficeTab(): Promise<ActiveOfficeTab | null>
  /** Activate Office tab and push an AI panel preset */
  pushAiPreset(input: {
    text: string
    autoRun?: boolean
    displayText?: string
    tabId?: string
  }): Promise<{ ok: boolean; tabId?: string; kind?: string; title?: string; path?: string }>
  /** Probe OpenAI-compatible Hub (models + optional balance hints) */
  probeAiHub(opts: { baseUrl: string; apiKey: string }): Promise<{
    ok: boolean
    message: string
    balanceText?: string
    modelCount?: number
  }>
  /** PWA / Hub → desktop Agent Intent (navigate Workbench tabs, optional mutate) */
  onAgentIntent(handler: (intent: AgentIntentDto) => void): () => void
  /** Ack intent lifecycle for future Hub result channel */
  agentIntentAck(intentId: string, status: 'applied' | 'dismissed' | 'failed'): Promise<void>
  /** Resolve NL text to an Agent Intent (desktop helper) */
  resolveAgentIntent(text: string): Promise<AgentIntentDto | null>
  /** DEV / tests: inject an intent without deep link */
  submitAgentIntent(intent: AgentIntentDto): Promise<boolean>
  /** Zip an education lesson pack (files + README + meta.json) */
  exportLessonPack(projectId: string): Promise<{
    ok: boolean
    path?: string
    error?: string
    canceled?: boolean
  }>
  /** open a blank markdown editor tab */
  newMarkdown(opts?: NewFileOpts & { projectId?: string }): Promise<void>
  /** open a blank html editor tab */
  newHtml(opts?: NewFileOpts & { projectId?: string }): Promise<void>
  /** drop entries from the recent list (does not touch the files) */
  removeRecent(paths: string[]): Promise<void>
  /** reveal the file in Finder / Explorer */
  revealPath(path: string): Promise<void>
  /** rename the file on disk (same directory) and update the recent list */
  renameFile(path: string, newName: string): Promise<RenameResult>
  /** copy the file next to itself (localized "copy" suffix before .ext) and record it as recent */
  duplicateFile(path: string): Promise<void>
  /** move files to the trash and drop them from the recent list */
  deleteFiles(paths: string[]): Promise<void>
  /** open the OS trash, where deleted files can be restored */
  openTrash(): Promise<void>
  /** the tree roots: the default save folder first, then the folders the user added */
  folderRoots(): Promise<FolderRoot[]>
  /** directory picker; the chosen folder joins the tree in place (nothing is copied or moved) */
  addFolderRoot(): Promise<FolderRoot | null>
  /** OS paths dropped on the Folders panel: folders join the tree, documents open */
  dropFolderRoots(paths: string[]): Promise<FolderRoot[]>
  /** take an added folder off the list; the disk is untouched */
  removeFolderRoot(path: string): Promise<void>
  /** absolute path of a File from an OS drag (Electron webUtils) */
  pathForFile(file: File): string
  /** one level of the tree: sub-folders + supported files directly inside `dir` */
  listFolder(dir: string): Promise<FolderListing>
  /** create `parent/name`; resolves to the new path */
  createFolder(parent: string, name: string): Promise<RenameResult>
  /** rename a folder in place (files inside keep their recents/stars/chat history) */
  renameFolder(dir: string, newName: string): Promise<RenameResult>
  /** move files and/or folders into `targetDir` */
  movePaths(paths: string[], targetDir: string, onConflict: MoveConflictPolicy): Promise<MoveResult>
  /** move a folder (and everything inside) to the trash */
  deleteFolder(dir: string): Promise<void>
  /** a folder under the root changed on disk (created/renamed/deleted/moved, from anywhere) */
  onFolderChanged(handler: (dirs: string[]) => void): () => void
  /** current UI language (persisted in userData/app-settings.json) */
  getLanguage(): Promise<UiLanguage>
  /** switch + persist the UI language; main rebuilds its menus to match */
  setLanguage(lang: UiLanguage): Promise<void>
  /** current update channel (persisted in userData/app-settings.json; default 'stable') */
  getUpdateChannel(): Promise<UpdateChannel>
  /** switch + persist the update channel; triggers an immediate update check */
  setUpdateChannel(channel: UpdateChannel): Promise<void>
  /** UniWork account status (desktop session sync TBD; Sign-in opens the UniWork web link) */
  accountStatus(): Promise<AccountStatus>
  /** open UniWork Sign-in in the system browser; returns whether the launch succeeded */
  accountLogin(): Promise<boolean>
  /** progress events for the login started via accountLogin; returns an unsubscribe */
  onAccountLogin(handler: (ev: AccountLoginEvent) => void): () => void
  /** a tab asked for the settings modal (composer model chip) */
  onOpenSettings(handler: (target: { section: string }) => void): () => void
  /** re-open the pending UniWork Sign-in URL in the default browser (rescue when auto-open failed) */
  openLoginUrl(): Promise<void>
  /** log out (clears any leftover local auth material) */
  accountLogout(): Promise<void>
  /** Editor AI “Buy AI plan” → open Settings section (e.g. account); unsubscribe returned */
  onOpenSettingsEvent?(handler: (section: string) => void): () => void
  /** app version (from package.json / electron app.getVersion) */
  getAppVersion(): Promise<string>
  /** live updater state (null until an update was first seen); Settings → About */
  getUpdateState(): Promise<UpdateUiState | null>
  /** re-open the (minimized) update dialog; a not-yet-started download also starts */
  openUpdateDialog(): Promise<boolean>
  /** open a shipped legal file (NOTICE, LICENSE, ...) in the system viewer; false when it is missing */
  openLegalDoc?(doc: LegalDoc): Promise<boolean>
  onUpdateStateChanged(handler: (state: UpdateUiState) => void): () => void
  /** whether the first-run onboarding has been completed or skipped (persisted in userData/app-settings.json) */
  onboardingSeen(): Promise<boolean>
  /** mark onboarding done */
  setOnboardingSeen(): Promise<boolean>
  /** current UI theme preference (persisted in userData/app-settings.json) */
  getTheme(): Promise<UiTheme>
  /** switch + persist the UI theme; broadcasts 'app:theme-changed' to all web contents */
  setTheme(theme: UiTheme): Promise<void>
  /** current document page theme preference (genoffice#1811, persisted in userData/app-settings.json) */
  getDocumentTheme(): Promise<DocTheme>
  /** switch + persist the document page theme; broadcasts 'app:document-theme-changed' to all web contents */
  setDocumentTheme(theme: DocTheme): Promise<void>
  /** AutoSave default applied by every editor window (persisted in userData/app-settings.json) */
  getAutoSaveDefault(): Promise<AutoSaveDefault>
  /** persist the AutoSave default; broadcasts 'app:auto-save-default-changed' to all web contents */
  setAutoSaveDefault(on: boolean): Promise<void>
  /** current local MCP server state (running/enabled/port/url) */
  getMcpStatus(): Promise<McpStatus>
  /** enable/disable the MCP server and/or change its port/background/logging; applies and persists, returns the new state */
  setMcpSettings(patch: {
    enabled?: boolean
    port?: number
    background?: boolean
    logging?: boolean
  }): Promise<McpStatus>
  /** last MCP log lines (empty when logging has never been on) */
  getMcpLogs(): Promise<string[]>
  /** truncate the MCP log file */
  clearMcpLogs(): Promise<void>
  /** reveal the MCP log file in the file manager (created empty when missing) */
  openMcpLogFile(): Promise<void>
  /** AI panel text size + chat-input spellcheck (persisted in userData/app-settings.json) */
  getAiPanelPrefs(): Promise<AiPanelPrefs>
  /** merge + persist; broadcasts 'app:ai-panel-prefs-changed' to all web contents */
  setAiPanelPrefs(patch: Partial<AiPanelPrefs>): Promise<AiPanelPrefs>
  /** effective default save folder for new/untitled files (configured in userData/app-settings.json, falls back to <Documents>/GenOffice) */
  getDefaultSaveDir(): Promise<string>
  /** directory picker to change the default save folder; resolves to the new folder, or null when canceled or the pick was unusable */
  pickDefaultSaveDir(): Promise<string | null>
  /** who opens .docx/.xlsx/.pptx today (Settings → General "default app" row) */
  getDefaultAppStatus(): Promise<DefaultAppStatus>
  /** claim the Office types (mac/linux) or open the system Default Apps page (win); resolves to the refreshed status */
  setDefaultApp(): Promise<DefaultAppStatus>
  /** theme switched anywhere (broadcast from the main process) */
  onThemeChanged(handler: (theme: UiTheme) => void): () => void
  /** document page theme switched anywhere (broadcast from the main process) */
  onDocumentThemeChanged(handler: (theme: DocTheme) => void): () => void
  /** open the Genspark credit-usage page in the default browser */
  openCreditUsage(): Promise<void>
  /** locally stored full cloud project list (instant; null when no store or logged out) */
  cloudProjectsCached(): Promise<CloudProjectsSnapshot | null>
  /** sync the full list from Genspark and return it (1 request when nothing changed); null when the sync failed */
  cloudProjectsSync(): Promise<CloudProjectsSnapshot | null>
  /** open a cloud project (relative '/agents?id=...' URL) in the default browser */
  openCloudProject(projectUrl: string): Promise<void>
  /** AI settings (userData/ai-settings.json, shared by every editor); the genspark key never appears here */
  getAiSettings(): Promise<AiSettings>
  /** persist AI settings; every renderer gets ai:settings-changed and re-reads */
  setAiSettings(settings: AiSettings): Promise<void>
  /** ai-settings.json was rewritten by any renderer (composer model chip, another window) */
  onAiSettingsChanged(handler: () => void): () => void
  /** provider catalog with each fixed endpoint's default base URL (empty for genspark/custom) */
  getAiProviders(): AiCatalogEntry[]
  /** live Codex model catalog discovered through the current or overridden app-server */
  getCodexModels(cliPath?: string): Promise<CodexModelCatalog>
  /** live model list advertised by a user-hosted OpenAI-compatible endpoint; empty when it cannot answer */
  getCustomModels(baseUrl: string, apiKey?: string): Promise<CodexModelCatalog>
  /** one-shot round trip against the given (possibly unsaved) settings — the settings-UI connection test */
  testAiSettings(settings: AiSettings): Promise<AiChatResponse>
  /** OpenRouter Token Hub: GET /api/v1/key for the given (possibly unsaved) API key */
  probeOpenRouterKey(apiKey: string): Promise<OpenRouterKeyStatus>
  /** one-shot non-streaming chat using saved (or provided) AI settings — Workbench helpers */
  aiChat(input: { system: string; user: string; settings?: AiSettings }): Promise<AiChatResponse>
  /** streaming chat (same IPC as editor AI panels) */
  aiStream(request: AiStreamRequest): Promise<void>
  aiStreamCancel(requestId: string): Promise<void>
  onAiStream(handler: (chunk: AiStreamChunk) => void): () => void
  /** local file attachments for My AI (files stay on device) */
  pickAttachments(): Promise<AttachmentAddResult | null>
  addAttachmentPaths(paths: string[]): Promise<AttachmentAddResult>
  addPastedImage(data: ArrayBuffer, ext: string): Promise<AttachmentAddResult>
  readAttachment(path: string, offset: number, maxChars: number): Promise<AttachmentReadResult>
  readAttachmentImage(path: string): Promise<AttachmentImageResult>
  getPathForFile(file: File): string
  /** image generation / media analysis provider catalog */
  getAiMediaProviders(): AiMediaProviderMeta[]
  /** credential check for a (possibly unsaved) media provider; genspark reports the gsk login state */
  testAiMediaSettings(input: {
    provider: AiMediaProviderId
    config: AiMediaProviderConfig
  }): Promise<{ ok: boolean; error?: string }>
  /** web search provider catalog */
  getAiSearchProviders(): AiSearchProviderMeta[]
  /** one minimal query against the given key (genspark reports the gsk login state) */
  testAiSearchSettings(input: {
    provider: AiSearchProviderId
    apiKey: string
  }): Promise<{ ok: boolean; error?: string }>
  /** Local Workbench SQLite store (main-process source of truth) */
  wb: WorkbenchStoreApi
}

/** IndexedDB media blobs embedded in Workbench ZIP backup (optional). */
export interface WorkbenchIdbMediaDump {
  version: 1
  tasks: Record<string, string>
  pets: Record<string, string>
  health: Record<string, string>
}

/** Renderer ↔ main bridge for Workbench key/value persistence. */
export interface WorkbenchStoreApi {
  loadAll(): Promise<{ keys: Record<string, string>; keyCount: number; dbPath: string }>
  getKey(key: string): Promise<string | null>
  setKey(key: string, value: string): Promise<void>
  removeKey(key: string): Promise<void>
  importKeys(keys: Record<string, string>): Promise<{ imported: number }>
  exportBackup(media?: WorkbenchIdbMediaDump | null): Promise<{
    ok: boolean
    path?: string
    error?: string
    canceled?: boolean
  }>
  importBackup(): Promise<{
    ok: boolean
    keyCount?: number
    keys?: Record<string, string>
    media?: WorkbenchIdbMediaDump
    error?: string
    canceled?: boolean
  }>
}

export interface AiCatalogEntry extends AiProviderMeta {
  /** default endpoint for fixed-endpoint providers ('' = model-dependent or user-supplied) */
  defaultBaseUrl: string
}

export type CloudProjectKind = 'docs' | 'sheets' | 'slides'

/** a Genspark web project shown in the home cloud section */
export interface CloudProjectEntry {
  projectId: string
  title: string
  /** module kind derived from the API project type ('docs_agent' → 'docs') */
  kind: CloudProjectKind | 'other'
  /** creation time, ms since epoch (0 when unparsable) */
  ctimeMs: number
  /** relative genspark.ai URL ('/agents?id=...') */
  projectUrl: string
}

/** full local copy of the cloud project list; filtering/paging are client-side */
export interface CloudProjectsSnapshot {
  /** false when gsk is unavailable (CLI missing or not logged in) */
  available: boolean
  /** all projects, newest first */
  projects: CloudProjectEntry[]
  /** ms epoch of the last successful sync (0 when never synced) */
  syncedAt: number
}

export interface AccountStatus {
  /** UniWork desktop session present (web Sign-in link used until sync lands) */
  loggedIn: boolean
  email?: string
  /** remaining account credits when the balance query succeeds */
  creditBalance?: number
}

/** login flow progress pushed from main (UniWork Sign-in URL open) */
export interface AccountLoginEvent {
  phase: 'launched' | 'url' | 'success' | 'error'
  url?: string
  expiresInSec?: number
  /** 'network' | 'expired' | error text */
  error?: string
}

/** Serializable Agent Intent (PWA / Hub → desktop Workbench router). */
export interface AgentIntentDto {
  intentId: string
  target:
    | { kind: 'module'; id: string }
    | { kind: 'pillar'; id: string }
    | { kind: 'skill-domain'; id: string }
  action: 'open' | 'navigate' | 'add_item' | 'summarize' | 'run_skill'
  scope: 'local' | 'cloud' | 'dual'
  source: 'pwa' | 'desktop' | 'hub' | 'dev'
  summary: string
  text?: string
  fields?: Record<string, string | number | boolean>
  requireConsent: boolean
  createdAt: string
}

export interface RenameResult {
  ok: boolean
  /** the new absolute path when ok */
  path?: string
  error?: string
}

export interface NewFileOpts {
  /** folder the new file's first save should land in (defaults to the save folder root) */
  dir?: string
}

// ── Folder tree (home "Folders" panel: the default save folder plus any folder the user added) ──

export interface FolderRoot {
  path: string
  /** folder name shown on the root row */
  name: string
  /** false when the folder does not exist and cannot be created, or is read-only */
  usable: boolean
  /** the folder exists and can be listed (a read-only or unplugged root is still shown) */
  readable: boolean
  /** an added folder: can be taken off the list; the default save folder cannot */
  removable: boolean
}

export interface FolderEntry {
  path: string
  name: string
  mtimeMs: number
  /** whether it contains at least one visible sub-folder (drives the expand chevron) */
  hasSubfolders: boolean
}

export type EduMaterialRoleEntry =
  | 'giao-an'
  | 'khdh'
  | 'slide'
  | 'phieu-hoc-tap'
  | 'ppct'
  | 'de-kiem-tra'
  | 'tai-lieu-tham-khao'
  | 'khac'

/** Teacher lesson-pack metadata mirrored from project-store edu/meta.json */
export interface EduProjectMetaEntry {
  version: 1 | 2
  kind: 'education'
  subject: string
  grade: string
  week?: string
  lessonTitle: string
  durationMinutes?: number
  objectives: string[]
  tags?: string[]
  notes?: string
  materials?: Partial<Record<string, EduMaterialRoleEntry>>
  createdAt: string
  updatedAt: string
}

export type PracticeIdEntry =
  | 'teacher'
  | 'legal'
  | 'construction'
  | 'procurement'
  | 'principal'
  | 'sales'
  | 'customer-care'
  | 'entrepreneur'
  | 'freelancer'
  | 'content-creator'
  | 'marketing'
  | 'hr'
  | 'accounting'
  | 'it'
  | 'real-estate'

export type ProjectKindEntry =
  | 'education'
  | 'legal'
  | 'construction'
  | 'procurement'
  | 'principal'
  | 'sales'
  | 'customer-care'
  | 'entrepreneur'
  | 'freelancer'
  | 'content-creator'
  | 'marketing'
  | 'hr'
  | 'accounting'
  | 'it'
  | 'real-estate'

export interface PracticeProjectMetaEntry {
  version: 1
  kind: 'practice'
  practiceId: PracticeIdEntry
  title: string
  facets: Record<string, string>
  tags?: string[]
  notes?: string
  materials?: Partial<Record<string, string>>
  createdAt: string
  updatedAt: string
}

export interface ProjectSummaryEntry {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  fileCount: number
  lastActiveAt: string
  isDefault: boolean
  kind?: ProjectKindEntry
  edu?: EduProjectMetaEntry
  practice?: PracticeProjectMetaEntry
}

export interface CreatePracticeProjectArgs {
  practiceId: Exclude<PracticeIdEntry, 'teacher'>
  title: string
  facets?: Record<string, string>
  tags?: string[]
  notes?: string
}

export interface PatchPracticeMetaArgs {
  projectId: string
  patch: Partial<
    Pick<PracticeProjectMetaEntry, 'title' | 'facets' | 'tags' | 'notes' | 'materials'>
  >
}

export interface CreateEducationProjectArgs {
  subject: string
  grade: string
  week?: string
  lessonTitle: string
  durationMinutes?: number
  objectives?: string[]
  tags?: string[]
  notes?: string
}

export interface PatchEducationMetaArgs {
  projectId: string
  patch: Partial<
    Pick<
      EduProjectMetaEntry,
      | 'subject'
      | 'grade'
      | 'week'
      | 'lessonTitle'
      | 'durationMinutes'
      | 'objectives'
      | 'tags'
      | 'notes'
      | 'materials'
    >
  >
}

export interface HomeAiPreset {
  text: string
  autoRun?: boolean
  displayText?: string
}

export interface NewDocOptions extends NewFileOpts {
  projectId?: string
  /** Seed a blank Docs tab with HTML (education templates) */
  aiContent?: { title: string; html: string }
  /** Queue an AI panel preset (Teacher workflows auto-run) */
  aiPreset?: HomeAiPreset
}

export interface NewSlideOptions extends NewFileOpts {
  projectId?: string
  aiPreset?: HomeAiPreset
}

export interface NewSheetOptions extends NewFileOpts {
  projectId?: string
  aiPreset?: HomeAiPreset
}

export interface NewPdfOptions extends NewFileOpts {
  projectId?: string
  aiPreset?: HomeAiPreset
}

export interface ActiveOfficeTab {
  id: string
  kind: string
  title: string
  path?: string
}

export interface TimelineEntryItem {
  filePath: string
  fileName: string
  chatId: string
  ts: string
  role: 'user' | 'assistant'
  preview: string
  seq: number
}

/** a document file listed by the tree (same shape as the home recents rows) */
export interface FileEntry {
  path: string
  name: string
  /** lowercased extension without the dot */
  ext: string
  mtimeMs: number
  sizeBytes: number
  starred: boolean
  /** the path failed to stat */
  missing?: boolean
}

export interface FolderListing {
  dir: string
  folders: FolderEntry[]
  /** supported document files directly inside `dir`, newest first */
  files: FileEntry[]
  /** the directory could not be read (deleted or moved outside the app) */
  missing?: boolean
}

export interface ProjectHomeApi {
  /** list all projects (with file count + last-active time) */
  listProjects(): Promise<ProjectSummaryEntry[]>
  /** list existing files currently belonging to a project */
  listFiles(projectId: string): Promise<string[]>
  /** create a project */
  createProject(name: string): Promise<ProjectSummaryEntry>
  /** create a teacher lesson pack with edu/meta.json */
  createEducationProject(args: CreateEducationProjectArgs): Promise<ProjectSummaryEntry>
  /** read education metadata for a project */
  getEduMeta(projectId: string): Promise<EduProjectMetaEntry | null>
  /** patch education metadata (tags, materials, notes, …) */
  patchEduMeta(args: PatchEducationMetaArgs): Promise<EduProjectMetaEntry>
  /** create a non-teacher practice pack with practice/meta.json */
  createPracticeProject(args: CreatePracticeProjectArgs): Promise<ProjectSummaryEntry>
  /** read practice metadata for a project */
  getPracticeMeta(projectId: string): Promise<PracticeProjectMetaEntry | null>
  /** patch practice metadata */
  patchPracticeMeta(args: PatchPracticeMetaArgs): Promise<PracticeProjectMetaEntry>
  /** rename a project */
  renameProject(id: string, name: string): Promise<void>
  /** soft-delete a project */
  deleteProject(id: string): Promise<void>
  /** move a file into the given project */
  moveFile(filePath: string, projectId: string): Promise<void>
  /** fetch the project timeline */
  getTimeline(projectId: string, limit?: number): Promise<TimelineEntryItem[]>
}

/** what to do when a moved item's name already exists in the target */
export type MoveConflictPolicy = 'ask' | 'replace' | 'keepBoth' | 'skip'

export interface MoveResult {
  /** old path → new path for everything that moved */
  moved: Array<{ from: string; to: string }>
  /** items skipped because the name exists in the target (policy 'ask'/'skip') */
  conflicts: string[]
  /** items that failed for another reason */
  failed: Array<{ path: string; error: string }>
}

export const HOME_CHANNELS = {
  recents: 'home:recents',
  searchFiles: 'home:search-files',
  rerankSearch: 'home:rerank-search',
  getFileSearchSettings: 'home:get-file-search-settings',
  setFileSearchSettings: 'home:set-file-search-settings',
  testFileSearchRerank: 'home:test-file-search-rerank',
  starred: 'home:starred',
  statPaths: 'home:stat-paths',
  toggleStar: 'home:toggle-star',
  openPath: 'home:open-path',
  browse: 'home:browse',
  newDoc: 'home:new-doc',
  newSheet: 'home:new-sheet',
  newSlide: 'home:new-slide',
  newMarkdown: 'home:new-markdown',
  newHtml: 'home:new-html',
  newPdf: 'home:new-pdf',
  removeRecent: 'home:remove-recent',
  revealPath: 'home:reveal-path',
  renameFile: 'home:rename-file',
  duplicateFile: 'home:duplicate-file',
  deleteFiles: 'home:delete-files',
  openTrash: 'home:open-trash',
  folderRoots: 'home:folder-roots',
  addFolderRoot: 'home:folder-root-add',
  dropFolderRoots: 'home:folder-root-drop',
  removeFolderRoot: 'home:folder-root-remove',
  listFolder: 'home:folder-list',
  createFolder: 'home:folder-create',
  renameFolder: 'home:folder-rename',
  movePaths: 'home:move-paths',
  deleteFolder: 'home:folder-delete',
  folderChanged: 'home:folder-changed',
  getLanguage: 'home:get-language',
  setLanguage: 'home:set-language',
  getUpdateChannel: 'home:get-update-channel',
  setUpdateChannel: 'home:set-update-channel',
  accountStatus: 'home:account-status',
  accountLogin: 'home:account-login',
  accountLoginEvent: 'home:account-login-event',
  openSettings: 'home:open-settings',
  accountLoginOpenUrl: 'home:account-login-open-url',
  accountLogout: 'home:account-logout',
  /** Main → shell renderer: open Settings to a section (from editor AI billing CTA). */
  openSettingsEvent: 'home:open-settings-event',
  getAppVersion: 'home:get-app-version',
  openLegalDoc: 'home:open-legal-doc',
  onboardingSeen: 'home:onboarding-seen',
  setOnboardingSeen: 'home:set-onboarding-seen',
  getTheme: 'home:get-theme',
  setTheme: 'home:set-theme',
  getDocumentTheme: 'home:get-document-theme',
  setDocumentTheme: 'home:set-document-theme',
  getAutoSaveDefault: 'home:get-auto-save-default',
  setAutoSaveDefault: 'home:set-auto-save-default',
  getMcpStatus: 'home:get-mcp-status',
  setMcpSettings: 'home:set-mcp-settings',
  getMcpLogs: 'home:get-mcp-logs',
  clearMcpLogs: 'home:clear-mcp-logs',
  openMcpLogFile: 'home:open-mcp-log-file',
  getAiPanelPrefs: 'home:get-ai-panel-prefs',
  setAiPanelPrefs: 'home:set-ai-panel-prefs',
  getDefaultSaveDir: 'home:get-default-save-dir',
  getDefaultAppStatus: 'home:get-default-app-status',
  setDefaultApp: 'home:set-default-app',
  pickDefaultSaveDir: 'home:pick-default-save-dir',
  openCreditUsage: 'home:open-credit-usage',
  cloudProjects: 'home:cloud-projects',
  cloudProjectsCached: 'home:cloud-projects-cached',
  openCloudProject: 'home:open-cloud-project',
  probeAiHub: 'home:probe-ai-hub',
  exportLessonPack: 'home:export-lesson-pack',
  agentIntentEvent: 'home:agent-intent-event',
  agentIntentAck: 'home:agent-intent-ack',
  resolveAgentIntent: 'home:resolve-agent-intent',
  submitAgentIntent: 'home:submit-agent-intent',
  fileExcerpts: 'home:file-excerpts',
  activeOfficeTab: 'home:active-office-tab',
  pushAiPreset: 'home:push-ai-preset',
  wbLoadAll: 'home:wb-load-all',
  wbGetKey: 'home:wb-get-key',
  wbSetKey: 'home:wb-set-key',
  wbRemoveKey: 'home:wb-remove-key',
  wbImportKeys: 'home:wb-import-keys',
  wbExportBackup: 'home:wb-export-backup',
  wbImportBackup: 'home:wb-import-backup',
} as const

export const PROJECT_CHANNELS = {
  list: 'project:list',
  files: 'project:files',
  create: 'project:create',
  createEducation: 'project:createEducation',
  getEduMeta: 'project:getEduMeta',
  patchEduMeta: 'project:patchEduMeta',
  createPractice: 'project:createPractice',
  getPracticeMeta: 'project:getPracticeMeta',
  patchPracticeMeta: 'project:patchPracticeMeta',
  rename: 'project:rename',
  delete: 'project:delete',
  moveFile: 'project:moveFile',
  timeline: 'project:timeline',
} as const
