import { useEffect, useId, useRef, useState } from 'react'
import type { UniworkShareApi } from '../../../shared/share-api'
import { ActionModal } from '../UniworkDocActions'
import { useI18n } from '../locale'
import { AccessRequestsSection } from './AccessRequestsSection'
import { ShareAccessList } from './ShareAccessList'
import { ShareAddSection } from './ShareAddSection'
import { ShareBreakGlassSection } from './ShareBreakGlassSection'
import { ShareLinksSection } from './ShareLinksSection'
import { ShareMembersError } from './ShareMembersError'
import { canManageTarget, type ShareDialogTarget } from './share-dialog-target'
import { useShareAccess, useShareDirectory, useShareSettings } from './use-share'
import './share-dialog.css'

export type { ShareDialogTarget }

export interface ShareDialogProps {
  open: boolean
  onClose: () => void
  /** the document: a list row satisfies it */
  row: ShareDialogTarget
  /** the bridge; defaults to `window.uniworkShare` (tests pass the in-memory fake) */
  api?: UniworkShareApi
  /** an access change landed: the list refetches its row (share scope pill) */
  onChanged?: () => void
  /** opened from a notice: that section's heading takes focus and scrolls into view */
  initialSection?: 'requests' | 'break_glass'
  /**
   * Names of workspaces other than the document's own (the list that opened the dialog knows
   * them); the member list the dialog reads names people from has no workspaces
   */
  workspaces?: readonly { id: string; name: string }[]
}

/**
 * The single-document Share dialog, a clone of the web's:
 * - header: the document title and where it is stored;
 * - add people: search, chips, a level (custom per person) and the dry-run preview;
 * - access list: the owner, the home workspace, people, other workspaces and the organization
 *   (a reader who does not manage sees their own level and its source, nothing to change);
 * - emergency access, access requests and public links.
 */
export function ShareDialog(props: ShareDialogProps) {
  if (!props.open) return null
  return <ShareDialogBody {...props} />
}

