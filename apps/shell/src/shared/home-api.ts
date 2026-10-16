import type {
  AiChatResponse,
  AiMediaProviderConfig,
  AiMediaProviderId,
  AiMediaProviderMeta,
  AiProviderMeta,
  AiSearchProviderId,
  AiSearchProviderMeta,
  AiSettings,
  AiSettingsSaveOptions,
  AiStreamChunk,
  AiStreamRequest,
  AiTestFailureKind,
  CodexModelCatalog,
  OpenRouterKeyStatus,
  UniworkCloudStatus,
} from '@genoffice/ai-provider'
import type { UpdateChannel, UpdateUiState } from './update-api'
import type {
  UniworkConflictAction,
  UniworkConflictReply,
  UniworkConflictView,
} from './uniwork-conflict'

export type {
  UniworkConflictAction,
  UniworkConflictIntentBlock,
  UniworkConflictKeepDraft,
  UniworkConflictNotice,
  UniworkConflictReply,
  UniworkConflictView,
} from './uniwork-conflict'

/** Legal files shipped beside the app and opened from Settings > About. */
/** The Settings window shows and saves the account's UniWork AI pick; My AI, email and one-click never pass this. */
export interface AiSettingsPickOptions {
  includeUniworkPick?: boolean
}

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
import type { DocumentTabKind } from './tabs-api'

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

export type UniworkDocFormat = 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'md' | 'html'
export type UniworkDocAccess = 'edit' | 'view'
export type UniworkSaveState =
  | 'ready'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'conflict'
  | 'blocked'
  | 'offline'
  | 'signed-out'
  | 'error'
  // G5-06 durable save queue: an intent is stored and waiting (queued /
  // paused_offline), the user or the admin paused dispatch (paused_user /
  // paused_admin), the commit outcome is being looked up (reconciling, or
  // reconciling-stuck past the 1 h limit), or the intent will not retry on its
  // own (failed). 'saving' stays the umbrella for validating/uploading/committing.
  | 'queued'
  | 'paused_offline'
  | 'paused_user'
  | 'paused_admin'
  | 'reconciling'
  | 'reconciling-stuck'
  | 'failed'
export type UniworkDocErrorCode =
  | 'not_signed_in'
  | 'session_expired'
  | 'wrong_deployment'
  | 'forbidden'
  | 'not_found'
  | 'deleted'
  | 'conflict'
  | 'quota_exceeded'
  | 'too_large'
  | 'unsupported_format'
  | 'engine_incompatible'
  | 'idempotency_mismatch'
  | 'ticket_invalid'
  | 'ticket_expired'
  | 'network'
  | 'timeout'
  | 'server_error'
  | 'malformed_response'
  // FD-11 (UNI-1809): the folder tree's own refusals, mapped from the server's
  // `document_too_deep` / `document_cycle` / `document_parent_kind` envelopes
  // (never a generic server_error). `folder_name_taken` is a field error and
  // lives in UniworkDocNameError.
  | 'document_too_deep'
  | 'document_cycle'
  | 'document_parent_kind'
  // the account's durable sync store could not be opened (locked keychain) or
  // refused the pending intent (budget full)
  | 'keystore_locked'
  | 'store_full'
  // G5-06 save queue: refused because sync_write is off / the server no longer
  // knows the intent / the document was deleted or archived / access was lost /
  // the account or organization was suspended / the kept-draft or document cap
  // was reached / another window holds the document lock
  | 'capability_off'
  | 'intent_unknown'
  | 'document_deleted'
  | 'document_archived'
  | 'permission_revoked'
  | 'member_deactivated'
  | 'organization_suspended'
  | 'drafts_full'
  | 'other_window'

export interface UniworkWorkspaceRef {
  id: string
  name: string
  orgId: string
  /** server `slug` ('' when absent): web links need it */
  slug: string
  /** server `organization_slug` ('' when absent) */
  orgSlug: string
  /** my effective role in this workspace (owner|admin|member); null when the server did not answer */
  myRole: string | null
}

export interface UniworkDocSummary {
  id: string
  workspaceId: string
  title: string
  format: UniworkDocFormat | null
  updatedAt: string
  updatedByName?: string
  /** shared-with-me rows only: the workspace the share lives in (name resolved by main) */
  workspaceName?: string
  /**
   * S18 row actions, derived by main from the server's `my_level`: `edit` or
   * `manage` may rename. Absent on a row whose level the server did not send
   * (the renderer then offers no action, never a disabled one).
   */
  canEdit?: boolean
  /** `my_level` is `manage`: the row may be archived (or, when archived, restored) */
  canManage?: boolean
  /** the row is in the trash (`archived_at` present); it stays listed so it can be restored */
  archived?: boolean
  /**
   * FD-11: what the row is. Absent on a row from a route the app reads as
   * files only (`listDocuments`, shared-with-me), whose rows are all files
   * anyway; `listChildren` and the title search carry it.
   */
  kind?: UniworkEntryKind
  /** FD-11: the folder/page holding the document; null = the workspace root */
  parentId?: string | null
  /**
   * FD-11: the ancestors of a search row, root first. Only the title search
   * sends one (cut at the first unreadable ancestor).
   */
  path?: { id: string; title: string }[]
}

/** FD-11: the three entry kinds the folder tree holds */
export type UniworkEntryKind = 'folder' | 'file' | 'page'

/**
 * FD-11: one node of `GET /workspaces/{ws}/documents/tree?folders_only=true`,
 * to depth 20 (the server's own cap).
 */
export interface UniworkFolderNode {
  id: string
  parentId: string | null
  title: string
  position: number
  children: UniworkFolderNode[]
}

/** FD-11: one contents page of a folder (folders + files + pages, server order) */
export interface UniworkFolderChildren {
  items: UniworkDocSummary[]
  nextCursor: string | null
}

