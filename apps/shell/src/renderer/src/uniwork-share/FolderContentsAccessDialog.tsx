import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  SHARE_LEVELS,
  type FolderContentsAccessItem,
  type FolderContentsAccessMode,
  type FolderContentsAccessPreview,
  type FolderContentsAccessResult,
  type ShareCandidate,
  type ShareLevel,
  type ShareResult,
  type UniworkShareApi,
} from '../../../shared/share-api'
import { ActionModal } from '../UniworkDocActions'
import { useI18n } from '../locale'
import { announce } from '../uniwork-live'
import { ShareCandidatePicker, type SelectedShareCandidate } from './ShareCandidatePicker'
import {
  buildFolderItems,
  canSubmitFolderItems,
  doneMessage,
  folderErrorKey,
  HOME_WORKSPACE_LEVELS,
  previewLines,
  warningKeys,
  type HomeWorkspaceChoice,
} from './folder-contents-access-model'
import { trackFolderBatch } from './folder-contents-access-store'
import {
  allowedLevelsForPrincipal,
  levelLabel as levelText,
  rejectedReasonKey,
} from './share-model'
import { useShareCandidates } from './use-share'
import './share-dialog.css'

/** what the dialog reads of the folder: its id, its home workspace and the title it shows */
export interface FolderContentsTarget {
  id: string
  workspaceId: string
  title: string
}

export interface FolderContentsAccessDialogProps {
  open: boolean
  folder: FolderContentsTarget
  /** the home workspace's name for its row in the replace mode (absent = the row says "the workspace") */
  workspaceName?: string
  /** the bridge; defaults to `window.uniworkShare` (tests pass the in-memory fake) */
  api?: UniworkShareApi
  onClose: () => void
  /** the run wrote something (a sync run settled): the list refetches once */
  onChanged?: () => void
  /** the answer in words, for the screen's toast (the bar reports a background run itself) */
  onNotice?: (message: string, tone: 'ok' | 'error') => void
}

/**
 * "Chia sẻ các tài liệu bên trong…": writes one set of access onto every document of a folder
 * the person manages (the spec's §7, the web's folder-contents-access dialog). The add area is
 * the bulk dialog's (the picker and one level for everybody picked); the mode is Thêm (default,
 * only raises) or Thay thế (exactly this list, the rest is removed), and the replace mode always
 * shows the home-workspace row because leaving it out turns the documents private. Confirm asks
 * the server for a dry run first; the summary and its warnings come back before anything is
 * written, and Thay thế quyền is a destructive button. A small folder answers at once (a toast);
 * a large one runs in the background and its progress lives in the bar, not in this dialog.
 */
export function FolderContentsAccessDialog(props: FolderContentsAccessDialogProps) {
  if (!props.open) return null
  return <FolderContentsAccessBody {...props} />
}