function ShareDialogBody({
  onClose,
  row,
  api,
  onChanged,
  initialSection,
  workspaces,
}: ShareDialogProps) {
  const { t } = useI18n()
  const shareApi = api ?? window.uniworkShare
  const titleId = useId()
  const descriptionId = useId()
  const adminNoteId = useId()
  const shelvedNoteId = useId()
  const [status, setStatus] = useState('')
  // counts the dialog's writes: the add picker reads its candidates again after each
  const [writes, setWrites] = useState(0)
  const addInputFocused = useRef(false)

  const access = useShareAccess(shareApi, row.id, true)
  const data = access.data
  // a manager reads the grants; anyone else reads only their own level. Until the overview is in,
  // the row's own level decides what to ask for
  const canAdminister = data ? data.myLevel === 'manage' || data.adminScope : canManageTarget(row)
  const adminOnly =
    (data ? data.adminScope : row.adminScope === true) &&
    (data?.myLevel ?? row.myLevel) !== 'manage'
  const directory = useShareDirectory(shareApi, canAdminister)
  const publicLinksEnabled = useShareSettings(shareApi, canAdminister)

  const shelved = !!row.shelvedAt
  const archived = row.archived === true || !!row.archivedAt
  const lockedBy = shelved ? shelvedNoteId : undefined

  // the first time a manager's overview lands, the search box takes focus (the dialog itself
  // opened on its Close button, so nothing is stolen from a person who already moved)
  const ready = !!data && canAdminister
  useEffect(() => {
    if (!ready || addInputFocused.current) return
    addInputFocused.current = true
    const input = document.querySelector<HTMLInputElement>(
      '.uw-share [data-share-section="add"] input',
    )
    const active = document.activeElement
    if (input && (!active || active === document.body || active.hasAttribute('data-share-close'))) {
      input.focus()
    }
  }, [ready])

  useEffect(() => {
    if (!status) return
    const timer = window.setTimeout(() => setStatus(''), 8000)
    return () => window.clearTimeout(timer)
  }, [status])

  const onMutated = async (note: string) => {
    setWrites((n) => n + 1)
    await access.refetch()
    onChanged?.()
    if (note) setStatus(note)
  }

  const memberName = (userId: string): string | null =>
    directory.userName(userId) ?? (directory.namesPending ? null : t('shrPersonUnknown'))

  const workspaceName = (id: string): string =>
    (data?.homeWorkspace?.workspaceId === id && data.homeWorkspace.workspaceName) ||
    workspaces?.find((w) => w.id === id)?.name ||
    (row.workspaceId === id && row.workspaceName ? row.workspaceName : '') ||
    t('shrWorkspaceUnknown')
  const storedWorkspace =
    data?.homeWorkspace?.workspaceName?.trim() ||
    workspaces?.find((w) => w.id === row.workspaceId)?.name ||
    row.workspaceName ||
    ''

  const docTitle = row.title.trim()
  const describedBy =
    [storedWorkspace ? descriptionId : '', adminOnly ? adminNoteId : '']
      .filter(Boolean)
      .join(' ') || undefined

  return (
    <ActionModal
      labelledBy={titleId}
      describedBy={describedBy}
      className="uw-share"
      onCancel={onClose}
    >
      <header className="uw-share-header">
        <div className="uw-share-header-text">
          <h2 id={titleId} className="uw-act-heading uw-share-title" title={docTitle || undefined}>
            {docTitle ? t('shrTitleNamed', { title: docTitle }) : t('shrTitle')}
          </h2>
          {storedWorkspace && (
            <p id={descriptionId} className="uw-share-muted">
              {t('shrStoredIn', { workspace: storedWorkspace })}
            </p>
          )}
          {adminOnly && (
            <p id={adminNoteId} className="uw-share-note">
              {t('shrAdminScopeNote')}
            </p>
          )}
        </div>
        <button
          type="button"
          className="uw-share-close"
          data-share-close
          aria-label={t('shrCloseLabel')}
          onClick={onClose}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M2 2l8 8M10 2l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      {status && (
        <p role="status" className="uw-share-notice">
          {status}
        </p>
      )}

      {(access.status === 'loading' || access.status === 'idle') && !data ? (
        <p className="uw-share-loading">{t('shrLoading')}</p>
      ) : access.status === 'error' || !data ? (
        <div className="uw-share-note error" role="alert">
          <span>{t('shrError')}</span>
          <button type="button" className="btn" onClick={() => void access.refetch()}>
            {t('shrRetry')}
          </button>
        </div>
      ) : !canAdminister ? (
        <ShareAccessList
          api={shareApi}
          documentId={row.id}
          docWorkspaceId={row.workspaceId}
          access={data}
          canManage={false}
          memberName={memberName}
          workspaceName={workspaceName}
          organizationName={row.organizationName}
          shelved={shelved}
          onMutated={onMutated}
        />
      ) : (
        <div className="uw-share-body">
          {directory.error && (
            <ShareMembersError error={directory.error} onRetry={directory.retry} />
          )}
          {shelved && (
            <p id={shelvedNoteId} className="uw-share-note">
              {t('shrShelvedNote')}
            </p>
          )}

          <ShareAddSection
            api={shareApi}
            documentId={row.id}
            open
            alreadySharedUserIds={[data.owner?.userId]}
            shelved={shelved}
            shelvedNoteId={lockedBy}
            candidatesRefreshKey={writes}
            onMutated={onMutated}
          />

          <ShareAccessList
            api={shareApi}
            documentId={row.id}
            docWorkspaceId={row.workspaceId}
            access={data}
            canManage
            memberName={memberName}
            workspaceName={workspaceName}
            organizationName={row.organizationName}
            shelved={shelved}
            onMutated={onMutated}
          />

          {(adminOnly || (data.breakGlass?.length ?? 0) > 0) && (
            <ShareBreakGlassSection
              api={shareApi}
              documentId={row.id}
              grants={data.breakGlass ?? []}
              resolveName={memberName}
              canGrant={adminOnly}
              focusOnOpen={initialSection === 'break_glass'}
              onMutated={onMutated}
            />
          )}

          {!archived && (
            <AccessRequestsSection
              api={shareApi}
              documentId={row.id}
              focusOnOpen={initialSection === 'requests'}
              onDecided={async (changedAccess) => {
                if (changedAccess) await onMutated('')
              }}
            />
          )}

          <ShareLinksSection
            api={shareApi}
            documentId={row.id}
            links={data.links ?? []}
            publicLinksEnabled={publicLinksEnabled}
            locked={shelved}
            lockedNoteId={lockedBy}
            onMutated={onMutated}
          />
        </div>
      )}
    </ActionModal>
  )
}
