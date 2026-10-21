import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { RecentEntry, UniworkDocStatus, UniworkDocSummary } from '../../shared/home-api'
import type { WorkHomeSummary, WorkNotification } from '../../shared/uniwork-work-api'
import {
  documentChangedFacts,
  documentChangedHasPage,
  noticeState,
  opensDocumentList,
} from './desk-doc-change'
import {
  docNotifications,
  freshShared,
  initials,
  inTrayRows,
  noteSentence,
  notePillKey,
  syncProblems,
  type InTrayRow,
} from './desk-model'
import { DocChangeDialog } from './DocChangeDialog'
import { DocPickerList } from './doclist/PickerList'
import { useI18n, type StringKey } from './locale'
import { publishUniworkNotice } from './uniwork-notice-bus'
import { openUniworkDocument } from './uniwork-open'
import { WorkbenchIcon } from './WorkbenchIcons'
import type { OverviewView } from './work-home'
import type { WorkLoad } from './work-cache'
import { WorkSkeleton, WorkStatePanel, WorkspacePickerContext } from './WorkErrorState'

/** what a click on a note does, decided from the notice (see openNote) */
interface NoteState {
  /** a several-document change: opens the list of its documents */
  list: boolean
  /** deleted or out of reach: say why in the launch notice instead of opening */
  notice: 'deleted' | 'forbidden' | null
  /** no page to open (deleted, trashed or out of reach): the click only marks it read */
  gone: boolean
}

/** px the picker keeps clear at a row's end: the pill (and, on a sync problem, Resolve) */
const TRAIL_PILL = 128
const TRAIL_RESOLVE = 232

const TRAY_ROWS = 8
/** working copies whose sync state is asked for (one stat each in main) */
const SYNC_PROBES = 20

interface Props {
  home: WorkLoad<WorkHomeSummary>
  /** a workspace is selected: the server sources can load */
  signedIn: boolean
  /** the page's server state: which note an empty tray shows */
  view: OverviewView
  /** this device's recents as listed (working copies included) */
  local: readonly RecentEntry[]
  /** reload the workspace list and every server section (the top bar's Refresh) */
  onReload?: () => void
  /** bumped by the top bar's Refresh: "Shared with you" reloads too */
  refreshTick?: number
}

