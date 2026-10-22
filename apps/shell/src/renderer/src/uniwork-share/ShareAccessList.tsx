import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ShareAccess,
  ShareLevel,
  SharePreview,
  SharePrincipalType,
  ShareSource,
  ShareUpdateItem,
  UniworkShareApi,
} from '../../../shared/share-api'
import { useI18n } from '../locale'
import {
  bridgeFailed,
  foldSearchText,
  levelLabel as levelText,
  levelRank,
  shareErrorKey,
  viaLabel,
} from './share-model'
import { revokeSentence, warningSentence, type PreviewSentence } from './share-preview-sentences'
import {
  AclOwnerRow,
  HomeWorkspaceRow,
  ShareRow,
  type ShareAccessHomeRow,
  type ShareAccessRowContext,
} from './ShareAccessRows'

export interface ShareAccessListProps {
  api: UniworkShareApi
  documentId: string
  /** the document's own workspace: the home row follows it when the overview does not name one */
  docWorkspaceId: string
  access: ShareAccess
  canManage: boolean
  /** a person's name; null while the directory is still loading (the row holds a skeleton) */
  memberName: (userId: string) => string | null
  workspaceName: (workspaceId: string) => string
  organizationName?: string
  shelved: boolean
  onMutated: (note: string) => Promise<void>
  /** UNI-2078: the owner row's action (Transfer ownership) */
  ownerAction?: ShareAccessRowContext['ownerAction']
}

interface PendingRowConfirm {
  rowKey: string
  item: ShareUpdateItem
  sentence: PreviewSentence
  /** the control that opened the panel takes its focus back when it closes */
  opener: 'revoke' | 'level'
}

/** a filter box shows once the list is longer than this */
const FILTER_THRESHOLD = 20

