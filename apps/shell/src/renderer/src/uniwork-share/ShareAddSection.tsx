import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type {
  ShareCandidate,
  ShareLevel,
  SharePreview,
  ShareResult,
  ShareUpdateItem,
  UniworkShareApi,
} from '../../../shared/share-api'
import { SHARE_LEVELS } from '../../../shared/share-api'
import { useI18n } from '../locale'
import {
  allowedLevelsForPrincipal,
  bridgeFailed,
  levelLabel as levelText,
  rejectedReasonKey,
  shareErrorKey,
  viaLabel,
} from './share-model'
import { warningSentence } from './share-preview-sentences'
import { ShareAddCustomLevels } from './ShareAddCustomLevels'
import { ShareCandidatePicker, type SelectedShareCandidate } from './ShareCandidatePicker'
import { useShareCandidates } from './use-share'

export interface ShareAddSectionProps {
  api: UniworkShareApi
  documentId: string
  /** the dialog is open: the picker's list is asked for only after the person opens it */
  open: boolean
  /** the owner and the viewer are already on the document: the picker marks them */
  alreadySharedUserIds: readonly (string | null | undefined)[]
  /** a shelved document gives nothing: the whole section reads, never writes */
  shelved: boolean
  shelvedNoteId?: string
  /** bumped after every write of the dialog: the picker's list is read again */
  candidatesRefreshKey?: number
  /** what a write changed: the dialog reloads the overview and tells the list owner */
  onMutated: (note: string) => Promise<void>
}

