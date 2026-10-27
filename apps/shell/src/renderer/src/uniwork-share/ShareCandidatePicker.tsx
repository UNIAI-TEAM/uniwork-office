import { useRef, useState } from 'react'
import type { ShareCandidate, ShareLevel, SharePrincipalType } from '../../../shared/share-api'
import { useI18n } from '../locale'
import { levelLabel as levelText } from './share-model'

export interface SelectedShareCandidate {
  key: string
  candidate: ShareCandidate
  /** a level picked for this person alone (differs from the common one) */
  customLevel?: ShareLevel
  /** a picked principal that already has a direct grant: keep it (default) or move it */
  onExisting: 'update' | 'keep'
}

const PRINCIPAL_GROUPS: SharePrincipalType[] = ['user', 'workspace', 'organization']

/** type glyph shared by the options, the chips, the custom-level list and the access rows */
export function SharePrincipalIcon({ principalType }: { principalType: string }) {
  return (
    <svg
      className="uw-share-icon"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {principalType === 'user' ? (
        <>
          <circle cx="8" cy="5.5" r="2.5" />
          <path d="M3 13.5c.4-2.4 2.4-3.6 5-3.6s4.6 1.2 5 3.6" />
        </>
      ) : principalType === 'workspace' ? (
        <>
          <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
          <path d="M2.5 6.5h11M6 6.5V13" />
        </>
      ) : (
        <>
          <rect x="3.5" y="2.5" width="9" height="11" rx="1" />
          <path d="M6 5.5h1M9 5.5h1M6 8h1M9 8h1M7 13.5v-2.5h2v2.5" />
        </>
      )}
    </svg>
  )
}

/** pixels from the bottom of the list at which the next page is requested */
const LOAD_MORE_THRESHOLD_PX = 48

export interface ShareCandidatePickerProps {
  inputId: string
  listboxId: string
  query: string
  onQueryChange: (value: string) => void
  /** the list is only asked for once the person opened it */
  onOpened: () => void
  selected: SelectedShareCandidate[]
  selectedKeys: Set<string>
  candidates: ShareCandidate[]
  hasMore: boolean
  loadingMore: boolean
  loadMoreError: boolean
  /** the first page failed: the "no result" empty state must not stand in for the failure */
  loadError: boolean
  loading: boolean
  onLoadMore: () => void
  onRetry: () => void
  alreadySharedUserIds: readonly (string | null | undefined)[]
  disabled: boolean
  /** nobody more can be added (the folder dialog's 100-item cap): the search is off, the chips stay removable */
  full?: boolean
  rejectedByKey: Record<string, string>
  onSelectCandidate: (candidate: ShareCandidate) => void
  onRemoveCandidate: (key: string, name: string) => void
  onChangeOnExisting: (key: string, onExisting: 'update' | 'keep') => void
  effectiveItemLevel: (item: SelectedShareCandidate) => ShareLevel
  rejectedReason: (code: string) => string
}

