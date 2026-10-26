import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'
import type {
  DriveFile,
  DriveHistoryEvent,
  UniworkDriveErrorCode,
  UniworkDriveResult,
} from '../../../shared/home-api'
import type { WorkWebTarget } from '../../../shared/uniwork-work-api'
import { useI18n, type StringKey } from '../locale'
import { ActionModal } from '../UniworkDocActions'
import { formatFullWhen } from '../uniwork-docs-model'
import { DriveFileIcon, formatDriveAccessBadge, getDriveBridge, openDriveWeb } from './DriveList'
import {
  driveActivityRows,
  driveCreationRows,
  driveErrorKey,
  driveTypeLabel,
  formatDriveDay,
  reboundByName,
  showRebind,
  viewerAccessOf,
  viewerLocksUni,
  viewerNeedsWeb,
} from './drive-panel-model'

/** where a hand-off to the web opens: the workspace the list shows (slugs are '' when unknown) */
export interface DriveWebBase {
  orgSlug: string
  wsSlug: string
}

type Detail =
  | { status: 'loading' }
  | { status: 'ready'; file: DriveFile }
  | { status: 'notfound' }
  | { status: 'error'; error: UniworkDriveErrorCode }

type History =
  | { status: 'loading' }
  | { status: 'ready'; events: readonly DriveHistoryEvent[] }
  | { status: 'error'; error: UniworkDriveErrorCode }

type DriveCall<T> = (input: {
  workspaceId: string
  driveFileId: string
}) => Promise<UniworkDriveResult<T>>

/** one bridge call; a bridge without it, or one that throws, reads as a network failure */
async function callDrive<T>(
  pick: (bridge: NonNullable<ReturnType<typeof getDriveBridge>>) => DriveCall<T> | undefined,
  workspaceId: string,
  driveFileId: string,
): Promise<UniworkDriveResult<T>> {
  const bridge = getDriveBridge()
  const fn = bridge ? pick(bridge) : undefined
  if (!bridge || typeof fn !== 'function') return { ok: false, error: 'network' }
  try {
    return await fn.call(bridge, { workspaceId, driveFileId })
  } catch {
    return { ok: false, error: 'network' }
  }
}

/** the file 4.2 and its history, read when the panel opens, on a retry and when the window refocuses */
function useDriveDetail(
  workspaceId: string,
  driveFileId: string,
  onFeatureDisabled: () => void,
  onGone: () => void,
) {
  const [detail, setDetail] = useState<Detail>({ status: 'loading' })
  const [history, setHistory] = useState<History>({ status: 'loading' })
  const [tick, setTick] = useState(0)
  const seqRef = useRef(0)
  const featureRef = useRef(onFeatureDisabled)
  featureRef.current = onFeatureDisabled
  const goneRef = useRef(onGone)
  goneRef.current = onGone

  // another file starts from the loading state; a refresh of the same file keeps what it shows
  const shownRef = useRef(driveFileId)
  if (shownRef.current !== driveFileId) {
    shownRef.current = driveFileId
    setDetail({ status: 'loading' })
    setHistory({ status: 'loading' })
  }

  useEffect(() => {
    const onFocus = () => setTick((n) => n + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => {
    const seq = ++seqRef.current
    void callDrive<DriveFile>(
      (b) => b.getFile ?? b.uniworkDriveGetFile,
      workspaceId,
      driveFileId,
    ).then((res) => {
      if (seqRef.current !== seq) return
      if (res.ok) {
        setDetail({ status: 'ready', file: res.value })
        return
      }
      if (res.error === 'feature_disabled') {
        featureRef.current()
        return
      }
      if (res.error === 'not_found') {
        setDetail({ status: 'notfound' })
        goneRef.current()
        return
      }
      // a refresh that fails keeps the file that is already on screen
      setDetail((prev) => (prev.status === 'ready' ? prev : { status: 'error', error: res.error }))
    })
    void callDrive<DriveHistoryEvent[]>(
      (b) => b.getHistory ?? b.uniworkDriveGetHistory,
      workspaceId,
      driveFileId,
    ).then((res) => {
      if (seqRef.current !== seq) return
      if (res.ok) setHistory({ status: 'ready', events: res.value })
      else
        setHistory((prev) =>
          prev.status === 'ready' ? prev : { status: 'error', error: res.error },
        )
    })
  }, [workspaceId, driveFileId, tick])

  const retry = useCallback(() => {
    setDetail((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }))
    setHistory((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }))
    setTick((n) => n + 1)
  }, [])
  const refresh = useCallback(() => setTick((n) => n + 1), [])

  return { detail, history, retry, refresh }
}

