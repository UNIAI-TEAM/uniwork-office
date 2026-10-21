import type { ReactNode } from 'react'
import type {
  ShareGrant,
  ShareLevel,
  SharePersonAccess,
  ShareSource,
} from '../../../shared/share-api'
import { useI18n } from '../locale'
import {
  allowedLevelsForPrincipal,
  levelLabel as levelText,
  levelRank,
  viaLabel,
} from './share-model'
import { SharePrincipalIcon } from './ShareCandidatePicker'

/** everything a row needs from the list: labels, flags and the one change callback */
export interface ShareAccessRowContext {
  canManage: boolean
  updatePending: boolean
  /** a shelved document only lets access be taken away: a raise and a first grant are off */
  shelved: boolean
  resolveMemberName: (userId: string) => string | null
  formatSourceOrigin: (src: Pick<ShareSource, 'via' | 'principalType' | 'principalId'>) => string
  /** the control that opened a confirm panel takes its focus back when the panel closes */
  setOpenerEl: (opener: 'revoke' | 'level', rowKey: string, el: HTMLElement | null) => void
  requestRowChange: (
    rowKey: string,
    principalType: string,
    principalId: string,
    name: string,
    beforeLevel: ShareLevel | null,
    nextLevel: ShareLevel | null,
  ) => Promise<void>
}

export interface ShareAccessHomeRow {
  workspaceId: string
  workspaceName: string
  level: ShareLevel | null
}

export function NameOrSkeleton({ name }: { name: string | null }) {
  return name === null ? (
    <span aria-hidden="true" className="uw-share-skeleton" />
  ) : (
    <span className="uw-share-row-name" title={name}>
      {name}
    </span>
  )
}

export function AclOwnerRow({
  owner,
  ctx,
}: {
  owner: SharePersonAccess
  ctx: ShareAccessRowContext
}) {
  const { t } = useI18n()
  return (
    <li className="uw-share-row" data-share-row={`owner:${owner.userId}`}>
      <span className="uw-share-row-main">
        <svg
          className="uw-share-icon"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        >
          <path d="M8 1.8l5 1.8v4c0 3-2.1 5-5 6.6-2.9-1.6-5-3.6-5-6.6v-4z" />
          <path d="M5.8 8l1.6 1.6L10.4 6.5" strokeLinecap="round" />
        </svg>
        <NameOrSkeleton name={ctx.resolveMemberName(owner.userId)} />
        <span className="uw-share-muted">{t('shrAclOwner')}</span>
      </span>
    </li>
  )
}

/** the level badge (read-only) or the level select with its Revoke button */
function LevelControls({
  rowKey,
  principalType,
  principalId,
  name,
  ariaName,
  level,
  allowed,
  disabled,
  ctx,
}: {
  rowKey: string
  principalType: string
  principalId: string
  name: string
  ariaName: string
  level: ShareLevel | null
  allowed: readonly ShareLevel[]
  disabled: boolean
  ctx: ShareAccessRowContext
}) {
  const { t } = useI18n()
  const { shelved, setOpenerEl, requestRowChange, updatePending } = ctx
  return (
    <span className="uw-share-row-controls">
      {level !== null ? (
        <select
          ref={(el) => setOpenerEl('level', rowKey, el)}
          className="uw-act-select uw-share-level-select"
          aria-label={t('shrLevelFor', { name: ariaName })}
          value={level}
          disabled={disabled}
          onChange={(e) =>
            void requestRowChange(
              rowKey,
              principalType,
              principalId,
              name,
              level,
              e.target.value as ShareLevel,
            )
          }
        >
          {allowed.map((option) => (
            <option
              key={option}
              value={option}
              disabled={shelved && levelRank(option) > levelRank(level)}
            >
              {levelText(t, option)}
            </option>
          ))}
        </select>
      ) : (
        <span className="uw-share-badge outline">{levelText(t, level)}</span>
      )}
      <button
        ref={(el) => setOpenerEl('revoke', rowKey, el)}
        type="button"
        className="btn uw-share-revoke"
        disabled={updatePending}
        aria-label={`${t('shrRevoke')} ${ariaName}`.trim()}
        onClick={() => void requestRowChange(rowKey, principalType, principalId, name, level, null)}
      >
        {t('shrRevoke')}
      </button>
    </span>
  )
}

