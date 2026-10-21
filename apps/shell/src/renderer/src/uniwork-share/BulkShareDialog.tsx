import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  SHARE_LEVELS,
  type ShareBulkFailure,
  type ShareBulkLink,
  type ShareBulkPlan,
  type ShareBulkResult,
  type ShareBulkWorkspace,
  type ShareCandidate,
  type ShareLevel,
  type ShareResult,
  type UniworkShareApi,
} from '../../../shared/share-api'
import { ActionModal } from '../UniworkDocActions'
import { useI18n, type StringKey } from '../locale'
import { ShareCandidatePicker, type SelectedShareCandidate } from './ShareCandidatePicker'
import {
  allowedLevelsForPrincipal,
  levelLabel as levelText,
  linkErrorKey,
  plural,
} from './share-model'
import { useShareCandidates } from './use-share'
import './share-dialog.css'

/** what the dialog reads of a document: its id, its own home workspace and a title for the result */
export interface BulkShareDoc {
  id: string
  workspaceId: string
  title: string
}

export interface BulkShareDialogProps {
  open: boolean
  /** the documents to share: every one passed the Share gate and is manageable */
  docs: readonly BulkShareDoc[]
  /** the bridge; defaults to `window.uniworkShare` (tests pass the in-memory fake) */
  api?: UniworkShareApi
  onClose: () => void
  /** the run settled, whatever its outcome: the list refetches once */
  onChanged?: () => void
  /** the run settled with an answer from main: the page reports it and clears the selection */
  onApplied?: (result: ShareBulkResult) => void
}

const WORKSPACE_CHOICES: readonly ShareBulkWorkspace[] = ['keep', 'view', 'comment', 'edit', 'none']
const LINK_CHOICES: readonly ShareBulkLink[] = ['keep', 'create', 'revoke']
const LINK_KEYS: Record<ShareBulkLink, StringKey> = {
  keep: 'shrBulkLinkKeep',
  create: 'shrBulkLinkCreate',
  revoke: 'shrBulkLinkRevoke',
}

/** the clipboard, with the old textarea route where the async one is absent or refused */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const copied = document.execCommand('copy')
      area.remove()
      return copied
    } catch {
      return false
    }
  }
}

/** the reason of one failed document, in the bulk bar's own words (the web's `error.*`) */
function failureKey(failure: ShareBulkFailure): StringKey {
  if (failure.retryable) return 'shrBulkErrBusy'
  switch (failure.error) {
    case 'forbidden':
      return 'shrBulkErrForbidden'
    case 'not_found':
      return 'shrBulkErrNotFound'
    case 'malformed_response':
      return 'shrBulkErrNotVerifiable'
    case 'folder_not_shareable':
    case 'my_folder_locked':
      return 'shrBulkErrNotShareable'
    default:
      return linkErrorKey(failure.error) ?? 'shrBulkErrFailed'
  }
}

/**
 * Chia sẻ on the bulk bar, a clone of the web's W13 dialog: the single dialog's add area (the same
 * picker and one level for everybody picked), a home-workspace choice and a public-link choice,
 * applied the same way to every document. There is no access list (it differs per document); a
 * picked person who already has a direct grant keeps it unless the box says otherwise. The run
 * is the bridge's sequential `bulk`; the answer is a per-document result list, and created link
 * URLs are shown here once with "copy all".
 */
export function BulkShareDialog(props: BulkShareDialogProps) {
  if (!props.open) return null
  return <BulkShareBody {...props} />
}