/**
 * The confirm dialog of "Unlink" (spec §7.7): the exact web copy, focus on Keep (the safe choice),
 * one unlink in flight, and a refusal stays in the dialog with its mapped sentence.
 */
function UnlinkConfirm({
  count,
  onConfirm,
  onCancel,
}: {
  count: number
  onConfirm: () => Promise<UniworkDriveErrorCode | null>
  onCancel: () => void
}) {
  const { t } = useI18n()
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<StringKey | null>(null)
  // one in-flight unlink at a time, even before React re-renders the busy button
  const sending = useRef(false)

  const cancel = () => {
    if (!busy) onCancel()
  }

  const confirm = async () => {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      const failed = await onConfirm()
      if (failed) setError(driveErrorKey(failed))
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const title =
    count <= 0
      ? t('uhDriveUnlinkConfirmTitleNone')
      : t(count === 1 ? 'uhDriveUnlinkConfirmTitleOne' : 'uhDriveUnlinkConfirmTitle', { count })

  return (
    <ActionModal
      labelledBy={`${id}-title`}
      describedBy={`${id}-desc`}
      onCancel={cancel}
      initialFocus="[data-drive-unlink-keep]"
    >
      <h3 id={`${id}-title`} className="uw-act-heading">
        {title}
      </h3>
      <p id={`${id}-desc`}>{t('uhDriveUnlinkConfirmBody')}</p>
      {error && (
        <p role="alert" className="uw-act-error" data-drive-unlink-error="">
          {t(error)}
        </p>
      )}
      <div className="modal-buttons">
        <button
          type="button"
          className="btn btn-secondary"
          data-drive-unlink-keep=""
          onClick={cancel}
        >
          {t('uhDriveUnlinkConfirmKeep')}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          data-drive-unlink-confirm=""
          aria-disabled={busy || undefined}
          aria-busy={busy || undefined}
          onClick={() => void confirm()}
        >
          {busy ? t('uhDriveUnlinkConfirmWorking') : t('uhDriveUnlinkConfirmSubmit')}
        </button>
      </div>
    </ActionModal>
  )
}

export interface DrivePanelProps {
  workspaceId: string
  /** the row the panel was opened from: names the panel while the detail loads */
  row: DriveFile
  web: DriveWebBase | null
  /** the panel takes focus once on open (keyboard selection); a click leaves focus on the row */
  autoFocus?: boolean
  onClose: () => void
  onOpenOnGoogle: (driveFileId: string) => void
  /** the file was unlinked: the host closes the panel, reads the list and the counts again */
  onUnlinked: () => void
  /** the org turned the connector off mid-session */
  onFeatureDisabled: () => void
  /** the file is gone (404): the host reads the list again */
  onGone: () => void
}

/**
 * The right-hand detail panel of one Google Drive file in Documents (spec §17.3, 4.2 on the app),
 * laid out like `UniworkDocInfoPanel`. It reads 4.2 and the audit history, opens Google through
 * the D1 bridge (ids only), unlinks after a confirm, and hands everything that needs a browser
 * (create tasks, ask UNI, re-link, grant access, reconnect, a task) to the web through `openWeb`.
 */
export function DrivePanel({
  workspaceId,
  row,
  web,
  autoFocus = false,
  onClose,
  onOpenOnGoogle,
  onUnlinked,
  onFeatureDisabled,
  onGone,
}: DrivePanelProps) {
  const { t, dateLocale } = useI18n()
  const uid = useId().replace(/:/g, '')
  const titleId = `dh-drive-panel-title-${uid}`
  const warnId = `dh-drive-panel-warn-${uid}`
  const viewerId = `dh-drive-panel-viewer-${uid}`
  const headingRef = useRef<HTMLHeadingElement>(null)
  const createdRef = useRef<HTMLDivElement>(null)
  const { detail, history, retry, refresh } = useDriveDetail(
    workspaceId,
    row.id,
    onFeatureDisabled,
    onGone,
  )
  const [warn, setWarn] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const file = detail.status === 'ready' ? detail.file : null

  // a new file starts without the re-create warning of the last one
  useEffect(() => {
    setWarn(false)
    setConfirming(false)
  }, [row.id])

  useEffect(() => {
    if (autoFocus) headingRef.current?.focus()
    // focus moves once, when the panel opens for a file
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id])

  const handOff = (build: (base: DriveWebBase) => WorkWebTarget) => {
    if (!web || !web.orgSlug || !web.wsSlug) return
    void openDriveWeb(build(web))
  }
  const webReady = Boolean(web?.orgSlug && web?.wsSlug)
  const openFileOnWeb = (action?: 'propose' | 'ask') =>
    handOff((base) => ({
      kind: 'drive-file',
      orgSlug: base.orgSlug,
      wsSlug: base.wsSlug,
      id: row.id,
      ...(action ? { action } : {}),
    }))
  const openTask = (taskId: string) =>
    handOff((base) => ({ kind: 'task', orgSlug: base.orgSlug, wsSlug: base.wsSlug, id: taskId }))
  const openConnect = () =>
    handOff((base) => ({ kind: 'drive-connect', orgSlug: base.orgSlug, wsSlug: base.wsSlug }))

  const tasksCreatedCount = file?.tasksCreated?.count ?? 0

  const onCreateTasks = () => {
    if (tasksCreatedCount > 0 && !warn) {
      setWarn(true)
      return
    }
    openFileOnWeb('propose')
  }

  const showCreated = () => {
    const block = createdRef.current
    block?.scrollIntoView?.({ block: 'nearest' })
    block?.querySelector<HTMLElement>('[data-drive-created-title]')?.focus()
  }

  const unlink = async (): Promise<UniworkDriveErrorCode | null> => {
    const res = await callDrive<null>((b) => b.unlink ?? b.uniworkDriveUnlink, workspaceId, row.id)
    if (res.ok) {
      setConfirming(false)
      onUnlinked()
      return null
    }
    if (res.error === 'feature_disabled') {
      setConfirming(false)
      onFeatureDisabled()
      return null
    }
    return res.error
  }

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || confirming || event.nativeEvent.isComposing) return
    event.preventDefault()
    onClose()
  }

  const name = file?.name ?? row.name
  const iconKind = file?.iconKind ?? row.iconKind

  return (
    <aside
      className="dh-drive-panel"
      data-drive-panel=""
      aria-labelledby={titleId}
      aria-busy={detail.status === 'loading'}
      onKeyDown={onPanelKeyDown}
    >
      <div className="dh-drive-panel-head">
        <DriveFileIcon iconKind={iconKind} size={28} />
        <div className="dh-drive-panel-heading">
          <h4
            className="dh-drive-panel-title"
            id={titleId}
            ref={headingRef}
            tabIndex={-1}
            data-drive-panel-title=""
          >
            {name}
          </h4>
          {file && (
            <p className="dh-drive-panel-sub" data-drive-panel-sub="">
              {driveTypeLabel(file.iconKind, t)}
              {file.driveModifiedAt
                ? ` · ${
                    file.driveModifiedByDisplay
                      ? t('uhDriveModifiedBy', {
                          name: file.driveModifiedByDisplay,
                          when: formatFullWhen(file.driveModifiedAt, dateLocale),
                        })
                      : t('uhDriveModifiedAt', {
                          when: formatFullWhen(file.driveModifiedAt, dateLocale),
                        })
                  }`
                : ''}
            </p>
          )}
        </div>
        <button
          type="button"
          className="uw-pick-close"
          data-drive-panel-close=""
          aria-label={t('uhDrivePanelClose')}
          onClick={onClose}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M3 3l8 8M11 3l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {detail.status === 'loading' && (
        <div className="uw-info-skeleton" role="status" data-drive-panel-loading="">
          <span className="uw-sr-only">{t('uwPickLoading')}</span>
          {[0, 1, 2, 3, 4].map((i) => (
            <span className="uw-skel uw-skel-line" key={i} aria-hidden="true" />
          ))}
        </div>
      )}

      {detail.status === 'error' && (
        <div className="uw-info-error" role="alert" data-drive-panel-error="">
          <p>{t(driveErrorKey(detail.error))}</p>
          <button type="button" className="btn btn-secondary" onClick={retry}>
            {t('acctRetry')}
          </button>
        </div>
      )}

      {detail.status === 'notfound' && (
        <div className="uw-info-error" role="alert" data-drive-panel-notfound="">
          <p>{t('uhDriveNotFound')}</p>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('uhDrivePanelClose')}
          </button>
        </div>
      )}

      {file && (
        <PanelBody
          file={file}
          history={history}
          warn={warn}
          warnId={warnId}
          viewerId={viewerId}
          webReady={webReady}
          createdRef={createdRef}
          onOpenOnGoogle={() => onOpenOnGoogle(file.id)}
          onCreateTasks={onCreateTasks}
          onAsk={() => openFileOnWeb('ask')}
          onShowCreated={showCreated}
          onOpenFileOnWeb={() => openFileOnWeb()}
          onConnect={openConnect}
          onOpenTask={openTask}
          onUnlink={() => setConfirming(true)}
          onRetryHistory={refresh}
        />
      )}

      {confirming && file && (
        <UnlinkConfirm
          count={Math.max(file.usedInCount, file.usedInTasks.length)}
          onConfirm={unlink}
          onCancel={() => setConfirming(false)}
        />
      )}
    </aside>
  )
}