export function HomeWorkspaceRow({
  homeRow,
  rowKey,
  displayLabel,
  ctx,
  confirmPanel,
}: {
  homeRow: ShareAccessHomeRow
  rowKey: string
  displayLabel: string
  ctx: ShareAccessRowContext
  confirmPanel: ReactNode
}) {
  const { t } = useI18n()
  return (
    <li className="uw-share-row stacked" data-share-row={rowKey}>
      <div className="uw-share-row-line">
        <span className="uw-share-row-main stacked">
          <span className="uw-share-row-head">
            <SharePrincipalIcon principalType="workspace" />
            <span className="uw-share-row-name" title={displayLabel}>
              {displayLabel}
            </span>
          </span>
          <span className="uw-share-row-sub">
            <span className="uw-share-badge">{t('shrHomeBadge')}</span>
          </span>
        </span>
        {ctx.canManage ? (
          <LevelControls
            rowKey={rowKey}
            principalType="workspace"
            principalId={homeRow.workspaceId}
            name={displayLabel}
            ariaName={homeRow.workspaceName || t('shrPrincipalWorkspace')}
            level={homeRow.level}
            allowed={allowedLevelsForPrincipal('workspace', true)}
            disabled={false}
            ctx={ctx}
          />
        ) : (
          <span className="uw-share-badge outline">{levelText(t, homeRow.level)}</span>
        )}
      </div>
      {confirmPanel}
    </li>
  )
}

export function ShareRow({
  share,
  rowKey,
  displayLabel,
  label,
  ctx,
  expanded,
  onToggleSources,
  confirmPanel,
}: {
  share: ShareGrant
  rowKey: string
  displayLabel: string
  label: string | null
  ctx: ShareAccessRowContext
  expanded: boolean
  onToggleSources: () => void
  confirmPanel: ReactNode
}) {
  const { t } = useI18n()
  const { formatSourceOrigin, canManage } = ctx
  const sources = share.sources ?? []

  const directBelowGroup = () => {
    if (!share.warnings?.includes('direct_below_group')) return null
    const higher =
      sources.find((src) => src.via !== 'share' && src.level === share.effectiveLevel) ??
      sources.find((src) => src.via !== 'share')
    const effectiveLevel = levelText(t, share.effectiveLevel || higher?.level || 'edit')
    const source = higher
      ? formatSourceOrigin(higher)
      : formatSourceOrigin({ via: share.effectiveVia || 'member' })
    return (
      <p
        className="uw-share-warning"
        data-testid={`warning-direct-below-group-${share.principalId}`}
      >
        {t('shrWarningDirectBelowGroup', { name: displayLabel, effectiveLevel, source })}
      </p>
    )
  }

  return (
    <li
      className="uw-share-row stacked"
      data-share-row={`${share.principalType}:${share.principalId}`}
    >
      <div className="uw-share-row-line">
        <div className="uw-share-row-text">
          <span className="uw-share-row-head">
            <SharePrincipalIcon principalType={share.principalType} />
            <NameOrSkeleton name={label} />
          </span>
          <span className="uw-share-row-sub">
            {levelText(t, share.level)}
            {share.effectiveLevel && share.effectiveLevel !== share.level
              ? ` · ${t('shrEffective', { level: levelText(t, share.effectiveLevel) })}`
              : ''}
            {share.effectiveVia ? ` · ${viaLabel(t, share.effectiveVia)}` : ''}
            {!share.active ? ` · ${t('shrInactive')}` : ''}
          </span>
          {sources.length > 0 && (
            <button
              type="button"
              className="uw-share-linkbtn"
              aria-expanded={expanded}
              onClick={onToggleSources}
            >
              {t('shrSourcesToggle', { count: sources.length })}
            </button>
          )}
        </div>
        {canManage && (
          <LevelControls
            rowKey={rowKey}
            principalType={share.principalType}
            principalId={share.principalId}
            name={displayLabel}
            ariaName={label ?? displayLabel}
            level={share.level}
            allowed={allowedLevelsForPrincipal(share.principalType, false)}
            disabled={!share.active}
            ctx={ctx}
          />
        )}
      </div>
      {directBelowGroup()}
      {expanded && sources.length > 0 && (
        <ul className="uw-share-sources">
          {sources.map((src, idx) => (
            <li key={`${src.via}-${src.principalId ?? idx}`}>
              {t('shrSourceItem', {
                level: levelText(t, src.level),
                source: formatSourceOrigin(src),
              })}
            </li>
          ))}
        </ul>
      )}
      {confirmPanel}
    </li>
  )
}