/** the combobox of the add-people area: search, grouped options, chips with the existing-access choice */
export function ShareCandidatePicker(props: ShareCandidatePickerProps) {
  const {
    inputId,
    listboxId,
    query,
    onQueryChange,
    onOpened,
    selected,
    selectedKeys,
    candidates,
    hasMore,
    loadingMore,
    loadMoreError,
    loadError,
    loading,
    onLoadMore,
    onRetry,
    alreadySharedUserIds,
    disabled,
    full,
    rejectedByKey,
    onSelectCandidate,
    onRemoveCandidate,
    onChangeOnExisting,
    effectiveItemLevel,
    rejectedReason,
  } = props
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const alreadyShared = new Set(alreadySharedUserIds.filter((id): id is string => Boolean(id)))
  const firstPageFailed = loadError && candidates.length === 0

  const show = () => {
    setOpen(true)
    onOpened()
  }
  const pickCandidate = (candidate: ShareCandidate) => {
    onSelectCandidate(candidate)
    setOpen(false)
  }

  return (
    <div
      ref={containerRef}
      className="uw-share-picker"
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null
        if (!next || !containerRef.current?.contains(next)) setOpen(false)
      }}
    >
      <label className="uw-act-label" htmlFor={inputId}>
        {t('shrPrincipalPlaceholder')}
      </label>

      {selected.length > 0 && (
        <ul aria-label={t('shrPeopleChosen')} className="uw-share-chips">
          {selected.map((item) => {
            const rejected = rejectedByKey[item.key]
            const { candidate } = item
            const title =
              candidate.principalType === 'user' && candidate.secondary
                ? `${candidate.name} <${candidate.secondary}>`
                : candidate.name
            const keepLabel = candidate.directLevel
              ? t('shrOnExistingKeep', { level: levelText(t, candidate.directLevel) })
              : ''
            const updateLabel = t('shrOnExistingUpdate', {
              level: levelText(t, effectiveItemLevel(item)),
            })
            return (
              <li
                key={item.key}
                data-chip={item.key}
                className={`uw-share-chip${rejected ? ' rejected' : ''}`}
              >
                <SharePrincipalIcon principalType={candidate.principalType} />
                <span className="uw-share-chip-name" title={title}>
                  {candidate.name}
                </span>
                {candidate.directLevel && (
                  <select
                    className="uw-act-select uw-share-chip-select"
                    aria-label={`${candidate.name} ${t('shrCandidateHasAccess', { level: levelText(t, candidate.directLevel) })}`}
                    value={item.onExisting}
                    onChange={(e) =>
                      onChangeOnExisting(item.key, e.target.value as 'update' | 'keep')
                    }
                  >
                    <option value="keep">{keepLabel}</option>
                    <option value="update">{updateLabel}</option>
                  </select>
                )}
                {rejected && (
                  <span
                    className="uw-share-chip-reason"
                    data-rejected-reason={candidate.principalId}
                  >
                    {rejectedReason(rejected)}
                  </span>
                )}
                <button
                  type="button"
                  className="uw-share-chip-x"
                  aria-label={t('shrPeopleRemove', { name: candidate.name })}
                  disabled={disabled}
                  onClick={() => onRemoveCandidate(item.key, candidate.name)}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                    <path
                      d="M2 2l6 6M8 2l-6 6"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <input
        ref={inputRef}
        id={inputId}
        className="uw-act-input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && !firstPageFailed}
        aria-controls={firstPageFailed ? undefined : listboxId}
        placeholder={t('shrCandidateSearch')}
        value={query}
        disabled={disabled || full}
        // not on focus: the dialog focuses this input when it opens, and a list that opened then
        // collapses on the first press elsewhere, moving the control under the pointer
        onClick={show}
        onChange={(event) => {
          onQueryChange(event.target.value)
          show()
          setActiveIndex(0)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            show()
            setActiveIndex((i) => (candidates.length ? (i + 1) % candidates.length : 0))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            show()
            setActiveIndex((i) =>
              candidates.length ? (i - 1 + candidates.length) % candidates.length : 0,
            )
          } else if (event.key === 'Enter' && open && candidates[activeIndex]) {
            event.preventDefault()
            pickCandidate(candidates[activeIndex]!)
          }
        }}
      />

      {firstPageFailed && (
        <div className="uw-share-note error" role="alert">
          <span>{t('shrCandidatesError')}</span>
          <button type="button" className="btn" onClick={onRetry}>
            {t('shrRetry')}
          </button>
        </div>
      )}

      {open && !firstPageFailed && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={t('shrPrincipalPlaceholder')}
          className="uw-share-listbox"
          onScroll={(event) => {
            const el = event.currentTarget
            if (
              hasMore &&
              !loadingMore &&
              el.scrollHeight - el.scrollTop - el.clientHeight <= LOAD_MORE_THRESHOLD_PX
            ) {
              onLoadMore()
            }
          }}
        >
          {loading && candidates.length === 0 ? (
            <div className="uw-share-listbox-note">{t('shrPeopleLoading')}</div>
          ) : candidates.length === 0 ? (
            <div className="uw-share-listbox-note">{t('shrPrincipalEmpty')}</div>
          ) : (
            PRINCIPAL_GROUPS.map((groupType) => {
              const items = candidates.filter((c) => c.principalType === groupType)
              if (items.length === 0) return null
              return (
                <div key={groupType} className="uw-share-group">
                  <div className="uw-share-group-title">
                    {groupType === 'user'
                      ? t('shrPrincipalUser')
                      : groupType === 'workspace'
                        ? t('shrPrincipalWorkspace')
                        : t('shrPrincipalOrganization')}
                  </div>
                  {items.map((candidate) => {
                    const key = `${candidate.principalType}:${candidate.principalId}`
                    const picked = selectedKeys.has(key)
                    const subtitle =
                      candidate.principalType === 'user'
                        ? candidate.secondary
                        : candidate.principalType === 'workspace'
                          ? t('shrCandidateWorkspaceSub')
                          : t('shrCandidateOrganizationSub')
                    return (
                      <div
                        key={key}
                        role="option"
                        tabIndex={-1}
                        aria-selected={picked}
                        aria-disabled={picked || undefined}
                        className="uw-share-option"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickCandidate(candidate)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            pickCandidate(candidate)
                          }
                        }}
                      >
                        <span className="uw-share-option-main">
                          <SharePrincipalIcon principalType={candidate.principalType} />
                          <span className="uw-share-option-text">
                            <span className="uw-share-option-name" title={candidate.name}>
                              {candidate.name}
                              {candidate.isHomeWorkspace && (
                                <span className="uw-share-badge">{t('shrHomeBadge')}</span>
                              )}
                            </span>
                            {subtitle && <span className="uw-share-option-sub">{subtitle}</span>}
                            {candidate.directLevel && (
                              <span className="uw-share-badge outline">
                                {t('shrCandidateHasAccess', {
                                  level: levelText(t, candidate.directLevel),
                                })}
                              </span>
                            )}
                          </span>
                        </span>
                        {!candidate.directLevel &&
                          candidate.principalType === 'user' &&
                          alreadyShared.has(candidate.principalId) && (
                            <span className="uw-share-option-sub">
                              {t('shrPeopleAlreadyShared')}
                            </span>
                          )}
                      </div>
                    )
                  })}
                </div>
              )
            })
          )}
          {(hasMore || loadingMore || loadMoreError) && (
            <div role="presentation" className="uw-share-more">
              {loadMoreError && !loadingMore && (
                <span role="status" className="uw-share-more-error">
                  {t('shrCandidatesError')}
                </span>
              )}
              <button
                type="button"
                className="btn"
                aria-disabled={loadingMore || undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (loadingMore) return
                  if (loadMoreError) onRetry()
                  else onLoadMore()
                  inputRef.current?.focus()
                }}
              >
                {loadingMore
                  ? t('shrPeopleLoading')
                  : loadMoreError
                    ? t('shrRetry')
                    : t('shrCandidatesMore')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
