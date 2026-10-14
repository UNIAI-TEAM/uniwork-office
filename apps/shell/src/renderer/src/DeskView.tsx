import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, ReactElement } from 'react'
import type { PracticeId } from '@uniwork/practice-core'
import type { DeskDraft, UniworkWorkspaceRef } from '../../shared/home-api'
import type { UniworkWorkError, WorkHomeSummary } from '../../shared/uniwork-work-api'
import { DeskDrawer } from './DeskDrawer'
import { DeskInProgress } from './DeskInProgress'
import { DeskInTray } from './DeskInTray'
import { DeskToday } from './DeskToday'
import { DeskTools } from './DeskTools'
import { HOME_REFRESH_MS, overviewView, useRecentDocuments } from './work-home'
import { useWorkLoad } from './work-cache'

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
}

const IN_PROGRESS_ROWS = 10

/** Mặt bàn (office desk spec): tools, what needs you, work in progress, the forms drawer, Today. */
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
}: Props): ReactElement {
  const workspace = workspaces?.find((w) => w.id === workspaceId) ?? null
  const wsId = workspace?.id ?? null
  const home = useWorkLoad<WorkHomeSummary>(
    wsId ? `home:${wsId}` : null,
    () => window.uniworkWork.homeSummary(wsId ?? ''),
    { refreshTick, intervalMs: HOME_REFRESH_MS },
  )
  const view = overviewView({ workspaces, workspaceError, summary: home.value, error: home.error })
  const recents = useRecentDocuments(wsId, refreshTick, IN_PROGRESS_ROWS)
  const [drafts, setDrafts] = useState<DeskDraft[]>([])
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
    const load = () => {
      void window.aiOffice.listDrafts().then(
        (d) => {
          if (live) setDrafts(d)
        },
        () => undefined,
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

  const unsavedPaths = useMemo(
    () => new Set(drafts.flatMap((d) => (d.kind === 'unsaved' && d.filePath ? [d.filePath] : []))),
    [drafts],
  )

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return
    dragDepth.current += 1
    setDragging(true)
  }
  const onDragLeave = (e: DragEvent) => {
    if (!hasFiles(e)) return
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

  return (
    <div
      className={`wb-desk${dragging ? ' is-dragging' : ''}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="wb-desk-main">
        <DeskTools
          dropped={dropped}
          onDropHandled={() => setDropped(null)}
          unsavedPaths={unsavedPaths}
        />
        <DeskInTray home={home} signedIn={workspace !== null} local={recents.local} />
        <DeskInProgress drafts={drafts} recent={recents.docs} />
        <DeskDrawer
          practiceId={practiceId}
          packId={packId}
          orgId={workspace?.orgId ?? null}
          vi={vi}
          onManage={() => onOpenTab('forms')}
        />
      </div>
      <DeskToday
        home={home}
        view={view}
        workspace={workspace}
        workspaceError={workspaceError}
        onReload={onReload}
        onOpenTasks={() => onOpenTab('tasks')}
      />
    </div>
  )
}
