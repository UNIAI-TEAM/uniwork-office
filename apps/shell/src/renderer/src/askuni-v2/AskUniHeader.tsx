import type { ReactElement } from 'react'
import { useI18n } from '../locale'
import type { AskUniWorkspace } from '../../../shared/askuni-api'
import { AskUniHistory, type AskUniConversationsApi } from './AskUniHistory'

/**
 * One line: the workspace (a label, or a select with several), the conversation title that opens the
 * history, and a New conversation button. There is no full page button: the app has no dock to widen.
 */
export function AskUniHeader({
  workspaceId,
  workspaces,
  onWorkspaceChange,
  activeId,
  conversations,
  onSelect,
  onNew,
}: {
  workspaceId: string
  workspaces?: AskUniWorkspace[]
  onWorkspaceChange?: (id: string) => void
  activeId: string | null
  conversations: AskUniConversationsApi
  onSelect: (id: string | null) => void
  onNew: () => void
}): ReactElement {
  const { t } = useI18n()
  const current = conversations.items.find((c) => c.id === activeId)
  const title = current?.title || t('askUniV2Untitled')
  const workspaceName = workspaces?.find((w) => w.id === workspaceId)?.name
  return (
    <header className="askuni2-header">
      {workspaces && workspaces.length > 1 ? (
        <label className="askuni-workspace">
          <span className="askuni-workspace-label">{t('askUniWorkspace')}</span>
          <select
            className="askuni-workspace-select"
            value={workspaceId}
            onChange={(e) => onWorkspaceChange?.(e.target.value)}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      ) : workspaceName ? (
        <p className="askuni-workspace">
          <span className="askuni-workspace-label">{t('askUniWorkspace')}</span>
          <span className="askuni-workspace-name">{workspaceName}</span>
        </p>
      ) : null}
      <div className="askuni2-header-title">
        <AskUniHistory
          title={title}
          activeId={activeId}
          conversations={conversations}
          onSelect={onSelect}
        />
      </div>
      <button
        type="button"
        className="askuni2-icon-btn"
        aria-label={t('askUniV2NewConversation')}
        title={t('askUniV2NewConversation')}
        onClick={onNew}
      >
        <svg
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M13 9v2.5A1.5 1.5 0 0 1 11.5 13h-7A1.5 1.5 0 0 1 3 11.5v-7A1.5 1.5 0 0 1 4.5 3H7M11 2.5v4M9 4.5h4" />
        </svg>
      </button>
    </header>
  )
}
