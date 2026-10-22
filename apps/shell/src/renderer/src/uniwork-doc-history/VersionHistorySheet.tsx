import { useEffect, useId, useRef, useState } from 'react'
import type { UniworkDocHistoryApi, DocVersion } from '../../../shared/doc-history-api'
import { DOC_VERSION_LABEL_MAX } from '../../../shared/doc-history-api'
import type { UniworkShareApi } from '../../../shared/share-api'
import { formatBytes } from '../doclist/format'
import { useI18n, type StringKey } from '../locale'
import { ActionModal } from '../UniworkDocActions'
import { useShareDirectory } from '../uniwork-share/use-share'
import { getDocHistoryBridge } from './bridge'
import { useDocVersions } from './use-doc-versions'
import { useFocusAfterLastPage } from './use-focus-after-last-page'
import {
  canWriteVersions,
  createErrorKey,
  formatWhen,
  newIntentKey,
  pageText,
  reasonKey,
  restoreRefusal,
  type VersionHistoryTarget,
} from './version-history-model'
import './version-history.css'

export interface VersionHistorySheetProps {
  open: boolean
  onClose: () => void
  /** the document: a list row satisfies it */
  row: VersionHistoryTarget
  /** the bridge; defaults to `window.uniworkDocHistory` (tests pass the in-memory fake) */
  bridge?: UniworkDocHistoryApi
  /** the member list the authors are named from; defaults to `window.uniworkShare` */
  shareApi?: UniworkShareApi
  /** a checkpoint or a restore landed: the list that opened the sheet reads its row again */
  onChanged?: () => void
}

/** no member list in this shell: every name stays unknown and the author line waits (web: not ready) */
const NO_MEMBERS: UniworkShareApi = {
  members: async () => ({ ok: false, error: 'network' }),
} as unknown as UniworkShareApi

/**
 * The web's Version history sheet (version-history-sheet.tsx) for the app: the server's
 * checkpoints newest first, a named checkpoint for who may edit, preview, download and a
 * confirmed restore. The history is the server's: nothing moves locally, the confirm stays
 * pending until the server answers, and a refusal keeps its sentence in place.
 */
export function VersionHistorySheet(props: VersionHistorySheetProps) {
  if (!props.open) return null
  return <VersionHistoryBody {...props} />
}

function VersionHistoryBody({
  onClose,
  row,
  bridge,
  shareApi,
  onChanged,
}: VersionHistorySheetProps) {
  const { t, dateLocale } = useI18n()
  const api = bridge ?? getDocHistoryBridge()
  if (!api) return null
  return (
    <VersionHistoryView
      api={api}
      shareApi={shareApi ?? (typeof window !== 'undefined' ? window.uniworkShare : undefined)}
      t={t}
      dateLocale={dateLocale}
      onClose={onClose}
      row={row}
      onChanged={onChanged}
    />
  )
}

type T = (key: StringKey, params?: Record<string, string | number>) => string