/** FD-11: the contents of one folder; `parentId: null` = the workspace root */
export interface UniworkFolderQuery {
  workspaceId: string
  parentId: string | null
  cursor?: string
  limit?: number
}

/** FD-11: title search across a workspace; `kind: 'all'` sends no kind filter */
export interface UniworkSearchQuery {
  workspaceId: string
  query: string
  kind: 'all' | 'folder' | 'document'
  cursor?: string
  limit?: number
}

export type UniworkSearchPage = UniworkFolderChildren

/** FD-11: create one folder in a workspace (root when `parentId` is null) */
export interface UniworkCreateFolderInput {
  workspaceId: string
  parentId: string | null
  title: string
}

/** FD-11: move a document/folder under another folder (null = the workspace root) */
export interface UniworkMoveDocumentInput {
  documentId: string
  parentId: string | null
}

/**
 * FD-11: the move's answer. `renamedTo` is the title the server gave the
 * document when a name collision made it rename itself ("Name (2)"), null when
 * the title is unchanged.
 */
export interface UniworkMoveResult {
  summary: UniworkDocSummary
  renamedTo: string | null
}

export interface UniworkDocListQuery {
  workspaceId: string
  query?: string
  cursor?: string
  limit?: number
}

export type UniworkResult<T> = { ok: true; value: T } | { ok: false; error: UniworkDocErrorCode }

export interface UniworkDocListPage {
  documents: UniworkDocSummary[]
  nextCursor: string | null
}

/** paged "shared with me" query; main aggregates the selected org's workspaces */
export interface UniworkSharedQuery {
  /** opaque cursor from the previous page; omit for the first page */
  cursor?: string
  /** page size, default 50, max 100 */
  limit?: number
}

export type UniworkSharedPage = UniworkDocListPage

/**
 * The document properties panel (S17). Every name/time the server does not
 * send is null and the renderer shows "—"; `ownerId`/`createdById`/
 * `updatedById` stay for the case a name could not be resolved.
 */
export interface UniworkDocProperties {
  documentId: string
  workspaceId: string
  title: string
  ownerName: string | null
  createdByName: string | null
  createdAt: string | null
  updatedByName: string | null
  updatedAt: string | null
  /** view | edit | manage */
  myLevel: string | null
  /** current version ordinal */
  version: number | null
  /**
   * who produced the current version. Always null today: D's DocumentDTO has
   * no per-version updater (`updated_by` is also set by a rename), so the
   * renderer shows "—" until the server sends one (D residual, G8-16).
   */
  versionByName: string | null
  ownerId: string | null
  createdById: string | null
  updatedById: string | null
}

/**
 * Errors a name field shows in place; every other failure is a toast.
 * `folder_name_taken` (FD-11) is the server's 409 for a folder whose name
 * already exists among its siblings: only folders collide, and the renderer
 * shows it under the field, so it is a field error too.
 */
export type UniworkDocNameError = 'name_empty' | 'name_too_long' | 'folder_name_taken'
/**
 * What a create/rename/archive/upload call may fail with. `name_empty` /
 * `name_too_long` / `folder_name_taken` are field errors and `upload_cancelled`
 * is an upload the person aborted; none of them is part of
 * `UniworkDocErrorCode`, because that union is switched on exhaustively by the
 * renderer's error copy table (a cancelled upload is not an error to show at
 * all).
 */
export type UniworkDocActionError = UniworkDocErrorCode | UniworkDocNameError | 'upload_cancelled'
export type UniworkDocActionResult<T> =
  | { ok: true; value: T }
  | {
      ok: false
      error: UniworkDocActionError
      /**
       * FD-11: `document_too_deep` carries the server's own depth cap (the
       * envelope's `max`, else the server default 20) so the renderer can show
       * it; absent for every other failure.
       */
      max?: number
    }

/** the formats the New document dialog offers (D accepts more; these three are the Office ones) */
export type UniworkDocNewFormat = 'docx' | 'xlsx' | 'pptx'

export interface UniworkCreateDocInput {
  workspaceId: string
  /** ULID of the parent folder/page; null = the workspace root */
  folderId: string | null
  name: string
  format: UniworkDocNewFormat
}

export interface UniworkUploadDocInput {
  workspaceId: string
  folderId: string | null
  /** the local file main's dialog returned; main reads the bytes and uploads them */
  path: string
  /**
   * renderer-minted, unique per upload start: `uniworkCancelUploadDocument`
   * names the upload it aborts through this id (never a path).
   */
  uploadId: string
}

/** one folder the "Location" field of the create/upload dialog offers */
export interface UniworkDocFolderRef {
  id: string
  /** the folder's title (D `DocumentSummaryDTO.title`) */
  title: string
}

/** upload progress: bytes sent of the total (0 when the total is not known yet) */
export interface UniworkUploadProgress {
  /** the upload this event belongs to (the dialog's own `uploadId`) */
  uploadId: string
  path: string
  loaded: number
  total: number
}

/** a document's title changed (here, or renamed elsewhere and picked up by main) */
export interface UniworkDocRenamedEvent {
  documentId: string
  title: string
}

/**
 * FD-11: something in a workspace's document tree changed (a feed page with at
 * least one row, or one of the app's own folder/tree actions), coalesced in
 * main to at most one push per workspace per 500 ms. Carries the workspace id
 * only - never a title or a path (no-PII rule).
 */
export interface UniworkTreeChangedEvent {
  workspaceId: string
}

/**
 * S6: the "new version available" bar of one document (G5-03a). Absent = no
 * bar. `version` is the server's head version when the notice carried one
 * (null only for an old host that sent none -> `uwRemoteUpdatedNoRev`).
 */
