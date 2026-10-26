import type {
  AiChatResponse,
  AiCustomProtocol,
  AiMediaProviderConfig,
  AiMediaProviderId,
  AiMediaProviderMeta,
  AiProviderMeta,
  AiSearchProviderId,
  AiSearchProviderMeta,
  AiSettings,
<<<<<<< ours
  AiSettingsSaveOptions,
  AiStreamChunk,
  AiStreamRequest,
  AiTestFailureKind,
=======
  AiStreamChunk,
  AiStreamRequest,
>>>>>>> theirs
  CodexModelCatalog,
  OpenRouterKeyStatus,
  UniworkCloudStatus,
} from '@genoffice/ai-provider'
import type {
  AskUniContext,
  AskUniOpenRequest,
  AskUniOpenResult,
  AskUniRequest,
  AskUniResult,
  AskUniV2Bridge,
} from './askuni-api'
import type { UpdateChannel, UpdateUiState } from './update-api'
import type {
<<<<<<< ours
  UniworkConflictAction,
  UniworkConflictReply,
  UniworkConflictView,
} from './uniwork-conflict'
import type {
  OpenSourceInput,
  OpenSourceValue,
  SourceViewHint,
  SourceViewResult,
  SourceViewState,
} from './source-view'

export { SOURCE_VIEW_CHANNELS } from './source-view'
export type {
  OpenSourceInput,
  OpenSourceValue,
  SourceViewErrorCode,
  SourceViewHint,
  SourceViewResult,
  SourceViewState,
} from './source-view'

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
=======
  AttachmentInfo,
  CliContext,
  CliRunRequest,
  CliRunResult,
  KbFileInfo,
  KbReadPage,
  KbSearchHit,
} from '@genoffice/agent-core'
>>>>>>> theirs
import type { AiPanelPrefs } from '@genoffice/ui/ai-panel-prefs'
import type { FileExcerpt } from './file-excerpt'
import type { DocumentTabKind } from './tabs-api'
import type {
  BatchUploadPickInput,
  BatchUploadPreflightInput,
  BatchUploadProgress,
  BatchUploadStartInput,
  BatchUploadStartResult,
  PreflightSDO,
} from './folder-upload-api'
import type { ZipDownloadBridge } from './zip-download-api'

export interface AttachmentAddResult {
  accepted: AttachmentInfo[]
  /** per-file rejection messages, already localized by the main process */
  rejected: string[]
}

export interface AttachmentReadResult {
  ok: boolean
  error?: string
  totalChars?: number
  text?: string
  offset?: number
}

export interface AttachmentImageResult {
  ok: boolean
  /** raw base64 (no data: URL prefix) */
  base64?: string
  mime?: string
  error?: string
}

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
/** mirrors AUTHOR_NAME_MAX in @genoffice/electron-utils (the renderer cannot import it) */
export const AUTHOR_NAME_MAX = 120

export interface AuthorNameSetting {
  /** stored override; '' means "use fallback" */
  value: string
  /** the OS account name */
  fallback: string
}

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

export type UniworkDocFormat = 'docx' | 'xlsx' | 'pptx' | 'pdf' | 'md' | 'txt' | 'html'
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
  // EL-1(a) (UNI-1645c): HTTP 423 document_locked — someone else holds the active edit lock
  | 'edit_locked'
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
  // UNI-1975: the server's 422 `folder_not_shareable` - a folder can't be shared,
  // only documents are (user-facing, never retried)
  | 'folder_not_shareable'
  // UNI-2066: the server's 422 `folder_into_my_folder` - a workspace folder can't
  // move into My Folder or under it (user-facing, never retried)
  | 'folder_into_my_folder'
  // UNI-2078: the copy route's own refusals - a work-product document copies only through its
  // owning screen (409 `owner_requires_copy`), a page has no copy yet (400 `invalid_request`,
  // reason `page_copy_not_supported`) and the copy needs the explicit consent (409
  // `copy_consent_required`); each is user-facing, never retried
  | 'owner_requires_copy'
  | 'page_copy_not_supported'
  | 'copy_consent_required'
  // UNI-2078: the purge route's refusals - the item is not (or no longer) in the trash (400
  // `document_not_in_trash`) and a folder over the server's node cap (400 `folder_too_large`)
  | 'document_not_in_trash'
  | 'folder_too_large'
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
  // EL-1(a) (UNI-1645c): HTTP 423 document_locked — another user holds the server edit lock
  | 'edit_locked'

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

/**
 * UNI-1958 row 1: the server's list-row `share_scope` (who reaches the
 * document), carried unchanged from the main parse to the Access cell.
 */
export interface UniworkDocShareScope {
  homeWorkspace: boolean
  /** live direct grants to people */
  users: number
  /** live direct grants to other workspaces */
  workspaces: number
  organization: boolean
  publicLink: boolean
}

export interface UniworkDocSummary {
  id: string
  workspaceId: string
  title: string
  format: UniworkDocFormat | null
  updatedAt: string
  updatedByName?: string
  /** DESKTOP-HOME: server `updated_by` ULID; absent when omitted */
  updatedById?: string
  /** DESKTOP-HOME: server `visibility`; absent when omitted or unknown */
  visibility?: 'private' | 'workspace' | 'restricted'
  /** DESKTOP-HOME: server `my_level`; absent when omitted or unknown */
  myLevel?: 'view' | 'comment' | 'edit' | 'manage'
  /** UNI-1958 row 1: server `share_scope`; absent when omitted (agent callers) or malformed */
  shareScope?: UniworkDocShareScope
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
   * FD-11: what the row is. Always present on `listChildren` and search rows;
   * `'file'` on the library (`listDocuments`) and shared-with-me routes, which
   * add `'page'` only when asked (`includePages`).
   */
  kind?: UniworkEntryKind
  /** FD-11: the folder/page holding the document; null = the workspace root */
  parentId?: string | null
  /**
   * MYFOLDER-01 / SAVE-01: the server's `system_kind`, kept only for the known
   * `'my_folder'` marker (unknown values are dropped at parse).
   */
  systemKind?: UniworkSystemKind
  /**
   * UNI-2066: a folder row's `is_empty` - nothing in it is visible to this
   * viewer. Only a real boolean is kept; absent = unknown (the card says nothing).
   */
  isEmpty?: boolean
  /**
   * FD-11: the ancestors of a search row, root first. Only the title search
   * sends one (cut at the first unreadable ancestor).
   */
  path?: { id: string; title: string }[]
  /** EL-1(b): list-row edit_lock summary (DH-2); absent when the server sent none */
  editLock?: UniworkDocEditLock
  /**
   * UNI-1961 (ARCHIVE-01): the row sits in Lưu trữ (the server's `shelved_at`).
   * Read leniently: an odd value drops the field, never the row.
   */
  shelvedAt?: string
  /** UNI-1961: the server's `shelved_by` id; absent when null (the system shelved it) */
  shelvedById?: string
  /** UNI-1961: the shelver's display name, resolved by main from the workspace members */
  shelvedByName?: string
  /** UNI-1961: `shelved_by` names someone the workspace member list no longer holds */
  shelvedByFormer?: boolean
  /**
   * UNI-1961: the server's `admin_scope` - a workspace admin on a restricted row
   * administers it without a `my_level` (the web's canManageTrashed)
   */
  adminScope?: boolean
  /** UNI-1961: a file row's `size_bytes` (the web's Size column); absent on pages/folders or 0 */
  sizeBytes?: number
  /** UNI-1961: the server's `origin` when it is one the web names (Group by Source) */
  origin?: 'upload' | 'created'
  /**
   * UNI-2047 doclist fields. Every one is optional and read leniently by main:
   * a missing or malformed server value leaves the key absent, so a screen
   * hides its column instead of guessing.
   */
  /** trash rows: the server's `archived_at` timestamp (`archived` stays the flag) */
  archivedAt?: string
  /** trash rows: the server's `archived_by` id */
  archivedById?: string
  /** trash rows: who trashed it, resolved by main from the workspace members like `shelvedByName` */
  archivedByName?: string
  /** trash rows: when the server purges the row (`purge_after`); "N days left" counts to it */
  purgeAfter?: string
  /** the caller owns the row (`is_owner`) */
  isOwner?: boolean
  /** the last editor as the server names them; absent outside the caller's org or for a non-person */
  updatedByUser?: UniworkDocUpdatedByUser
  /** recent rows: the caller's last opened/edited/commented touch */
  lastActivity?: UniworkDocLastActivity
  /** shared-with-me rows: who shared the row and when */
  shared?: UniworkDocShared
  /** shared-by-me rows: how widely the caller shared the row */
  shareSummary?: UniworkDocShareSummary
  /** favorites rows: when the caller starred the row (`favorited_at`) */
  favoritedAt?: string
  /**
   * UNI-2047 APP-SHARE-DIALOG: the server's `owner_kind` when the document belongs to another
   * module (a work product); absent for an ordinary document. Such a row is never shared here.
   */
  ownerKind?: string
}

