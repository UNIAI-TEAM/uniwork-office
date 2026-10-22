import { useCallback, useRef, useState, type ReactNode } from 'react'
import { FileBadge } from '../FileBadge'
import { useI18n } from '../locale'
import {
  DEFAULT_DOCUMENTS_HOME_FILTERS,
  DOCUMENTS_HOME_UPDATED_OPTIONS,
  hasActiveFilters,
  toggleTypePick,
  updatedByOptionsForSelect,
  type DocumentsHomeFilterState,
  type DocumentsHomeTypePick,
  type DocumentsHomeUpdatedPreset,
  type UpdatedByOption,
} from '../uniwork-home/documents-home-model'
import type { DocListScreen } from './columns'
import { TypeFilter, typePickLabel } from './TypeFilter'

type FiltersByScreen = Partial<Record<DocListScreen, DocumentsHomeFilterState>>

/**
 * The filters a person set, one set per screen: leaving a screen keeps its choice for the way back
 * and never carries it onto another screen. Held in memory only (the shared rules remember sorts and
 * groups, not filters); `reset` starts every screen clean (another workspace).
 */
export function useDocListFilters(
  screen: DocListScreen,
): readonly [DocumentsHomeFilterState, (next: DocumentsHomeFilterState) => void, () => void] {
  const [byScreen, setByScreen] = useState<FiltersByScreen>({})
  const set = useCallback(
    (next: DocumentsHomeFilterState) => setByScreen((prev) => ({ ...prev, [screen]: next })),
    [screen],
  )
  const reset = useCallback(() => setByScreen({}), [])
  return [byScreen[screen] ?? DEFAULT_DOCUMENTS_HOME_FILTERS, set, reset] as const
}

export interface FilterBarProps {
  filters: DocumentsHomeFilterState
  onChange: (next: DocumentsHomeFilterState) => void
  /** the people the loaded rows name as last editor (never a raw id) */
  authors: readonly UpdatedByOption[]
  /** a control that leads the row, before the Type control (Recent's Tất cả / Đã mở / Đã sửa) */
  lead?: ReactNode
  /** types this screen's rows can never match (Từ nơi khác lists files only: no UniNote) */
  hideTypes?: readonly DocumentsHomeTypePick[]
}

/**
 * The quick filters every UniWork screen shares: the one Type control (a menu of checkable types),
 * then Người sửa and Cập nhật, then one removable chip per picked type. The list reloads from its
 * first page on every change. A screen with a `lead` (Recent's segment) keeps it first in this row.
 */
export function FilterBar({ filters, onChange, authors, lead, hideTypes }: FilterBarProps) {
  const { t } = useI18n()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const patch = (part: Partial<DocumentsHomeFilterState>) => onChange({ ...filters, ...part })
  const removePick = (pick: DocumentsHomeTypePick) => {
    patch({ types: toggleTypePick(filters.types, pick) })
    // the chip is about to be gone: focus goes to the Type trigger, never to the body
    triggerRef.current?.focus()
  }
  return (
    <div className={`dh-filter-bar${lead ? ' has-lead' : ''}`}>
      {lead}
      <TypeFilter
        types={filters.types}
        onChange={(types) => patch({ types })}
        hideTypes={hideTypes}
        triggerRef={triggerRef}
      />

      {/* one group, so the two selects wrap together and render at one width (N-04) */}
      <div className="dh-filter-selects">
        <label className="dh-filter-chip">
          <span className="dh-filter-k">{t('uhFilterModifiedBy')}</span>
          <select
            className="dh-filter-select"
            data-filter="updatedBy"
            aria-label={t('uhFilterModifiedBy')}
            value={filters.updatedBy}
            onChange={(e) => patch({ updatedBy: e.target.value })}
          >
            <option value="">{t('uhFilterAnyPerson')}</option>
            {updatedByOptionsForSelect(authors, filters.updatedBy, t('uwEditLockSomeone')).map(
              (author) => (
                <option key={author.id} value={author.id}>
                  {author.name}
                </option>
              ),
            )}
          </select>
        </label>

        <label className="dh-filter-chip">
          <span className="dh-filter-k">{t('uhFilterUpdated')}</span>
          <select
            className="dh-filter-select"
            data-filter="updatedFrom"
            aria-label={t('uhFilterUpdated')}
            value={filters.updatedPreset}
            onChange={(e) => patch({ updatedPreset: e.target.value as DocumentsHomeUpdatedPreset })}
          >
            {DOCUMENTS_HOME_UPDATED_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {filters.types.length > 0 && (
        <div className="dh-filter-chips">
          {filters.types.map((pick) => {
            const name = typePickLabel(t, pick)
            return (
              <span key={pick} className="dh-type-chip" data-chip={pick}>
                <FileBadge ext={pick} size={16} />
                {name}
                <button
                  type="button"
                  className="dh-type-chip-x"
                  aria-label={t('uhFilterTypeRemove', { type: name })}
                  onClick={() => removePick(pick)}
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="12"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    aria-hidden="true"
                    focusable="false"
                  >
                    <path d="m4 4 8 8M12 4l-8 8" />
                  </svg>
                </button>
              </span>
            )
          })}
        </div>
      )}

      {hasActiveFilters(filters) && (
        <button
          type="button"
          className="dh-filter-clear"
          onClick={() => onChange(DEFAULT_DOCUMENTS_HOME_FILTERS)}
        >
          {t('uhFilterClear')}
        </button>
      )}
    </div>
  )
}
