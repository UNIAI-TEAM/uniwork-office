import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import type {
  DriveConnection,
  DriveFile,
  DriveHistoryEvent,
  DriveIconKind,
  UniworkDriveErrorCode,
  UniworkDriveResult,
} from '../../../shared/home-api'
import type { WorkWebTarget } from '../../../shared/uniwork-work-api'
import { FileBadge } from '../FileBadge'
import { ListState } from '../doclist/ListState'
import { useI18n, type TFunc } from '../locale'
import { Chevron } from '../uniwork-folders/UniworkFolderTree'
import { driveErrorKey } from './drive-panel-model'
import {
  buildDriveSidebarState,
  fetchDocumentsHomeDriveFiles,
  fetchDriveAvailable,
  fetchDriveConnections,
  resolveDriveAccountFilter,
  type DocumentsHomeApiAdapter,
  type DriveAccountNavRow,
  type DriveSidebarState,
} from './documents-home-model'

/**
 * Google Drive brand mark (3-color triangle). Brand logo colors are fixed artwork,
 * never re-authored by UI chrome themes (CLAUDE.md rule 4 / spec §7.9).
 */
export function GoogleDriveGlyph({ className = 'dh-nav-icon' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.2 3 2 13.7l3.8 6.6L12 9.6z" fill="#0F9D58" />
      <path d="M15.8 3H8.2L12 9.6l2.1 3.6H22z" fill="#F4B400" />
      <path d="M22 13.2H9.9l-4.1 7.1h12.4z" fill="#4285F4" />
    </svg>
  )
}

/** Lucide `TriangleAlert` icon for disconnected account warnings (spec §7.9, §7.10). */
export function DriveTriangleAlertIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  )
}

/**
 * File-type icon for a Drive file row (`icon_kind` from the server SDO, spec §7.9).
 * Google Docs / Sheets / Slides use the shared Google file marks; Office / PDF / text / markdown
 * reuse `FileBadge` so no second icon set is introduced.
 */
export function DriveFileIcon({ iconKind, size = 24 }: { iconKind: DriveIconKind; size?: number }) {
  switch (iconKind) {
    case 'google_doc':
      return (
        <svg
          className="dh-drive-file-icon"
          data-icon-kind="google_doc"
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          aria-hidden="true"
        >
          <path d="M9 2h11l7 7v19a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#4285F4" />
          <path d="M20 2v5a2 2 0 0 0 2 2h5z" fill="#A1C2FA" />
          <rect x="11" y="14" width="12" height="1.8" rx=".5" fill="#fff" />
          <rect x="11" y="18" width="12" height="1.8" rx=".5" fill="#fff" />
          <rect x="11" y="22" width="8" height="1.8" rx=".5" fill="#fff" />
        </svg>
      )
    case 'google_sheet':
      return (
        <svg
          className="dh-drive-file-icon"
          data-icon-kind="google_sheet"
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          aria-hidden="true"
        >
          <path d="M9 2h11l7 7v19a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#0F9D58" />
          <path d="M20 2v5a2 2 0 0 0 2 2h5z" fill="#87CEAC" />
          <rect x="11" y="14" width="12" height="10" rx=".8" fill="#fff" />
          <path d="M11 17.4h12M11 20.6h12M15.6 14v10" stroke="#0F9D58" strokeWidth="1.2" />
        </svg>
      )
    case 'google_slide':
      return (
        <svg
          className="dh-drive-file-icon"
          data-icon-kind="google_slide"
          width={size}
          height={size}
          viewBox="0 0 32 32"
          fill="none"
          aria-hidden="true"
        >
          <path d="M9 2h11l7 7v19a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#F4B400" />
          <path d="M20 2v5a2 2 0 0 0 2 2h5z" fill="#FADA80" />
          <rect
            x="11.4"
            y="14.4"
            width="11.2"
            height="8.4"
            rx=".8"
            fill="none"
            stroke="#fff"
            strokeWidth="1.8"
          />
        </svg>
      )
    case 'docx':
    case 'xlsx':
    case 'pptx':
    case 'pdf':
      return (
        <span className="dh-drive-file-icon" data-icon-kind={iconKind}>
          <FileBadge ext={iconKind} size={size} />
        </span>
      )
    case 'markdown':
      return (
        <span className="dh-drive-file-icon" data-icon-kind="markdown">
          <FileBadge ext="md" size={size} />
        </span>
      )
    case 'text':
      return (
        <span className="dh-drive-file-icon" data-icon-kind="text">
          <FileBadge ext="txt" size={size} />
        </span>
      )
    case 'generic':
    default:
      return (
        <span className="dh-drive-file-icon" data-icon-kind={iconKind || 'generic'}>
          <FileBadge ext="file" size={size} />
        </span>
      )
  }
}

