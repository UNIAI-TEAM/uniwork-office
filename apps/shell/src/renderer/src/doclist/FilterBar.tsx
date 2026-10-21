import { useCallback, useState, type ReactNode } from 'react'
import { useI18n } from '../locale'
import {
  DEFAULT_DOCUMENTS_HOME_FILTERS,
  DOCUMENTS_HOME_TYPE_CHIPS,
  DOCUMENTS_HOME_UPDATED_OPTIONS,
  hasActiveFilters,
  updatedByOptionsForSelect,
  type DocumentsHomeFilterState,
  type DocumentsHomeTypeFilter,
  type DocumentsHomeUpdatedPreset,
  type UpdatedByOption,
} from '../uniwork-home/documents-home-model'
import type { DocListScreen } from './columns'

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
  /** a control that leads the row, before the type chips (Recent's Tất cả / Đã mở / Đã sửa) */
  lead?: ReactNode
}

/**
 * The quick filters every UniWork screen shares (Rules board): the type chips in one fixed order,
 * then Người sửa and Cập nhật. The list reloads from its first page on every change. A screen
 * with a `lead` (Recent's segment) keeps it in this row, and the two selects sit at the far end.
 */
export function FilterBar({ filters, onChange, authors, lead }: FilterBarProps) {
  const { t } = useI18n()
  const patch = (part: Partial<DocumentsHomeFilterState>) => onChange({ ...filters, ...part })
  return (
    <div className={`dh-filter-bar${lead ? ' has-lead' : ''}`}>
      {lead}
      <div
        className="dh-filter-chips"
        role="group"
        aria-label={t('uhFilterType').replace(/[:：]\s*$/, '')}
      >
        {DOCUMENTS_HOME_TYPE_CHIPS.map((chip) => {
          const on = filters.format === chip.value
          return (
            <button
              key={chip.value}
              type="button"
              className={`dh-filter-type${on ? ' on' : ''}`}
              data-chip={chip.value}
              aria-pressed={on}
              onClick={() => patch({ format: chip.value as DocumentsHomeTypeFilter })}
            >
              {chip.labelKey ? t(chip.labelKey) : chip.literal}
            </button>
          )
        })}
      </div>

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