/** UNI-2047: the server's `updated_by_user`; `avatarUrl` is absolute http(s) and loads with no auth header */
export interface UniworkDocUpdatedByUser {
  name: string
  avatarUrl?: string
}

/** UNI-2047: the server's `last_activity` on a recent row */
export interface UniworkDocLastActivity {
  kind: 'opened' | 'edited' | 'commented'
  at: string
}

/** UNI-2047: the server's `shared` block on a shared-with-me row */
export interface UniworkDocShared {
  /** `shared.by`: the sharer's id */
  byId?: string
  /** `shared.by_kind`, kept as sent (the server may add kinds) */
  byKind?: string
  /** `shared.by_name`; absent when the sharer is outside the caller's org */
  byName?: string
  at: string
}

/**
 * UNI-2047: the server's `share_summary` on a shared-by-me row. `people` are
 * direct users, `links` are the live ones; `latestAt` is absent when nothing
 * is shared.
 */
export interface UniworkDocShareSummary {
  people: number
  workspaces: number
  links: number
  latestAt?: string
}

/** UNI-2047: the sort keys a doclist route accepts (S3 plus the SV-0..SV-3 per-list keys) */
export type UniworkListSort =
  'updated' | 'name' | 'size' | 'editor' | 'activity' | 'shared' | 'starred' | 'deleted' | 'shelved'

/** UNI-2047: the Recent segment (`activity` filter on `/documents/recent`) */
export type UniworkListActivity = 'opened' | 'edited'

/**
 * UNI-1961 (ARCHIVE-01): the answer of an unshelve or shelve - the item, and
 * the ids the batch touched (a folder unshelve may leave descendants the
 * caller does not manage on the shelf).
 */
export interface UniworkDocShelveResult {
  document: UniworkDocSummary
  affected: string[]
}

/** UNI-2047 B6: the answer of Gắn sao - when the server recorded the star */
export interface UniworkDocFavoriteResult {
  favoritedAt: string
}

/** FD-11: the three entry kinds the folder tree holds */
export type UniworkEntryKind = 'folder' | 'file' | 'page'

/**
 * MYFOLDER-01 / SAVE-01: the server's `system_kind` (omitempty, loose enum).
 * `'my_folder'` marks the caller's personal "My Folder" (D
 * `DocumentSystemKindMyFolder`); anything else or absent is an ordinary row.
 * The stored title is never the label - the renderer shows a localized name.
 */
export type UniworkSystemKind = 'my_folder'

/**
 * UNI-2113: one value of the server's `?type=` vocabulary: `page` (a UniNote) or a file format.
 * The menu order is page, docx, xlsx, pptx, pdf, md, html, txt (the renderer owns the order).
 */
export type UniworkDocTypePick = 'page' | UniworkDocFormat

/**
 * DESKTOP-HOME: optional list filters for `listChildren`, `listDocuments`,
 * `listSharedByMe`, `listTrash`, `listSharedWithMe`, `listShelved` and (UNI-2047 B6, only the type,
 * the kind and the sort) `listFavorites`.
 * Unset = parameter omitted.
 */
export interface UniworkListFilters {
  /**
   * UNI-2113: the Documents home Type multi-select, one repeated `?type=` per pick (OR across the
   * picks, AND with the route's own `kind`). Unset or empty = no type filter. It replaces the
   * single `format` / `kind=page` filter of UNI-2047: a UniNote is the `page` pick.
   */
  types?: UniworkDocTypePick[]
  updatedBy?: string
  updatedFrom?: string
  /** UNI-2047: server-side sort key; unset = the route's own order, nothing sent */
  sort?: UniworkListSort
  /** UNI-2047: sort direction; unset = the key's own default, nothing sent */
  order?: 'asc' | 'desc'
  /** UNI-2047: Recent only (`/documents/recent`): keep rows by their last touch */
  activity?: UniworkListActivity
}

/**
 * UNI-1961: one file of the Documents home's "other sources" list
 * (`GET /workspaces/{ws}/documents/sources`): a document file attached in
 * chat, a task, a meeting or email (UNI-1967: docx/xlsx/pptx/pdf/md/html/txt).
 * The web's lenient shape (sources-schema.ts): every field but the ids, the
 * source, the parent and the name takes a default when the server omits it.
 */
export interface UniworkSourceFile {
  id: string
  /** chat | task | meeting | email; kept as sent (a new module is not dropped) */
  source: string
  parent: { kind: string; id: string; title: string }
  name: string
  mimeType: string
  extension: string
  sizeBytes: number
  updatedAt: string
  owner: { id: string; name: string } | null
  canOpenInApp: boolean
  canSave: boolean
}

export interface UniworkSourceListQuery {
  workspaceId: string
  source?: string
  /**
   * UNI-2113: the Type picks, one `?type=` each. The sources list holds every format (txt too);
   * `page` is accepted and adds nothing (a page-only pick is an empty page).
   */
  types?: UniworkDocTypePick[]
  q?: string
  cursor?: string
  limit?: number
}