export function formatDriveAccessBadge(
  file: DriveFile,
  t: TFunc,
): { label: string; tone: 'private' | 'shared' | 'neutral' } {
  if (file.driveId) {
    return { label: t('uhDriveSharedDrive'), tone: 'neutral' }
  }
  switch (file.sharingState) {
    case 'private':
      return { label: t('uhDrivePrivate'), tone: 'private' }
    case 'shared': {
      if (typeof file.sharedUserCount === 'number' && file.sharedUserCount > 0) {
        return {
          label: t(file.sharedUserCount === 1 ? 'uhDriveSharedCountOne' : 'uhDriveSharedCount', {
            count: file.sharedUserCount,
          }),
          tone: 'shared',
        }
      }
      return { label: t('uhDriveShared'), tone: 'shared' }
    }
    default:
      return { label: t('uhDriveAccessUnknown'), tone: 'neutral' }
  }
}

export function formatDriveUsedIn(file: DriveFile, t: TFunc): string {
  const first = file.usedInTasks[0]
  const total = Math.max(file.usedInCount, file.usedInTasks.length)
  if (!first || total === 0) {
    return t('uhDriveNotUsed')
  }
  const remaining = total - 1
  if (remaining <= 0) {
    return t('uhDriveUsedInSingle', { identifier: first.identifier })
  }
  return t(remaining === 1 ? 'uhDriveUsedInMoreOne' : 'uhDriveUsedInMore', {
    identifier: first.identifier,
    count: remaining,
  })
}

export function formatDriveTasksCreated(file: DriveFile, t: TFunc): string | null {
  const count = file.tasksCreated?.count ?? 0
  if (count <= 0) return null
  return t(count === 1 ? 'uhDriveTasksCreatedLineOne' : 'uhDriveTasksCreatedLine', { count })
}

type DriveTarget = { workspaceId: string; driveFileId: string }

export type DriveRendererBridge = DocumentsHomeApiAdapter & {
  openOnGoogle?: (input: DriveTarget) => Promise<UniworkDriveResult<null>>
  uniworkDriveOpenOnGoogle?: (input: DriveTarget) => Promise<UniworkDriveResult<null>>
  /** UNI-2196 (D3): the detail panel's reads and the unlink */
  getFile?: (input: DriveTarget) => Promise<UniworkDriveResult<DriveFile>>
  uniworkDriveGetFile?: (input: DriveTarget) => Promise<UniworkDriveResult<DriveFile>>
  unlink?: (input: DriveTarget) => Promise<UniworkDriveResult<null>>
  uniworkDriveUnlink?: (input: DriveTarget) => Promise<UniworkDriveResult<null>>
  getHistory?: (input: DriveTarget) => Promise<UniworkDriveResult<DriveHistoryEvent[]>>
  uniworkDriveGetHistory?: (input: DriveTarget) => Promise<UniworkDriveResult<DriveHistoryEvent[]>>
}

/**
 * Resolves the renderer Drive bridge (`window.uniworkDrive` or `window.aiOffice` aliases).
 */
export function getDriveBridge(): DriveRendererBridge | null {
  if (typeof window === 'undefined') return null
  if (window.uniworkDrive) return window.uniworkDrive
  if (window.aiOffice) return window.aiOffice as unknown as DriveRendererBridge
  return null
}

const WEB_HAND_OFF_DEDUPE_MS = 1000
let lastWebHandOff = { key: '', at: 0 }

/**
 * Hands a Drive step that needs a browser over to the web page through main's `openWeb`
 * (spec §17.4). Main builds the URL from the ids; the renderer never passes one.
 */
export function openDriveWeb(target: WorkWebTarget): Promise<boolean> {
  const work = typeof window === 'undefined' ? undefined : window.uniworkWork
  if (!work) return Promise.resolve(false)
  // D3-V2-1: the second click of a double-click must not open the same page twice
  const key = JSON.stringify(target)
  const now = Date.now()
  if (key === lastWebHandOff.key && now - lastWebHandOff.at < WEB_HAND_OFF_DEDUPE_MS) {
    return Promise.resolve(true)
  }
  lastWebHandOff = { key, at: now }
  try {
    return Promise.resolve(work.openWeb(target)).catch(() => false)
  } catch {
    return Promise.resolve(false)
  }
}

/**
 * Sidebar rows for Google Drive (spec §17.2, §7.6, prototype `Docs-List.dc.html`):
 * sits directly under "Thư mục của tôi" in the Folders section, with one child row
 * per connected account (`Drive: <email>`) and a `TriangleAlert` + "Mất kết nối"
 * marker when broken.
 */
