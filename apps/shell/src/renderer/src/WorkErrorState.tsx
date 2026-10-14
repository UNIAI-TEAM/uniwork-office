import { createContext, useContext } from 'react'
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
      strokeWidth="1.5"
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

/**
 * Every Workbench empty / error / sign-in state (redesign spec 2.3): tile, title, one line,
 * one action. The full panel centres in its area; `compact` (28px tile, 12px padding,
 * left-aligned) fits a narrow column or a card section.
 */
export function WorkStatePanel({
  tone,
  icon,
  title,
  body,
  action,
  role,
  compact = false,
}: {
  /** a module tint for empty states, a signal for errors */
  tone: Tint | SignalTone
  icon: ReactNode
  title: string
  body?: string
  action?: { label: string; onClick: () => void; variant?: 'primary' | 'secondary' }
  role?: 'status' | 'alert'
  compact?: boolean
}): ReactElement {
  return (
    <div className={`wb-state${compact ? ' is-compact' : ''}`} role={role}>
      <span
        className="wb-state-icon"
        style={isSignal(tone) ? signalStyle(tone) : tintStyle(tone)}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="wb-state-text">
        <h3 className="wb-state-title">{title}</h3>
        {body ? <p className="wb-state-body">{body}</p> : null}
        {action ? (
          <button
            type="button"
            className={`wb-btn wb-btn-${action.variant ?? 'primary'}${compact ? ' wb-btn-sm' : ''}`}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ) : null}
      </div>
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

/**
 * Opens the top bar's workspace chip (spec 4.11, "Chọn không gian khác"); PracticeHome provides it.
 * Outside a Workbench page it is null and the lost-access panel has no action.
 */
export const WorkspacePickerContext = createContext<(() => void) | null>(null)

/** A server tab with nothing to show (spec §7): sign in, lost access, or an error with Retry. */
export function WorkErrorState({
  state,
  onRetry,
  compact,
}: {
  state: UniworkWorkError
  onRetry: () => void
  compact?: boolean
}): ReactElement {
  const { t } = useI18n()
  const pickWorkspace = useContext(WorkspacePickerContext)
  const copy = COPY[state]
  const run =
    state === 'signed-out' ? () => void window.aiOffice.accountLogin().catch(() => false) : onRetry
  const action =
    state === 'forbidden'
      ? pickWorkspace && { label: t('wbOvPickWorkspace'), onClick: pickWorkspace }
      : copy.action && { label: t(copy.action), onClick: run }
  return (
    <WorkStatePanel
      tone={copy.tone}
      icon={<StateGlyph id={copy.glyph} />}
      title={t(copy.title)}
      body={copy.body ? t(copy.body) : undefined}
      action={action || undefined}
      role={state === 'signed-out' ? 'status' : 'alert'}
      compact={compact}
    />
  )
}

/** No workspace on screen: why the list failed, else the web onboarding link (a member of none). */
export function WorkNoWorkspace({
  error,
  onRetry,
  compact,
}: {
  error: UniworkWorkError | null
  onRetry: () => void
  compact?: boolean
}): ReactElement {
  const { t } = useI18n()
  if (error) return <WorkErrorState state={error} onRetry={onRetry} compact={compact} />
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
      compact={compact}
    />
  )
}

export type WorkSkeletonShape = 'rows' | 'agenda' | 'card'

/** one placeholder list row: a round icon, two text bars and a pill */
function SkelRow(): ReactElement {
  return (
    <span className="wb-skel-line">
      <span className="wb-skel wb-skel-dot" />
      <span className="wb-skel-lines">
        <span className="wb-skel wb-skel-bar" />
        <span className="wb-skel wb-skel-bar is-short" />
      </span>
      <span className="wb-skel wb-skel-pill" />
    </span>
  )
}

/**
 * The loading placeholder of a server tab, shaped like what loads (spec 2.3): list rows,
 * an agenda (a day head over rows) or a profile card. Reduced motion stops the shimmer.
 */
export function WorkSkeleton({
  shape = 'rows',
  rows = 3,
}: {
  shape?: WorkSkeletonShape
  rows?: number
}): ReactElement {
  return (
    <div className={`wb-work-skeleton wb-block is-${shape}`} aria-busy="true">
      {shape === 'agenda' ? <span className="wb-skel wb-skel-head" /> : null}
      {shape === 'card' ? (
        <span className="wb-skel-line">
          <span className="wb-skel wb-skel-avatar" />
          <span className="wb-skel-lines">
            <span className="wb-skel wb-skel-bar" />
            <span className="wb-skel wb-skel-bar is-short" />
          </span>
        </span>
      ) : null}
      {Array.from({ length: rows }, (_, i) => (
        <SkelRow key={i} />
      ))}
    </div>
  )
}

/** A kept answer after a failed reload: when it was loaded, and Retry. */
export function WorkStaleNote({ at, onRetry }: { at: number; onRetry: () => void }): ReactElement {
  const { t, dateLocale } = useI18n()
  return (
    <p className="wb-work-stale wb-num" role="status">
      {t('wbOvUpdatedAt', { time: clock(new Date(at).toISOString(), dateLocale) })} ·{' '}
      <button type="button" className="wb-link" onClick={onRetry}>
        {t('acctRetry')}
      </button>
    </p>
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
export function workLoadState(
  load: {
    value: unknown
    error: UniworkWorkError | null
    reload: () => void
  },
  shape?: WorkSkeletonShape,
): ReactElement | null {
  if (load.error === 'signed-out' || load.error === 'forbidden') {
    return <WorkErrorState state={load.error} onRetry={load.reload} />
  }
  if (load.value !== null) return null
  if (load.error) return <WorkErrorState state={load.error} onRetry={load.reload} />
  return <WorkSkeleton shape={shape} />
}
