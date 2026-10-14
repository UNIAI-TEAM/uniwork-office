import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, ReactElement } from 'react'
import type { DeskDraft, UniworkWorkspaceRef } from '../../shared/home-api'
import type { UniworkWorkError, WorkHomeSummary } from '../../shared/uniwork-work-api'
import { DeskDrawer } from './DeskDrawer'
import { DeskInProgress } from './DeskInProgress'
import { DeskInTray } from './DeskInTray'
import { DeskToday } from './DeskToday'
import { DeskTools } from './DeskTools'
import { getWorkbenchModule, type PracticeId } from '@uniwork/practice-core'
import { useI18n } from './locale'
import { greetingName, HOME_REFRESH_MS, overviewView, useRecentDocuments } from './work-home'
import { useWorkLoad } from './work-cache'
import { WorkToolbar } from './WorkToolbar'

const DESK = getWorkbenchModule('desk')!

interface Props {
  practiceId: PracticeId
  vi: boolean
  /** null while the list loads */
  workspaces: readonly UniworkWorkspaceRef[] | null
  workspaceId: string | null
  workspaceError: UniworkWorkError | null
  refreshTick: number
  /** where a form draft goes: the selected pack, else the default one; null = none yet */
  packId: string | null
  /** reload the workspace list and every server section (the top bar's Refresh) */
  onReload: () => void
  /** each summary on screen (null before one exists): the page redraws the tab counts on it */
  onSummary?: (summary: WorkHomeSummary | null) => void
  onOpenTab: (id: 'tasks' | 'forms') => void
  /** a Drawer draft linked a form to a pack: refresh the packs */
  onPackLinked?: () => void
  /** the signed-in person's display name ('' when unknown): the toolbar greets them */
  userName?: string
  /** the Drawer's pack chip: the role's packs, the one picked in Knowledge, and picking another */
  packs?: readonly { id: string; title: string }[]
  selectedPackId?: string | null
  onSelectPack?: (id: string | null) => void
}

const IN_PROGRESS_ROWS = 10