export interface UniworkSourceListPage {
  items: UniworkSourceFile[]
  nextCursor: string | null
}

/** UNI-1961: download one source file to a path the person picks */
export interface UniworkSourceDownloadInput {
  workspaceId: string
  sourceId: string
  /** the suggested file name (the row's name; only its last segment is used) */
  name: string
}

/**
 * UNI-2066: what putting a folder in the trash would move
 * (`GET /documents/{id}/archive-impact`, behind the same manage gate). A subtree
 * past the server's cap carries no counts. `relocatedCount` (documents other
 * people own that the trash hands back to their owners) only words one
 * sentence and is never shown as a number; an unreadable value reads as 0.
 */
export type UniworkArchiveImpact =
  | { tooLarge: true }
  | { tooLarge: false; folders: number; documents: number; relocatedCount: number }

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
  /** MYFOLDER-01 / SAVE-01: `'my_folder'` on the caller's personal folder row */
  systemKind?: UniworkSystemKind
  /**
   * UNI-2066: the server's `is_empty` - nothing in the folder is visible to this
   * viewer. Only a real boolean is kept; absent = unknown (never a count).
   */
  isEmpty?: boolean
}

/** FD-11: one contents page of a folder (folders + files + pages, server order) */
export interface UniworkFolderChildren {
  items: UniworkDocSummary[]
  nextCursor: string | null
}