export type UniworkRemoteBar =
  | { kind: 'updated'; version: number | null }
  | { kind: 'newer-dirty'; version: number; wait?: 'commit' | 'stuck' }
  | { kind: 'newer-ai'; version: number }
  | { kind: 'now-clean'; version: number }
  | { kind: 'reload-failed'; version: number }
  | { kind: 'revoked' }
  | { kind: 'deleted' }

/** the S6 bar's actions: hide, hide until a newer revision, retry a clean reload, or the conflict flow */
export type UniworkRemoteAction = 'later' | 'close' | 'retry' | 'reload' | 'reload-now'

/**
 * G5-08c, S11 Lock-while-open bar: the document was open and dirty when its lock happened. The
 * buffer stays on screen read-only; `store` = the unsent changes were kept in the encrypted store
 * (`uwLockWhileOpen`), `ram` = the store could not take them, so they exist only in this window
 * (`uwLockWhileOpenRam`). `reason` is the lock's cause (EXPERIENCE State Patterns > blocked reasons).
 */
export interface UniworkLockWhileOpen {
  mode: 'store' | 'ram'
  reason:
    | 'lease_expired'
    | 'clock_rollback'
    | 'permission_revoked'
    | 'document_deleted'
    | 'keystore_locked'
    | 'store_full'
    | 'signed_out'
}

export interface UniworkDocStatus {
  path: string
  documentId: string
  workspaceId: string
  title: string
  format: UniworkDocFormat
  access: UniworkDocAccess
  /**
   * DOC-05: the caller's server level when known (`comment` is below `edit`: `access` reads `view`
   * for it). Only the Discussion panel reads it, so a comment-level caller can write there.
   */
  commentsLevel?: 'view' | 'comment' | 'edit' | 'manage'
  state: UniworkSaveState
  error?: UniworkDocErrorCode
  /** an unsent N+1 exists behind the pending intent (G5-06) */
  pendingNext?: boolean
  lastSavedAt?: string
  /** S6 (G5-03a): the new-version bar of this document; absent = none */
  remote?: UniworkRemoteBar
  /** G5-08c: a lock happened while this document was open (outranks `remote`); absent = none */
  lockWhileOpen?: UniworkLockWhileOpen
  /**
   * G5-06u: the save waits for an AI run to finish ('ai-long' = long enough to
   * offer Stop). Type only for now: main never sets it yet (the desktop AI-run
   * owner wires it); absent = no wait.
   */
  saveWait?: 'ai' | 'ai-long'
}

/**
 * G5-06u: main asks the shell renderer to open the queue popover of `path`
 * (Ctrl/Cmd+S on a document that already has a pending save, or a save the
 * store refused). The renderer ignores a request for a path that is not the
 * active tab.
 */
export interface UniworkQueuePopoverRequest {
  path: string
}

export type UniworkConflictChoice = 'overwrite' | 'save-local-copy' | 'open-latest' | 'later'

/** why a working copy was refused before anything opened (S11 lock panel) */
export type UniworkLockReason = 'store_newer' | 'keystore_locked' | 'signed_out'

/**
 * G5-11: what the sign-out / account-switch / deployment-switch prompt needs;
 * computed WITHOUT changing anything.
 */
export interface SignOutPlan {
  /** docs with a pending intent or N+1 changes (dirty file or dirty editor) */
  count: number
  /** intents in validating|uploading|committing|reconciling */
  waiting: number
  /** storeLocked(): the capture cannot be written */
  keystoreLocked: boolean
  /** keystoreLocked && docs whose N+1 is not already ciphertext (or a module that could not capture) */
  ramOnly: number
}

export interface SignOutProgress {
  phase: 'waiting' | 'done'
  /** d1-2: count of dirty documents whose capture timed out at sign-out */
  captureFailed?: number
}

/** bounded wait for an in-flight upload/commit receipt at sign-out (G5-11 D4) */
export const SIGN_OUT_RECEIPT_WAIT_MS = 30_000

/**
 * D5: main-initiated sign-out confirmation (deployment switch) pushed to the
 * shell renderer; answered through `signOutPromptAnswer`. `mode: 'notice'`
 * (Q2 = a) is sent after an account switch already locked the previous
 * account and RAM-only content of it was lost: the renderer only reports
 * that, with one acknowledge button, and main does not wait for the answer.
 */
export interface SignOutPromptRequest {
  requestId: string
  plan: SignOutPlan
  /** absent = 'confirm' (sign out or go back) */
  mode?: 'confirm' | 'notice'
}

export interface SignOutPromptAnswer {
  requestId: string
  confirmed: boolean
}

/**
 * G5-04g: the folder of this working copy holds a binding.json with an integer
 * schema >= 2, a store written by a newer app. This build does not read that
 * store, so it neither opens the copy nor treats it as a plain local file: it
 * records the lock and the shell shows the S11 panel.
 */
export interface UniworkDocLock {
  /** the working copy path that was refused */
  path: string
  reason: UniworkLockReason
  /** basename of the working copy (a schema >= 2 binding is not parsed, so no title) */
  name: string
}

export type UniworkLaunchEvent =
  | { phase: 'opening'; title?: string }
  | { phase: 'opened'; path: string; title: string }
  | { phase: 'needs-sign-in' }
  | { phase: 'failed'; error: UniworkDocErrorCode }

export interface RecentUniworkSource {
  documentId: string
  workspaceId: string
  title: string
  access: UniworkDocAccess
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
  /** the starred group this file belongs to (absent when ungrouped); only
      populated by the starred() query — the other list queries omit it */
  group?: string
  /** the path failed to stat (disconnected drive, moved, deleted) — kept
      listed like Word's recents instead of silently dropped (r158) */
  missing?: boolean
  /** set when the file is a working copy of a UniWork document */
  uniwork?: RecentUniworkSource
}