export function DriveSidebarRows({
  state,
  active,
  selectedAccountId,
  expanded,
  onToggle,
  onSelect,
}: {
  state: DriveSidebarState
  active: boolean
  selectedAccountId: string | null
  /** the account rows are shown (the node's chevron is open) */
  expanded: boolean
  onToggle: () => void
  onSelect: (connectionId: string | null) => void
}) {
  const { t } = useI18n()
  const accountsId = useId()
  if (!state.visible) return null

  const isAllCurrent = active && selectedAccountId === null
  const hasAccounts = state.accounts.length > 0

  return (
    <div className="dh-drive-sidebar" data-drive-sidebar="">
      <div className="dh-drive-node">
        <button
          type="button"
          className={`dh-nav-item nav-item dh-drive-nav-root${isAllCurrent ? ' active' : ''}`}
          data-nav="google-drive"
          data-drive-account="all"
          aria-current={isAllCurrent ? 'page' : undefined}
          onClick={() => onSelect(null)}
        >
          <GoogleDriveGlyph className="dh-nav-icon dh-drive-brand-icon" />
          <span className="dh-nav-label">{t('uhNavGoogleDrive')}</span>
          <span className="dh-drive-nav-count" data-drive-total="">
            {state.totalCount}
          </span>
        </button>
        {/* a sibling of the row button (a button cannot hold a button); a node without accounts keeps the empty slot */}
        {hasAccounts && (
          <button
            type="button"
            className="uwf-twisty dh-drive-twisty"
            data-drive-toggle=""
            aria-expanded={expanded}
            aria-controls={expanded ? accountsId : undefined}
            aria-label={t('dlGroupToggle', { group: t('uhNavGoogleDrive') })}
            onClick={onToggle}
          >
            <Chevron expanded={expanded} />
          </button>
        )}
      </div>
      {hasAccounts && expanded && (
        <div id={accountsId} className="dh-drive-accounts" role="group">
          {state.accounts.map((acct: DriveAccountNavRow) => {
            const isCurrent = active && selectedAccountId === acct.id
            const label = t('uhNavDriveAccount', { email: acct.email })
            return (
              <button
                key={acct.id}
                type="button"
                className={`dh-nav-item nav-item dh-drive-nav-account${isCurrent ? ' active' : ''}`}
                data-drive-account={acct.id}
                aria-current={isCurrent ? 'page' : undefined}
                title={label}
                onClick={() => onSelect(acct.id)}
              >
                <span className="dh-nav-label">{label}</span>
                {acct.needsReconnect && (
                  <span className="dh-drive-nav-lost" data-drive-lost="">
                    <DriveTriangleAlertIcon className="dh-drive-warn-icon" />
                    <span>{t('uhDriveLost')}</span>
                  </span>
                )}
                <span className="dh-drive-nav-count" data-drive-account-count="">
                  {acct.linkedFileCount}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export interface DriveListProps {
  workspaceId: string
  connections: readonly DriveConnection[]
  selectedAccountId: string | null
  files: readonly DriveFile[]
  status: 'loading' | 'ready' | 'error'
  error?: UniworkDriveErrorCode
  offline: boolean
  nextCursor: string | null
  loadingMore: boolean
  moreError?: UniworkDriveErrorCode
  onRetry: () => void
  onLoadMore: () => void
  onOpenOnGoogle: (driveFileId: string) => void
  /** the row whose detail panel is open (UNI-2196, D3) */
  selectedFileId?: string | null
  /** a row was picked: a click or Space (`keyboard`) selects, a double click or Enter opens on Google */
  onSelect?: (driveFileId: string, via: 'pointer' | 'keyboard') => void
  /** Escape on a row closes the open panel */
  onClosePanel?: () => void
  /** the detail panel, drawn beside the table */
  panel?: ReactNode
  /** Web hand-off seams (UNI-2196, D3); disabled when omitted */
  onAddFromDrive?: (connectionId: string | null) => void
  onManageConnections?: () => void
  onReconnect?: (connectionId: string) => void
}

/** the five table columns; the loading skeleton reuses them so its cells line up with the header */
const DRIVE_COLUMNS = [
  { cls: 'dh-drive-col-name', key: 'uhDriveColName' },
  { cls: 'dh-drive-col-account', key: 'uhDriveColAccount' },
  { cls: 'dh-drive-col-access', key: 'uhDriveColAccess' },
  { cls: 'dh-drive-col-used', key: 'uhDriveColUsedIn' },
  { cls: 'dh-drive-col-tasks', key: 'uhDriveColTasksCreated' },
] as const

/** the sentence of a list-level Drive error; a missing file reads as the generic load error here */
function driveListErrorKey(error: UniworkDriveErrorCode | undefined) {
  return !error || error === 'not_found' ? 'uhDriveLoadError' : driveErrorKey(error)
}

/**
 * 4.1 Documents › Google Drive list table and states on the desktop app (spec §17.2, §7.6, §7.10).
 * Columns: Tên, Mở bằng tài khoản, Quyền trên Google Drive, Đang dùng ở, Đã tạo việc.
 * A click or Space on a row selects it (the detail panel opens, UNI-2196); a double click or Enter
 * calls `open-on-google` with `{ workspaceId, driveFileId }` only.
 */
export function DriveList({
  connections,
  selectedAccountId,
  files,
  status,
  error,
  offline,
  nextCursor,
  loadingMore,
  moreError,
  onRetry,
  onLoadMore,
  onOpenOnGoogle,
  selectedFileId = null,
  onSelect,
  onClosePanel,
  panel,
  onAddFromDrive,
  onManageConnections,
  onReconnect,
}: DriveListProps) {
  const { t } = useI18n()

  const resolvedAccountId = resolveDriveAccountFilter(selectedAccountId, connections)
  const selectedConnection = resolvedAccountId
    ? (connections.find((c) => c.id === resolvedAccountId) ?? null)
    : null
  const brokenAccount = Boolean(
    selectedConnection &&
    (selectedConnection.needsReconnect ||
      selectedConnection.status === 'needs_reconnect' ||
      Boolean(selectedConnection.authFailedAt)),
  )

  const addLabel = selectedConnection
    ? t('uhDriveAddFromAccount', { email: selectedConnection.googleEmail })
    : t('uhDriveAddFromDrive')
  const addDisabled = brokenAccount || !onAddFromDrive
  const manageDisabled = !onManageConnections

  const connectionById = new Map(connections.map((c) => [c.id, c]))

  const isOfflineState = offline && files.length === 0
  const isErrorState = !isOfflineState && status === 'error' && files.length === 0
  const isLoadingState = !isOfflineState && status === 'loading' && files.length === 0

  // a pick brings a stacked panel (below the list) into view; beside the list nothing scrolls
  const bodyRef = useRef<HTMLDivElement>(null)
  const [pickTick, setPickTick] = useState(0)
  const pick = (driveFileId: string, via: 'pointer' | 'keyboard') => {
    setPickTick((n) => n + 1)
    onSelect?.(driveFileId, via)
  }
  useEffect(() => {
    const body = bodyRef.current
    if (pickTick === 0 || !body || getComputedStyle(body).flexDirection !== 'column') return
    body.querySelector('[data-drive-panel]')?.scrollIntoView?.({ block: 'nearest' })
  }, [pickTick])

  const onRowKeyDown = (event: ReactKeyboardEvent<HTMLTableRowElement>, driveFileId: string) => {
    if (event.nativeEvent.isComposing) return
    if (event.repeat) return
    if (event.key === 'Escape' && selectedFileId && onClosePanel) {
      event.preventDefault()
      onClosePanel()
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ') return
    const target = event.target as HTMLElement | null
    if (target && target !== event.currentTarget && target.closest('button, a, input')) return
    event.preventDefault()
    if (event.key === ' ') pick(driveFileId, 'keyboard')
    else onOpenOnGoogle(driveFileId)
  }

  return (
    <div className={`dh-drive-view${panel ? ' has-panel' : ''}`} data-drive-view="">
      <div className="dh-drive-actions-bar">
        <button
          type="button"
          className="btn btn-secondary dh-toolbar-btn dh-drive-manage-btn"
          data-drive-manage=""
          disabled={manageDisabled}
          aria-disabled={manageDisabled || undefined}
          onClick={() => onManageConnections?.()}
        >
          {t('uhDriveManageConnections')}
        </button>
        {!brokenAccount && (
          <button
            type="button"
            className="btn btn-primary dh-toolbar-btn dh-drive-add-btn"
            data-drive-add=""
            disabled={addDisabled}
            aria-disabled={addDisabled || undefined}
            onClick={() => {
              if (addDisabled || !onAddFromDrive) return
              onAddFromDrive(resolvedAccountId)
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            {addLabel}
          </button>
        )}
      </div>

      <div className="dh-drive-body" ref={bodyRef}>
        <div className="dh-drive-main">
          {isLoadingState && (
            <div
              className="dh-drive-table-wrap uw-pick-skeleton dh-drive-skeleton"
              role="status"
              aria-busy="true"
              data-drive-loading=""
            >
              <span className="uw-sr-only">{t('uwPickLoading')}</span>
              <table className="dh-drive-table" aria-hidden="true">
                <thead>
                  <tr className="dh-drive-head-row">
                    {DRIVE_COLUMNS.map((col) => (
                      <th key={col.cls} className={`dh-drive-th ${col.cls}`}>
                        <span className="uw-skel dh-drive-skel-th" />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <tr className="dh-drive-row dh-drive-skel-row" key={i}>
                      <td className="dh-drive-td">
                        <span className="dh-drive-skel-name">
                          <span className="uw-skel uw-skel-icon" />
                          <span className="uw-skel uw-skel-line" />
                        </span>
                      </td>
                      <td className="dh-drive-td">
                        <span className="uw-skel uw-skel-line short" />
                      </td>
                      <td className="dh-drive-td">
                        <span className="uw-skel dh-drive-skel-pill" />
                      </td>
                      <td className="dh-drive-td">
                        <span className="uw-skel uw-skel-line short" />
                      </td>
                      <td className="dh-drive-td">
                        <span className="uw-skel dh-drive-skel-num" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {isOfflineState && (
            <ListState
              kind="error"
              glyph="error"
              title={t('uhDriveOffline')}
              action={{ label: t('acctRetry'), onClick: onRetry }}
            />
          )}

          {isErrorState && (
            <ListState
              kind="error"
              glyph="error"
              title={t(driveListErrorKey(error))}
              action={{ label: t('acctRetry'), onClick: onRetry }}
            />
          )}

          {!isLoadingState && !isOfflineState && !isErrorState && files.length === 0 && (
            <div className="dh-empty dh-drive-empty" role="status" data-drive-empty="">
              <p className="dh-drive-empty-title">{t('uhDriveEmpty')}</p>
            </div>
          )}

          {!isLoadingState && !isOfflineState && !isErrorState && files.length > 0 && (
            <>
              <div className="dh-drive-table-wrap">
                <table className="dh-drive-table" aria-label={t('uhNavGoogleDrive')}>
                  <thead>
                    <tr className="dh-drive-head-row">
                      {DRIVE_COLUMNS.map((col) => (
                        <th key={col.cls} scope="col" className={`dh-drive-th ${col.cls}`}>
                          {t(col.key)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((file) => {
                      const badge = formatDriveAccessBadge(file, t)
                      const viewerConnId = file.viewerConnectionId || file.connectionId
                      const viewerConn = viewerConnId ? connectionById.get(viewerConnId) : undefined
                      const rowNeedsReconnect =
                        file.viewerAccess === 'connection_lost' ||
                        file.boundConnectionLost === true ||
                        Boolean(
                          viewerConn &&
                          (viewerConn.needsReconnect ||
                            viewerConn.status === 'needs_reconnect' ||
                            Boolean(viewerConn.authFailedAt)),
                        )
                      const viewerEmail = file.viewerAccountEmail?.trim() ?? ''
                      // a row without the viewer's account says why, instead of a bare dash
                      const accountEmail = viewerEmail || t('uhDriveViewerEmailMissing')
                      const usedInText = formatDriveUsedIn(file, t)
                      const tasksCreatedText = formatDriveTasksCreated(file, t)

                      return (
                        <tr
                          key={file.id}
                          className={`dh-drive-row${selectedFileId === file.id ? ' is-selected' : ''}`}
                          data-drive-file-id={file.id}
                          aria-current={selectedFileId === file.id ? 'true' : undefined}
                          tabIndex={0}
                          onClick={() => pick(file.id, 'pointer')}
                          onDoubleClick={(e) => {
                            const target = e.target as HTMLElement | null
                            if (target && target.closest('button, a, input')) return
                            onOpenOnGoogle(file.id)
                          }}
                          onKeyDown={(e) => onRowKeyDown(e, file.id)}
                        >
                          <td className="dh-drive-td dh-drive-cell-name">
                            <div className="dh-drive-name-wrap">
                              <DriveFileIcon iconKind={file.iconKind} size={24} />
                              <span className="dh-drive-file-name" title={file.name}>
                                {file.name}
                              </span>
                            </div>
                          </td>
                          <td className="dh-drive-td dh-drive-cell-account">
                            <div className="dh-drive-account-stack">
                              <span
                                className={`dh-drive-account-email${viewerEmail ? '' : ' is-missing'}`}
                                title={accountEmail}
                              >
                                {accountEmail}
                              </span>
                              {rowNeedsReconnect &&
                                (onReconnect ? (
                                  <button
                                    type="button"
                                    className="dh-drive-reconnect-link"
                                    data-drive-reconnect={viewerConnId || file.connectionId}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onReconnect(viewerConnId || file.connectionId)
                                    }}
                                  >
                                    <DriveTriangleAlertIcon className="dh-drive-warn-icon" />
                                    <span>{t('uhDriveReconnect')}</span>
                                  </button>
                                ) : (
                                  <span
                                    className="dh-drive-reconnect-link dh-drive-reconnect-text"
                                    data-drive-reconnect={viewerConnId || file.connectionId}
                                  >
                                    <DriveTriangleAlertIcon className="dh-drive-warn-icon" />
                                    <span>{t('uhDriveReconnect')}</span>
                                  </span>
                                ))}
                            </div>
                          </td>
                          <td className="dh-drive-td dh-drive-cell-access">
                            <span
                              className={`dh-vis-badge dh-drive-badge dh-drive-badge-${badge.tone}`}
                              data-drive-access={badge.tone}
                            >
                              {badge.label}
                            </span>
                          </td>
                          <td className="dh-drive-td dh-drive-cell-used">{usedInText}</td>
                          <td className="dh-drive-td dh-drive-cell-tasks">{tasksCreatedText}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {moreError && (
                <div className="dh-drive-more-error-row" role="alert">
                  <p className="uw-pick-more-error">{t(driveListErrorKey(moreError))}</p>
                  <button
                    type="button"
                    className="btn btn-secondary dh-drive-retry-btn"
                    data-drive-retry=""
                    onClick={onRetry}
                  >
                    {t('acctRetry')}
                  </button>
                </div>
              )}

              {nextCursor && (
                <div className="dh-load-more-row">
                  <button
                    type="button"
                    className="btn btn-secondary uw-pick-more"
                    data-drive-load-more=""
                    disabled={loadingMore}
                    onClick={onLoadMore}
                  >
                    {loadingMore ? t('uwPickLoadingMore') : t('uhLoadMore')}
                  </button>
                </div>
              )}

              <p className="dh-drive-footnote">{t('uhDriveFootnote')}</p>
            </>
          )}
        </div>
        {panel}
      </div>
    </div>
  )
}

export interface UseDocumentsHomeDriveResult {
  sidebarState: DriveSidebarState
  selectedAccountId: string | null
  setSelectedAccountId: (accountId: string | null) => void
  selectedConnection: DriveConnection | null
  brokenAccount: boolean
  connections: readonly DriveConnection[]
  files: readonly DriveFile[]
  status: 'loading' | 'ready' | 'error'
  error?: UniworkDriveErrorCode
  offline: boolean
  nextCursor: string | null
  loadingMore: boolean
  moreError?: UniworkDriveErrorCode
  retry: () => void
  loadMore: () => void
  openOnGoogle: (driveFileId: string) => Promise<void>
}

/**
 * State and lifecycle hook for Google Drive in DocumentsHome (spec §17.2, §7.6, §7.10):
 * - Probes capability `drive_connector` + connections for the active workspace.
 * - Tracks whether the Drive row has been shown in this session so going offline keeps
 *   the row visible and renders the offline message ("Cần kết nối mạng…").
 * - Cold start offline: capability unread -> row stays hidden.
 * - Refreshes when the Drive row is opened, when the window regains focus, and after actions.
 */
export function useDocumentsHomeDrive({
  workspaceId,
  subView,
  listTick,
  onErrorToast,
  onFeatureDisabled,
}: {
  workspaceId: string
  subView: string
  listTick: number
  onErrorToast?: (error: UniworkDriveErrorCode) => void
  /** the org turned the connector off mid-session: the host leaves the Drive view */
  onFeatureDisabled?: () => void
}): UseDocumentsHomeDriveResult {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [capability, setCapability] = useState(false)
  const [connections, setConnections] = useState<readonly DriveConnection[]>([])
  // the viewer has linked files although no connection is left (a disconnected one): the row stays
  const [orphanFileCount, setOrphanFileCount] = useState(0)
  const [seenInSession, setSeenInSession] = useState(false)
  const seenInSessionRef = useRef(false)
  const [syncOnline, setSyncOnline] = useState<boolean>(true)
  const [networkFailed, setNetworkFailed] = useState(false)
  const [focusTick, setFocusTick] = useState(0)
  const [driveTick, setDriveTick] = useState(0)
  const onFeatureDisabledRef = useRef(onFeatureDisabled)
  onFeatureDisabledRef.current = onFeatureDisabled

  const [filesState, setFilesState] = useState<{
    status: 'loading' | 'ready' | 'error'
    files: DriveFile[]
    totalCount: number | null
    nextCursor: string | null
    loadingMore: boolean
    error?: UniworkDriveErrorCode
    moreError?: UniworkDriveErrorCode
  }>({
    status: 'loading',
    files: [],
    totalCount: null,
    nextCursor: null,
    loadingMore: false,
  })

  // Reset workspace-scoped account selection when workspace changes
  const prevWsRef = useRef(workspaceId)
  if (prevWsRef.current !== workspaceId) {
    prevWsRef.current = workspaceId
    setSelectedAccountId(null)
    setConnections([])
    setOrphanFileCount(0)
    setSeenInSession(false)
    seenInSessionRef.current = false
    setNetworkFailed(false)
    setFilesState({
      status: 'loading',
      files: [],
      totalCount: null,
      nextCursor: null,
      loadingMore: false,
    })
  }

  // Subscribe to SyncCenter online/offline snapshot if present
  useEffect(() => {
    const syncApi = typeof window !== 'undefined' ? window.uniworkSyncCenter : undefined
    if (!syncApi) return
    let cancelled = false
    if (typeof syncApi.getSnapshot === 'function') {
      void syncApi
        .getSnapshot()
        .then((snap) => {
          if (!cancelled && snap?.header) {
            setSyncOnline(snap.header.online !== false)
          }
        })
        .catch(() => undefined)
    }
    if (typeof syncApi.subscribe === 'function') {
      return syncApi.subscribe((snap) => {
        if (!cancelled && snap?.header) {
          setSyncOnline(snap.header.online !== false)
        }
      })
    }
    return () => {
      cancelled = true
    }
  }, [])

  // Refresh when the window regains focus (spec §17.1, §17.2)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onFocus = () => setFocusTick((n) => n + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const isDriveView = subView === 'google-drive'

  // Load capability + connections
  const connSeqRef = useRef(0)
  useEffect(() => {
    const seq = ++connSeqRef.current
    const bridge = getDriveBridge()
    if (!bridge) {
      setCapability(false)
      setConnections([])
      return
    }
    void (async () => {
      const avail = await fetchDriveAvailable(bridge)
      if (connSeqRef.current !== seq) return
      setCapability(avail)
      if (!avail) {
        // If we haven't seen the row in this session, don't fetch connections
        if (!seenInSessionRef.current) {
          setConnections([])
          return
        }
      }
      const res = await fetchDriveConnections(bridge, workspaceId)
      if (connSeqRef.current !== seq) return
      if (!res) return
      if (res.ok) {
        setNetworkFailed(false)
        const known = avail || seenInSessionRef.current
        // no connection: one file is enough to keep the Drive row (its connection may be disconnected)
        let linked = 0
        if (known && res.value.length === 0) {
          const probe = await fetchDocumentsHomeDriveFiles(bridge, {
            workspaceId,
            connectionId: null,
            limit: 1,
          })
          if (connSeqRef.current !== seq) return
          // a failed probe keeps the last good connections and count: the row neither blinks nor vanishes
          if (!probe.ok) return
          linked = probe.value.totalCount
        }
        // committed together, so the row does not blink while the probe is in flight
        setConnections(res.value)
        setOrphanFileCount(linked)
        if (known && (res.value.length > 0 || linked > 0)) {
          seenInSessionRef.current = true
          setSeenInSession(true)
        }
      } else if (res.error === 'network') {
        setNetworkFailed(true)
      } else if (res.error === 'feature_disabled') {
        setCapability(false)
        setConnections([])
        setOrphanFileCount(0)
        seenInSessionRef.current = false
        setSeenInSession(false)
        onFeatureDisabledRef.current?.()
      }
    })()
  }, [workspaceId, isDriveView, listTick, focusTick, driveTick])

  const resolvedAccountId = resolveDriveAccountFilter(selectedAccountId, connections)

  // Load files when Google Drive sub-view is open
  const filesSeqRef = useRef(0)
  const prevAccountRef = useRef<string | null>(resolvedAccountId)
  useEffect(() => {
    if (!isDriveView) return
    const seq = ++filesSeqRef.current
    const bridge = getDriveBridge()
    const accountChanged = prevAccountRef.current !== resolvedAccountId
    prevAccountRef.current = resolvedAccountId
    if (!syncOnline) {
      setNetworkFailed(true)
      setFilesState((prev) =>
        !accountChanged && prev.files.length > 0
          ? { ...prev, loadingMore: false, moreError: 'network' }
          : {
              status: 'error',
              files: [],
              totalCount: null,
              nextCursor: null,
              loadingMore: false,
              error: 'network',
            },
      )
      return
    }
    setFilesState((prev) => ({
      status: !accountChanged && prev.files.length > 0 ? prev.status : 'loading',
      files: accountChanged ? [] : prev.files,
      totalCount: prev.totalCount,
      nextCursor: accountChanged ? null : prev.nextCursor,
      loadingMore: false,
      moreError: undefined,
    }))
    void fetchDocumentsHomeDriveFiles(bridge, {
      workspaceId,
      connectionId: resolvedAccountId,
    }).then((res) => {
      if (filesSeqRef.current !== seq) return
      if (!res.ok && res.error === 'feature_disabled') onFeatureDisabledRef.current?.()
      if (res.ok) {
        setNetworkFailed(false)
        // A successful refresh replaces the list with page 1 (collapsing any cursor-loaded pages).
        setFilesState({
          status: 'ready',
          files: res.value.files,
          totalCount: resolvedAccountId === null ? res.value.totalCount : null,
          nextCursor: res.value.nextCursor,
          loadingMore: false,
        })
      } else {
        if (res.error === 'network') setNetworkFailed(true)
        setFilesState((prev) =>
          !accountChanged && prev.files.length > 0
            ? {
                ...prev,
                loadingMore: false,
                moreError: res.error,
              }
            : {
                status: 'error',
                files: [],
                totalCount: null,
                nextCursor: null,
                loadingMore: false,
                error: res.error,
              },
        )
      }
    })
  }, [workspaceId, isDriveView, resolvedAccountId, syncOnline, listTick, focusTick, driveTick])

  const loadMore = useCallback(() => {
    const cursor = filesState.nextCursor
    if (!isDriveView || !cursor || filesState.loadingMore || filesState.status !== 'ready') return
    const seq = filesSeqRef.current
    setFilesState((prev) => ({ ...prev, loadingMore: true, moreError: undefined }))
    const bridge = getDriveBridge()
    void fetchDocumentsHomeDriveFiles(bridge, {
      workspaceId,
      connectionId: resolvedAccountId,
      cursor,
    }).then((res) => {
      if (filesSeqRef.current !== seq) return
      if (!res.ok && res.error === 'feature_disabled') onFeatureDisabledRef.current?.()
      if (res.ok) {
        setFilesState((prev) => ({
          ...prev,
          files: [...prev.files, ...res.value.files],
          nextCursor: res.value.nextCursor,
          loadingMore: false,
        }))
      } else {
        setFilesState((prev) => ({
          ...prev,
          loadingMore: false,
          moreError: res.error,
        }))
      }
    })
  }, [
    isDriveView,
    filesState.nextCursor,
    filesState.loadingMore,
    filesState.status,
    workspaceId,
    resolvedAccountId,
  ])

  const retry = useCallback(() => {
    setNetworkFailed(false)
    setDriveTick((n) => n + 1)
  }, [])

  const onErrorToastRef = useRef(onErrorToast)
  onErrorToastRef.current = onErrorToast

  const openOnGoogle = useCallback(
    async (driveFileId: string) => {
      const bridge = getDriveBridge()
      const fn = bridge?.openOnGoogle ?? bridge?.uniworkDriveOpenOnGoogle
      if (typeof fn !== 'function') return
      try {
        const res = await fn.call(bridge, { workspaceId, driveFileId })
        if (res && !res.ok && res.error) {
          if (res.error === 'network') setNetworkFailed(true)
          if (res.error === 'feature_disabled') onFeatureDisabledRef.current?.()
          else onErrorToastRef.current?.(res.error)
        }
      } catch {
        setNetworkFailed(true)
        onErrorToastRef.current?.('network')
      }
      // Window focus handles refreshing when returning from the external browser; do not refetch here.
    },
    [workspaceId],
  )

  const offline = !syncOnline || networkFailed || filesState.error === 'network'

  const sidebarState = buildDriveSidebarState({
    capability,
    connections,
    totalCountOverride:
      resolvedAccountId === null
        ? (filesState.totalCount ?? (connections.length === 0 ? orphanFileCount : null))
        : null,
    hasLinkedFiles: orphanFileCount > 0,
    offline,
    seenInSession,
  })

  const selectedConnection = resolvedAccountId
    ? (connections.find((c) => c.id === resolvedAccountId) ?? null)
    : null
  const brokenAccount = Boolean(
    selectedConnection &&
    (selectedConnection.needsReconnect ||
      selectedConnection.status === 'needs_reconnect' ||
      Boolean(selectedConnection.authFailedAt)),
  )

  return {
    sidebarState,
    selectedAccountId: resolvedAccountId,
    setSelectedAccountId,
    selectedConnection,
    brokenAccount,
    connections,
    files: filesState.files,
    status: filesState.status,
    error: filesState.error,
    offline,
    nextCursor: filesState.nextCursor,
    loadingMore: filesState.loadingMore,
    moreError: filesState.moreError,
    retry,
    loadMore,
    openOnGoogle,
  }
}