/** Mặt bàn (redesign spec 4.1): toolbar, one sign-in banner, tools, tray, in progress, forms, Today. */
export function DeskView({
  practiceId,
  vi,
  workspaces,
  workspaceId,
  workspaceError,
  refreshTick,
  packId,
  onReload,
  onSummary,
  onOpenTab,
  onPackLinked,
  userName = '',
  packs,
  selectedPackId,
  onSelectPack,
}: Props): ReactElement {
  const { t } = useI18n()
  const workspace = workspaces?.find((w) => w.id === workspaceId) ?? null
  const wsId = workspace?.id ?? null
  const home = useWorkLoad<WorkHomeSummary>(
    wsId ? `home:${wsId}` : null,
    () => window.uniworkWork.homeSummary(wsId ?? ''),
    { refreshTick, intervalMs: HOME_REFRESH_MS },
  )
  const view = overviewView({ workspaces, workspaceError, summary: home.value, error: home.error })
  const recents = useRecentDocuments(wsId, refreshTick, IN_PROGRESS_ROWS)
  // null until listDrafts answers: an empty list before that is not "nothing in progress"
  const [drafts, setDrafts] = useState<DeskDraft[] | null>(null)
  const [dropped, setDropped] = useState<string[] | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  // a ref, so an inline callback never re-fires the effect
  const onSummaryRef = useRef(onSummary)
  onSummaryRef.current = onSummary
  useEffect(() => {
    onSummaryRef.current?.(home.value)
  }, [home.value])

  // drafts follow the tabs: a save, a close or a new unsaved tab changes them
  useEffect(() => {
    let live = true
    // a slow older answer must not replace a newer one
    let latest = 0
    const load = () => {
      const req = ++latest
      void window.aiOffice.listDrafts().then(
        (d) => {
          if (live && req === latest) setDrafts(d)
        },
        // a failed first answer must not hold In progress on the skeleton: the recents still show
        () => {
          if (live && req === latest) setDrafts((d) => d ?? [])
        },
      )
    }
    load()
    const off = window.aiOfficeTabs?.onChanged(load)
    window.addEventListener('focus', load)
    return () => {
      live = false
      off?.()
      window.removeEventListener('focus', load)
    }
  }, [refreshTick])

  // a dragleave eaten by leaving the window, or a drop outside the Desk, must not leave the highlight on
  useEffect(() => {
    const reset = () => {
      dragDepth.current = 0
      setDragging(false)
    }
    window.addEventListener('drop', reset)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('drop', reset)
      window.removeEventListener('blur', reset)
    }
  }, [])

  const unsavedPaths = useMemo(
    () =>
      new Set(
        (drafts ?? []).flatMap((d) => (d.kind === 'unsaved' && d.filePath ? [d.filePath] : [])),
      ),
    [drafts],
  )

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  // enter/leave stay inside the Desk, so Home's "Drop to open" overlay hides over it
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.stopPropagation()
    dragDepth.current += 1
    setDragging(true)
  }
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return
    e.stopPropagation()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  const onDragOver = (e: DragEvent) => {
    if (hasFiles(e)) e.preventDefault()
  }
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return
    // claimed here: the preload's drop-to-open bridge skips a drop the page handled
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => window.aiOffice.pathForFile(f))
      .filter((p) => p.length > 0)
    setDropped(paths.length > 0 ? paths : null)
  }

  // the toolbar: a greeting when a name is known, then what waits, from data already loaded
  const hour = new Date().getHours()
  const greeting =
    hour >= 6 && hour < 12
      ? 'greetMorning'
      : hour >= 12 && hour < 18
        ? 'greetAfternoon'
        : 'greetEvening'
  const name = greetingName(userName)
  const s = home.value
  const due =
    s && !s.partial.includes('tasks') && s.counts.overdue !== null && s.counts.due_today !== null
      ? s.counts.overdue + s.counts.due_today
      : 0
  const unsaved = (drafts ?? []).filter((d) => d.kind === 'unsaved').length
  const facts = [
    due > 0 ? t('wbDeskSummaryTasks', { count: due }) : null,
    unsaved > 0 ? t('wbDeskSummaryUnsaved', { count: unsaved }) : null,
  ].filter(Boolean)
  const summary =
    name || facts.length > 0 ? (
      <>
        {name ? <strong>{t('wbDeskGreeting', { greeting: t(greeting), name })}</strong> : null}
        {name && facts.length > 0 ? ' ' : null}
        {facts.join(t('wbDeskSummaryJoin'))}
      </>
    ) : null

  // the one sign-in / offline notice on the Desk (spec 1.6): the tray and Today do not repeat it
  const banner =
    view === 'signed-out' ? (
      <div className="wb-banner is-info" role="status">
        <p>{t('wbDeskSignInBanner')}</p>
        <button
          type="button"
          className="wb-btn wb-btn-secondary wb-btn-sm"
          onClick={() => void window.aiOffice.accountLogin().catch(() => false)}
        >
          {t('wbDeskSignIn')}
        </button>
      </div>
    ) : view === 'unreachable' ? (
      <div className="wb-banner is-warning" role="alert">
        <p>{t('wbDeskOfflineBanner')}</p>
        <button type="button" className="wb-btn wb-btn-secondary wb-btn-sm" onClick={onReload}>
          {t('acctRetry')}
        </button>
      </div>
    ) : null

  // the toolbar and banner take a file drop too ("anywhere on the Desk"): the drop target is a
  // box-less wrapper, so the three stay rows of the page column
  return (
    <div
      className="wb-desk-drop"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <WorkToolbar title={vi ? DESK.labelVi : DESK.labelEn} summary={summary} />
      {banner}
      <div className={`wb-desk${dragging ? ' is-dragging' : ''}`}>
        <div className="wb-desk-main">
          <DeskTools
            dropped={dropped}
            onDropHandled={() => setDropped(null)}
            unsavedPaths={unsavedPaths}
          />
          <DeskInTray
            home={home}
            signedIn={workspace !== null}
            view={view}
            local={recents.local}
            onReload={onReload}
            refreshTick={refreshTick}
          />
          <DeskInProgress
            drafts={drafts ?? []}
            recent={recents.docs}
            local={recents.local}
            loading={drafts === null || !recents.loaded}
            // signed out or offline already has the page banner: no second notice here
            cloudFailed={recents.cloudFailed && view === 'ready'}
            retrying={recents.checking}
            onRetry={recents.reload}
          />
          <DeskDrawer
            practiceId={practiceId}
            packId={packId}
            orgId={workspace?.orgId ?? null}
            vi={vi}
            onManage={() => onOpenTab('forms')}
            onPackLinked={onPackLinked}
            packs={packs}
            selectedPackId={selectedPackId}
            onSelectPack={onSelectPack}
          />
        </div>
        <DeskToday
          home={home}
          view={view}
          workspace={workspace}
          onReload={onReload}
          onOpenTasks={() => onOpenTab('tasks')}
        />
      </div>
    </div>
  )
}