/** the add-people area: a picker with chips, a common level, custom levels and the dry-run preview */
export function ShareAddSection({
  api,
  documentId,
  open,
  alreadySharedUserIds,
  shelved,
  shelvedNoteId,
  candidatesRefreshKey,
  onMutated,
}: ShareAddSectionProps) {
  const { t } = useI18n()
  const baseId = useId()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [opened, setOpened] = useState(false)
  const [selected, setSelected] = useState<SelectedShareCandidate[]>([])
  const [commonLevel, setCommonLevel] = useState<ShareLevel>('view')
  const [customMode, setCustomMode] = useState(false)
  const [pendingApplyAll, setPendingApplyAll] = useState<ShareLevel | null>(null)
  const [pendingPreview, setPendingPreview] = useState<{
    items: ShareUpdateItem[]
    preview: SharePreview
  } | null>(null)
  const [rejectedByKey, setRejectedByKey] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [pending, setPending] = useState(false)
  // `pending` is false between the dry run resolving and the real call, so a fast second click
  // would run both again; the ref closes that gap
  const inFlight = useRef(false)
  const submitRef = useRef<HTMLButtonElement>(null)
  const previewClosedByButtons = useRef(false)
  const prevPreview = useRef<typeof pendingPreview>(null)

  // when the confirm box closes from its own buttons, focus goes back to the Share button
  useEffect(() => {
    const prev = prevPreview.current
    prevPreview.current = pendingPreview
    if (!prev || pendingPreview || !previewClosedByButtons.current) return
    previewClosedByButtons.current = false
    submitRef.current?.focus()
  }, [pendingPreview])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setDebouncedQuery('')
      return
    }
    const timer = setTimeout(() => setDebouncedQuery(trimmed), 250)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (open) return
    setQuery('')
    setDebouncedQuery('')
    setSelected([])
    setCommonLevel('view')
    setCustomMode(false)
    setPendingApplyAll(null)
    setPendingPreview(null)
    setRejectedByKey({})
    setSubmitError(null)
    setAnnouncement('')
  }, [open, documentId])

  const candidatesQuery = useShareCandidates(
    api,
    documentId,
    debouncedQuery,
    open && opened,
    candidatesRefreshKey,
  )
  const selectedKeys = useMemo(() => new Set(selected.map((s) => s.key)), [selected])
  const label = (level: string | null | undefined) => levelText(t, level)
  const rejectedReason = (code: string) => t(rejectedReasonKey(code))

  const effectiveItemLevel = (item: SelectedShareCandidate): ShareLevel => {
    const desired = item.customLevel ?? commonLevel
    const allowed = allowedLevelsForPrincipal(
      item.candidate.principalType,
      item.candidate.isHomeWorkspace,
    )
    return allowed.includes(desired) ? desired : 'edit'
  }
  const allowedFor = (item: SelectedShareCandidate) =>
    allowedLevelsForPrincipal(item.candidate.principalType, item.candidate.isHomeWorkspace)
  const hasCustomOverrides = selected.some(
    (s) => s.customLevel !== undefined && s.customLevel !== commonLevel,
  )
  const customSummary = (() => {
    const counts = new Map<ShareLevel, number>()
    for (const item of selected) {
      const level = effectiveItemLevel(item)
      counts.set(level, (counts.get(level) ?? 0) + 1)
    }
    return SHARE_LEVELS.filter((level) => (counts.get(level) ?? 0) > 0)
      .map((level) => `${counts.get(level)} ${label(level)}`)
      .join(' · ')
  })()

  const selectCandidate = (candidate: ShareCandidate) => {
    if (shelved) return
    const key = `${candidate.principalType}:${candidate.principalId}`
    if (selectedKeys.has(key)) return
    setSelected((prev) => [...prev, { key, candidate, onExisting: 'keep' }])
    setQuery('')
    setPendingPreview(null)
    setSubmitError(null)
  }
  const removeCandidate = (key: string, name: string) => {
    setSelected((prev) => prev.filter((item) => item.key !== key))
    setRejectedByKey((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
    setPendingPreview(null)
    setAnnouncement(t('shrPeopleRemoved', { name }))
  }
  // any change to what would be written drops a shown preview: the confirm box must never
  // commit items other than the ones its sentences describe
  const updateSelected = (key: string, patch: Partial<SelectedShareCandidate>) => {
    setSelected((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))
    setPendingPreview(null)
  }
  const confirmApplyAll = (level: ShareLevel) => {
    setCommonLevel(level)
    setSelected((prev) => prev.map((item) => ({ ...item, customLevel: undefined })))
    setPendingApplyAll(null)
    setPendingPreview(null)
  }

  const buildItems = (): ShareUpdateItem[] =>
    selected.map((item) => ({
      principalType: item.candidate.principalType,
      principalId: item.candidate.principalId,
      level: effectiveItemLevel(item),
      ...(item.candidate.directLevel !== null ? { onExisting: item.onExisting } : {}),
    }))

  const handleFailure = (failure: Extract<ShareResult<never>, { ok: false }>) => {
    if (failure.error === 'document_access_rejected' && failure.rejected?.length) {
      const next: Record<string, string> = {}
      for (const r of failure.rejected) next[`${r.principalType}:${r.principalId}`] = r.code
      setRejectedByKey(next)
      setSubmitError(
        failure.rejected
          .map((r) => {
            const match = selected.find(
              (s) =>
                s.candidate.principalType === r.principalType &&
                s.candidate.principalId === r.principalId,
            )
            return `${match?.candidate.name ?? r.principalId}: ${rejectedReason(r.code)}`
          })
          .join(' · '),
      )
      return
    }
    const key = shareErrorKey(failure.error)
    setSubmitError(t(key ?? 'shrSubmitFailed'))
  }

  const executeCommit = async (items: ShareUpdateItem[]) => {
    if (inFlight.current || shelved) return
    inFlight.current = true
    setPending(true)
    setSubmitError(null)
    setRejectedByKey({})
    try {
      const result = await api.update({ documentId, items, dryRun: false }).catch(bridgeFailed)
      if (!result.ok) {
        handleFailure(result)
        return
      }
      setSelected([])
      setQuery('')
      setCustomMode(false)
      previewClosedByButtons.current = true
      setPendingPreview(null)
      await onMutated(t('shrSharedToast', { count: items.length }))
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  const handleSubmit = async () => {
    if (shelved || !selected.length || pending || inFlight.current) return
    inFlight.current = true
    setPending(true)
    setSubmitError(null)
    setRejectedByKey({})
    const items = buildItems()
    const dry = await api.update({ documentId, items, dryRun: true }).catch(bridgeFailed)
    inFlight.current = false
    setPending(false)
    if (!dry.ok) {
      handleFailure(dry)
      return
    }
    if (dry.value.preview.warnings.length > 0) {
      setPendingPreview({ items, preview: dry.value.preview })
      return
    }
    await executeCommit(items)
  }

  const warningText = (warning: { code: string; index: number }) => {
    const item = selected[warning.index]
    const principalId = item?.candidate.principalId
    return warningSentence(
      { t, levelLabel: label, sourceLabel: (via) => viaLabel(t, via) },
      {
        code: warning.code,
        name: item?.candidate.name ?? '',
        principalType: item?.candidate.principalType ?? 'user',
        targetLevel: item ? effectiveItemLevel(item) : commonLevel,
        beforeLevel: item?.candidate.directLevel ?? undefined,
        user: pendingPreview?.preview.users.find((u) => u.userId === principalId),
        group: pendingPreview?.preview.groups.find(
          (g) => g.principalType === item?.candidate.principalType && g.principalId === principalId,
        ),
      },
    ).confirm
  }

  const cappedGroups = selected.some((s) => !allowedFor(s).includes('manage'))
  const onlyGroups =
    selected.length > 0 &&
    selected.every(
      (s) => s.candidate.principalType === 'organization' || s.candidate.isHomeWorkspace,
    )

  return (
    <section
      aria-labelledby={`${baseId}-title`}
      className="uw-share-section"
      data-share-section="add"
    >
      <div className="uw-share-section-head">
        <h3 id={`${baseId}-title`} className="uw-share-heading">
          {t('shrAddTitle')}
        </h3>
        {selected.length > 0 && (
          <span className="uw-share-muted">
            {t('shrSelectedCount', { count: selected.length })}
          </span>
        )}
      </div>

      <span className="uw-share-sr" aria-live="polite">
        {announcement}
      </span>

      <ShareCandidatePicker
        inputId={`${baseId}-input`}
        listboxId={`${baseId}-listbox`}
        query={query}
        onQueryChange={setQuery}
        onOpened={() => setOpened(true)}
        selected={selected}
        selectedKeys={selectedKeys}
        candidates={candidatesQuery.items}
        hasMore={candidatesQuery.hasMore}
        loadingMore={candidatesQuery.loadingMore}
        loadMoreError={candidatesQuery.loadMoreError}
        loadError={candidatesQuery.loadError}
        loading={candidatesQuery.loading}
        onLoadMore={candidatesQuery.loadMore}
        onRetry={candidatesQuery.retry}
        alreadySharedUserIds={alreadySharedUserIds}
        disabled={pending || shelved}
        rejectedByKey={rejectedByKey}
        onSelectCandidate={selectCandidate}
        onRemoveCandidate={removeCandidate}
        onChangeOnExisting={(key, onExisting) => updateSelected(key, { onExisting })}
        effectiveItemLevel={effectiveItemLevel}
        rejectedReason={rejectedReason}
      />

      <div className="uw-share-form-row">
        <div className="uw-share-form-left">
          <div className="uw-share-field">
            <label className="uw-act-label" htmlFor={`${baseId}-level`}>
              {t('shrLevelLabel')}
            </label>
            <select
              id={`${baseId}-level`}
              data-common-level
              className="uw-act-select"
              value={commonLevel}
              disabled={shelved}
              onChange={(e) => {
                const next = e.target.value as ShareLevel
                if (hasCustomOverrides) setPendingApplyAll(next)
                else {
                  setCommonLevel(next)
                  setPendingPreview(null)
                }
              }}
            >
              {(onlyGroups && commonLevel !== 'manage'
                ? (['view', 'comment', 'edit'] as const)
                : SHARE_LEVELS
              ).map((level) => (
                <option key={level} value={level}>
                  {label(level)}
                </option>
              ))}
            </select>
          </div>
          {selected.length > 1 && (
            <button
              type="button"
              className="btn"
              aria-expanded={customMode}
              aria-disabled={shelved || undefined}
              aria-describedby={shelved ? shelvedNoteId : undefined}
              onClick={() => {
                if (!shelved) setCustomMode((p) => !p)
              }}
            >
              {t('shrCustomLevelsToggle')}
            </button>
          )}
        </div>

        <button
          type="button"
          ref={submitRef}
          data-share-submit
          className="btn btn-primary"
          aria-disabled={shelved || !selected.length || pending || undefined}
          aria-describedby={shelved ? shelvedNoteId : undefined}
          aria-busy={pending || undefined}
          onClick={() => void handleSubmit()}
        >
          {pending ? t('shrSubmitting') : t('shrSubmit')}
        </button>
      </div>

      {commonLevel === 'manage' && cappedGroups && (
        <p role="status" className="uw-share-muted">
          {t('shrLevelManageCappedHint')}
        </p>
      )}

      {pendingApplyAll && (
        <div role="region" aria-label={t('shrApplyAllButton')} className="uw-share-note">
          <span>
            {t('shrApplyAllConfirm', { count: selected.length, level: label(pendingApplyAll) })}
          </span>
          <span className="uw-share-note-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => confirmApplyAll(pendingApplyAll)}
            >
              {t('shrApplyAllAccept')}
            </button>
            <button type="button" className="btn" onClick={() => setPendingApplyAll(null)}>
              {t('shrApplyAllCancel')}
            </button>
          </span>
        </div>
      )}

      {customMode && selected.length > 1 && (
        <ShareAddCustomLevels
          selected={selected}
          shelved={shelved}
          summaryText={customSummary}
          onApplyAll={() => {
            if (shelved) return
            if (hasCustomOverrides) setPendingApplyAll(commonLevel)
            else confirmApplyAll(commonLevel)
          }}
          allowedLevels={allowedFor}
          effectiveItemLevel={effectiveItemLevel}
          onChangeLevel={(key, customLevel) => updateSelected(key, { customLevel })}
        />
      )}

      {pendingPreview && (
        <div role="region" data-testid="share-add-confirm" className="uw-share-note warn">
          <ul className="uw-share-warnings">
            {pendingPreview.preview.warnings.map((w, idx) => (
              <li key={`${w.code}-${w.index}-${idx}`}>{warningText(w)}</li>
            ))}
          </ul>
          <span className="uw-share-note-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending}
              onClick={() => void executeCommit(pendingPreview.items)}
            >
              {t('shrConfirmAccept')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={pending}
              onClick={() => {
                previewClosedByButtons.current = true
                setPendingPreview(null)
              }}
            >
              {t('shrConfirmCancel')}
            </button>
          </span>
        </div>
      )}

      {submitError && (
        <p role="alert" className="uw-act-error">
          {submitError}
        </p>
      )}
    </section>
  )
}