/** paged query for the home file lists */
export interface RecentQuery {
  /** number of entries to skip (default 0) */
  offset?: number
  /** page size; 0 returns no entries but still reports totals (default 50) */
  limit?: number
  /** restrict to one extension ('docx' | 'xlsx' | 'pptx'); omit for all */
  ext?: string
  /** starred() only: restrict to one starred group; omit for all */
  group?: string
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

/**
 * The command line tool on the PATH (`command`: the name to type, `uniwork-office-cli`
 * on every OS). Created only when the user
 * asks for it in Settings: `absent` (not set up), `present`, `blocked` (no
 * writable folder, or another program of that name is in the way; `manual` is the
 * command to finish by hand), `unsupported` (dev run, temporary mount).
 */
export interface CliLinkState {
  state: 'unsupported' | 'absent' | 'present' | 'blocked'
  /** the name to type in a terminal */
  command?: string
  location?: string
  /** shell line that adds the link's folder to the PATH when the shell does not search it */
  pathHint?: string
  manual?: string
}

/** Settings "Test connection" answer: a failure carries its kind, never the provider's raw text */
export interface AiConnectionTestResult {
  ok: boolean
  errorKind?: AiTestFailureKind
}

/** Desk "In progress": an open tab with unsaved changes, or a crash copy newer than its recent file */
export interface DeskDraft {
  kind: 'unsaved' | 'recovery'
  title: string
  app: DocumentTabKind
  /** absent for an untitled unsaved tab */
  filePath?: string
  /** the tab to switch to ('unsaved' only; 'detached:<n>' for a detached window) */
  tabId?: string
  /** when the crash copy was written ('recovery' only) */
  modifiedMs?: number
}

export type DeskToolId =
  'pdf-to-docx' | 'pdf-to-xlsx' | 'pdf-to-pptx' | 'export-pdf' | 'merge-pdf' | 'split-pdf'

/** what Export PDF takes: the inputs headlessModuleFor (electron-utils) routes to an editor */
export const DESK_EXPORTABLE = /\.(docx|xlsx|xlsm|xls|csv|tsv|pptx|md|markdown|html|htm)$/i

export interface DeskToolRequest {
  tool: DeskToolId
  /** absolute paths (a drop); absent = main asks with a file picker */
  inputs?: string[]
  /** split-pdf: pages per part, 1-999 (default 1) */
  splitEvery?: number
}

export type DeskToolResult =
  | { ok: true; outputs: string[] }
  | { ok: false; canceled: true }
  | {
      ok: false
      error:
        'busy' | 'bad-input' | 'not-found' | 'same-path' | 'target-open' | 'encrypted' | 'failed'
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
  testFileSearchRerank(settings: FileSearchSettings): Promise<AiConnectionTestResult>
  /** starred files (independent of the recent list), newest first (paged) */
  starred(query?: RecentQuery): Promise<RecentPage>
  /** starred group names that currently have at least one file, in creation order */
  starredGroups(): Promise<string[]>
  /** put each starred path into `group` (null = remove from its group) */
  setStarredGroup(paths: string[], group: string | null): Promise<void>
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
  /** PWA / Hub → desktop Agent Intent (navigate Workbench tabs, optional mutate) */
  onAgentIntent(handler: (intent: AgentIntentDto) => void): () => void
  /** Ack intent lifecycle for future Hub result channel */
  agentIntentAck(intentId: string, status: 'applied' | 'dismissed' | 'failed'): Promise<void>
  /** Resolve NL text to an Agent Intent (desktop helper) */
  resolveAgentIntent(text: string): Promise<AgentIntentDto | null>
  /** DEV / tests: inject an intent without deep link */
  submitAgentIntent(intent: AgentIntentDto): Promise<boolean>
  /** open a blank markdown editor tab */
  newMarkdown(opts?: NewFileOpts & { projectId?: string }): Promise<void>
  /** open a blank html editor tab */
  newHtml(opts?: NewFileOpts & { projectId?: string }): Promise<void>
  /** drop entries from the recent list (does not touch the files) */
  removeRecent(paths: string[]): Promise<void>
  /** unstar files in bulk (Starred view selection bar); the recents list and the files are untouched */
  unstarPaths(paths: string[]): Promise<void>
  /** reveal the file in Finder / Explorer */
  revealPath(path: string): Promise<void>
  /** Desk: open tabs with unsaved changes, then crash copies newer than a recent file that is not open */
  listDrafts(): Promise<DeskDraft[]>
  /** Desk tools: one conversion; pickers and save dialogs happen in main */
  runDeskTool(req: DeskToolRequest): Promise<DeskToolResult>
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
  /** the release channel a dev / beta build is pinned to (setUpdateChannel is ignored), else null */
  getPinnedUpdateChannel(): Promise<string | null>
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
  /** log out (clears any leftover local auth material); { confirmed: true } after the sign-out prompt */
  accountLogout(options?: { confirmed?: boolean }): Promise<void>
  /** account status pushes (every state change); returns an unsubscribe */
  onAccountStatus(handler: (status: AccountStatus) => void): () => void
  /** abandon the pending sign-in attempt (state -> signed-out) */
  accountCancelLogin(): Promise<void>
  /** retry after server-unreachable (refresh + profile reload); resolves with the new status */
  accountRetry(): Promise<AccountStatus>
  /**
   * keystore-locked after a failed Retry: start a fresh browser sign-in that
   * replaces the saved sign-in this computer cannot open (queued offline edits
   * stay locked and kept). Refused by main in any other state; resolves like
   * accountLogin (whether the browser launched).
   */
  accountReplaceLockedSignIn?(): Promise<boolean>
  /** connect to the server at this address (validated, saved as the profile); the status after */
  accountSetServer(address: string): Promise<AccountSetServerResult>
  /** choose the active organization (persists uniworkOrgId, reloads entitlements) */
  accountSelectOrg(orgId: string): Promise<AccountStatus>
  /** UniWork cloud AI: signed in + entitled, per-tool availability and credits (never a token) */
  uniworkCloudStatus?(): Promise<UniworkCloudStatus>
  /** re-reads the cloud status (credits) from the server */
  uniworkCloudRefresh?(): Promise<UniworkCloudStatus>
  /** cloud status pushes; returns an unsubscribe */
  onUniworkCloudStatus?(handler: (status: UniworkCloudStatus) => void): () => void
  /** Editor AI “Open AI settings” → open a Settings section (e.g. aiModel); unsubscribe returned */
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
  /** where the `genoffice` command stands (Settings → General); nothing is written */
  getCliLinkStatus(): Promise<CliLinkState>
  /** put `genoffice` on the PATH (the Settings button); resolves to the refreshed state */
  installCliLink(): Promise<CliLinkState>
  /** theme switched anywhere (broadcast from the main process) */
  onThemeChanged(handler: (theme: UiTheme) => void): () => void
  /** document page theme switched anywhere (broadcast from the main process) */
  onDocumentThemeChanged(handler: (theme: DocTheme) => void): () => void
  /** open the Token Hub (OpenRouter) credits page in the default browser */
  openCreditUsage(): Promise<void>
  /** AI settings (userData/ai-settings.json, shared by every editor) */
  getAiSettings(options?: AiSettingsPickOptions): Promise<AiSettings>
  /** persist AI settings; every renderer gets ai:settings-changed and re-reads */
  setAiSettings(
    settings: AiSettings,
    options?: AiSettingsPickOptions & AiSettingsSaveOptions,
  ): Promise<void>
  /** ai-settings.json was rewritten by any renderer (composer model chip, another window) */
  onAiSettingsChanged(handler: () => void): () => void
  /** provider catalog with each fixed endpoint's default base URL (empty for UniAI/custom) */
  getAiProviders(): AiCatalogEntry[]
  /** live Codex model catalog discovered through the current or overridden app-server */
  getCodexModels(cliPath?: string): Promise<CodexModelCatalog>
  /** live model list advertised by a user-hosted OpenAI-compatible endpoint; empty when it cannot answer */
  getCustomModels(baseUrl: string, apiKey?: string): Promise<CodexModelCatalog>
  /** one-shot round trip against the given (possibly unsaved) settings — the settings-UI connection test */
  testAiSettings(settings: AiSettings): Promise<AiConnectionTestResult>
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
  /** image generation / media analysis providers a picker may offer */
  getAiMediaProviders(): AiMediaProviderMeta[]
  /** credential check for a (possibly unsaved) media provider */
  testAiMediaSettings(input: {
    provider: AiMediaProviderId
    config: AiMediaProviderConfig
  }): Promise<AiConnectionTestResult>
  /** web search provider catalog */
  getAiSearchProviders(): AiSearchProviderMeta[]
  /** one minimal query against the given key (the keyless auto entry needs none) */
  testAiSearchSettings(input: {
    provider: AiSearchProviderId
    apiKey: string
  }): Promise<AiConnectionTestResult>
  /** Local Workbench SQLite store (main-process source of truth) */
  wb: WorkbenchStoreApi
  uniworkListWorkspaces(): Promise<UniworkResult<UniworkWorkspaceRef[]>>
  uniworkListDocuments(query: UniworkDocListQuery): Promise<UniworkResult<UniworkDocListPage>>
  /** documents shared directly with me, aggregated across the selected org's workspaces (S17) */
  uniworkListSharedWithMe(query?: UniworkSharedQuery): Promise<UniworkResult<UniworkSharedPage>>
  /** the document properties panel (S17); nulls where the server sends no value */
  uniworkDocumentProperties(documentId: string): Promise<UniworkResult<UniworkDocProperties>>
  /** S18: create a blank document (docx/xlsx/pptx) in a workspace/folder */
  uniworkCreateDocument(
    input: UniworkCreateDocInput,
  ): Promise<UniworkDocActionResult<UniworkDocSummary>>
  /** S18: main shows the native open dialog; null when the person cancelled */
  uniworkPickUploadFile(): Promise<{ path: string; name: string } | null>
  /** S18: upload a local file into a workspace/folder as one UniWork document */
  uniworkUploadDocument(
    input: UniworkUploadDocInput,
  ): Promise<UniworkDocActionResult<UniworkDocSummary>>
  /** bytes sent while an upload runs; returns an unsubscribe */
  onUniworkUploadProgress(cb: (event: UniworkUploadProgress) => void): () => void
  /**
   * S18: abort the running upload started with this `uploadId` (Cancel/Esc of
   * the dialog). The upload then answers `upload_cancelled`; an id main does
   * not hold - already finished, or a stale dialog - is a no-op.
   */
  uniworkCancelUploadDocument(uploadId: string): Promise<void>
  /** S18: rename a document (the server keeps the title) */
  uniworkRenameDocument(
    documentId: string,
    name: string,
  ): Promise<UniworkDocActionResult<UniworkDocSummary>>
  /** S18: archive a document (never a hard delete) */
  uniworkArchiveDocument(documentId: string): Promise<UniworkDocActionResult<UniworkDocSummary>>
  /** S18: restore an archived document */
  uniworkRestoreDocument(documentId: string): Promise<UniworkDocActionResult<UniworkDocSummary>>
  /** the folders of one workspace, for the create/upload "Location" field */
  uniworkListFolders(workspaceId: string): Promise<UniworkResult<UniworkDocFolderRef[]>>
  /**
   * FD-11: the workspace's whole folder tree (`folders_only=true`), root nodes
   * first, to the server's depth 20.
   */
  uniworkFolderTree(workspaceId: string): Promise<UniworkResult<UniworkFolderNode[]>>
  /**
   * FD-11: one folder's contents (folders + files + pages, server order);
   * `parentId: null` is the workspace root.
   */
  uniworkListChildren(q: UniworkFolderQuery): Promise<UniworkResult<UniworkFolderChildren>>
  /** FD-11: title search across a workspace; hits carry their `path` */
  uniworkSearchDocuments(q: UniworkSearchQuery): Promise<UniworkResult<UniworkSearchPage>>
  /** FD-11: create one folder in a workspace (root when `parentId` is null) */
  uniworkCreateFolder(
    i: UniworkCreateFolderInput,
  ): Promise<UniworkDocActionResult<UniworkDocSummary>>
  /**
   * FD-11: move a document or folder under another folder (null = the root).
   * `renamedTo` names the title the server gave it on a name collision.
   */
  uniworkMoveDocument(
    i: UniworkMoveDocumentInput,
  ): Promise<UniworkDocActionResult<UniworkMoveResult>>
  /** FD-11: a workspace's document tree changed; returns an unsubscribe */
  onUniworkTreeChanged(cb: (event: UniworkTreeChangedEvent) => void): () => void
  /** a document was renamed (here or elsewhere); returns an unsubscribe */
  onUniworkDocRenamed(cb: (event: UniworkDocRenamedEvent) => void): () => void
  uniworkOpenDocument(documentId: string): Promise<UniworkResult<{ path: string }>>
  uniworkDocStatus(path: string): Promise<UniworkDocStatus | null>
  uniworkActiveDocStatus(): Promise<UniworkDocStatus | null>
  onUniworkDocStatus(cb: (status: UniworkDocStatus) => void): () => void
  /** G5-06u: main asks for the queue popover of a path (Ctrl/Cmd+S with a pending save) */
  onUniworkQueuePopover(cb: (request: UniworkQueuePopoverRequest) => void): () => void
  uniworkSave(path: string): Promise<UniworkDocStatus | null>
  uniworkResolveConflict(path: string): Promise<UniworkDocStatus | null>
  /** G5-09: main pushes the conflict dialog view when S5 opens or updates in place */
  onUniworkConflict(cb: (view: UniworkConflictView) => void): () => void
  /** G5-09: main ended the open S5 session itself (tab/language switch, document closed) */
  onUniworkConflictClosed(cb: (sessionId: string) => void): () => void
  /** G5-09: answer the open conflict dialog session */
  uniworkConflictAct(
    sessionId: string,
    action: UniworkConflictAction,
  ): Promise<UniworkConflictReply>
  /**
   * S6 (G5-03a): one action of the new-version bar (`later`, `close`, `retry`
   * or the two reloads); resolves to the status after the action.
   */
  uniworkRemoteAction(path: string, action: UniworkRemoteAction): Promise<UniworkDocStatus | null>
  /** S6: the bar's unscaled CSS-px height; main scales it by `--ui-scale` and moves the active editor view down by it */
  uniworkSetBarInset(heightPx: number): Promise<void>
  onUniworkLaunch(cb: (event: UniworkLaunchEvent) => void): () => void
  /** newer-store locks pushed from main; returns an unsubscribe */
  onUniworkLock(cb: (lock: UniworkDocLock) => void): () => void
  /** the locks main currently shows */
  uniworkLocks(): Promise<UniworkDocLock[]>
  /**
   * The whole lock list changed in main (a keystore lock cleared after the
   * keychain unlocked, so the S11 panel must not stay up); the payload is the
   * current list. Returns an unsubscribe.
   */
  onUniworkLocksChanged(cb: (locks: UniworkDocLock[]) => void): () => void
  /** close the lock panel for a path (nothing is deleted) */
  dismissUniworkLock(path: string): Promise<void>
  /** G5-11: compute the sign-out plan for the active account without changing anything */
  signOutPlan(): Promise<SignOutPlan>
  /** G5-11: progress pushes while a sign-out waits for an in-flight save (`waiting` | `done`) */
  onSignOutProgress(cb: (event: SignOutProgress) => void): () => void
  /** G5-11 D5: main-initiated sign-out prompt (account switch / deployment switch) */
  onSignOutPrompt?(cb: (request: SignOutPromptRequest) => void): () => void
  /** G5-11 D5: answer a main-initiated sign-out prompt */
  answerSignOutPrompt?(requestId: string, confirmed: boolean): Promise<void>
}

/** IndexedDB media blobs embedded in Workbench ZIP backup (optional). */
export interface WorkbenchIdbMediaDump {
  version: 1
  tasks: Record<string, string>
}

/** Workbench data of one bucket: a UniWork account, or signed-out use */
export interface WorkbenchSnapshot {
  keys: Record<string, string>
  keyCount: number
  dbPath: string
  /** opaque id of the bucket these keys belong to; every later call names it */
  bucket: string
  /** this account received the pre-upgrade data: the renderer moves its own copies once */
  legacyPending: boolean
  unavailable?: boolean
}

/**
 * Renderer ↔ main bridge for Workbench key/value persistence. Writes name the
 * bucket of the snapshot they were made from; main ignores them once the
 * account changed (see apps/shell/src/main/workbench-accounts.ts).
 */
export interface WorkbenchStoreApi {
  loadAll(): Promise<WorkbenchSnapshot>
  getKey(key: string, bucket: string): Promise<string | null>
  setKey(key: string, value: string, bucket: string): Promise<void>
  removeKey(key: string, bucket: string): Promise<void>
  importKeys(keys: Record<string, string>, bucket: string): Promise<{ imported: number }>
  /** the renderer moved its pre-upgrade localStorage / IndexedDB copies into `bucket` */
  legacyDone(bucket: string): Promise<void>
  /** the signed-in account changed: reload (the payload is the new bucket) */
  onBucketChanged(cb: (bucket: string) => void): () => void
  exportBackup(
    media: WorkbenchIdbMediaDump | null | undefined,
    bucket: string,
  ): Promise<{
    ok: boolean
    path?: string
    error?: string
    canceled?: boolean
  }>
  importBackup(bucket: string): Promise<{
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

export type AccountState =
  | 'not-configured'
  | 'signed-out'
  | 'signing-in'
  | 'signed-in'
  | 'refreshing'
  | 'session-expired'
  | 'session-revoked'
  | 'server-unreachable'
  | 'wrong-deployment'
  | 'keyring-unavailable'
  | 'keystore-locked'

export type AccountErrorCode =
  | 'network'
  | 'timeout'
  | 'login_timeout'
  | 'cancelled'
  | 'invalid_callback'
  | 'state_mismatch'
  | 'auth_code_invalid'
  | 'rate_limited'
  | 'unauthorized'
  | 'device_revoked'
  | 'refresh_reused'
  | 'wrong_deployment'
  | 'not_configured'
  | 'keyring_unavailable'
  | 'keystore_locked'
  | 'server_error'
  | 'malformed_response'

export interface AccountProfile {
  accountId: string
  email: string
  displayName: string
  avatarUrl?: string
}

/** why an organization row may or may not be chosen after sign-in (S16) */
export type OrgMembershipState = 'active' | 'member_deactivated' | 'organization_suspended'

export interface AccountOrg {
  id: string
  name: string
  slug: string
  role: string
  /** the row's selectability: only 'active' may be chosen */
  membership: OrgMembershipState
}

export interface AccountEntitlement {
  featureKey: string
  name: string
  kind: 'flag' | 'quota'
  enabled: boolean
  quotaLimit: number | null
  currentUsage: number
  unit?: string
}

export interface AccountEntitlements {
  orgId: string
  planCode: string
  planName: string
  /** subscription status as issued by the server (e.g. active, trialing, past_due) */
  status: string
  features: AccountEntitlement[]
  /** epoch ms when main fetched them */
  fetchedAt: number
}

export interface AccountStatus {
  /** true only in states signed-in / refreshing (kept for existing callers) */
  loggedIn: boolean
  /** profile email when known (kept for existing callers) */
  email?: string
  state: AccountState
  profile?: AccountProfile
  org?: AccountOrg
  orgs?: AccountOrg[]
  entitlements?: AccountEntitlements | null
  /** API origin of the active deployment profile (display only, e.g. "uniworkos.com") */
  serverOrigin?: string
  /** full API origin of the active profile (prefills the server address field) */
  serverUrl?: string
  /**
   * G8-16 S16: a choice is required before any organization-scoped call; the
   * `org` is absent until the user picks one.
   */
  needsOrgChoice?: boolean
  /** G8-16 S16: a remembered organization is no longer a membership of this account */
  rememberedGone?: boolean
  /**
   * G8-16 S16: the organization list could not be loaded, so the picker cannot
   * show it (the renderer shows `uwOrgPickError` + Retry). Set only when the
   * session itself is still usable (offline); a failure that ended the session
   * keeps its own state and error.
   */
  orgsError?: AccountErrorCode
  /**
   * keystore-locked only: a Retry already found the saved sign-in still
   * unreadable, so main now accepts accountReplaceLockedSignIn (a fresh
   * sign-in that replaces it). Absent in every other state.
   */
  canReplaceLockedSignIn?: boolean
  error?: AccountErrorCode
}

export type AccountSetServerResult = { status: AccountStatus } & (
  { ok: true } | { ok: false; error: 'invalid_address' | 'unreachable' | 'refused' }
)

/** login flow progress pushed from main */
export interface AccountLoginEvent {
  phase: 'launched' | 'url' | 'success' | 'error'
  url?: string
  expiresInSec?: number
  error?: AccountErrorCode
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

export type PracticeIdEntry =
  | 'legal'
  | 'construction'
  | 'procurement'
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
  | 'legal'
  | 'construction'
  | 'procurement'
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
  practice?: PracticeProjectMetaEntry
}

export interface CreatePracticeProjectArgs {
  practiceId: PracticeIdEntry
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
  /** create a practice pack with practice/meta.json */
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
  unstarPaths: 'home:unstar-paths',
  starredGroups: 'home:starred-groups',
  setStarredGroup: 'home:set-starred-group',
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
  listDrafts: 'home:list-drafts',
  runDeskTool: 'home:run-desk-tool',
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
  getPinnedUpdateChannel: 'home:get-pinned-update-channel',
  setUpdateChannel: 'home:set-update-channel',
  accountStatus: 'home:account-status',
  accountLogin: 'home:account-login',
  accountLoginEvent: 'home:account-login-event',
  openSettings: 'home:open-settings',
  accountLoginOpenUrl: 'home:account-login-open-url',
  accountLogout: 'home:account-logout',
  accountStatusEvent: 'home:account-status-event',
  accountCancelLogin: 'home:account-cancel-login',
  accountRetry: 'home:account-retry',
  accountReplaceLockedSignIn: 'home:account-replace-locked-sign-in',
  accountSetServer: 'home:account-set-server',
  accountSelectOrg: 'home:account-select-org',
  /** UniWork cloud AI status (token-free UniworkCloudStatus); refresh re-reads credits */
  uniworkCloudStatus: 'home:uniwork-cloud-status',
  uniworkCloudRefresh: 'home:uniwork-cloud-refresh',
  uniworkCloudStatusEvent: 'home:uniwork-cloud-status-event',
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
  getCliLinkStatus: 'home:get-cli-link-status',
  installCliLink: 'home:install-cli-link',
  pickDefaultSaveDir: 'home:pick-default-save-dir',
  openCreditUsage: 'home:open-credit-usage',
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
  wbLegacyDone: 'home:wb-legacy-done',
  /** push: the signed-in account changed, the workbench data shown changes with it */
  wbBucketChanged: 'home:wb-bucket-changed',
} as const

/** UniWork documents (open/save against UniWork); handlers live in main/uniwork-docs */
export const UNIWORK_DOC_CHANNELS = {
  listWorkspaces: 'uniwork-doc:list-workspaces',
  listDocuments: 'uniwork-doc:list-documents',
  /** invoke(query?) -> the org's documents shared directly with me (paged) */
  listSharedWithMe: 'uniwork-doc:list-shared-with-me',
  /** invoke(documentId) -> the properties panel of one document */
  documentProperties: 'uniwork-doc:document-properties',
  /** invoke(input) -> create a blank document (S18) */
  createDocument: 'uniwork-doc:create-document',
  /** invoke() -> the native open dialog's pick, or null when cancelled (S18) */
  pickUploadFile: 'uniwork-doc:pick-upload-file',
  /** invoke(input) -> upload a local file as one document (S18) */
  uploadDocument: 'uniwork-doc:upload-document',
  /** push -> upload bytes sent of the total (S18) */
  uploadProgress: 'uniwork-doc:upload-progress',
  /** invoke(uploadId) -> abort a running upload; an unknown/finished id is a no-op (S18) */
  cancelUpload: 'uniwork-doc:cancel-upload',
  /** invoke(documentId, name) -> rename (S18) */
  renameDocument: 'uniwork-doc:rename-document',
  /** invoke(documentId) -> archive (S18; there is no delete) */
  archiveDocument: 'uniwork-doc:archive-document',
  /** invoke(documentId) -> restore an archived document (S18) */
  restoreDocument: 'uniwork-doc:restore-document',
  /** invoke(workspaceId) -> the workspace's folders (S18 location field) */
  listFolders: 'uniwork-doc:list-folders',
  /** invoke(workspaceId) -> the workspace's folder tree, root nodes first (FD-11) */
  folderTree: 'uniwork-doc:folder-tree',
  /** invoke(q) -> one folder's contents: folders + files + pages (FD-11) */
  listChildren: 'uniwork-doc:list-children',
  /** invoke(q) -> title search across the workspace; hits carry their path (FD-11) */
  searchDocuments: 'uniwork-doc:search-documents',
  /** invoke(i) -> create one folder in a workspace/folder (FD-11) */
  createFolder: 'uniwork-doc:create-folder',
  /** invoke(i) -> move a document or folder under another folder (FD-11) */
  moveDocument: 'uniwork-doc:move-document',
  /** push -> { workspaceId }: a workspace's document tree changed (FD-11; coalesced) */
  treeChanged: 'uniwork-doc:tree-changed',
  /** push -> a document's title changed (S18 renamed-elsewhere announce) */
  docRenamed: 'uniwork-doc:doc-renamed',
  openDocument: 'uniwork-doc:open-document',
  docStatus: 'uniwork-doc:status',
  activeDocStatus: 'uniwork-doc:active-status',
  docStatusEvent: 'uniwork-doc:status-event',
  /** main -> shell renderer: open the queue popover of { path } (G5-06u) */
  queuePopover: 'uniwork-doc:queue-popover',
  save: 'uniwork-doc:save',
  resolveConflict: 'uniwork-doc:resolve-conflict',
  /** main -> shell renderer: open or update the S5 conflict dialog (G5-09) */
  conflictOpen: 'uniwork-doc:conflict-open',
  /** main -> shell renderer: main ended the open S5 session itself (G5-09) */
  conflictClosed: 'uniwork-doc:conflict-closed',
  /** invoke(sessionId, action) -> UniworkConflictReply (G5-09) */
  conflictAct: 'uniwork-doc:conflict-act',
  /** invoke(path, action) -> the S6 bar action (later/close/retry/reload/reload-now) */
  remoteAction: 'uniwork-doc:remote-action',
  /** invoke(heightPx) -> the S6 bar's height under the tab strip (active view inset) */
  barInset: 'uniwork-doc:bar-inset',
  launchEvent: 'uniwork-doc:launch-event',
  /** main -> shell renderer: a working copy refused by the newer-store guard */
  lock: 'uniwork-doc:lock',
  /** invoke -> the locks currently shown (shell window mount / reload) */
  locks: 'uniwork-doc:locks',
  /** invoke(path) -> forget the lock; nothing else */
  dismissLock: 'uniwork-doc:dismiss-lock',
  /** main -> shell renderer: the whole lock list changed (a keystore lock cleared after unlock/Retry) */
  locksChanged: 'uniwork-doc:locks-changed',
  /** invoke() -> SignOutPlan (G5-11) */
  signOutPlan: 'uniwork-doc:sign-out-plan',
  /** push -> { phase: 'waiting' | 'done' } (G5-11) */
  signOutProgress: 'uniwork-doc:sign-out-progress',
  /** main -> shell renderer: ask the sign-out prompt for an account or deployment switch (G5-11 D5) */
  signOutPrompt: 'uniwork-doc:sign-out-prompt',
  /** invoke({ requestId, confirmed }) -> answer the main-initiated sign-out prompt (G5-11 D5) */
  signOutPromptAnswer: 'uniwork-doc:sign-out-prompt-answer',
} as const

export const PROJECT_CHANNELS = {
  list: 'project:list',
  files: 'project:files',
  create: 'project:create',
  createPractice: 'project:createPractice',
  getPracticeMeta: 'project:getPracticeMeta',
  patchPracticeMeta: 'project:patchPracticeMeta',
  rename: 'project:rename',
  delete: 'project:delete',
  moveFile: 'project:moveFile',
  timeline: 'project:timeline',
} as const