function FolderContentsAccessBody({
  folder,
  workspaceName,
  api,
  onClose,
  onChanged,
  onNotice,
}: FolderContentsAccessDialogProps) {
  const { t } = useI18n()
  const shareApi = api ?? window.uniworkShare
  const baseId = useId()
  const [mode, setMode] = useState<FolderContentsAccessMode>('merge')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [opened, setOpened] = useState(false)
  const [selected, setSelected] = useState<SelectedShareCandidate[]>([])
  const [level, setLevel] = useState<ShareLevel>('view')
  // replace: no row sent = the documents go private, so the default is the honest "not shared"
  const [homeChoice, setHomeChoice] = useState<HomeWorkspaceChoice>('none')
  const [step, setStep] = useState<'form' | 'review'>('form')
  const [preview, setPreview] = useState<FolderContentsAccessPreview | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejectedByKey, setRejectedByKey] = useState<Record<string, string>>({})
  // the state flips after the click; the ref closes the gap for a fast second one
  const inFlight = useRef(false)
  const reviewRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setDebouncedQuery('')
      return
    }
    const timer = setTimeout(() => setDebouncedQuery(trimmed), 250)
    return () => clearTimeout(timer)
  }, [query])

  // the form's buttons unmount when the review replaces it: focus goes to the review's safe
  // button (Back for a destructive replace, the action for an add) so the Tab trap keeps working
  useEffect(() => {
    if (step !== 'review') return
    const selector = mode === 'replace' ? '[data-fca-back]' : '[data-fca-apply]'
    reviewRef.current?.querySelector<HTMLElement>(selector)?.focus()
  }, [step, mode])

  const candidatesQuery = useShareCandidates(
    shareApi,
    folder.id,
    debouncedQuery,
    opened && step === 'form',
  )
  const candidates = candidatesQuery.items
  // the replace mode's home row is the answer for the home workspace: it cannot be picked again
  const homeKey = `workspace:${folder.workspaceId}`
  const selectedKeys = useMemo(() => {
    const keys = new Set(selected.map((s) => s.key))
    if (mode === 'replace') keys.add(homeKey)
    return keys
  }, [selected, mode, homeKey])

  const label = (value: string | null | undefined) => levelText(t, value)
  const effectiveItemLevel = (item: SelectedShareCandidate): ShareLevel =>
    allowedLevelsForPrincipal(
      item.candidate.principalType,
      item.candidate.isHomeWorkspace,
    ).includes(level)
      ? level
      : 'edit'

  const picked = (): FolderContentsAccessItem[] =>
    selected.map((item) => ({
      principalType: item.candidate.principalType,
      principalId: item.candidate.principalId,
      level: effectiveItemLevel(item),
    }))
  const items = buildFolderItems({
    mode,
    picked: picked(),
    homeWorkspaceId: folder.workspaceId,
    homeChoice,
  })
  const canSubmit = canSubmitFolderItems(mode, items)

  const resetOutcome = () => {
    setPreview(null)
    setError(null)
    setRejectedByKey({})
  }

  /** the refusals every call of the dialog meets; true when it has been handled */
  const handleFailure = (failure: Extract<ShareResult<never>, { ok: false }>) => {
    if (failure.error === 'document_access_rejected' && failure.rejected?.length) {
      const next: Record<string, string> = {}
      for (const r of failure.rejected) next[`${r.principalType}:${r.principalId}`] = r.code
      setRejectedByKey(next)
      setStep('form')
      setPreview(null)
      setError(
        failure.rejected
          .map((r) => {
            const match = selected.find(
              (s) =>
                s.candidate.principalType === r.principalType &&
                s.candidate.principalId === r.principalId,
            )
            return `${match?.candidate.name ?? r.principalId}: ${t(rejectedReasonKey(r.code))}`
          })
          .join(' · '),
      )
      return
    }
    if (failure.error === 'folder_access_batch_running') {
      // another run owns this folder: say so and follow it, closing the dialog does not stop it
      const { batchId } = failure
      const message = t('shrFcRunning')
      if (batchId) {
        trackFolderBatch({
          api: shareApi,
          batchId,
          folderId: folder.id,
          folderTitle: folder.title,
          total: 0,
        })
      }
      announce(message)
      onNotice?.(message, 'ok')
      onClose()
      return
    }
    setStep('form')
    setPreview(null)
    setError(t(folderErrorKey(failure.error)))
  }

  const call = async (dryRun: boolean): Promise<ShareResult<FolderContentsAccessResult>> =>
    shareApi
      .folderContentsAccess({ folderId: folder.id, mode, items, dryRun })
      .catch((): ShareResult<never> => ({ ok: false, error: 'network' }))

  /** Xác nhận: the dry run; nothing is written */
  const review = async () => {
    if (pending || inFlight.current || !canSubmit) return
    inFlight.current = true
    setPending(true)
    resetOutcome()
    const answer = await call(true)
    inFlight.current = false
    setPending(false)
    if (!answer.ok) return handleFailure(answer)
    if (answer.value.kind !== 'dryRun') {
      setError(t('shrSubmitFailed'))
      return
    }
    setPreview(answer.value.preview)
    setStep('review')
  }

  /** the real call, from the review */
  const apply = async () => {
    if (pending || inFlight.current || !preview) return
    inFlight.current = true
    setPending(true)
    setError(null)
    const answer = await call(false)
    inFlight.current = false
    setPending(false)
    if (!answer.ok) return handleFailure(answer)
    const value = answer.value
    if (value.kind === 'sync') {
      const message = doneMessage(t, value)
      announce(message)
      onNotice?.(message, 'ok')
      onChanged?.()
      onClose()
      return
    }
    if (value.kind === 'background') {
      trackFolderBatch({
        api: shareApi,
        batchId: value.batchId,
        folderId: folder.id,
        folderTitle: folder.title,
        total: value.total,
      })
      announce(t('shrFcStarted', { title: folder.title, total: value.total }))
      onChanged?.()
      onClose()
      return
    }
    setStep('form')
    setPreview(null)
    setError(t('shrSubmitFailed'))
  }

  const titleId = `${baseId}-title`
  const descriptionId = `${baseId}-desc`
  const ids = {
    input: `${baseId}-input`,
    listbox: `${baseId}-listbox`,
    level: `${baseId}-level`,
    home: `${baseId}-home`,
    modes: `${baseId}-modes`,
  }
  const lines = preview ? previewLines(t, preview, mode) : []
  const warnings = preview ? warningKeys(preview) : []
  const nothingToChange = preview !== null && preview.changed === 0
  const homeName = workspaceName?.trim() || t('shrFcHomeFallback')

  return (
    <ActionModal
      labelledBy={titleId}
      describedBy={descriptionId}
      className="uw-share uw-fca"
      onCancel={pending ? () => {} : onClose}
    >
      <header className="uw-share-header">
        <div className="uw-share-header-text">
          <h2 id={titleId} className="uw-act-heading uw-share-title">
            {t('shrFcTitle', { title: folder.title })}
          </h2>
          <p id={descriptionId} className="uw-share-muted">
            {t('shrFcFixed')}
          </p>
        </div>
      </header>

      {step === 'review' && preview ? (
        <div className="uw-share-body" data-fca-review ref={reviewRef}>
          <ul className="uw-fca-summary" role="status" aria-label={t('shrFcSummaryLabel')}>
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {nothingToChange && <p className="uw-share-muted">{t('shrFcNothing')}</p>}
          {warnings.length > 0 && (
            <ul className="uw-fca-warnings" aria-label={t('shrFcWarningsLabel')}>
              {warnings.map((key) => (
                <li key={key} className="uw-share-notice warn" data-fca-warning>
                  {t(key)}
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="uw-act-error">
              {error}
            </p>
          )}
          <div className="modal-buttons">
            <button
              type="button"
              className="btn"
              data-fca-back
              disabled={pending}
              onClick={() => {
                setStep('form')
                resetOutcome()
              }}
            >
              {t('shrFcBack')}
            </button>
            {!nothingToChange && (
              <button
                type="button"
                className={mode === 'replace' ? 'btn btn-danger' : 'btn btn-primary'}
                data-fca-apply
                aria-busy={pending || undefined}
                disabled={pending}
                onClick={() => void apply()}
              >
                {pending
                  ? t('shrFcApplying')
                  : mode === 'replace'
                    ? t('shrFcApplyReplace')
                    : t('shrFcApplyMerge')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="uw-share-body" data-fca-form>
          <fieldset className="uw-fca-modes" aria-labelledby={ids.modes} disabled={pending}>
            <legend id={ids.modes} className="uw-share-heading">
              {t('shrFcModeLabel')}
            </legend>
            {(['merge', 'replace'] as const).map((value) => (
              <label key={value} className="uw-fca-mode">
                <input
                  type="radio"
                  name={`${baseId}-mode`}
                  value={value}
                  data-fca-mode={value}
                  checked={mode === value}
                  onChange={() => {
                    setMode(value)
                    resetOutcome()
                  }}
                />
                <span className="uw-fca-mode-name">
                  {t(value === 'merge' ? 'shrFcModeMerge' : 'shrFcModeReplace')}
                </span>
                <span className="uw-fca-mode-hint">
                  {t(value === 'merge' ? 'shrFcModeMergeHint' : 'shrFcModeReplaceHint')}
                </span>
              </label>
            ))}
          </fieldset>

          <section aria-labelledby={`${baseId}-add`} className="uw-share-section">
            <div className="uw-share-section-head">
              <h3 id={`${baseId}-add`} className="uw-share-heading">
                {t('shrAddTitle')}
              </h3>
            </div>
            <ShareCandidatePicker
              inputId={ids.input}
              listboxId={ids.listbox}
              query={query}
              onQueryChange={setQuery}
              onOpened={() => setOpened(true)}
              selected={selected}
              selectedKeys={selectedKeys}
              candidates={candidates}
              hasMore={candidatesQuery.hasMore}
              loadingMore={candidatesQuery.loadingMore}
              loadMoreError={candidatesQuery.loadMoreError}
              loadError={candidatesQuery.loadError}
              loading={candidatesQuery.loading}
              onLoadMore={candidatesQuery.loadMore}
              onRetry={candidatesQuery.retry}
              alreadySharedUserIds={[]}
              disabled={pending}
              rejectedByKey={rejectedByKey}
              onSelectCandidate={(candidate: ShareCandidate) => {
                const key = `${candidate.principalType}:${candidate.principalId}`
                if (selectedKeys.has(key)) return
                setSelected((prev) => [...prev, { key, candidate, onExisting: 'keep' }])
                setQuery('')
                resetOutcome()
              }}
              onRemoveCandidate={(key) => {
                setSelected((prev) => prev.filter((s) => s.key !== key))
                resetOutcome()
              }}
              onChangeOnExisting={() => {}}
              effectiveItemLevel={effectiveItemLevel}
              rejectedReason={(code) => t(rejectedReasonKey(code))}
            />
            <div className="uw-share-form-row">
              <div className="uw-share-field">
                <label className="uw-act-label" htmlFor={ids.level}>
                  {t('shrLevelLabel')}
                </label>
                <select
                  id={ids.level}
                  data-fca-level
                  className="uw-act-select"
                  value={level}
                  disabled={pending}
                  onChange={(e) => {
                    setLevel(e.target.value as ShareLevel)
                    resetOutcome()
                  }}
                >
                  {SHARE_LEVELS.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {mode === 'replace' && (
            <section className="uw-share-section" data-fca-home>
              <div className="uw-share-field">
                <label className="uw-act-label" htmlFor={ids.home}>
                  {t('shrFcHomeRow', { name: homeName })}
                </label>
                <select
                  id={ids.home}
                  data-fca-home-level
                  className="uw-act-select"
                  value={homeChoice}
                  disabled={pending}
                  onChange={(e) => {
                    setHomeChoice(e.target.value as HomeWorkspaceChoice)
                    resetOutcome()
                  }}
                >
                  {HOME_WORKSPACE_LEVELS.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                  <option value="none">{t('shrBulkWorkspaceNone')}</option>
                </select>
              </div>
              {items.length === 0 && <p className="uw-share-muted">{t('shrFcReplaceEmpty')}</p>}
            </section>
          )}

          {error && (
            <p role="alert" className="uw-act-error" data-fca-error>
              {error}
            </p>
          )}

          <div className="modal-buttons">
            <button
              type="button"
              className="btn"
              data-fca-cancel
              disabled={pending}
              onClick={onClose}
            >
              {t('shrConfirmCancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-fca-confirm
              aria-disabled={!canSubmit || pending || undefined}
              aria-busy={pending || undefined}
              onClick={() => void review()}
            >
              {pending ? t('shrFcChecking') : t('shrConfirmAccept')}
            </button>
          </div>
        </div>
      )}
    </ActionModal>
  )
}
