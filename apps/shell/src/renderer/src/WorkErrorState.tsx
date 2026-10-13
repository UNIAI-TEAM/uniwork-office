import type { ReactElement, ReactNode } from 'react'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import type { UniworkWorkError } from '../../shared/uniwork-work-api'
import { useI18n, type StringKey } from './locale'
import { signalStyle, tintStyle, type SignalTone, type Tint } from './module-tones'
import { clock } from './work-home'

/** Line glyphs for the state tiles, on the 24-unit box WorkbenchIcons uses, in currentColor. */
const GLYPH = {
  alert: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4.5M12 15.8v.2" />
    </>
  ),
  offline: (
    <>
      <path d="M8 17.5h8.5a3.5 3.5 0 0 0 .5-6.96A5 5 0 0 0 7.6 9.8 3.9 3.9 0 0 0 8 17.5z" />
      <path d="M5 5l14 14" />
    </>
  ),
  lock: (
    <>
      <rect x="6.5" y="11" width="11" height="8" rx="1.5" />
      <path d="M9 11V8.5a3 3 0 0 1 6 0V11" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="9" r="3" />
      <path d="M6.5 18.5c.9-2.8 2.9-4 5.5-4s4.6 1.2 5.5 4" />
    </>
  ),
  workspace: (
    <>
      <rect x="6" y="5" width="12" height="14" rx="1.5" />
      <path d="M9.5 9h1M13.5 9h1M9.5 12.5h1M13.5 12.5h1M11 19v-3h2v3" />
    </>
  ),
} satisfies Record<string, ReactElement>

function StateGlyph({ id }: { id: keyof typeof GLYPH }): ReactElement {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPH[id]}
    </svg>
  )
}

const isSignal = (tone: Tint | SignalTone): tone is SignalTone =>
  tone === 'danger' || tone === 'warning' || tone === 'info'

/** Every Workbench empty / error / sign-in state (redesign spec 5): tile, title, one line, one action. */
export function WorkStatePanel({
  tone,
  icon,
  title,
  body,
  action,
  role,
}: {
  /** a module tint for empty states, a signal for errors */
  tone: Tint | SignalTone
  icon: ReactNode
  title: string
  body?: string
  action?: { label: string; onClick: () => void; variant?: 'primary' | 'secondary' }
  role?: 'status' | 'alert'
}): ReactElement {
  return (
    <div className="wb-state" role={role}>
      <span
        className="wb-state-icon"
        style={isSignal(tone) ? signalStyle(tone) : tintStyle(tone)}
        aria-hidden="true"
      >
        {icon}
      </span>
      <h3 className="wb-state-title">{title}</h3>
      {body ? <p className="wb-state-body">{body}</p> : null}
      {action ? (
        <button
          type="button"
          className={`wb-btn wb-btn-${action.variant ?? 'primary'}`}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}

const COPY: Record<
  UniworkWorkError,
  {
    title: StringKey
    body?: StringKey
    action?: StringKey
    tone: SignalTone
    glyph: keyof typeof GLYPH
  }
> = {
  'signed-out': {
    title: 'wbOvSignedOutTitle',
    body: 'wbOvSignedOutBody',
    action: 'acctSignInUniwork',
    tone: 'info',
    glyph: 'person',
  },
  forbidden: {
    title: 'wbOvForbiddenTitle',
    body: 'wbOvForbiddenBody',
    tone: 'warning',
    glyph: 'lock',
  },
  offline: {
    title: 'wbOvOfflineTitle',
    body: 'wbOvOfflineBody',
    action: 'acctRetry',
    tone: 'warning',
    glyph: 'offline',
  },
  server: { title: 'wbOvLoadFailed', action: 'acctRetry', tone: 'danger', glyph: 'alert' },
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
    <WorkStatePanel
      tone={copy.tone}
      icon={<StateGlyph id={copy.glyph} />}
      title={t(copy.title)}
      body={copy.body ? t(copy.body) : undefined}
      action={copy.action ? { label: t(copy.action), onClick: run } : undefined}
      role={state === 'signed-out' ? 'status' : 'alert'}
    />
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
    <WorkStatePanel
      tone="info"
      icon={<StateGlyph id="workspace" />}
      title={t('wbOvNoWorkspaceTitle')}
      action={{
        label: t('wbOvNoWorkspaceAction'),
        onClick: () => void window.uniworkWork.openWeb({ kind: 'onboarding' }).catch(() => false),
      }}
      role="status"
    />
  )
}

/** The loading placeholder of a server tab: three shimmer rows (reduced motion stops them). */
export function WorkSkeleton(): ReactElement {
  return (
    <div className="wb-work-skeleton" aria-busy="true">
      <span className="wb-skel wb-skel-row" />
      <span className="wb-skel wb-skel-row" />
      <span className="wb-skel wb-skel-row" />
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
  return <WorkSkeleton />
}