function BulkShareBody({ docs, api, onClose, onChanged, onApplied }: BulkShareDialogProps) {
  const { t } = useI18n()
  const shareApi = api ?? window.uniworkShare
  const baseId = useId()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [opened, setOpened] = useState(false)
  const [selected, setSelected] = useState<SelectedShareCandidate[]>([])
  const [level, setLevel] = useState<ShareLevel>('view')
  const [updateExisting, setUpdateExisting] = useState(false)
  const [workspace, setWorkspace] = useState<ShareBulkWorkspace>('keep')
  const [link, setLink] = useState<ShareBulkLink>('keep')
  const [expiry, setExpiry] = useState('7')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ShareBulkResult | null>(null)
  const [copied, setCopied] = useState<boolean | null>(null)
  // the state flips after the click; the ref closes the gap for a fast second one
  const inFlight = useRef(false)

  // the form's Submit button unmounts when the result view replaces it; focus goes to Close so
  // Esc and the Tab trap (listening on the dialog) keep working
  const resultRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (result) resultRef.current?.querySelector<HTMLElement>('[data-bulk-close]')?.focus()
  }, [result])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setDebouncedQuery('')
      return
    }
    const timer = setTimeout(() => setDebouncedQuery(trimmed), 250)
    return () => clearTimeout(timer)
  }, [query])

  // the candidates come from the first document: the people of the organization are the same for
  // all of them, but a direct grant is not, so none is shown
  const firstId = docs[0]?.id ?? ''
  const candidatesQuery = useShareCandidates(
    shareApi,
    firstId,
    debouncedQuery,
    opened && result === null,
  )
  const candidates = useMemo<ShareCandidate[]>(
    () => candidatesQuery.items.map((item) => ({ ...item, directLevel: null })),
    [candidatesQuery.items],
  )
  const selectedKeys = useMemo(() => new Set(selected.map((s) => s.key)), [selected])

  const label = (value: string | null | undefined) => levelText(t, value)
  const effectiveItemLevel = (item: SelectedShareCandidate): ShareLevel =>
    allowedLevelsForPrincipal(
      item.candidate.principalType,
      item.candidate.isHomeWorkspace,
    ).includes(level)
      ? level
      : 'edit'
  const workspaceLabel = (choice: ShareBulkWorkspace) =>
    choice === 'keep'
      ? t('shrBulkKeep')
      : choice === 'none'
        ? t('shrBulkWorkspaceNone')
        : t('shrBulkWorkspaceLevel', { level: label(choice) })

  const nothing = selected.length === 0 && workspace === 'keep' && link === 'keep'
  const blocked = pending || nothing

  const titleOf = useMemo(
    () => new Map(docs.map((doc) => [doc.id, doc.title.trim() || t('shrBulkUntitled')])),
    // `t` is not referentially stable; the titles only change with the documents
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docs],
  )

  const apply = async () => {
    if (blocked || inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError(null)
    const days = Number.parseInt(expiry, 10)
    const plan: ShareBulkPlan = {
      docs: [...new Map(docs.map((doc) => [doc.id, doc])).values()].map((doc) => ({
        id: doc.id,
        workspaceId: doc.workspaceId,
      })),
      people: selected.map((item) => ({
        principalType: item.candidate.principalType,
        principalId: item.candidate.principalId,
        level: effectiveItemLevel(item),
      })),
      onExisting: updateExisting ? 'update' : 'keep',
      workspace,
      link,
      ...(link === 'create' && Number.isFinite(days)
        ? { expiresInDays: Math.min(90, Math.max(1, days)) }
        : {}),
    }
    const answer = await shareApi
      .bulk(plan)
      .catch((): ShareResult<never> => ({ ok: false, error: 'network' }))
    inFlight.current = false
    setPending(false)
    // whatever the outcome, some document may have changed
    onChanged?.()
    if (!answer.ok) {
      setError(t('shrSubmitFailed'))
      return
    }
    onApplied?.(answer.value)
    if (answer.value.failed.length === 0 && answer.value.links.length === 0) onClose()
    else setResult(answer.value)
  }

  const copyAll = async () => {
    if (!result) return
    const text = result.links
      .map((entry) => `${titleOf.get(entry.id) ?? t('shrBulkUntitled')}\t${entry.url}`)
      .join('\n')
    setCopied(await copyText(text))
  }

  const titleId = `${baseId}-title`
  const descriptionId = `${baseId}-desc`
  const count = new Set(docs.map((doc) => doc.id)).size
  const ids = {
    input: `${baseId}-input`,
    listbox: `${baseId}-listbox`,
    level: `${baseId}-level`,
    existing: `${baseId}-existing`,
    workspace: `${baseId}-ws`,
    link: `${baseId}-link`,
    expiry: `${baseId}-expiry`,
  }

  return (
    <ActionModal
      labelledBy={titleId}
      describedBy={descriptionId}
      className="uw-share uw-bulk-share"
      onCancel={pending ? () => {} : onClose}
    >
      <header className="uw-share-header">
        <div className="uw-share-header-text">
          <h2 id={titleId} className="uw-act-heading uw-share-title">
            {plural(t, 'shrBulkTitle', count)}
          </h2>
          <p id={descriptionId} className="uw-share-muted">
            {plural(t, 'shrBulkAppliesTo', count)}
          </p>
        </div>
      </header>

      {result ? (
        <div className="uw-share-body" data-bulk-result ref={resultRef}>
          <p role="status" className="uw-share-notice">
            {t('shrBulkDone', { ok: result.ok.length, total: count })}
          </p>
          {result.failed.length > 0 && (
            <ul className="uw-bulk-failures">
              {result.failed.map((failure) => (
                <li key={failure.id} data-bulk-failure className="uw-act-error">
                  {t('shrBulkErrorLine', {
                    title: titleOf.get(failure.id) ?? t('shrBulkUntitled'),
                    reason: t(failureKey(failure)),
                  })}
                </li>
              ))}
            </ul>
          )}
          {result.links.length > 0 && (
            <section data-bulk-links className="uw-share-note uw-bulk-links">
              <h3 className="uw-share-heading">{t('shrBulkLinksCreated')}</h3>
              <ul aria-label={t('shrBulkLinksCreated')} className="uw-bulk-link-list">
                {result.links.map((entry) => (
                  <li key={entry.id}>
                    <span className="uw-bulk-link-title">
                      {titleOf.get(entry.id) ?? t('shrBulkUntitled')}
                    </span>
                    <span className="uw-bulk-link-url">{entry.url}</span>
                  </li>
                ))}
              </ul>
              <p className="uw-share-muted">{t('shrLinkUrlOnce')}</p>
              <div>
                <button
                  type="button"
                  className="btn"
                  data-bulk-copy-all
                  onClick={() => void copyAll()}
                >
                  {copied ? t('shrLinkCopied') : t('shrBulkCopyAll')}
                </button>
              </div>
              {copied === false && (
                <p role="alert" className="uw-act-error">
                  {t('shrBulkCopyFailed')}
                </p>
              )}
            </section>
          )}
          <div className="modal-buttons">
            <button type="button" className="btn btn-primary" data-bulk-close onClick={onClose}>
              {t('shrBulkClose')}
            </button>
          </div>
        </div>
      ) : (
        <div className="uw-share-body" data-bulk-share>
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
              rejectedByKey={{}}
              onSelectCandidate={(candidate) => {
                const key = `${candidate.principalType}:${candidate.principalId}`
                if (selectedKeys.has(key)) return
                setSelected((prev) => [...prev, { key, candidate, onExisting: 'keep' }])
                setQuery('')
              }}
              onRemoveCandidate={(key) => setSelected((prev) => prev.filter((s) => s.key !== key))}
              onChangeOnExisting={() => {}}
              effectiveItemLevel={effectiveItemLevel}
              rejectedReason={() => t('shrRejectedUnknown')}
            />
            <div className="uw-share-form-row">
              <div className="uw-share-field">
                <label className="uw-act-label" htmlFor={ids.level}>
                  {t('shrLevelLabel')}
                </label>
                <select
                  id={ids.level}
                  data-bulk-level
                  className="uw-act-select"
                  value={level}
                  disabled={pending}
                  onChange={(e) => setLevel(e.target.value as ShareLevel)}
                >
                  {SHARE_LEVELS.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                </select>
              </div>
              <label className="uw-bulk-check" htmlFor={ids.existing}>
                <input
                  id={ids.existing}
                  type="checkbox"
                  data-bulk-update-existing
                  checked={updateExisting}
                  disabled={pending}
                  onChange={(e) => setUpdateExisting(e.target.checked)}
                />
                <span>{t('shrBulkUpdateExisting')}</span>
              </label>
            </div>
          </section>

          <div className="uw-bulk-choices">
            <div className="uw-share-field">
              <label className="uw-act-label" htmlFor={ids.workspace}>
                {t('shrBulkWorkspaceLabel')}
              </label>
              <select
                id={ids.workspace}
                data-bulk-workspace
                className="uw-act-select"
                value={workspace}
                disabled={pending}
                onChange={(e) => setWorkspace(e.target.value as ShareBulkWorkspace)}
              >
                {WORKSPACE_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {workspaceLabel(choice)}
                  </option>
                ))}
              </select>
            </div>
            <div className="uw-share-field">
              <label className="uw-act-label" htmlFor={ids.link}>
                {t('shrBulkLinkLabel')}
              </label>
              <select
                id={ids.link}
                data-bulk-link
                className="uw-act-select"
                value={link}
                disabled={pending}
                onChange={(e) => setLink(e.target.value as ShareBulkLink)}
              >
                {LINK_CHOICES.map((choice) => (
                  <option key={choice} value={choice}>
                    {t(LINK_KEYS[choice])}
                  </option>
                ))}
              </select>
            </div>
            {link === 'create' && (
              <div className="uw-share-field">
                <label className="uw-act-label" htmlFor={ids.expiry}>
                  {t('shrLinkExpiryLabel')}
                </label>
                <input
                  id={ids.expiry}
                  data-bulk-expiry
                  className="uw-act-input"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={90}
                  value={expiry}
                  disabled={pending}
                  onChange={(e) => setExpiry(e.target.value)}
                />
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="uw-act-error">
              {error}
            </p>
          )}

          <div className="modal-buttons">
            <button
              type="button"
              className="btn"
              data-bulk-cancel
              disabled={pending}
              onClick={onClose}
            >
              {t('shrConfirmCancel')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-bulk-submit
              aria-disabled={blocked || undefined}
              aria-busy={pending || undefined}
              onClick={() => void apply()}
            >
              {pending ? t('shrSubmitting') : t('shrSubmit')}
            </button>
          </div>
        </div>
      )}
    </ActionModal>
  )
}