function PanelBody({
  file,
  history,
  warn,
  warnId,
  viewerId,
  webReady,
  createdRef,
  onOpenOnGoogle,
  onCreateTasks,
  onAsk,
  onShowCreated,
  onOpenFileOnWeb,
  onConnect,
  onOpenTask,
  onUnlink,
  onRetryHistory,
}: {
  file: DriveFile
  history: History
  warn: boolean
  warnId: string
  viewerId: string
  webReady: boolean
  createdRef: RefObject<HTMLDivElement | null>
  onOpenOnGoogle: () => void
  onCreateTasks: () => void
  onAsk: () => void
  onShowCreated: () => void
  onOpenFileOnWeb: () => void
  onConnect: () => void
  onOpenTask: (taskId: string) => void
  onUnlink: () => void
  onRetryHistory: () => void
}) {
  const { t, dateLocale } = useI18n()
  const access = viewerAccessOf(file)
  const locked = viewerLocksUni(access)
  const rebound = reboundByName(file)
  const badge = formatDriveAccessBadge(file, t)
  const viewerEmail = file.viewerAccountEmail?.trim() ?? ''
  const usedCount = Math.max(file.usedInCount, file.usedInTasks.length)
  const creations = driveCreationRows(file.taskCreations, t, dateLocale)
  const owner = file.ownerDisplay?.trim() || '—'
  const linkedDay = formatDriveDay(file.createdAt, dateLocale)
  const linkedBy = [file.createdByName?.trim(), linkedDay].filter(Boolean).join(' · ') || '—'
  const lastDay = formatDriveDay(file.tasksCreated?.lastCreatedAt, dateLocale)
  const lastBy = file.tasksCreated?.lastCreatedByName?.trim() ?? ''
  const warning =
    lastDay && lastBy
      ? t('uhDriveRecreateWarning', { count: file.tasksCreated.count, date: lastDay, name: lastBy })
      : t('uhDriveRecreateWarningShort', { count: file.tasksCreated.count })
  const webAttrs = { disabled: !webReady, 'aria-disabled': !webReady || undefined }

  const lockedAttrs = (enabled: boolean) => ({
    'aria-disabled': !enabled || undefined,
    'aria-describedby': locked ? viewerId : undefined,
    'data-drive-locked': locked || undefined,
  })

  return (
    <div className="dh-drive-panel-body">
      <div className="dh-drive-panel-actions">
        <button
          type="button"
          className="btn btn-secondary dh-toolbar-btn"
          data-drive-panel-open=""
          onClick={onOpenOnGoogle}
        >
          {t('uhDriveOpenOnGoogle')}
        </button>
        {file.canPropose && (
          <button
            type="button"
            className="btn btn-primary dh-toolbar-btn"
            data-drive-panel-create=""
            {...lockedAttrs(webReady && !locked)}
            aria-describedby={warn ? warnId : locked ? viewerId : undefined}
            onClick={() => {
              if (locked || !webReady) return
              onCreateTasks()
            }}
          >
            {warn ? t('uhDriveRecreateContinue') : t('uhDriveCreateTasks')}
          </button>
        )}
        {file.canAsk && (
          <button
            type="button"
            className="btn btn-secondary dh-toolbar-btn"
            data-drive-panel-ask=""
            {...lockedAttrs(webReady && !locked)}
            onClick={() => {
              if (locked || !webReady) return
              onAsk()
            }}
          >
            {t('uhDriveAskUni')}
          </button>
        )}
      </div>

      {warn && (
        <div className="dh-drive-panel-warn" role="status" id={warnId} data-drive-recreate="">
          <p>{warning}</p>
          <button
            type="button"
            className="dh-drive-panel-link"
            data-drive-recreate-view=""
            onClick={onShowCreated}
          >
            {t('uhDriveRecreateView')}
          </button>
        </div>
      )}

      <dl className="dh-drive-panel-list">
        <div className="dh-drive-panel-row">
          <dt>{t('uhDriveFieldSource')}</dt>
          <dd>{`${t('uhNavGoogleDrive')} · ${driveTypeLabel(file.iconKind, t)}`}</dd>
        </div>
        <div className="dh-drive-panel-row" data-drive-bound="">
          <dt>{t('uhDriveBoundAccount')}</dt>
          <dd>
            {file.boundAccountEmail || '—'}
            {rebound && (
              <span className="dh-drive-panel-muted" data-drive-rebound="">
                {' '}
                {t('uhDriveReboundBy', { name: rebound })}
              </span>
            )}
          </dd>
        </div>
        <div className="dh-drive-panel-row" data-drive-viewer={access}>
          <dt>{t('uhDriveYouOpenWith')}</dt>
          <dd id={viewerId}>
            {access === 'granted' && (
              <>
                {viewerEmail || t('uhDriveViewerEmailMissing')}
                <span className="dh-drive-panel-note">{t('uhDriveOpensWithNote')}</span>
              </>
            )}
            {access === 'unknown' && (
              <>
                <strong className="dh-drive-panel-warn-title">
                  {t('uhDriveViewerUnknownTitle')}
                </strong>
                <span className="dh-drive-panel-note">
                  {t('uhDriveViewerUnknownBody', {
                    name: file.boundByName?.trim() || file.createdByName?.trim() || '—',
                  })}
                </span>
                <span className="dh-drive-panel-note">{t('uhDriveViewerUnknownHint')}</span>
              </>
            )}
            {access === 'lost' && (
              <span>{t('uhDriveViewerLost', { email: viewerEmail || '—' })}</span>
            )}
            {access === 'connection_lost' && (
              <span>{t('uhDriveViewerConnLost', { email: viewerEmail || '—' })}</span>
            )}
            {viewerNeedsWeb(access) && (
              <button
                type="button"
                className="btn btn-secondary dh-drive-panel-inline-btn"
                data-drive-grant={access === 'connection_lost' ? 'reconnect' : 'grant'}
                {...webAttrs}
                onClick={access === 'connection_lost' ? onConnect : onOpenFileOnWeb}
              >
                {access === 'connection_lost'
                  ? t('uhDriveReconnectAction')
                  : t('uhDriveGrantAccess')}
              </button>
            )}
          </dd>
        </div>
        <div className="dh-drive-panel-row">
          <dt>{t('uhDriveFieldOwner')}</dt>
          <dd>{owner}</dd>
        </div>
        <div className="dh-drive-panel-row">
          <dt>{t('uhDriveFieldLinkedBy')}</dt>
          <dd>{linkedBy}</dd>
        </div>
        <div className="dh-drive-panel-row">
          <dt>{t('uhDriveFieldPermissions')}</dt>
          <dd>
            {t('uhDrivePermissionsValue')}
            <span
              className={`dh-vis-badge dh-drive-badge dh-drive-badge-${badge.tone} dh-drive-panel-badge`}
            >
              {badge.label}
            </span>
          </dd>
        </div>
      </dl>

      <section className="dh-drive-panel-section" data-drive-used="">
        <h5 className="dh-drive-panel-h">{t('uhDriveUsedInTitle', { count: usedCount })}</h5>
        {file.usedInTasks.length === 0 ? (
          <p className="dh-drive-panel-muted">{t('uhDriveNotUsed')}</p>
        ) : (
          <ul className="dh-drive-panel-tasks">
            {file.usedInTasks.map((task) => (
              <li key={task.taskId}>
                <button
                  type="button"
                  className="dh-drive-panel-task"
                  data-drive-task={task.taskId}
                  {...webAttrs}
                  onClick={() => onOpenTask(task.taskId)}
                >
                  <span className="dh-drive-panel-task-id">{task.identifier}</span>
                  <span className="dh-drive-panel-task-title">{task.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {creations.length > 0 && (
        <section className="dh-drive-panel-section" data-drive-created="" ref={createdRef}>
          <h5 className="dh-drive-panel-h" tabIndex={-1} data-drive-created-title="">
            {t('uhDriveTasksCreatedTitle')}
          </h5>
          {creations.map((group) => (
            <div className="dh-drive-panel-group" key={group.key} data-drive-creation={group.key}>
              <p className="dh-drive-panel-group-label">{group.label}</p>
              <ul className="dh-drive-panel-tasks">
                {group.tasks.map((task) => (
                  <li key={task.taskId}>
                    <button
                      type="button"
                      className="dh-drive-panel-task"
                      data-drive-task={task.taskId}
                      {...webAttrs}
                      onClick={() => onOpenTask(task.taskId)}
                    >
                      <span className="dh-drive-panel-task-id">{task.identifier}</span>
                      <span className="dh-drive-panel-task-title">{task.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <section className="dh-drive-panel-section" data-drive-activity="">
        <h5 className="dh-drive-panel-h">{t('uhDriveActivityTitle')}</h5>
        {history.status === 'loading' && (
          <div role="status">
            <span className="uw-sr-only">{t('uwPickLoading')}</span>
            <span className="uw-skel uw-skel-line" aria-hidden="true" />
          </div>
        )}
        {history.status === 'error' && (
          <div className="dh-drive-panel-inline-error" role="alert">
            <p>{t(driveErrorKey(history.error))}</p>
            <button type="button" className="btn btn-secondary" onClick={onRetryHistory}>
              {t('acctRetry')}
            </button>
          </div>
        )}
        {history.status === 'ready' &&
          (() => {
            const rows = driveActivityRows(history.events, t, dateLocale)
            return rows.length === 0 ? (
              <p className="dh-drive-panel-muted">{t('uhDriveActivityEmpty')}</p>
            ) : (
              <ul className="dh-drive-panel-activity">
                {rows.map((r) => (
                  <li key={r.id} data-drive-activity-row="">
                    <span>{r.text}</span>
                    {r.when && <span className="dh-drive-panel-muted">{r.when}</span>}
                  </li>
                ))}
              </ul>
            )
          })()}
      </section>

      <div className="dh-drive-panel-foot">
        {showRebind(file) && (
          <button
            type="button"
            className="btn btn-secondary"
            data-drive-rebind=""
            {...webAttrs}
            onClick={onOpenFileOnWeb}
          >
            {t('uhDriveRebind')}
          </button>
        )}
        {file.canUnlink && (
          <button
            type="button"
            className="btn btn-secondary dh-drive-panel-unlink"
            data-drive-unlink=""
            onClick={onUnlink}
          >
            {t('uhDriveUnlink')}
          </button>
        )}
      </div>
    </div>
  )
}
