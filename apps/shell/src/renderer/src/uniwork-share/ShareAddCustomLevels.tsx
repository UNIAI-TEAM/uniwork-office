import type { ShareLevel } from '../../../shared/share-api'
import { useI18n } from '../locale'
import { levelLabel } from './share-model'
import { SharePrincipalIcon, type SelectedShareCandidate } from './ShareCandidatePicker'

interface ShareAddCustomLevelsProps {
  selected: SelectedShareCandidate[]
  shelved: boolean
  summaryText: string
  onApplyAll: () => void
  allowedLevels: (item: SelectedShareCandidate) => readonly ShareLevel[]
  effectiveItemLevel: (item: SelectedShareCandidate) => ShareLevel
  onChangeLevel: (key: string, level: ShareLevel) => void
}

/** the per-person level list the "custom levels" toggle opens under the form */
export function ShareAddCustomLevels({
  selected,
  shelved,
  summaryText,
  onApplyAll,
  allowedLevels,
  effectiveItemLevel,
  onChangeLevel,
}: ShareAddCustomLevelsProps) {
  const { t } = useI18n()
  return (
    <div className="uw-share-custom">
      <div className="uw-share-custom-head">
        <span role="status" className="uw-share-custom-summary">
          {t('shrCustomLevelsSummary', { summary: summaryText })}
        </span>
        <button type="button" className="btn" disabled={shelved} onClick={onApplyAll}>
          {t('shrApplyAllButton')}
        </button>
      </div>
      <ul className="uw-share-list">
        {selected.map((item) => (
          <li key={item.key} className="uw-share-custom-row">
            <span className="uw-share-custom-name">
              <SharePrincipalIcon principalType={item.candidate.principalType} />
              <span title={item.candidate.name}>{item.candidate.name}</span>
            </span>
            <span className="uw-share-custom-type">
              {item.candidate.principalType === 'user'
                ? t('shrPrincipalUser')
                : item.candidate.principalType === 'workspace'
                  ? t('shrPrincipalWorkspace')
                  : t('shrPrincipalOrganization')}
            </span>
            <select
              className="uw-act-select uw-share-level-select"
              aria-label={t('shrLevelFor', { name: item.candidate.name })}
              value={effectiveItemLevel(item)}
              disabled={shelved}
              onChange={(e) => onChangeLevel(item.key, e.target.value as ShareLevel)}
            >
              {allowedLevels(item).map((level) => (
                <option key={level} value={level}>
                  {levelLabel(t, level)}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </div>
  )
}
