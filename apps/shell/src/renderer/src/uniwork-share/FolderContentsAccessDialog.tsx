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
  maxPickedItems,
  previewLines,
  warningLines,
  type HomeWorkspaceChoice,
  type HomeWorkspaceState,
} from './folder-contents-access-model'
import { trackFolderBatch, useFolderBatches } from './folder-contents-access-store'
import { levelLabel as levelText, rejectedReasonKey } from './share-model'
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
  /** the home workspace's name for its row in the replace mode (absent = the row says "workspace of this folder") */
  workspaceName?: string
  /** the bridge; defaults to `window.uniworkShare` (tests pass the in-memory fake) */
  api?: UniworkShareApi
  onClose: () => void
  /** the run wrote something (a sync run settled): the list refetches once */
  onChanged?: () => void
  /** the answer in words, for the screen's toast (a background run's end comes from `useFolderBatchEnd`) */
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
 * a large one runs in the background and its progress is drawn in this dialog (the web's flow):
 * closing it keeps the run going, and the screen's `useFolderBatchEnd` toasts the end.
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
  // replace: no level is preselected, the person answers for the home workspace (or picks Private)
  const [homeChoice, setHomeChoice] = useState<HomeWorkspaceState>('')
  const [step, setStep] = useState<'form' | 'review' | 'progress'>('form')
  // the background run this dialog shows; `alreadyRunning` = it is another request's (a 409)
  const [progress, setProgress] = useState<{ batchId: string; alreadyRunning: boolean } | null>(
    null,
  )
  const [preview, setPreview] = useState<FolderContentsAccessPreview | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejectedByKey, setRejectedByKey] = useState<Record<string, string>>({})
  // the state flips after the click; the ref closes the gap for a fast second one
  const inFlight = useRef(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const closing = useRef(false)
  const batches = useFolderBatches()
  const batch = progress ? batches.find((b) => b.batchId === progress.batchId) : undefined

  /** closes once: the end of the run and a click can meet */
  const finish = () => {
    if (closing.current) return
    closing.current = true
    onClose()
  }
  // the run ended (an ended batch leaves the store): the screen toasts it, nothing is left to show
  useEffect(() => {
    if (step === 'progress' && !batch) finish()
  })

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setDebouncedQuery('')
      return
    }
    const timer = setTimeout(() => setDebouncedQuery(trimmed), 250)
    return () => clearTimeout(timer)
  }, [query])

  // the focused button unmounts whenever the step changes, which would drop focus on <body> and
  // with it the dialog's Esc / Tab handling: focus follows the step. Review: the safe button
  // (Back for a destructive replace, the action for an add); progress: Done; back to the form
  // (Back, or a failed apply): its first control. The first render is the modal's own focus.
  const previousStep = useRef(step)
  useEffect(() => {
    const from = previousStep.current
    previousStep.current = step
    if (step === 'review') {
      const selector = mode === 'replace' ? '[data-fca-back]' : '[data-fca-apply]'
      // nothing to change has no apply button: Back is what is left
      const target =
        bodyRef.current?.querySelector<HTMLElement>(selector) ??
        bodyRef.current?.querySelector<HTMLElement>('[data-fca-back]')
      target?.focus()
    } else if (step === 'progress') {
      bodyRef.current?.querySelector<HTMLElement>('[data-fca-done]')?.focus()
    } else if (from !== 'form') {
      bodyRef.current
        ?.querySelector<HTMLElement>('[data-fca-mode]:checked, [data-fca-confirm]')
        ?.focus()
    }
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
  // BE-1: a workspace or the organization never takes manage (level_not_allowed), whichever
  // workspace it is, so a picked group is held at edit when the common level is manage
  const effectiveItemLevel = (item: SelectedShareCandidate): ShareLevel =>
    item.candidate.principalType !== 'user' && level === 'manage' ? 'edit' : level

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
  const canSubmit = canSubmitFolderItems(mode, items, homeChoice)
  // the server takes 100 items, the replace mode's home row among them
  const maxPicked = maxPickedItems(mode)
  const listFull = selected.length >= maxPicked
  const homeName = workspaceName?.trim()

  const resetOutcome = () => {
    setPreview(null)
    setError(null)
    setRejectedByKey({})
  }

  /** follow a background run inside this dialog; closing the dialog does not stop it */
  const showProgress = (batchId: string, total: number, alreadyRunning: boolean) => {
    trackFolderBatch({
      api: shareApi,
      batchId,
      folderId: folder.id,
      folderTitle: folder.title,
      total,
    })
    announce(t('shrFcProgressTitle'))
    setProgress({ batchId, alreadyRunning })
    setPreview(null)
    setError(null)
    setStep('progress')
  }

  /** the refusals every call of the dialog meets; true when it has been handled */
  const handleFailure = (failure: Extract<ShareResult<never>, { ok: false }>) => {
    if (failure.error === 'document_access_rejected' && failure.rejected?.length) {
      const next: Record<string, string> = {}
      for (const r of failure.rejected) next[`${r.principalType}:${r.principalId}`] = r.code
      setRejectedByKey(next)
      setStep('form')
      setPreview(null)
      // the web's sentence, then the app's per-person reason (the home row has no chip to mark)
      const reasons = failure.rejected.map((r) => {
        const match = selected.find(
          (s) =>
            s.candidate.principalType === r.principalType &&
            s.candidate.principalId === r.principalId,
        )
        const name =
          match?.candidate.name ??
          (r.principalType === 'workspace' && r.principalId === folder.workspaceId
            ? (homeName ?? t('shrFcHomeRowUnnamed'))
            : r.principalId)
        return `${name}: ${t(rejectedReasonKey(r.code))}`
      })
      setError(`${t('shrFcErrorRejected')} ${reasons.join(' · ')}`)
      return
    }
    if (failure.error === 'folder_access_batch_running') {
      // another run owns this folder: show its progress here (closing the dialog does not stop
      // it); without a batch id there is nothing to follow, so no promise of progress is made
      if (failure.batchId) {
        showProgress(failure.batchId, 0, true)
        return
      }
      setStep('form')
      setPreview(null)
      setError(t('shrFcRunningNoBatch'))
      return
    }
    setStep('form')
    setPreview(null)
    // a server without the route (BE-1: a coded 501 until the feature ships) is not a fault of this call
    setError(failure.endpointMissing ? t('shrFcUnavailable') : t(folderErrorKey(failure.error)))
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
      setError(t('shrFcErrorGeneric'))
      return
    }
    const found = answer.value.preview
    // the summary is read out through aria-describedby on the focused review button
    setPreview(found)
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
    if (!answer.ok && answer.error === 'malformed_response') {
      // the write answered 2xx but the body cannot be read: it may have been applied, so no error
      // and no form to resubmit; say so neutrally (the toast has no neutral tone: 'ok') and refetch
      const message = t('shrFcToastUnknown')
      announce(message)
      onNotice?.(message, 'ok')
      onChanged?.()
      finish()
      return
    }
    if (!answer.ok) return handleFailure(answer)
    const value = answer.value
    if (value.kind === 'sync') {
      const message = doneMessage(t, value)
      announce(message)
      onNotice?.(message, 'ok')
      onChanged?.()
      finish()
      return
    }
    if (value.kind === 'background') {
      showProgress(value.batchId, value.total, false)
      onChanged?.()
      return
    }
    setStep('form')
    setPreview(null)
    setError(t('shrFcErrorGeneric'))
  }

  const titleId = `${baseId}-title`
  const descriptionId = `${baseId}-desc`
  const scopeId = `${baseId}-scope`
  const summaryId = `${baseId}-summary`
  const warningsId = `${baseId}-warnings`
  const nothingId = `${baseId}-nothing`
  const ids = {
    input: `${baseId}-input`,
    listbox: `${baseId}-listbox`,
    level: `${baseId}-level`,
    home: `${baseId}-home`,
    homeRow: `${baseId}-home-row`,
    modes: `${baseId}-modes`,
  }
  const lines = preview ? previewLines(t, preview) : []
  const warnings = preview ? warningLines(t, preview) : []
  const nothingToChange = preview !== null && preview.changed === 0
  // the summary is spoken once, as the description of the focused review button
  const reviewDescribedBy = [
    summaryId,
    ...(nothingToChange ? [nothingId] : []),
    ...(warnings.length > 0 ? [warningsId] : []),
  ].join(' ')
  // the title is the plain verb; the subtitle says which folder the share covers
  const scope = folder.title.trim()
    ? t('shrFcScope', { title: folder.title })
    : t('shrFcScopeUntitled')
  const total = batch?.total ?? 0
  const percent =
    total > 0 ? Math.min(100, Math.round(((batch?.processed ?? 0) / total) * 100)) : undefined

  return (
    <ActionModal
      labelledBy={titleId}
      describedBy={[
        ...(step === 'progress' ? [] : [scopeId]),
        descriptionId,
        ...(step === 'review' ? [reviewDescribedBy] : []),
      ].join(' ')}
      className="uw-share uw-fca"
      onCancel={pending ? () => {} : finish}
    >
      <header className="uw-share-header">
        <div className="uw-share-header-text">
          <h2 id={titleId} className="uw-act-heading uw-share-title">
            {step === 'progress' ? t('shrFcProgressTitle') : t('shrFcTitle')}
          </h2>
          {step !== 'progress' && (
            <p id={scopeId} className="uw-share-muted" data-fca-scope>
              {scope}
            </p>
          )}
          <p id={descriptionId} className="uw-share-muted">
            {step === 'progress' ? t('shrFcProgressHint') : t('shrFcFixed')}
          </p>
        </div>
      </header>

      {step === 'progress' ? (
        <div className="uw-share-body" data-fca-progress ref={bodyRef}>
          {progress?.alreadyRunning && (
            <p className="uw-share-notice warn" data-fca-running>
              {t('shrFcProgressAlreadyRunning')}
            </p>
          )}
          <div className="uw-fca-progress">
            <progress
              className="uw-fca-meter"
              max={100}
              value={percent}
              aria-label={t('shrFcProgressLabel')}
            />
            <p className="uw-fca-count" data-fca-count>
              {total > 0
                ? t(total === 1 ? 'shrFcProgressCountOne' : 'shrFcProgressCountOther', {
                    processed: batch?.processed ?? 0,
                    count: total,
                  })
                : t('shrFcProgressStarting')}
            </p>
          </div>
          <div className="modal-buttons">
            <button type="button" className="btn btn-primary" data-fca-done onClick={finish}>
              {t('shrFcProgressClose')}
            </button>
          </div>
        </div>
      ) : step === 'review' && preview ? (
        <div className="uw-share-body" data-fca-review ref={bodyRef}>
          <ul id={summaryId} className="uw-fca-summary" aria-label={t('shrFcSummaryLabel')}>
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {nothingToChange && (
            <p id={nothingId} className="uw-share-muted">
              {t('shrFcNothing')}
            </p>
          )}
          {warnings.length > 0 && (
            <ul id={warningsId} className="uw-fca-warnings" aria-label={t('shrFcWarningsLabel')}>
              {warnings.map((line) => (
                <li key={line} className="uw-share-notice warn" data-fca-warning>
                  {line}
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
              aria-describedby={reviewDescribedBy}
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
                aria-describedby={reviewDescribedBy}
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
        <div className="uw-share-body" data-fca-form ref={bodyRef}>
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
                    if (value === 'replace') {
                      // the home row is the replace mode's own: a picked home workspace moves into
                      // it (its level kept) instead of staying as a chip that is never sent
                      const home = selected.find((s) => s.key === homeKey)
                      if (home) {
                        setSelected((prev) => prev.filter((s) => s.key !== homeKey))
                        if (homeChoice === '') {
                          setHomeChoice(level === 'manage' ? 'edit' : level)
                        }
                      }
                    }
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
                {t('shrFcPrincipalsTitle')}
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
              full={listFull}
              rejectedByKey={rejectedByKey}
              onSelectCandidate={(candidate: ShareCandidate) => {
                const key = `${candidate.principalType}:${candidate.principalId}`
                if (selectedKeys.has(key) || listFull) return
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
            {listFull ? (
              <p className="uw-share-muted" data-fca-cap>
                {t('shrFcTooMany', { max: maxPicked })}
              </p>
            ) : (
              selected.length === 0 && (
                <p className="uw-share-muted" data-fca-empty>
                  {t(
                    mode === 'merge' ? 'shrFcPrincipalsEmptyMerge' : 'shrFcPrincipalsEmptyReplace',
                  )}
                </p>
              )
            )}
            {/* replace with nobody picked has no level to choose: the home row below is the answer */}
            {(mode === 'merge' || selected.length > 0) && (
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
            )}
          </section>

          {mode === 'replace' && (
            <section className="uw-share-section" data-fca-home aria-labelledby={ids.homeRow}>
              <h3 id={ids.homeRow} className="uw-share-heading">
                {homeName ? t('shrFcHomeRow', { name: homeName }) : t('shrFcHomeRowUnnamed')}
              </h3>
              <div className="uw-share-field">
                <label className="uw-act-label" htmlFor={ids.home}>
                  {t('shrFcHomeLevelLabel')}
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
                  <option value="" disabled>
                    {t('shrFcHomeLevelChoose')}
                  </option>
                  {HOME_WORKSPACE_LEVELS.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                  <option value="private">{t('shrFcLevelPrivate')}</option>
                </select>
              </div>
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
              onClick={finish}
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
