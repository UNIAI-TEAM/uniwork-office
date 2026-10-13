import type { ReactElement } from 'react'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import type { UniworkWorkError } from '../../shared/uniwork-work-api'
import { useI18n, type StringKey } from './locale'
import { clock } from './work-home'

const COPY: Record<UniworkWorkError, { title: StringKey; body?: StringKey; action?: StringKey }> = {
  'signed-out': {
    title: 'wbOvSignedOutTitle',
    body: 'wbOvSignedOutBody',
    action: 'acctSignInUniwork',
  },
  forbidden: { title: 'wbOvForbiddenTitle', body: 'wbOvForbiddenBody' },
  offline: { title: 'wbOvOfflineTitle', body: 'wbOvOfflineBody', action: 'acctRetry' },
  server: { title: 'wbOvLoadFailed', action: 'acctRetry' },
}

/** A server tab with nothing to show (spec §7): sign in, lost access, or an error with Retry. */
export function WorkErrorState({
  state,
  onRetry,
}: {
  state: UniworkWorkError
  onRetry: () => void
}): ReactElement {
  const { t } = useI18n()
  const copy = COPY[state]
  const run =
    state === 'signed-out' ? () => void window.aiOffice.accountLogin().catch(() => false) : onRetry
  return (
    <div className="wb-work-state" role={state === 'signed-out' ? 'status' : 'alert'}>
      <h3>{t(copy.title)}</h3>
      {copy.body ? <p>{t(copy.body)}</p> : null}
      {copy.action ? (
        <button type="button" className="btn btn-primary" onClick={run}>
          {t(copy.action)}
        </button>
      ) : null}
    </div>
  )
}

/** No workspace on screen: why the list failed, else the web onboarding link (a member of none). */
export function WorkNoWorkspace({
  error,
  onRetry,
}: {
  error: UniworkWorkError | null
  onRetry: () => void
}): ReactElement {
  const { t } = useI18n()
  if (error) return <WorkErrorState state={error} onRetry={onRetry} />
  return (
    <div className="wb-work-state" role="status">
      <h3>{t('wbOvNoWorkspaceTitle')}</h3>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void window.uniworkWork.openWeb({ kind: 'onboarding' }).catch(() => false)}
      >
        {t('wbOvNoWorkspaceAction')}
      </button>
    </div>
  )
}

/** A kept answer after a failed reload: when it was loaded, and Retry. */
export function WorkStaleNote({ at, onRetry }: { at: number; onRetry: () => void }): ReactElement {
  const { t, dateLocale } = useI18n()
  return (
    <p className="wb-work-stale" role="status">
      {t('wbOvUpdatedAt', { time: clock(new Date(at).toISOString(), dateLocale) })} ·{' '}
      <button type="button" className="wb-link" onClick={onRetry}>
        {t('acctRetry')}
      </button>
    </p>
  )
}

/** A write the server refused: the change was undone; Retry repeats the same request. */
export function WorkToast({
  message,
  onRetry,
  onDismiss,
}: {
  message: StringKey
  onRetry: () => void
  onDismiss: () => void
}): ReactElement {
  const { t } = useI18n()
  return (
    <div className="wb-toast" role="alert">
      <span>{t(message)}</span>
      <button type="button" className="wb-link" onClick={onRetry}>
        {t('acctRetry')}
      </button>
      <button type="button" className="wb-link" onClick={onDismiss}>
        {t('wbOvDismiss')}
      </button>
    </div>
  )
}

/** What PracticeHome hands every server tab (Tasks, Calendar, Profile). */
export interface WorkPaneProps {
  /** the active workspace; null = signed out, in none, or the first list failed (workspaceError says why) */
  workspace: UniworkWorkspaceRef | null
  /** why the last workspace list failed; the last good list and pick stay, so this can come with a workspace */
  workspaceError: UniworkWorkError | null
  /** the top bar's Refresh: re-lists workspaces and reloads every server tab */
  onReload: () => void
}

/** What a server tab shows instead of its data (lost access, sign in, an error, the skeleton); null when it has data. */
export function workLoadState(load: {
  value: unknown
  error: UniworkWorkError | null
  reload: () => void
}): ReactElement | null {
  if (load.error === 'signed-out' || load.error === 'forbidden') {
    return <WorkErrorState state={load.error} onRetry={load.reload} />
  }
  if (load.value !== null) return null
  if (load.error) return <WorkErrorState state={load.error} onRetry={load.reload} />
  return <div className="wb-work-skeleton" aria-busy="true" />
}