function VersionHistoryView({
  api,
  shareApi,
  t,
  dateLocale,
  onClose,
  row,
  onChanged,
}: {
  api: UniworkDocHistoryApi
  shareApi: UniworkShareApi | undefined
  t: T
  dateLocale: string
  onClose: () => void
  row: VersionHistoryTarget
  onChanged?: () => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const nameId = useId()
  const canWrite = canWriteVersions(row)
  const shelved = !!row.shelvedAt
  const list = useDocVersions(api, row.id, true)
  const directory = useShareDirectory(shareApi ?? NO_MEMBERS, true)
  const listRef = useRef<HTMLUListElement>(null)
  const markLoadMore = useFocusAfterLastPage(
    listRef,
    list.rows.length,
    list.hasMore,
    list.loadingMore,
  )

  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<StringKey | null>(null)
  const [notice, setNotice] = useState('')
  const createKey = useRef<string | null>(null)

  const [restoreTarget, setRestoreTarget] = useState<DocVersion | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<StringKey | null>(null)
  const restoreKey = useRef<string | null>(null)
  /** the version a restore made current; before any restore the newest row is */
  const [currentNo, setCurrentNo] = useState<number | null>(null)

  const [rowError, setRowError] = useState<StringKey | null>(null)
  const [busy, setBusy] = useState<{ kind: 'open' | 'download'; no: number } | null>(null)
  const [preview, setPreview] = useState<
    | { no: number; state: 'loading' }
    | { no: number; state: 'error' }
    | { no: number; state: 'ready'; text: string }
    | null
  >(null)
  const previewRequest = useRef(0)

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const authorName = (version: DocVersion): string | null => {
    if (!version.created_by) return null
    if (version.created_by_kind === 'system') return t('vhsAuthorSystem')
    if (directory.namesPending) return null
    const name = directory.userName(version.created_by)
    if (name) return name
    // an agent that is not a member keeps only its badge: no second "Agent" next to it
    return version.created_by_kind === 'agent' ? '' : t('vhsAuthorFormer')
  }

  const newestNo = list.rows[0]?.version
  const current = currentNo ?? newestNo

  const changeLabel = (next: string) => {
    setLabel(next)
    // a changed name is a new checkpoint intent: the next submit mints a key
    createKey.current = null
    setCreateError(null)
  }

  const submitName = async () => {
    if (creating || !canWrite) return
    setCreating(true)
    setCreateError(null)
    setNotice('')
    createKey.current ??= newIntentKey()
    const trimmed = label.trim()
    const result = await api
      .createVersion({
        documentId: row.id,
        label: trimmed || undefined,
        idempotencyKey: createKey.current,
      })
      .catch((): { ok: false; error: 'network' } => ({ ok: false, error: 'network' }))
    if (!alive.current) return
    setCreating(false)
    if (!result.ok) {
      setCreateError(createErrorKey(result))
      return
    }
    createKey.current = null
    setLabel('')
    setCurrentNo(null)
    setNotice(t('vhsNameDone', { no: result.value.version }))
    list.reload()
    onChanged?.()
  }

  const confirmRestore = async () => {
    if (!restoreTarget || restoring) return
    setRestoring(true)
    setRestoreError(null)
    // a checkpoint's "Created version N" line is not about this restore
    setNotice('')
    restoreKey.current ??= newIntentKey()
    const result = await api
      .restore({
        documentId: row.id,
        versionNo: restoreTarget.version,
        idempotencyKey: restoreKey.current,
      })
      .catch((): { ok: false; error: 'network' } => ({ ok: false, error: 'network' }))
    if (!alive.current) return
    setRestoring(false)
    if (!result.ok) {
      const refusal = restoreRefusal(result)
      // a lock refusal or a stale base ends this intent: the retry starts a new one
      if (refusal.dropKey) restoreKey.current = null
      setRestoreError(refusal.key)
      return
    }
    restoreKey.current = null
    setRestoreTarget(null)
    setCurrentNo(result.value.document.current_version)
    list.reload()
    onChanged?.()
  }

  const cancelRestore = () => {
    if (restoring) return
    setRestoreTarget(null)
    setRestoreError(null)
    restoreKey.current = null
  }

  const view = async (version: DocVersion) => {
    // the row buttons stay focusable while busy (aria-disabled): a press then does nothing
    if (busy !== null) return
    setRowError(null)
    if (version.kind === 'page') {
      const request = ++previewRequest.current
      setPreview({ no: version.version, state: 'loading' })
      const result = await api
        .version({ documentId: row.id, versionNo: version.version })
        .catch((): { ok: false; error: 'network' } => ({ ok: false, error: 'network' }))
      if (!alive.current || request !== previewRequest.current) return
      setPreview(
        result.ok
          ? { no: version.version, state: 'ready', text: pageText(result.value.content) }
          : { no: version.version, state: 'error' },
      )
      return
    }
    setBusy({ kind: 'open', no: version.version })
    const result = await api
      .openVersion({ documentId: row.id, versionNo: version.version })
      .catch((): { ok: false; error: 'network' } => ({ ok: false, error: 'network' }))
    if (!alive.current) return
    setBusy(null)
    if (!result.ok) {
      setRowError(result.error === 'unsupported_format' ? 'vhsOpenUnsupported' : 'vhsPreviewError')
      return
    }
    // the copy opened in a tab behind the sheet: leave it so the tab is what the person sees
    onClose()
  }

  const download = async (version: DocVersion) => {
    if (busy !== null) return
    setRowError(null)
    setBusy({ kind: 'download', no: version.version })
    const result = await api
      .downloadVersion({
        documentId: row.id,
        versionNo: version.version,
        suggestedName: row.title,
      })
      .catch((): { ok: false; error: 'network' } => ({ ok: false, error: 'network' }))
    if (!alive.current) return
    setBusy(null)
    // a cancelled save dialog is the person's choice, not a failure
    if (!result.ok && result.error !== 'dialog_canceled') setRowError('vhsDownloadFailed')
  }

  return (
    <>
      <ActionModal
        labelledBy={titleId}
        describedBy={descriptionId}
        className="uw-versions"
        onCancel={onClose}
      >
        <header className="uw-versions-header">
          <div className="uw-versions-header-text">
            <h2 id={titleId} className="uw-act-heading uw-versions-title">
              {t('vhsTitle')}
            </h2>
            <p id={descriptionId} className="uw-versions-muted">
              {t('vhsDescription')}
            </p>
          </div>
          <button
            type="button"
            className="uw-versions-close"
            aria-label={t('vhsClose')}
            onClick={onClose}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M2 2l8 8M10 2l-8 8"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>

        {notice && (
          <p role="status" className="uw-versions-notice">
            {notice}
          </p>
        )}

        {canWrite ? (
          <form
            className="uw-versions-create"
            onSubmit={(event) => {
              event.preventDefault()
              void submitName()
            }}
          >
            <label htmlFor={nameId} className="uw-act-label">
              {t('vhsNameLabel')}
            </label>
            <div className="uw-versions-create-line">
              <input
                id={nameId}
                type="text"
                className="uw-act-input"
                value={label}
                maxLength={DOC_VERSION_LABEL_MAX}
                placeholder={t('vhsNamePlaceholder')}
                readOnly={creating}
                spellCheck={false}
                onChange={(event) => changeLabel(event.target.value)}
              />
              <button
                type="submit"
                className="btn btn-primary uw-versions-submit"
                aria-disabled={creating || undefined}
                aria-busy={creating || undefined}
              >
                {creating ? t('vhsNameSubmitting') : t('vhsNameSubmit')}
              </button>
            </div>
            <p className="uw-versions-muted">{t('vhsNameHint')}</p>
            {createError && (
              <p role="alert" className="uw-versions-error">
                {t(createError)}
              </p>
            )}
          </form>
        ) : (
          <p className="uw-versions-note">{t(shelved ? 'vhsShelvedBlocked' : 'vhsManageOnly')}</p>
        )}

        {rowError && (
          <p role="alert" className="uw-versions-error uw-versions-row-error">
            {t(rowError)}
          </p>
        )}

        {list.status === 'loading' ? (
          <p className="uw-versions-loading" aria-busy="true">
            {t('vhsLoading')}
          </p>
        ) : list.status === 'error' ? (
          <div className="uw-versions-failed">
            <p role="alert" className="uw-versions-error">
              {t('vhsError')}
            </p>
            <button type="button" className="btn" onClick={list.reload}>
              {t('vhsRetry')}
            </button>
          </div>
        ) : list.rows.length === 0 ? (
          <p className="uw-versions-muted uw-versions-empty">{t('vhsEmpty')}</p>
        ) : (
          <>
            <ul className="uw-versions-list" ref={listRef}>
              {list.rows.map((version) => {
                const author = authorName(version)
                return (
                  <li
                    key={version.id}
                    className="uw-versions-row"
                    data-version-row={version.version}
                    tabIndex={-1}
                  >
                    <div className="uw-versions-row-main">
                      <p className="uw-versions-row-head">
                        <span className="uw-versions-row-no">
                          {t('vhsRowVersion', { no: version.version })}
                        </span>
                        {version.version === current && (
                          <span className="uw-versions-badge">{t('vhsCurrentBadge')}</span>
                        )}
                      </p>
                      <p className="uw-versions-row-meta">
                        {version.label && (
                          <span className="uw-versions-row-label">{version.label} · </span>
                        )}
                        {t(reasonKey(version))}
                        {version.size_bytes > 0
                          ? ` · ${formatBytes(version.size_bytes, dateLocale)}`
                          : ''}
                        {version.created_at && formatWhen(version.created_at, dateLocale) && (
                          <>
                            {' · '}
                            <time dateTime={version.created_at}>
                              {formatWhen(version.created_at, dateLocale)}
                            </time>
                          </>
                        )}
                      </p>
                      {author !== null && (
                        <p className="uw-versions-row-author" data-testid="version-author">
                          {author && <span className="uw-versions-author-name">{author}</span>}
                          {version.created_by_kind === 'agent' && (
                            <span className="uw-versions-agent">{t('vhsAuthorAgent')}</span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="uw-versions-row-actions">
                      <button
                        type="button"
                        className="uw-versions-icon-btn"
                        aria-label={t('vhsPreviewTitle', { no: version.version })}
                        title={t('vhsView')}
                        aria-disabled={busy !== null || undefined}
                        aria-busy={
                          (busy?.kind === 'open' && busy.no === version.version) || undefined
                        }
                        onClick={() => void view(version)}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                          <path
                            d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinejoin="round"
                          />
                          <circle
                            cx="8"
                            cy="8"
                            r="2"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.4"
                          />
                        </svg>
                      </button>
                      {version.kind !== 'page' && (
                        <button
                          type="button"
                          className="uw-versions-icon-btn"
                          aria-label={t('vhsDownloadVersion', { no: version.version })}
                          title={t('vhsDownload')}
                          aria-disabled={busy !== null || undefined}
                          aria-busy={
                            (busy?.kind === 'download' && busy.no === version.version) || undefined
                          }
                          onClick={() => void download(version)}
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                            <path
                              d="M8 2.5v8m0 0L4.8 7.3M8 10.5l3.2-3.2M3 13h10"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      )}
                      {canWrite && (
                        <button
                          type="button"
                          className="uw-versions-icon-btn"
                          aria-label={t('vhsRestore', { no: version.version })}
                          title={t('vhsRestore', { no: version.version })}
                          onClick={() => {
                            setRestoreError(null)
                            restoreKey.current = null
                            setRestoreTarget(version)
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                            <path
                              d="M2.5 8a5.5 5.5 0 1 0 1.8-4.07M2.5 2.5v2.8h2.8"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            {list.moreFailed && (
              <p role="alert" className="uw-versions-error">
                {t('vhsError')}
              </p>
            )}
            {list.hasMore && (
              <div className="uw-versions-more">
                <button
                  type="button"
                  className="btn"
                  aria-disabled={list.loadingMore || undefined}
                  aria-busy={list.loadingMore || undefined}
                  onClick={() => {
                    if (list.loadingMore) return
                    markLoadMore()
                    list.loadMore()
                  }}
                >
                  {t('vhsLoadMore')}
                </button>
              </div>
            )}
          </>
        )}
      </ActionModal>

      {restoreTarget && (
        <RestoreConfirm
          t={t}
          version={restoreTarget}
          error={restoreError}
          busy={restoring}
          onConfirm={() => void confirmRestore()}
          onCancel={cancelRestore}
        />
      )}

      {preview && (
        <PagePreview
          t={t}
          preview={preview}
          onClose={() => {
            previewRequest.current++
            setPreview(null)
          }}
        />
      )}
    </>
  )
}

function RestoreConfirm({
  t,
  version,
  error,
  busy,
  onConfirm,
  onCancel,
}: {
  t: T
  version: DocVersion
  error: StringKey | null
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  return (
    <ActionModal
      labelledBy={titleId}
      describedBy={descriptionId}
      className="uw-versions-confirm"
      onCancel={onCancel}
    >
      <h2 id={titleId} className="uw-act-heading">
        {t('vhsRestoreConfirmTitle', { no: version.version })}
      </h2>
      <p id={descriptionId} className="uw-versions-muted">
        {t('vhsRestoreConfirmDescription')}
      </p>
      {error && (
        <p role="alert" className="uw-versions-error">
          {t(error)}
        </p>
      )}
      <div className="modal-buttons">
        <button type="button" className="btn" aria-disabled={busy || undefined} onClick={onCancel}>
          {t('vhsCancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          aria-disabled={busy || undefined}
          aria-busy={busy || undefined}
          onClick={onConfirm}
        >
          {busy ? t('vhsRestoreSubmitting') : t('vhsRestoreConfirmSubmit')}
        </button>
      </div>
    </ActionModal>
  )
}

function PagePreview({
  t,
  preview,
  onClose,
}: {
  t: T
  preview:
    | { no: number; state: 'loading' }
    | { no: number; state: 'error' }
    | { no: number; state: 'ready'; text: string }
  onClose: () => void
}) {
  const titleId = useId()
  return (
    <ActionModal labelledBy={titleId} className="uw-versions-preview" onCancel={onClose}>
      <header className="uw-versions-header">
        <h2 id={titleId} className="uw-act-heading uw-versions-title">
          {t('vhsPreviewTitle', { no: preview.no })}
        </h2>
        <button
          type="button"
          className="uw-versions-close"
          aria-label={t('vhsClose')}
          onClick={onClose}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M2 2l8 8M10 2l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>
      <div className="uw-versions-preview-body">
        {preview.state === 'loading' ? (
          <p className="uw-versions-muted" aria-busy="true">
            {t('vhsLoading')}
          </p>
        ) : preview.state === 'error' ? (
          <p role="alert" className="uw-versions-error">
            {t('vhsPreviewError')}
          </p>
        ) : preview.text ? (
          <pre className="uw-versions-preview-text" tabIndex={0}>
            {preview.text}
          </pre>
        ) : (
          <p className="uw-versions-muted">{t('vhsPreviewEmpty')}</p>
        )}
      </div>
    </ActionModal>
  )
}
