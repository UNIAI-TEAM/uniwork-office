import { useI18n } from '../locale'
import { GROUP_LABEL_KEY, type GroupId } from './groups'

/**
 * The header row of a day / week group: a full-width toggle that collapses or
 * opens the rows under it (`aria-expanded`). Its name says which group it is.
 */
export function GroupHeader({
  id,
  open,
  onToggle,
}: {
  id: GroupId
  open: boolean
  onToggle: (id: GroupId) => void
}) {
  const { t } = useI18n()
  const label = t(GROUP_LABEL_KEY[id])
  return (
    <div role="row" className="dh-group-row" data-group={id}>
      <div role="cell" className="dh-group-cell">
        <button
          type="button"
          className="dh-group-toggle"
          aria-expanded={open}
          aria-label={t('dlGroupToggle', { group: label })}
          onClick={() => onToggle(id)}
        >
          <svg
            className="dh-group-chevron"
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2.5 3.5L5 6.5l2.5-3" />
          </svg>
          <span>{label}</span>
        </button>
      </div>
    </div>
  )
}