/** FD-11: the contents of one folder; `parentId: null` = the workspace root */
export interface UniworkFolderQuery extends UniworkListFilters {
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
  /** UNI-2113: the Type picks narrow the search like the lists (one `type=` each, OR across picks) */
  types?: UniworkDocTypePick[]
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

/**
 * UNI-2078: the input of a plain copy. A blank `title` is left out (the server names the copy);
 * `idempotencyKey` is minted per dialog open so a retry of the same open replays safely.
 */
export interface UniworkCopyDocumentInput {
  documentId: string
  title?: string
  idempotencyKey?: string
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

export interface UniworkDocListQuery extends UniworkListFilters {
  workspaceId: string
  query?: string
  cursor?: string
  limit?: number
  /**
   * UNI-1953: also list UniNote pages (the Documents home). Unset = files only,
   * which every picker and every list that downloads keeps.
   */
  includePages?: boolean
}

export type UniworkResult<T> = { ok: true; value: T } | { ok: false; error: UniworkDocErrorCode }

export interface UniworkDocListPage {
  documents: UniworkDocSummary[]
  nextCursor: string | null
}

/**
 * paged "shared with me" query; main aggregates the selected org's workspaces.
 * UNI-2047: the type / updater / date filters and the sort go to every
 * workspace; a value outside the vocabulary is dropped, unset = today's call.
 */
export interface UniworkSharedQuery extends Pick<
  UniworkListFilters,
  'types' | 'updatedBy' | 'updatedFrom' | 'sort' | 'order'
> {
  /** opaque cursor from the previous page; omit for the first page */
  cursor?: string
  /** page size, default 50, max 100 */
  limit?: number
  /** UNI-1953: also list UniNote pages (the Documents home); unset = files only */
  includePages?: boolean
}

export type UniworkSharedPage = UniworkDocListPage

/**
 * UNI-1961 / UNI-2047: the Lưu trữ shelf query. Only the type filter and the
 * sort apply (`updatedBy` / `updatedFrom` / `activity` are never forwarded).
 */
export interface UniworkShelvedQuery extends Pick<UniworkListFilters, 'types' | 'sort' | 'order'> {
  workspaceId: string
  cursor?: string
  limit?: number
}

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
  /** `owner_kind` (`work_product` for an owned document); null for an ordinary one */
  ownerKind: string | null
  /** `shelved_at` while the document sits in Archive (Lưu trữ); null otherwise */
  shelvedAt: string | null
  /** `admin_scope`: the person reaches the document as a workspace admin, not through a grant */
  adminScope: boolean
  /** `archived_at` while the document sits in the trash; null otherwise */
  archivedAt: string | null
}

/**
 * Errors a name field shows in place; every other failure is a toast.
 * `folder_name_taken` (FD-11) is the server's 409 for a folder whose name
 * already exists among its siblings: only folders collide, and the renderer
 * shows it under the field, so it is a field error too.
 */
export type UniworkDocNameError = 'name_empty' | 'name_too_long' | 'folder_name_taken'
/**
 * What a create/rename/archive/upload/move call may fail with. `name_empty` /
 * `name_too_long` / `folder_name_taken` are field errors, `move_name_taken` is
 * a move whose destination exhausted all "(n)" auto-renames (FD11-B-R1-03), and
 * `upload_cancelled` is an upload the person aborted; none of them is part of
 * `UniworkDocErrorCode`, because that union is switched on exhaustively by the
 * renderer's error copy table.
 * MYFOLDER-01 / SAVE-01: `my_folder_locked` (409, error_class "conflict") and
 * `invalid_destination` (400) arrive on the error's `serverCode` and join here
 * for the same reason - the renderer shows them verbatim, keyed by code.
 * SAVE-01 r2: `first_save_flush_failed` = the editor could not be written to
 * disk (refused or timed out), so nothing was created. `first_save_bind_failed`
 * = the document was created but the local bind failed; the created document
 * was archived to the trash (restorable). `first_save_orphaned` = the create
 * landed and the compensating archive failed too; both carry `documentId` /
 * `documentTitle` so the dialog can tell the person where the document is.
 */
export type UniworkDocActionError =
  | UniworkDocErrorCode
  | UniworkDocNameError
  | 'move_name_taken'
  | 'upload_cancelled'
  | 'my_folder_locked'
  | 'invalid_destination'
  | 'first_save_flush_failed'
  | 'first_save_bind_failed'
  | 'first_save_orphaned'
export type UniworkDocActionResult<T> =
  | { ok: true; value: T }
  | {
      ok: false
      error: UniworkDocActionError
      name?: string
      sizeBytes?: number
      maxBytes?: number
      /**
       * UNI-2047: the server throttled (429) or was briefly down (503), so the same call may be
       * tried again once. Absent on every other failure: a `server_error` that is not a throttle
       * may have been applied, and a second call would answer conflict / not_found.
       */
      retryable?: boolean
      /**
       * FD-11 / B-R2-01: `document_too_deep` carries the depth cap so the
       * renderer can show it; D's `document_too_deep` has no `fields` map and
       * `max` is always the app constant 20 (matching the server's
       * `maxDocumentDepth`). Absent for every other failure.
       */
      max?: number
      /**
       * SAVE-01 r2 (S01-R1-2): on `first_save_bind_failed` /
       * `first_save_orphaned` the document that was created, so the dialog can
       * name it (trash, or the folder it landed in). Absent everywhere else.
       */
      documentId?: string
      documentTitle?: string
      /**
       * UNI-1959: a create the server answered 404 / 501 - its route for this
       * kind is not deployed - so the New menu disables that kind for the
       * session. Set on create-document / create-page failures only.
       */
      endpointMissing?: boolean
    }

/** the file formats D's blank route generates (UNI-1953: the Office three plus md / html / pdf; UNI-2046: txt) */
export type UniworkDocNewFormat = 'docx' | 'xlsx' | 'pptx' | 'md' | 'txt' | 'html' | 'pdf'

export interface UniworkCreateDocInput {
  workspaceId: string
  /** ULID of the parent folder/page; null = the workspace root */
  folderId: string | null
  name: string
  format: UniworkDocNewFormat
}

/** UNI-1953: a UniNote is a page, not a file format: it has its own create call */
export interface UniworkCreatePageInput {
  workspaceId: string
  /** ULID of the parent folder/page; null = the caller's My Folder */
  folderId: string | null
  name: string
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

/** upload progress: bytes sent of the total (0 when the total is not known yet) */
export interface UniworkUploadProgress {
  /** the upload this event belongs to (the dialog's own `uploadId`) */
  uploadId: string
  path: string
  loaded: number
  total: number
  /** BIGUP-A1: 'checking' while the server verifies a chunked upload; absent = uploading */
  phase?: 'uploading' | 'checking'
}

/** MYFOLDER-01 / SAVE-01: where the first Save to UniWork creates the document */
export type UniworkFirstSaveTarget = { kind: 'my_folder' } | { kind: 'folder'; folderId: string }

/**
 * SAVE-01: the Save dialog's confirm. `tabPath` is the unbound file the tab
 * shows; `workspaceId` scopes the create (the dialog's workspace). Main flushes
 * the editor, creates the document (destination my_folder, or the picked
 * parent_id) and binds the tab to the answer, so the next save is a plain
 * bound commit with no dialog.
 */
export interface UniworkFirstSaveInput {
  tabPath: string
  title: string
  workspaceId: string
  target: UniworkFirstSaveTarget
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

/**
 * EL-1(a) (UNI-1645c): active edit-lock holder metadata from HTTP 423 `document_locked`.
 * `holderId` is kept main-side only; only the display name and timestamps cross to the renderer.
 */
export interface UniworkDocEditLock {
  holderName: string | null
  since: string | null
  expiresAt: string | null
  heldByMe: boolean
  offlineHoldUntil?: string
}

/** EL-1(b): the desktop's own edit-lock session phase for an open bound document */
export type UniworkEditLockPhase =
  'acquiring' | 'held' | 'other' | 'self_elsewhere' | 'free' | 'lost' | 'unreachable'
export type UniworkEditLockLostReason =
  | 'released'
  | 'expired'
  | 'taken_over'
  | 'handed_over'
  | 'access_lost'
  | 'document_archived'
  | 'moved_here'
  | 'session_revoked'
  | 'member_deactivated'
  | 'organization_suspended'
  | 'document_deleted'
  | 'unknown'
export interface UniworkEditLockSessionView {
  phase: UniworkEditLockPhase
  /** 'other' | 'self_elsewhere': the holder's display name (null when the server sent none) */
  holderName: string | null
  /** 'other' | 'self_elsewhere': ISO time the holder started */
  since: string | null
  /** 'lost' only */
  lostReason?: UniworkEditLockLostReason
  /** 'lost' with taken_over / handed_over: who took it */
  byName?: string | null
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
  /** EL-1(a) (UNI-1645c): populated while `state === 'edit_locked'`; absent otherwise. */
  editLock?: UniworkDocEditLock
  /** EL-1(b): absent = no lock session (unbound, view access, version ticket, signed out) */
  lockSession?: UniworkEditLockSessionView
  /** Payload size in bytes when known (e.g. when `error === 'too_large'`). */
  sizeBytes?: number
  /** Server/configured maximum document size in bytes when `error === 'too_large'`. */
  maxBytes?: number
  /** Warn-band signal emitted once per bound document session when `warn_bytes <= sizeBytes <= max_bytes`. */
  sizeWarn?: { sizeBytes: number; maxBytes: number }
  /** True when a save just exceeded `max_bytes` and the over-cap save dialog should be offered. */
  saveTooLargePrompt?: boolean
  /** Monotonic sequence id for `saveTooLargePrompt` so the renderer latches once per over-cap save. */
  saveTooLargePromptSeq?: number
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

/**
 * UNI-1959 (mirrors the web UNI-1960): main asks the shell renderer for the
 * "Name the document" dialog on the first save of a document created blank. The
 * save is held until the renderer answers `continue` (the name / folder step is
 * done or unchanged) or `cancel` (no save).
 */
export interface UniworkFirstSaveNameRequest {
  /** minted by main per ask; the answer names it */
  requestId: string
  /** the working copy the editor saved */
  path: string
  documentId: string
  workspaceId: string
  /** the document's current title, with its extension (e.g. `Untitled document.docx`) */
  title: string
  /** the folder holding it now; null = unknown / workspace root */
  parentId: string | null
}

export interface UniworkFirstSaveNameAnswer {
  requestId: string
  /**
   * `shown` = the dialog is up (it stops main's delivery clock; the person has
   * no deadline after it); `continue` / `cancel` = the verdict
   */
  answer: 'continue' | 'cancel' | 'shown'
}

export type UniworkConflictChoice = 'overwrite' | 'save-local-copy' | 'open-latest' | 'later'

/**
 * Why a working copy was refused before anything opened, or why an offline copy
 * could not be opened (S11 lock panel). The reasons are the "Lý do bị chặn"
 * table of EXPERIENCE.md; G5-05u widened them from the original three.
 * `keyring_unavailable` is deliberately absent: a machine without a usable OS
 * keystore refuses sign-in, so no UniWork session (and no panel) exists there.
 */
export const UNIWORK_LOCK_REASONS = [
  'store_newer',
  'keystore_locked',
  'signed_out',
  'session_expired',
  'foreign_account',
  'permission_revoked',
  'document_deleted',
  'organization_suspended',
  'member_deactivated',
  'lease_expired',
  'clock_rollback',
] as const

export type UniworkLockReason = (typeof UNIWORK_LOCK_REASONS)[number]

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
  /**
   * G5-05u: `reason === 'lease_expired'` while the org capability
   * `offline_library` is off: the lease cannot be renewed, so the panel shows
   * `uwLockLibraryOff` and offers the sync center instead of "Kết nối lại".
   */
  libraryOff?: boolean
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
 * The decision-model routes the app can call. Several vendors publish more
 * than one size or generation behind the same URL, and the difference is only
 * the `model` in the body — but they are listed separately rather than folded
 * into one option with a model picker, because picking the wrong one costs
 * real money per call and a dropdown that names them is the safer surface.
 */
export type DecisionEndpoint =
  | 'openrouter'
  | 'direct'
  | 'perplexity'
  | 'perplexity-v12'
  | 'perplexity-flash'
  | 'liquid'
  | 'liquid-ultra'
  | 'openai'
  | 'cloudflare'
  | 'cloudflare-flash'
  | 'kev'
  | 'rizzo'
  | 'custom'

export function isCloudflareEndpoint(endpoint: DecisionEndpoint): boolean {
  return endpoint === 'cloudflare' || endpoint === 'cloudflare-flash'
}

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
  /** `cloudflare`/`cloudflare-flash` only: Workers AI account id */
  cloudflareAccountId: string
  /** `cloudflare`/`cloudflare-flash` only: Workers AI model path, e.g. @cf/cloudflare/clef */
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

<<<<<<< ours
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

=======
export interface UserSkillEntry {
  name: string
  description: string
  relevant: boolean
}

>>>>>>> theirs
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
  // ---- knowledge-base ask panel: the reader's starred corpus, askable ----
  /** the starred corpus as the AI's knowledge base */
  kbList(): Promise<KbFileInfo[]>
  /** the skills the user installed into GenOffice */
  skillsList(): Promise<UserSkillEntry[]>
  /** one installed skill's body, by name */
  skillText(name: string): Promise<string>
  /** open Settings › Integrations (the skills list) */
  openSkillsSettings(): Promise<void>
  /** full-text search over the corpus */
  kbSearch(query: { q: string; limit?: number }): Promise<KbSearchHit[]>
  /** one page of a corpus file's parsed text (path must be in kbList) */
  kbRead(path: string, offset: number): Promise<KbReadPage>
  /** write the AI's markdown as a new .md / .docx in the save folder; resolves to its path */
  kbCreateDocument(request: {
    title: string
    format: 'md' | 'docx'
    content: string
  }): Promise<{ path: string }>
  /** the work and output directories the Ask AI CLI tools use for one conversation */
  kbCliContext(sessionId: string): Promise<CliContext>
  /** run the bundled genoffice CLI for one conversation (confined; see main/home-cli.ts);
   *  `sources` are the attached files whose folders the CLI may read */
  kbRunCli(
    sessionId: string,
    request: CliRunRequest & { sources?: string[] },
  ): Promise<CliRunResult>
  /** chat attachments: the files:* handlers Docs registers in the shell main process */
  pickAttachments(): Promise<AttachmentAddResult | null>
  addAttachmentPaths(paths: string[]): Promise<AttachmentAddResult>
  addPastedImage(data: ArrayBuffer, ext: string): Promise<AttachmentAddResult>
  readAttachment(path: string, offset: number, maxChars: number): Promise<AttachmentReadResult>
  readAttachmentImage(path: string): Promise<AttachmentImageResult>
  /** the user's AI provider settings (shared with every app's panel) */
  aiGetSettings(): Promise<AiSettings>
  /** one streamed model turn over the shared ai:stream handler */
  aiStream(request: AiStreamRequest): Promise<void>
  aiStreamCancel(requestId: string): Promise<void>
  /** subscribe to stream chunks; returns unsubscribe */
  onAiStream(handler: (chunk: AiStreamChunk) => void): () => void
  /** Genspark login state (the default provider's auth source) */
  aiGskStatus(): Promise<{ loggedIn: boolean; email?: string }>
  /** open an existing file, routing to the right module by extension */
  openHelp(): Promise<void>
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
  /** a blank .txt in the default folder, opened in the markdown module as plain source */
  newTxt(opts?: NewFileOpts & { projectId?: string }): Promise<void>
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
<<<<<<< ours
  /** UniWork account status (desktop session sync TBD; Sign-in opens the UniWork web link) */
=======
  /** whether the launch and periodic background update checks run (default on) */
  getAutoUpdateCheck(): Promise<boolean>
  setAutoUpdateCheck(on: boolean): Promise<void>
  /** Genspark account status (gsk login state; to be upgraded to a signup/account system later) */
>>>>>>> theirs
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
  /** whether long-idle background tabs release their renderer once many are open (default on) */
  getTabSleepEnabled(): Promise<boolean>
  setTabSleepEnabled(on: boolean): Promise<void>
  /** whether the documents open at the last close reopen at launch (default off) */
  getRestoreLastSession(): Promise<boolean>
  setRestoreLastSession(on: boolean): Promise<void>
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
<<<<<<< ours
=======
  /** whether anonymous usage statistics are enabled (default true in official builds) */
  getAnalyticsEnabled(): Promise<boolean>
  /** persist an explicit analytics opt-in or opt-out */
  setAnalyticsEnabled(enabled: boolean): Promise<boolean>
  /** name on comments and tracked changes; `value` is the stored override ('' = use `fallback`, the OS account) */
  getAuthorName(): Promise<AuthorNameSetting>
  /** persist; broadcasts 'app:author-name-changed' (the effective name) to all web contents */
  setAuthorName(value: string): Promise<AuthorNameSetting>
>>>>>>> theirs
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
  /** live model list advertised by a user-hosted endpoint, probed on the route its declared protocol speaks; empty when it cannot answer */
  getCustomModels(
    baseUrl: string,
    apiKey?: string,
    api?: AiCustomProtocol,
  ): Promise<CodexModelCatalog>
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
  /** UNI-2069: Ask UNI over the workspace's documents (shell main, device bearer); see askuni-api.ts */
  uniworkAskUni(req: AskUniRequest): Promise<AskUniResult>
  uniworkAskUniContext(): Promise<AskUniContext>
  /** UNI-2069 s4: open a citation (a document in the app, other kinds as the web page) */
  uniworkAskUniOpenCitation(req: AskUniOpenRequest): Promise<AskUniOpenResult>
  /** UNI-2076: Ask UNI v2 streamed answer (main holds the session, events to this window only) */
  askUniStream: AskUniV2Bridge['askUniStream']
  askUniStreamCancel: AskUniV2Bridge['askUniStreamCancel']
  onAskUniStreamEvent: AskUniV2Bridge['onAskUniStreamEvent']
  /** the public `ask_uni_stream` flag: v2 pane on, P1 pane off */
  askUniFlags: AskUniV2Bridge['askUniFlags']
  /** UNI-2076 s2: Ask UNI v2 conversation REST and picker lookups (main, device bearer) */
  askUniCapabilities: AskUniV2Bridge['askUniCapabilities']
  askUniConversations: AskUniV2Bridge['askUniConversations']
  askUniMessages: AskUniV2Bridge['askUniMessages']
  askUniRename: AskUniV2Bridge['askUniRename']
  askUniDelete: AskUniV2Bridge['askUniDelete']
  askUniFeedbackSet: AskUniV2Bridge['askUniFeedbackSet']
  askUniFeedbackClear: AskUniV2Bridge['askUniFeedbackClear']
  askUniLookup: AskUniV2Bridge['askUniLookup']
  uniworkListWorkspaces(): Promise<UniworkResult<UniworkWorkspaceRef[]>>
  uniworkListDocuments(query: UniworkDocListQuery): Promise<UniworkResult<UniworkDocListPage>>
  /** documents shared directly with me, aggregated across the selected org's workspaces (S17) */
  uniworkListSharedWithMe(query?: UniworkSharedQuery): Promise<UniworkResult<UniworkSharedPage>>
  /** DESKTOP-HOME: documents shared by the caller in one workspace (paged) */
  uniworkListSharedByMe(
    q: { workspaceId: string; cursor?: string; limit?: number } & UniworkListFilters,
  ): Promise<UniworkResult<UniworkDocListPage>>
  /** DESKTOP-HOME: archived documents in the workspace's trash (`archived=1`, paged) */
  uniworkListTrash(
    q: { workspaceId: string; cursor?: string; limit?: number } & UniworkListFilters,
  ): Promise<UniworkResult<UniworkDocListPage>>
  /** UNI-1961: the Documents home's "other sources" files (paged) */
  uniworkListSources(q: UniworkSourceListQuery): Promise<UniworkResult<UniworkSourceListPage>>
  /** UNI-1961: save one source file through the save dialog; `path` null = cancelled */
  uniworkDownloadSource(
    input: UniworkSourceDownloadInput,
  ): Promise<UniworkResult<{ path: string | null }>>
  /**
   * UNI-2068: the bulk bar's Download as one zip (or one plain file); the save dialog opens in
   * main. Absent on a main that predates it: the renderer then hides the action.
   */
  zipDownload?: ZipDownloadBridge
  /** UNI-1993: open a source row's file as a view-only tab (no document, no sync) */
  uniworkOpenSource(input: OpenSourceInput): Promise<SourceViewResult<OpenSourceValue>>
  /** UNI-1993: the tab chip's state of a path; null unless the path is a view-only source */
  uniworkSourceViewState(path: string): Promise<SourceViewState | null>
  /** UNI-1993: an explicit Save hit a view-only source path (the "view only" hint) */
  onUniworkSourceViewHint(cb: (payload: SourceViewHint) => void): () => void
  /** the document properties panel (S17); nulls where the server sends no value */
  uniworkDocumentProperties(documentId: string): Promise<UniworkResult<UniworkDocProperties>>
  /** S18: create a blank document (docx/xlsx/pptx) in a workspace/folder */
  uniworkCreateDocument(
    input: UniworkCreateDocInput,
  ): Promise<UniworkDocActionResult<UniworkDocSummary>>
  /** UNI-1953: create a UniNote (a page) in a workspace/folder; the app opens it on the web */
  uniworkCreatePage(
    input: UniworkCreatePageInput,
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
  /**
   * UNI-2052: the native dialog for a folder or several files, as a preflight
   * (null when cancelled). Absolute paths stay in main; the reply has none.
   */
  uniworkBatchUploadPick(input: BatchUploadPickInput): Promise<PreflightSDO | null>
  /** UNI-2052: preflights for dropped paths (`getPathForFile`): loose files first, then each folder */
  uniworkBatchUploadPreflight(input: BatchUploadPreflightInput): Promise<PreflightSDO[]>
  /** UNI-2052: start a preflight; the run is then followed through the progress push */
  uniworkBatchUploadStart(input: BatchUploadStartInput): Promise<BatchUploadStartResult>
  /** UNI-2052: progress of a run (one total, never one per file); returns an unsubscribe */
  onUniworkBatchUploadProgress(cb: (event: BatchUploadProgress) => void): () => void
  /** UNI-2052: abort a run; what already landed stays. An unknown run id is a no-op */
  uniworkBatchUploadCancel(runId: string): Promise<void>
  /** UNI-2052: run the retryable failures of a finished run again */
  uniworkBatchUploadRetry(runId: string): Promise<void>
  /** UNI-2052: the report was closed without retrying */
  uniworkBatchUploadDismiss(runId: string): Promise<void>
  /** UNI-2052: whether the server takes folders; false = only loose files go up (one by one) */
  uniworkBatchUploadFoldersAvailable(): Promise<boolean>
  /** S18: rename a document (the server keeps the title) */
  uniworkRenameDocument(
    documentId: string,
    name: string,
    /**
     * SD-D2: the web's first-save share. `shareWithWorkspace` adds `visibility: "workspace"` to the
     * same PATCH (manager of a not-yet-shared document only; main applies the rule), and an
     * unchanged title still sends it
     */
    options?: { shareWithWorkspace?: boolean },
  ): Promise<UniworkDocActionResult<UniworkDocSummary>>
  /** S18: archive a document (never a hard delete) */
  uniworkArchiveDocument(documentId: string): Promise<UniworkDocActionResult<UniworkDocSummary>>
  /**
   * UNI-2066: what trashing this folder would move (counts, and whether other
   * people's documents inside go back to their owners); needs manage on the folder
   */
  uniworkArchiveImpact(documentId: string): Promise<UniworkDocActionResult<UniworkArchiveImpact>>
  /** S18: restore an archived document */
  uniworkRestoreDocument(documentId: string): Promise<UniworkDocActionResult<UniworkDocSummary>>
  /**
   * UNI-2078: make a copy of a file document you can edit (workspace root, the source's access).
   * A 404 / 501 answers `endpointMissing: true` (the deployment has no copy route yet).
   */
  uniworkCopyDocument(
    input: UniworkCopyDocumentInput,
  ): Promise<UniworkDocActionResult<UniworkDocSummary>>
  /**
   * UNI-2078: delete a trashed document forever (manage or admin_scope; main re-checks the gate
   * and that the item is in the trash before any request). The value names the purged id.
   */
  uniworkPurgeDocument(documentId: string): Promise<UniworkDocActionResult<{ id: string }>>
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
  /** UNI-1961 (ARCHIVE-01): the workspace's Lưu trữ shelf, shelved_at newest first (paged) */
  uniworkListShelved(q: UniworkShelvedQuery): Promise<UniworkResult<UniworkDocListPage>>
  /** UNI-1961: Bỏ lưu trữ - the item and its same-batch descendants the caller manages */
  uniworkUnshelveDocument(
    documentId: string,
  ): Promise<UniworkDocActionResult<UniworkDocShelveResult>>
  /** UNI-1961: Chuyển vào thùng rác from Lưu trữ (any kind: file, page or folder) */
  uniworkTrashShelvedDocument(
    documentId: string,
  ): Promise<UniworkDocActionResult<UniworkDocSummary>>
  /** UNI-1961: Lưu trữ - shelve a live item the caller manages (the row ⋯; files and pages) */
  uniworkShelveDocument(documentId: string): Promise<UniworkDocActionResult<UniworkDocShelveResult>>
  /**
   * UNI-2047 B6: the caller's stars in one workspace (`favorited_at` on each row, newest star first,
   * paged). Only the type, the kind and the sort are read; an older server answers `not_found`.
   */
  uniworkListFavorites(
    q: { workspaceId: string; cursor?: string; limit?: number } & UniworkListFilters,
  ): Promise<UniworkResult<UniworkDocListPage>>
  /** UNI-2047 B6: Gắn sao (idempotent) */
  uniworkFavoriteDocument(
    documentId: string,
  ): Promise<UniworkDocActionResult<UniworkDocFavoriteResult>>
  /** UNI-2047 B6: Bỏ gắn sao (idempotent) */
  uniworkUnfavoriteDocument(
    documentId: string,
  ): Promise<UniworkDocActionResult<{ documentId: string }>>
  uniworkOpenDocument(documentId: string): Promise<UniworkResult<{ path: string }>>
  /**
   * UNI-2079: a notice's target. Opens like uniworkOpenDocument, then (with a commentId)
   * reveals that thread in the opened document, as a launch ticket does.
   */
  uniworkOpenDocumentAt(input: {
    documentId: string
    commentId?: string
  }): Promise<UniworkResult<{ path: string }>>
  uniworkDocStatus(path: string): Promise<UniworkDocStatus | null>
  uniworkActiveDocStatus(): Promise<UniworkDocStatus | null>
  onUniworkDocStatus(cb: (status: UniworkDocStatus) => void): () => void
  /** G5-06u: main asks for the queue popover of a path (Ctrl/Cmd+S with a pending save) */
  onUniworkQueuePopover(cb: (request: UniworkQueuePopoverRequest) => void): () => void
  uniworkSave(path: string): Promise<UniworkDocStatus | null>
  /** EL-1(b): "Sửa ở đây" - acquire (move_from_self when self_elsewhere); resolves with the new status */
  uniworkEditHere(path: string): Promise<UniworkDocStatus | null>
  /** Save a local copy of the bound working copy at `path` to a user-chosen path ("Lưu bản sao về máy"). */
  uniworkSaveLocalCopy?(path: string): Promise<boolean>
  uniworkResolveConflict(path: string): Promise<UniworkDocStatus | null>
  /** SAVE-01: main asks the shell renderer to open the first-save dialog for an unbound path */
  onUniworkFirstSaveOpen(cb: (request: { path: string }) => void): () => void
  /**
   * SAVE-01: the dialog's confirm - flush the editor, create the document in
   * My Folder (or the picked folder) and bind the tab to it in one call.
   */
  uniworkFirstSave(input: UniworkFirstSaveInput): Promise<UniworkDocActionResult<UniworkDocSummary>>
  /**
   * SAVE-01 r2 (S01-R1-6): acknowledge a firstSaveOpen push the moment the
   * SaveDialog opens. Without it File > Save on an unbound tab cannot tell a
   * live dialog from a dead renderer and would warn every time.
   */
  uniworkFirstSaveOpenAck(path: string): Promise<void>
  /** UNI-1959: main asks for the "Name the document" dialog of a blank document's first save */
  onUniworkFirstSaveName(cb: (request: UniworkFirstSaveNameRequest) => void): () => void
  /** UNI-1959: the dialog's verdict; main continues or drops the held save */
  uniworkFirstSaveNameAnswer(input: UniworkFirstSaveNameAnswer): Promise<void>
  /** UNI-1959: main took an ask back (its tab closed, its session ended): drop its dialog / queue slot */
  onUniworkFirstSaveNameDismiss(cb: (requestId: string) => void): () => void
  /** MYFOLDER-01 (Q3): ensure the caller's personal My Folder (dialog open) */
  uniworkEnsureMyFolder(workspaceId: string): Promise<UniworkResult<UniworkDocSummary>>
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
  openHelp: 'home:open-help',
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
  newTxt: 'home:new-txt',
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
  getAutoUpdateCheck: 'home:get-auto-update-check',
  setAutoUpdateCheck: 'home:set-auto-update-check',
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
  getTabSleepEnabled: 'home:get-tab-sleep-enabled',
  setTabSleepEnabled: 'home:set-tab-sleep-enabled',
  getRestoreLastSession: 'home:get-restore-last-session',
  setRestoreLastSession: 'home:set-restore-last-session',
  getMcpStatus: 'home:get-mcp-status',
  setMcpSettings: 'home:set-mcp-settings',
  getMcpLogs: 'home:get-mcp-logs',
  clearMcpLogs: 'home:clear-mcp-logs',
  openMcpLogFile: 'home:open-mcp-log-file',
<<<<<<< ours
=======
  getAnalyticsEnabled: 'home:get-analytics-enabled',
  setAnalyticsEnabled: 'home:set-analytics-enabled',
  getAuthorName: 'home:get-author-name',
  setAuthorName: 'home:set-author-name',
>>>>>>> theirs
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
  /** invoke(q) -> documents shared by me in one workspace (DESKTOP-HOME) */
  listSharedByMe: 'uniwork-doc:list-shared-by-me',
  /** invoke(q) -> archived documents in one workspace's trash (DESKTOP-HOME) */
  listTrash: 'uniwork-doc:list-trash',
  /** invoke(q) -> the Documents home's "other sources" files (UNI-1961) */
  listSources: 'uniwork-doc:list-sources',
  /** invoke(input) -> save one source file through the save dialog (UNI-1961) */
  downloadSource: 'uniwork-doc:download-source',
  /** invoke(documentId) -> the properties panel of one document */
  documentProperties: 'uniwork-doc:document-properties',
  /** invoke(input) -> create a blank document (S18) */
  createDocument: 'uniwork-doc:create-document',
  /** invoke(input) -> create a UniNote page (UNI-1953) */
  createPage: 'uniwork-doc:create-page',
  /** invoke() -> the native open dialog's pick, or null when cancelled (S18) */
  pickUploadFile: 'uniwork-doc:pick-upload-file',
  /** invoke(input) -> upload a local file as one document (S18) */
  uploadDocument: 'uniwork-doc:upload-document',
  /** push -> upload bytes sent of the total (S18) */
  uploadProgress: 'uniwork-doc:upload-progress',
  /** invoke(uploadId) -> abort a running upload; an unknown/finished id is a no-op (S18) */
  cancelUpload: 'uniwork-doc:cancel-upload',
  /** invoke(input) -> the native dialog's pick as a folder / files preflight, or null when cancelled (UNI-2052) */
  batchUploadPick: 'uniwork-doc:batch-upload-pick',
  /** invoke(input) -> preflights for dropped absolute paths: one for the loose files, one per directory (UNI-2052) */
  batchUploadPreflight: 'uniwork-doc:batch-upload-preflight',
  /** invoke(input) -> start a preflight; answers the run id (UNI-2052) */
  batchUploadStart: 'uniwork-doc:batch-upload-start',
  /** push -> progress of a folder / files upload run (UNI-2052) */
  batchUploadProgress: 'uniwork-doc:batch-upload-progress',
  /** invoke(runId) -> abort a run; what already landed stays (UNI-2052) */
  batchUploadCancel: 'uniwork-doc:batch-upload-cancel',
  /** invoke(runId) -> run the retryable failures of a finished run again (UNI-2052) */
  batchUploadRetry: 'uniwork-doc:batch-upload-retry',
  /** invoke(runId) -> the report was closed without retrying: let the run go (UNI-2052) */
  batchUploadDismiss: 'uniwork-doc:batch-upload-dismiss',
  /** invoke() -> whether the server takes folders (it sent a folder_upload limits block) (UNI-2052) */
  batchUploadFoldersAvailable: 'uniwork-doc:batch-upload-folders-available',
  /** invoke(documentId, name) -> rename (S18) */
  renameDocument: 'uniwork-doc:rename-document',
  /** invoke(documentId) -> archive (S18; there is no delete) */
  archiveDocument: 'uniwork-doc:archive-document',
  /** invoke(documentId) -> the impact of trashing a folder (UNI-2066) */
  archiveImpact: 'uniwork-doc:archive-impact',
  /** invoke(documentId) -> restore an archived document (S18) */
  restoreDocument: 'uniwork-doc:restore-document',
  /** invoke({ documentId, title?, idempotencyKey? }) -> a plain copy of a file document (UNI-2078) */
  copyDocument: 'uniwork-doc:copy-document',
  /** invoke(documentId) -> delete a trashed document forever (UNI-2078) */
  purgeDocument: 'uniwork-doc:purge-document',
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
  /** invoke({ documentId, commentId? }) -> open, then reveal the comment thread (UNI-2079) */
  openDocumentAt: 'uniwork-doc:open-document-at',
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
  /**
   * SAVE-01: main -> shell renderer: the active tab is not bound and asks to
   * save to UniWork - open the name/target SaveDialog for it ({ path })
   */
  firstSaveOpen: 'uniwork-doc:first-save-open',
  /**
   * SAVE-01: invoke(UniworkFirstSaveInput) -> create + bind in one call;
   * UniworkDocActionResult<UniworkDocSummary>
   */
  firstSave: 'uniwork-doc:first-save',
  /**
   * SAVE-01 r2 (S01-R1-6): invoke(path) — the renderer acknowledges it opened
   * the SaveDialog for a firstSaveOpen push. No ack within main's window means
   * no dialog is up and File > Save warns instead of reporting a phantom save.
   */
  firstSaveOpenAck: 'uniwork-doc:first-save-open-ack',
  /**
   * UNI-1959: main -> shell renderer: open "Name the document" for the first
   * save of a blank-created document (UniworkFirstSaveNameRequest)
   */
  firstSaveName: 'uniwork-doc:first-save-name',
  /** UNI-1959: invoke(UniworkFirstSaveNameAnswer) - the dialog's verdict on a held save */
  firstSaveNameAnswer: 'uniwork-doc:first-save-name-answer',
  /** UNI-1959: main -> shell renderer: drop the dialog of this ask ({ requestId }) */
  firstSaveNameDismiss: 'uniwork-doc:first-save-name-dismiss',
  /** MYFOLDER-01 (Q3): invoke(workspaceId) -> the ensured My Folder row (DocumentSDO) */
  ensureMyFolder: 'uniwork-doc:ensure-my-folder',
  /** invoke(sessionId, action) -> UniworkConflictReply (G5-09) */
  conflictAct: 'uniwork-doc:conflict-act',
  /** invoke(path, action) -> the S6 bar action (later/close/retry/reload/reload-now) */
  remoteAction: 'uniwork-doc:remote-action',
  /** EL-1(b): invoke(path) -> "Sửa ở đây" acquire; UniworkDocStatus | null */
  editHere: 'uniwork-doc:edit-here',
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
  /** invoke(path) -> save the bound working copy to a user-chosen local path ("Lưu bản sao về máy") */
  saveLocalCopy: 'uniwork-doc:save-local-copy',
  /** invoke(q) -> the workspace's Lưu trữ shelf, shelved_at DESC (UNI-1961) */
  listShelved: 'uniwork-doc:list-shelved',
  /** invoke(documentId) -> Bỏ lưu trữ (UNI-1961) */
  unshelveDocument: 'uniwork-doc:unshelve-document',
  /** invoke(documentId) -> move a shelved item of any kind to the trash (UNI-1961) */
  trashShelvedDocument: 'uniwork-doc:trash-shelved-document',
  /** invoke(documentId) -> Lưu trữ a live item (UNI-1961) */
  shelveDocument: 'uniwork-doc:shelve-document',
  /** invoke(q) -> the caller's stars in one workspace, newest star first (UNI-2047 B6, SV-2) */
  listFavorites: 'uniwork-doc:list-favorites',
  /** invoke(documentId) -> Gắn sao (UNI-2047 B6; idempotent) */
  favoriteDocument: 'uniwork-doc:favorite-document',
  /** invoke(documentId) -> Bỏ gắn sao (UNI-2047 B6; idempotent) */
  unfavoriteDocument: 'uniwork-doc:unfavorite-document',
} as const

/**
 * UNI-2047 APP-SHARE-DIALOG: the Share dialog's channels (handlers in
 * main/uniwork-docs/share-service.ts, wired in wiring.ts; the renderer-facing
 * types are shared/share-api.ts). Every channel answers a `ShareResult`.
 */
export const UNIWORK_SHARE_CHANNELS = {
  /** invoke(documentId) -> the access overview (`GET /documents/{id}/shares`) */
  get: 'uniwork-share:get',
  /** invoke({documentId, items, dryRun?}) -> add / change / remove access, or its preview */
  update: 'uniwork-share:update',
  /** invoke({documentId, q?, cursor?, limit?}) -> people / workspaces / organization to share with */
  candidates: 'uniwork-share:candidates',
  /** invoke({documentId, expiresInDays?}) -> a new public link (token + url once) */
  linkCreate: 'uniwork-share:link-create',
  /** invoke({documentId, linkId}) -> revoke a public link */
  linkRevoke: 'uniwork-share:link-revoke',
  /** invoke() -> the selected organization's public-links policy (read only) */
  settings: 'uniwork-share:settings',
  /** invoke(documentId) -> the pending access requests (null value = no such route) */
  requests: 'uniwork-share:requests',
  /** invoke({documentId, requestId, level?}) -> approve a request */
  requestApprove: 'uniwork-share:request-approve',
  /** invoke({documentId, requestId}) -> decline a request */
  requestDecline: 'uniwork-share:request-decline',
  /** invoke(plan) -> share several documents the same way, one after another */
  bulk: 'uniwork-share:bulk',
  /** invoke({documentId, reason}) -> open a 24 h emergency (break-glass) grant */
  breakGlassGrant: 'uniwork-share:break-glass-grant',
  /** invoke({documentId, grantId}) -> end one emergency grant */
  breakGlassRevoke: 'uniwork-share:break-glass-revoke',
  /** invoke({cursor?, limit?}) -> one page of the selected organization's members */
  members: 'uniwork-share:members',
  /** UNI-2078: invoke(documentId) -> the people who may take the document */
  ownerCandidates: 'uniwork-share:owner-candidates',
  /** UNI-2078: invoke({documentId, userId, previousOwnerLevel?}) -> transfer the ownership */
  transferOwner: 'uniwork-share:owner-transfer',
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