/** the access list: the owner, the home workspace, people, other workspaces and the organization */
export function ShareAccessList({
  api,
  documentId,
  docWorkspaceId,
  access,
  canManage,
  memberName,
  workspaceName,
  organizationName,
  shelved,
  onMutated,
  ownerAction,
}: ShareAccessListProps) {
  const { t } = useI18n()
  const [filterQuery, setFilterQuery] = useState('')
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({})
  const [pendingConfirm, setPendingConfirm] = useState<PendingRowConfirm | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // `pending` is false between the dry run resolving and the real call, so a fast second click
  // would write twice; the ref closes that gap
  const inFlight = useRef(false)
  const confirmRef = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const openerEls = useRef(new Map<string, HTMLElement>())
  const prevConfirm = useRef<PendingRowConfirm | null>(null)
  const confirmOutcome = useRef<'accept' | 'cancel' | null>(null)

  const myLevel = access.myLevel
  const homeWorkspace = access.homeWorkspace ?? null
  const homeWsId = homeWorkspace?.workspaceId || docWorkspaceId
  const rawShares = useMemo(() => access.shares ?? [], [access.shares])

  // the confirm panel lives inside its row: it scrolls into view and takes focus; closing it
  // returns focus to the control that opened it (an accepted revoke removed that row: the heading)
  useEffect(() => {
    const prev = prevConfirm.current
    prevConfirm.current = pendingConfirm
    if (pendingConfirm) {
      confirmRef.current?.scrollIntoView?.({ block: 'nearest' })
      confirmRef.current?.focus()
      return
    }
    if (!prev || document.activeElement === headingRef.current) return
    const outcome = confirmOutcome.current ?? 'cancel'
    confirmOutcome.current = null
    const target =
      outcome === 'accept' && prev.item.level === null
        ? null
        : (openerEls.current.get(`${prev.opener}:${prev.rowKey}`) ?? null)
    ;((target?.isConnected ? target : null) ?? headingRef.current)?.focus()
  }, [pendingConfirm])

  const label = (level: string | null | undefined) => levelText(t, level)

  const formatSourceOrigin = (src: Pick<ShareSource, 'via' | 'principalType' | 'principalId'>) => {
    if (src.principalType === 'workspace' || src.via === 'member') {
      // the dialog's lookup never answers empty: its unknown-name line must not read as a name here
      const named = src.principalId ? workspaceName(src.principalId) : ''
      const name =
        (named !== t('shrWorkspaceUnknown') && named) ||
        (homeWorkspace && (!src.principalId || src.principalId === homeWorkspace.workspaceId)
          ? homeWorkspace.workspaceName
          : '')
      return name ? t('shrViaWorkspaceNamed', { name }) : t('shrViaMember')
    }
    if (src.principalType === 'organization' || String(src.via) === 'organization') {
      return organizationName
        ? t('shrViaOrganizationNamed', { name: organizationName })
        : t('shrViaOrganization')
    }
    return viaLabel(t, src.via)
  }

  const resolvePrincipalName = (principalType: string, principalId: string): string | null => {
    if (principalType === 'user') return memberName(principalId)
    if (principalType === 'workspace') return workspaceName(principalId)
    if (principalType === 'organization') return organizationName || t('shrPrincipalOrganization')
    return principalId
  }

  const homeShareFallback = useMemo(
    () =>
      rawShares.find(
        (s) =>
          s.active &&
          s.principalType === 'workspace' &&
          homeWsId !== '' &&
          s.principalId === homeWsId,
      ),
    [rawShares, homeWsId],
  )
  const homeRow = useMemo((): ShareAccessHomeRow | null => {
    if (homeWorkspace && homeWorkspace.level !== null) {
      return {
        workspaceId: homeWorkspace.workspaceId,
        workspaceName: homeWorkspace.workspaceName,
        level: homeWorkspace.level,
      }
    }
    if (homeShareFallback) {
      return {
        workspaceId: homeShareFallback.principalId,
        workspaceName: homeWorkspace?.workspaceName ?? '',
        level: homeShareFallback.level,
      }
    }
    return null
  }, [homeWorkspace, homeShareFallback])

  const orderedShares = useMemo(
    () => [
      ...rawShares.filter((s) => s.principalType === 'user'),
      ...rawShares.filter(
        (s) =>
          s.principalType === 'workspace' &&
          (!s.active || homeWsId === '' || s.principalId !== homeWsId),
      ),
      ...rawShares.filter((s) => s.principalType === 'organization'),
    ],
    [rawShares, homeWsId],
  )

  const owner = access.owner ?? null
  const totalRows = (owner ? 1 : 0) + (homeRow ? 1 : 0) + orderedShares.length
  const filterVisible = totalRows > FILTER_THRESHOLD
  // a filter typed while the box showed must not keep hiding rows once the box is gone
  const needle = filterVisible ? foldSearchText(filterQuery) : ''
  useEffect(() => {
    if (!filterVisible) setFilterQuery('')
  }, [filterVisible])
  const matchesFilter = (text: string) => !needle || foldSearchText(text).includes(needle)

  if (!canManage) {
    const mySources = access.mySources ?? []
    return (
      <section
        aria-labelledby="share-access-title"
        className="uw-share-section plain"
        data-share-section="access"
      >
        <h3 id="share-access-title" ref={headingRef} tabIndex={-1} className="uw-share-heading">
          {myLevel ? t('shrMyLevel', { level: label(myLevel) }) : t('shrAccessTitle')}
        </h3>
        {mySources.length > 0 && (
          <ul className="uw-share-sources">
            {mySources.map((src, idx) => (
              <li key={`${src.via}-${src.principalId ?? idx}`}>
                {t('shrSourceItem', { level: label(src.level), source: formatSourceOrigin(src) })}
              </li>
            ))}
          </ul>
        )}
        <p className="uw-share-muted">{t('shrManageOnly')}</p>
      </section>
    )
  }

  const sentenceDeps = {
    t,
    levelLabel: label,
    sourceLabel: (via: string) => formatSourceOrigin({ via: via as ShareSource['via'] }),
  }

  const buildConfirmSentence = (
    item: ShareUpdateItem,
    name: string,
    beforeLevel: ShareLevel | null,
    preview: SharePreview,
  ): PreviewSentence | null => {
    const user = preview.users.find((x) => x.userId === item.principalId)
    const group = preview.groups.find(
      (x) => x.principalType === item.principalType && x.principalId === item.principalId,
    )
    if (item.level === null) {
      return revokeSentence(sentenceDeps, { name, principalType: item.principalType, user, group })
    }
    const warning = preview.warnings[0]
    if (!warning) return null
    return warningSentence(sentenceDeps, {
      code: warning.code,
      name,
      principalType: item.principalType,
      targetLevel: item.level,
      beforeLevel: beforeLevel ?? undefined,
      user,
      group,
    })
  }

  const failureText = (error: Parameters<typeof shareErrorKey>[0], item: ShareUpdateItem) => {
    const key = shareErrorKey(error)
    return t(key ?? (item.level === null ? 'shrRevokeFailed' : 'shrSubmitFailed'))
  }

  const commitRowChange = async (item: ShareUpdateItem, done: string) => {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setActionError(null)
    try {
      const result = await api
        .update({ documentId, items: [item], dryRun: false })
        .catch(bridgeFailed)
      if (!result.ok) {
        setActionError(failureText(result.error, item))
        return
      }
      confirmOutcome.current = 'accept'
      setPendingConfirm(null)
      await onMutated(done)
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  const requestRowChange: ShareAccessRowContext['requestRowChange'] = async (
    rowKey,
    principalType,
    principalId,
    name,
    beforeLevel,
    nextLevel,
  ) => {
    // a shelved document only lets access be taken away: revoke and a lowering pass
    if (shelved && nextLevel !== null && levelRank(nextLevel) > levelRank(beforeLevel)) return
    if (pending || inFlight.current) return
    inFlight.current = true
    setPending(true)
    setActionError(null)
    const item: ShareUpdateItem = {
      principalType: principalType as SharePrincipalType,
      principalId,
      level: nextLevel,
      ...(nextLevel !== null ? { onExisting: 'update' as const } : {}),
    }
    const dry = await api.update({ documentId, items: [item], dryRun: true }).catch(bridgeFailed)
    inFlight.current = false
    setPending(false)
    if (!dry.ok) {
      setActionError(failureText(dry.error, item))
      return
    }
    const sentence = buildConfirmSentence(item, name, beforeLevel, dry.value.preview)
    if (sentence) {
      confirmOutcome.current = 'cancel'
      setPendingConfirm({
        rowKey,
        item,
        sentence,
        opener: nextLevel === null ? 'revoke' : 'level',
      })
      return
    }
    await commitRowChange(item, t('shrUpdatedToast', { name, level: label(item.level ?? 'view') }))
  }

  const ctx: ShareAccessRowContext = {
    canManage,
    updatePending: pending,
    shelved,
    resolveMemberName: memberName,
    formatSourceOrigin,
    setOpenerEl: (opener, rowKey, el) => {
      const key = `${opener}:${rowKey}`
      if (el) openerEls.current.set(key, el)
      else openerEls.current.delete(key)
    },
    requestRowChange,
    ...(ownerAction ? { ownerAction } : {}),
  }

  const hasAnyRow = Boolean(owner || homeRow || orderedShares.length > 0)
  const homeLabel = homeRow
    ? homeRow.workspaceName
      ? `${t('shrPrincipalWorkspace')} ${homeRow.workspaceName}`
      : t('shrPrincipalWorkspace')
    : ''
  const homeRowKey = homeRow ? `home:${homeRow.workspaceId}` : ''
  const shareKey = (s: (typeof orderedShares)[number]) => `${s.principalType}:${s.principalId}`
  const visibleShares = orderedShares.filter((s) =>
    matchesFilter(resolvePrincipalName(s.principalType, s.principalId) ?? ''),
  )
  // the panel falls back to the foot of the list when its row is filtered out or gone
  const confirmInRow = Boolean(
    pendingConfirm &&
    ((homeRow && pendingConfirm.rowKey === homeRowKey && matchesFilter(homeRow.workspaceName)) ||
      visibleShares.some((s) => pendingConfirm.rowKey === shareKey(s))),
  )

  const confirmPanel = pendingConfirm ? (
    <div
      ref={confirmRef}
      role="region"
      data-testid="share-access-confirm"
      tabIndex={-1}
      className="uw-share-note warn"
    >
      <p>{pendingConfirm.sentence.confirm}</p>
      <span className="uw-share-note-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() => void commitRowChange(pendingConfirm.item, pendingConfirm.sentence.done)}
        >
          {t('shrConfirmAccept')}
        </button>
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() => {
            confirmOutcome.current = 'cancel'
            setPendingConfirm(null)
          }}
        >
          {t('shrConfirmCancel')}
        </button>
      </span>
    </div>
  ) : null

  return (
    <section
      aria-labelledby="share-access-title"
      className="uw-share-section plain"
      data-share-section="access"
    >
      <div className="uw-share-section-head">
        <h3 id="share-access-title" ref={headingRef} tabIndex={-1} className="uw-share-heading">
          {t('shrAccessTitle')}
        </h3>
        {myLevel && (
          <span className="uw-share-muted">{t('shrMyLevel', { level: label(myLevel) })}</span>
        )}
      </div>

      {filterVisible && (
        <input
          className="uw-act-input"
          aria-label={t('shrAccessFilterLabel')}
          placeholder={t('shrAccessFilterPlaceholder')}
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
        />
      )}

      <ul className="uw-share-list bordered">
        {owner && matchesFilter(memberName(owner.userId) ?? '') && (
          <AclOwnerRow owner={owner} ctx={ctx} />
        )}

        {homeRow && matchesFilter(homeRow.workspaceName) && (
          <HomeWorkspaceRow
            homeRow={homeRow}
            rowKey={homeRowKey}
            displayLabel={homeLabel}
            ctx={ctx}
            confirmPanel={pendingConfirm?.rowKey === homeRowKey ? confirmPanel : null}
          />
        )}

        {visibleShares.map((share) => {
          const name = resolvePrincipalName(share.principalType, share.principalId)
          const rowKey = shareKey(share)
          return (
            <ShareRow
              key={share.id || rowKey}
              share={share}
              rowKey={rowKey}
              displayLabel={name ?? t('shrPersonUnknown')}
              label={name}
              ctx={ctx}
              expanded={Boolean(expandedSources[rowKey])}
              onToggleSources={() =>
                setExpandedSources((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }))
              }
              confirmPanel={pendingConfirm?.rowKey === rowKey ? confirmPanel : null}
            />
          )
        })}

        {!hasAnyRow && <li className="uw-share-row muted">{t('shrNoGrants')}</li>}
      </ul>

      {pendingConfirm && !confirmInRow ? confirmPanel : null}

      {actionError && (
        <p role="alert" className="uw-act-error">
          {actionError}
        </p>
      )}
    </section>
  )
}