/** "Cần bạn xử lý" (office desk spec §3.1): sync problems, comments and mentions, new shares. */
export function DeskInTray({
  home,
  signedIn,
  view,
  local,
  onReload,
  refreshTick,
}: Props): ReactElement {
  const { t } = useI18n()
  const pickWorkspace = useContext(WorkspacePickerContext)
  const titleId = useId()
  const [shared, setShared] = useState<UniworkDocSummary[]>([])
  const [statuses, setStatuses] = useState<Record<string, UniworkDocStatus>>({})
  const [expanded, setExpanded] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  /** the change notice whose documents the list dialog shows */
  const [listFor, setListFor] = useState<string | null>(null)

  useEffect(() => {
    if (!signedIn) {
      setShared([])
      return
    }
    let live = true
    void window.aiOffice.uniworkListSharedWithMe({ limit: 20 }).then(
      (r) => {
        if (live) setShared(r.ok ? r.value.documents : [])
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [signedIn, refreshTick])

  const bound = useMemo(
    () =>
      local
        .filter((e) => e.uniwork)
        .slice(0, SYNC_PROBES)
        .map((e) => e.path),
    [local],
  )
  const boundKey = bound.join('\n')
  useEffect(() => {
    const paths = boundKey ? boundKey.split('\n') : []
    let live = true
    // paths an event updated while the probes ran: the event is newer than the probe
    const touched = new Set<string>()
    void Promise.all(paths.map((p) => window.aiOffice.uniworkDocStatus(p).catch(() => null))).then(
      (list) => {
        if (!live) return
        const fresh = Object.fromEntries(list.flatMap((s) => (s ? [[s.path, s]] : [])))
        setStatuses((m) => ({
          ...fresh,
          ...Object.fromEntries(Object.entries(m).filter(([p]) => touched.has(p))),
        }))
      },
    )
    const off = window.aiOffice.onUniworkDocStatus((s) => {
      if (!paths.includes(s.path)) return
      touched.add(s.path)
      setStatuses((m) => ({ ...m, [s.path]: s }))
    })
    return () => {
      live = false
      off()
    }
  }, [boundKey])

  // "Show more" removes itself: focus goes on to the first row it revealed
  useEffect(() => {
    if (expanded)
      listRef.current?.querySelectorAll<HTMLButtonElement>('.wb-desk-row-title')[TRAY_ROWS]?.focus()
  }, [expanded])

  const rows = inTrayRows({
    notes: home.value ? docNotifications(home.value.inbox) : [],
    shared: freshShared(shared, local, Date.now()),
    sync: syncProblems(Object.values(statuses)),
  })
  const visible = expanded ? rows : rows.slice(0, TRAY_ROWS)

  /** mark one notice read; a refusal is quiet: the row comes back with the next summary */
  const markRead = async (id: string) => {
    const r = await window.uniworkWork.markNotificationsRead([id]).catch(() => null)
    if (r?.ok)
      home.update((s) => ({
        ...s,
        inbox: s.inbox.filter((n) => n.id !== id),
        counts: {
          ...s.counts,
          unread: s.counts.unread === null ? null : Math.max(0, s.counts.unread - 1),
        },
      }))
  }

  const openNote = async (n: WorkNotification, state: NoteState, title: string) => {
    if (state.list) {
      // the list reads the documents itself; the notice is read as it opens
      setListFor(n.id)
      void markRead(n.id)
      return
    }
    if (state.notice) {
      // gone or out of reach: nothing to open, so say why and clear the reminder
      publishUniworkNotice({ phase: 'failed', error: state.notice })
      await markRead(n.id)
      return
    }
    if (state.gone) {
      await markRead(n.id)
      return
    }
    // a failed open keeps the reminder
    if (!(await openUniworkDocument({ documentId: n.resource_id, title }, window.aiOffice))) return
    await markRead(n.id)
  }

  const describe = (
    r: InTrayRow,
  ): {
    key: string
    /** the row as the picker list's document: its date, editor and file type */
    doc: UniworkDocSummary
    /** what stands in for the file badge (a person or the inbox mark); null = the file's badge */
    icon: ReactNode | null
    title: string
    sub: string
    pill: { tone: 'danger' | 'info' | 'neutral'; label: StringKey }
    /** a sync problem's visible next step; other rows show their time */
    resolve: boolean
    /** the document is deleted or out of reach: the row is dimmed and only clears itself */
    gone: boolean
    open: () => void
  } => {
    if (r.kind === 'note') {
      const n = r.note
      const actor = n.params.actor ?? ''
      const changed = n.kind === 'document_changed'
      const facts = changed ? documentChangedFacts(n) : null
      const sentence = (() => {
        const { key, params } = noteSentence(n)
        return t(key, params)
      })()
      const list = opensDocumentList(n)
      // a several-document change always opens its list; any other notice says when its document is gone
      const verdict = list ? 'open' : noticeState(n)
      const state: NoteState = {
        list,
        notice: verdict === 'deleted' ? 'deleted' : verdict === 'no_access' ? 'forbidden' : null,
        gone: verdict !== 'open' || (changed && !documentChangedHasPage(n)),
      }
      // the document's name for the open notice and the row's title
      const named = facts ? (facts.titles[0] ?? '') : (n.params.document ?? '')
      const titles =
        facts && facts.count > 1 && facts.titles.length > 0
          ? [
              facts.titles.join(', '),
              facts.more > 0 ? t('wbDocChangeMore', { count: facts.more }) : '',
            ]
              .filter(Boolean)
              .join(' ')
          : ''
      // a change reads as its sentence; a comment, mention or resolved note names the document
      const sentenceIsTitle = changed || !named
      const title = sentenceIsTitle ? sentence : named
      const sub = state.notice
        ? t(state.notice === 'deleted' ? 'uwErrDeleted' : 'uwErrForbidden')
        : sentenceIsTitle
          ? titles
          : sentence
      return {
        key: `n:${n.id}`,
        // a notification names a document but not its type: the person (or the inbox mark) is the icon
        doc: { id: `n:${n.id}`, workspaceId: '', title, format: null, updatedAt: n.created_at },
        icon: actor ? (
          <span className="wb-desk-avatar" aria-hidden="true">
            {initials(actor)}
          </span>
        ) : (
          <WorkbenchIcon id="inbox" size={24} tint="blue" />
        ),
        title,
        sub,
        pill: { tone: changed ? 'neutral' : 'info', label: notePillKey(n) },
        resolve: false,
        gone: state.gone,
        open: () => void openNote(n, state, named),
      }
    }
    if (r.kind === 'shared') {
      const d = r.doc
      return {
        key: `s:${d.id}`,
        doc: d,
        icon: null,
        title: d.title,
        sub: [t('wbDeskReasonShared'), d.workspaceName].filter(Boolean).join(' · '),
        pill: { tone: 'neutral', label: 'wbDeskPillShared' },
        resolve: false,
        gone: false,
        open: () => void openUniworkDocument({ documentId: d.id, title: d.title }, window.aiOffice),
      }
    }
    const s = r.status
    const conflict = s.state === 'conflict'
    return {
      key: `y:${s.path}`,
      doc: {
        id: `y:${s.path}`,
        workspaceId: s.workspaceId,
        title: s.title,
        format: s.format as UniworkDocSummary['format'],
        updatedAt: s.lastSavedAt ?? '',
      },
      icon: null,
      title: s.title,
      sub: t(conflict ? 'wbDeskReasonConflict' : 'wbDeskReasonSync'),
      pill: { tone: 'danger', label: conflict ? 'wbDeskPillConflict' : 'wbDeskPillSync' },
      resolve: true,
      gone: false,
      open: () =>
        void openUniworkDocument({ documentId: s.documentId, title: s.title }, window.aiOffice),
    }
  }

  const described = visible.map(describe)
  const byId = new Map(described.map((d) => [d.doc.id, d]))

  // an empty tray only says "nothing waiting" when the notifications really loaded;
  // signed out, offline or locked out, the Desk banner (or Today) already says why
  const empty = (): ReactNode => {
    if (view === 'loading') return <WorkSkeleton rows={2} />
    if (view === 'forbidden' && pickWorkspace)
      return (
        <p className="wb-ov-note">
          {t('wbDeskNoServerData')} ·{' '}
          <button type="button" className="wb-link" onClick={pickWorkspace}>
            {t('wbOvPickWorkspace')}
          </button>
        </p>
      )
    if (view === 'signed-out' || view === 'unreachable' || view === 'forbidden')
      return <p className="wb-ov-note">{t('wbDeskNoServerData')}</p>
    if (view === 'no-workspace') return <p className="wb-ov-note">{t('wbOvNoWorkspaceTitle')}</p>
    if (home.error || home.value?.partial.includes('notifications'))
      return (
        <p className="wb-ov-partial">
          {t('wbOvLoadFailed')} ·{' '}
          <button type="button" className="wb-link" onClick={onReload ?? home.reload}>
            {t('acctRetry')}
          </button>
        </p>
      )
    return (
      <WorkStatePanel
        tone="gray"
        icon={<WorkbenchIcon id="inbox" size={20} />}
        title={t('wbDeskInTrayEmpty')}
        role="status"
        compact
      />
    )
  }

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      className="wb-desk-card wb-block"
      aria-labelledby={titleId}
    >
      <div className="wb-desk-head">
        <h3 id={titleId}>{t('wbDeskInTray')}</h3>
        {rows.length > 0 ? <span className="wb-desk-count wb-num">{rows.length}</span> : null}
      </div>
      {rows.length === 0 ? (
        empty()
      ) : (
        <>
          <DocPickerList
            docs={described.map((d) => d.doc)}
            label={t('wbDeskInTray')}
            activeId={null}
            semantics="list"
            listRef={listRef}
            reserve={described.some((d) => d.resolve) ? TRAIL_RESOLVE : TRAIL_PILL}
            iconFor={(doc) => byId.get(doc.id)?.icon ?? null}
            sublineFor={(doc) => {
              const sub = byId.get(doc.id)?.sub
              return sub ? { short: sub, full: sub } : null
            }}
            nameFor={(doc) => {
              const d = byId.get(doc.id)
              if (!d) return null
              return (
                <button
                  type="button"
                  id={`${titleId}-row${described.indexOf(d)}`}
                  className="wb-row-title wb-desk-row-title"
                >
                  {d.title}
                </button>
              )
            }}
            // the whole row opens (the title button's click bubbles here, so it opens once)
            optionProps={(doc) => {
              const d = byId.get(doc.id)
              return { onClick: d?.open, className: d?.gone ? 'is-gone' : undefined }
            }}
            trailing={(doc) => {
              const d = byId.get(doc.id)
              if (!d) return null
              return (
                <span className="wb-desk-trail">
                  <span
                    className={`wb-pill${d.pill.tone === 'neutral' ? '' : ` is-${d.pill.tone}`}`}
                  >
                    {t(d.pill.label)}
                  </span>
                  {d.resolve ? (
                    <button
                      type="button"
                      className="wb-btn wb-btn-secondary wb-btn-sm wb-desk-row-act"
                      aria-describedby={`${titleId}-row${described.indexOf(d)}`}
                      onClick={d.open}
                    >
                      {t('wbDeskResolve')}
                    </button>
                  ) : null}
                </span>
              )
            }}
          />
          {rows.length > visible.length ? (
            <div className="wb-desk-more">
              <button type="button" className="wb-link" onClick={() => setExpanded(true)}>
                {t('wbDeskMore', { count: rows.length - visible.length })}
              </button>
            </div>
          ) : null}
        </>
      )}
      {listFor ? (
        <DocChangeDialog
          key={listFor}
          notificationId={listFor}
          onClose={() => setListFor(null)}
          returnFocus={() =>
            listRef.current?.querySelector<HTMLElement>('.wb-desk-row-title') ?? sectionRef.current
          }
        />
      ) : null}
    </section>
  )
}
