import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import type { UniworkWorkError, WorkNotification } from '../../shared/uniwork-work-api'
import { DocChangeDialog } from './DocChangeDialog'
import { useI18n, type StringKey } from './locale'
import { MODULE_TONES, tintStyle, type Tint } from './module-tones'
import { noticeLine, openNotice } from './notice-open'
import { relativeNoticeTime } from './notice-time'
import {
  NOTICES_PAGE,
  callWork,
  idBatches,
  notifyNoticesChanged,
  useAlive,
  useNoticesRefresh,
} from './notices-data'
import {
  INBOX_CATEGORIES,
  groupInbox,
  inboxCategory,
  isDocumentKind,
  noticeTarget,
  notePillKey,
  unreadByCategory,
  type InboxCategory,
  type InboxGroup,
  type InboxGroupKey,
} from './notices-model'
import { WbIconBtn } from './WbRowActions'
import { useWbToast } from './WbToastHost'
import {
  WorkErrorState,
  WorkNoWorkspace,
  WorkSkeleton,
  WorkStatePanel,
  type WorkPaneProps,
} from './WorkErrorState'
import { WbGlyph, WorkbenchIcon, type WbGlyphId } from './WorkbenchIcons'
import { WorkToolbar, type WorkToolbarProps } from './WorkToolbar'
import { appendOlder, mergeFirstPage } from './inbox-list'

type Filter = 'all' | 'unread'

/** the glyph and tint that stand for a category on its rows */
const CATEGORY_ICON: Record<InboxCategory, { glyph: WbGlyphId; tint: Tint }> = {
  mentions: { glyph: 'pencil', tint: 'blue' },
  assigned: { glyph: 'arrowRight', tint: 'green' },
  meetings: { glyph: 'video', tint: 'violet' },
  updates: { glyph: 'refresh', tint: 'yellow' },
  workspace: { glyph: 'folder', tint: 'gray' },
}

const CATEGORY_LABEL: Record<InboxCategory, StringKey> = {
  mentions: 'inboxCategoryMentions',
  assigned: 'inboxCategoryAssigned',
  meetings: 'inboxCategoryMeetings',
  updates: 'inboxCategoryUpdates',
  workspace: 'inboxCategoryWorkspace',
}

const GROUP_LABEL: Record<InboxGroupKey, StringKey> = {
  unread: 'inboxGroupUnread',
  today: 'inboxGroupToday',
  yesterday: 'inboxGroupYesterday',
  week: 'inboxGroupWeek',
  older: 'inboxGroupOlder',
}

interface ListState {
  /** the loaded rows, newest first; null until the first page */
  rows: WorkNotification[] | null
  /** cursor of the next older page; null at the end */
  next: string | null
  /** why the last reload failed (the rows on screen are kept) */
  error: UniworkWorkError | null
  loadingOlder: boolean
  /** the last "show older" failed */
  olderError: boolean
  /** an older page has been added to the list */
  paged: boolean
  /** a new filter's first page is on its way: the filters stay, the rows are a skeleton */
  switching: boolean
}

const INITIAL: ListState = {
  rows: null,
  next: null,
  error: null,
  loadingOlder: false,
  olderError: false,
  paged: false,
  switching: false,
}

const withRead = (rows: WorkNotification[], ids: ReadonlySet<string>, read: boolean) =>
  rows.map((n) => {
    if (!ids.has(n.id)) return n
    if (read) return n.read_at ? n : { ...n, read_at: new Date().toISOString() }
    const { read_at: _unused, ...rest } = n
    return rest
  })

/**
 * The Inbox tab (UNI-2079): the web inbox in the app. Every notice of the workspace, 30 at a time,
 * newest first, as All or Unread and by category; read, unread and archive per row, mark all read, Undo
 * for the bulk and the archive, j / k / r / e / Enter from the keyboard, and a click opens the notice
 * where it points. A document opens in the app; a task, meeting or chat opens on the web.
 */
export function InboxPane({
  workspace,
  workspaceError,
  onReload,
  head,
}: WorkPaneProps & {
  /** the tab toolbar, drawn here so its summary can count the unread rows */
  head?: WorkToolbarProps
}): ReactElement {
  if (!workspace) {
    return (
      <>
        {head ? <WorkToolbar {...head} /> : null}
        <WorkNoWorkspace error={workspaceError} onRetry={onReload} />
      </>
    )
  }
  // another workspace starts from nothing: its own list, filters and pins
  return <InboxList key={workspace.id} workspace={workspace} head={head} />
}

function InboxList({
  workspace,
  head,
}: {
  workspace: NonNullable<WorkPaneProps['workspace']>
  head?: WorkToolbarProps
}): ReactElement {
  const { t, dateLocale } = useI18n()
  const toasts = useWbToast()
  const wsId = workspace.id
  const alive = useAlive()
  const [state, setState] = useState<ListState>(INITIAL)
  const [filter, setFilter] = useState<Filter>('all')
  const [category, setCategory] = useState<InboxCategory | 'any'>('any')
  // rows the person just read or unread stay in the group they were in: they do not jump away under the cursor
  const [pins, setPins] = useState<ReadonlyMap<string, InboxGroupKey>>(new Map())
  const [listFor, setListFor] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const stateRef = useRef(state)
  stateRef.current = state
  const filterRef = useRef(filter)
  filterRef.current = filter
  // a write or a new filter outdates every request that is already on its way
  const epoch = useRef(0)
  // counts filter switches only, so a request can tell a write from a switch
  const filterEpoch = useRef(0)
  const want = useRef({ refresh: false, older: false })
  const busy = useRef(false)

  const query = useCallback(
    (extra: { before?: string } = {}) => ({
      workspaceId: wsId,
      ...(filterRef.current === 'unread' ? { unread: true } : {}),
      ...extra,
      limit: NOTICES_PAGE,
    }),
    [wsId],
  )

  const doRefresh = useCallback(async () => {
    const mine = epoch.current
    const result = await callWork(() => window.uniworkWork.listNotifications(query()))
    if (!alive() || mine !== epoch.current) return
    setState((s) =>
      result.ok
        ? {
            ...s,
            ...mergeFirstPage(s.rows, s.next, result.value),
            error: null,
            switching: false,
          }
        : { ...s, error: result.error },
    )
  }, [alive, query])

  const doOlder = useCallback(async () => {
    const cursor = stateRef.current.next
    if (!stateRef.current.rows || cursor === null) return
    const mine = epoch.current
    const filterMine = filterEpoch.current
    setState((s) => ({ ...s, loadingOlder: true, olderError: false }))
    const result = await callWork(() =>
      window.uniworkWork.listNotifications(query({ before: cursor })),
    )
    if (!alive()) return
    if (mine !== epoch.current) {
      // a write landed meanwhile: the list reloads first, then this page is asked for again;
      // a filter switch drops the request, nobody asked the new list for its second page
      setState((s) => ({ ...s, loadingOlder: false }))
      if (filterMine === filterEpoch.current) want.current.older = true
      return
    }
    setState((s) =>
      result.ok
        ? { ...s, ...appendOlder(s.rows ?? [], result.value), loadingOlder: false, paged: true }
        : { ...s, loadingOlder: false, olderError: true },
    )
  }, [alive, query])

  // one request at a time; a reload outranks "show older"
  const pump = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      while (alive() && (want.current.refresh || want.current.older)) {
        if (want.current.refresh) {
          want.current.refresh = false
          await doRefresh()
        } else {
          want.current.older = false
          await doOlder()
        }
      }
    } finally {
      busy.current = false
    }
  }, [alive, doRefresh, doOlder])
  const refresh = useCallback(() => {
    want.current.refresh = true
    void pump()
  }, [pump])
  const showOlder = useCallback(() => {
    want.current.older = true
    void pump()
  }, [pump])

  useNoticesRefresh(refresh, { key: wsId })

  const changeFilter = (next: Filter) => {
    if (next === filter) return
    filterRef.current = next
    epoch.current++
    filterEpoch.current++
    want.current.older = false
    setFilter(next)
    setPins(new Map())
    setState({ ...INITIAL, switching: true })
    refresh()
  }

  // ── what is on screen ──
  const rows = state.rows
  const now = new Date(Date.now())
  const visible = rows
    ? category === 'any'
      ? rows
      : rows.filter((n) => inboxCategory(n.kind) === category)
    : []
  const groups = groupInbox(visible, now, pins)
  const order = groups.flatMap((g) => g.rows.map((n) => n.id))
  const groupsRef = useRef<InboxGroup[]>(groups)
  groupsRef.current = groups
  const orderRef = useRef(order)
  orderRef.current = order
  const unreadHere = rows ? rows.filter((n) => !n.read_at).length : 0

  // ── focus ──
  const rowEl = (id: string): HTMLElement | null =>
    Array.from(rootRef.current?.querySelectorAll<HTMLElement>('li[data-notice-id]') ?? []).find(
      (li) => li.dataset.noticeId === id,
    ) ?? null
  const focusRow = (id: string | undefined) =>
    id ? (rowEl(id)?.querySelector<HTMLElement>('.wb-inbox-main')?.focus(), undefined) : undefined
  // a removed row took the focus with it: it lands on its neighbour once the list has re-rendered
  const refocus = useRef<string | null>(null)
  useEffect(() => {
    if (refocus.current === null) return
    focusRow(refocus.current)
    refocus.current = null
  })
  const neighbour = (id: string): string | undefined => {
    const at = orderRef.current.indexOf(id)
    return orderRef.current[at + 1] ?? orderRef.current[at - 1]
  }

  // ── writes ──
  const settled = () => {
    refresh()
    notifyNoticesChanged()
  }
  const failed = () =>
    toasts.show({ id: 'inbox-failed', tone: 'alert', message: { key: 'inboxError' } })
  const pin = (ids: readonly string[]) => {
    const next = new Map(pins)
    for (const g of groupsRef.current)
      for (const n of g.rows) if (ids.includes(n.id) && !next.has(n.id)) next.set(n.id, g.key)
    setPins(next)
  }
  const edit = (change: (rows: WorkNotification[]) => WorkNotification[]) => {
    epoch.current++
    setState((s) => (s.rows ? { ...s, rows: change(s.rows) } : s))
  }

  const setRead = async (n: WorkNotification, read: boolean) => {
    pin([n.id])
    edit((all) => withRead(all, new Set([n.id]), read))
    const result = await callWork(() =>
      read
        ? window.uniworkWork.markNotificationsRead([n.id])
        : window.uniworkWork.markNotificationsUnread([n.id]),
    )
    if (!result.ok) {
      edit((all) => withRead(all, new Set([n.id]), !read))
      failed()
    }
    settled()
  }

  // opening a notice reads it, but never complains: it comes back with the next reload
  const markReadQuiet = async (id: string) => {
    pin([id])
    const result = await callWork(() => window.uniworkWork.markNotificationsRead([id]))
    if (result.ok) edit((all) => withRead(all, new Set([id]), true))
    settled()
  }

  const archive = async (n: WorkNotification) => {
    const was = stateRef.current.rows ?? []
    const at = was.findIndex((r) => r.id === n.id)
    refocus.current = neighbour(n.id) ?? null
    edit((all) => all.filter((r) => r.id !== n.id))
    const result = await callWork(() => window.uniworkWork.archiveNotifications([n.id]))
    if (!result.ok) {
      edit((all) => {
        const back = [...all]
        back.splice(Math.min(Math.max(at, 0), back.length), 0, n)
        return back
      })
      failed()
      settled()
      return
    }
    toasts.show({
      id: `inbox-archive:${n.id}`,
      message: { key: 'inboxArchivedOne', params: { n: 1 } },
      actions: [
        {
          label: 'inboxUndo',
          onClick: () => {
            void (async () => {
              const undone = await callWork(() => window.uniworkWork.unarchiveNotifications([n.id]))
              if (!undone.ok) {
                toasts.show({
                  id: `inbox-archive:${n.id}`,
                  tone: 'alert',
                  message: { key: 'inboxUndoFailed' },
                })
              }
              settled()
            })()
          },
        },
      ],
    })
    settled()
  }

  const markAll = async () => {
    epoch.current++
    const result = await callWork(() =>
      window.uniworkWork.markAllNotificationsRead({ workspaceId: wsId }),
    )
    if (!result.ok) {
      failed()
      settled()
      return
    }
    const ids = result.value
    if (ids.length > 0) {
      edit((all) => withRead(all, new Set(all.map((n) => n.id)), true))
      toasts.show({
        id: 'inbox-mark-all',
        message: {
          key: ids.length === 1 ? 'inboxMarkedAllOne' : 'inboxMarkedAllOther',
          params: { n: ids.length },
        },
        actions: [
          {
            label: 'inboxUndo',
            onClick: () => {
              void (async () => {
                let ok = true
                for (const batch of idBatches(ids)) {
                  const undone = await callWork(() =>
                    window.uniworkWork.markNotificationsUnread(batch),
                  )
                  if (!undone.ok) ok = false
                }
                if (!ok) {
                  toasts.show({
                    id: 'inbox-mark-all',
                    tone: 'alert',
                    message: { key: 'inboxUndoFailed' },
                  })
                }
                settled()
              })()
            },
          },
        ],
      })
    }
    settled()
  }

  const open = async (n: WorkNotification) => {
    await openNotice(n, noticeLine(n, t, dateLocale), {
      workspace,
      markRead: markReadQuiet,
      openList: setListFor,
    })
  }

  // ── keyboard (as on the web: j / k move, r reads, e archives; Enter is the row button's own) ──
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return
    const current = target.closest<HTMLElement>('li[data-notice-id]')?.dataset.noticeId
    const all = orderRef.current
    const step = (by: 1 | -1) => {
      e.preventDefault()
      if (current === undefined) return focusRow(all[by === 1 ? 0 : all.length - 1])
      const to = all[all.indexOf(current) + by]
      if (to) focusRow(to)
    }
    switch (e.key) {
      case 'j':
        return step(1)
      case 'k':
        return step(-1)
      case 'ArrowDown':
        return current === undefined ? undefined : step(1)
      case 'ArrowUp':
        return current === undefined ? undefined : step(-1)
      case 'r':
      case 'e': {
        const n = current === undefined ? undefined : rows?.find((r) => r.id === current)
        if (!n) return
        e.preventDefault()
        if (e.key === 'e') void archive(n)
        else void setRead(n, !n.read_at)
        return
      }
    }
  }

  // ── view ──
  const counts = unreadByCategory(rows ?? [])
  // with more pages unloaded the loaded rows are not the unread total: say only the tab's hint
  const summary =
    rows && state.next === null ? (
      <>
        <strong>
          {t(unreadHere === 1 ? 'inboxCategoryUnreadOne' : 'inboxCategoryUnreadOther', {
            n: unreadHere,
          })}
        </strong>
        {head?.summary ? <> · {head.summary}</> : null}
      </>
    ) : (
      head?.summary
    )
  const actions = (
    <button
      type="button"
      className="wb-btn wb-btn-secondary wb-btn-sm"
      disabled={rows === null || (unreadHere === 0 && state.next === null)}
      onClick={() => void markAll()}
    >
      {t('inboxMarkAllRead')}
    </button>
  )
  const toolbar = head ? <WorkToolbar {...head} summary={summary} actions={actions} /> : null

  if (rows === null && !state.switching) {
    return (
      <>
        {toolbar}
        {state.error ? (
          <WorkErrorState state={state.error} onRetry={refresh} />
        ) : (
          <WorkSkeleton rows={4} />
        )}
      </>
    )
  }

  const empty = (): ReactElement => {
    const icon = <WorkbenchIcon id="inbox" size={20} />
    if ((rows ?? []).length === 0)
      return filter === 'unread' ? (
        <WorkStatePanel
          tone={MODULE_TONES.inbox}
          icon={icon}
          title={t('inboxEmptyUnreadTitle')}
          role="status"
        />
      ) : (
        <WorkStatePanel
          tone={MODULE_TONES.inbox}
          icon={icon}
          title={t('inboxEmptyTitle')}
          body={t('inboxEmptyDescription')}
          role="status"
        />
      )
    // rows exist, but none of this category among them
    return state.next !== null ? (
      <WorkStatePanel
        tone={MODULE_TONES.inbox}
        icon={icon}
        title={t('inboxEmptyCategoryTitle')}
        body={t('inboxEmptyCategoryMore')}
        action={{ label: t('inboxLoadOlder'), onClick: showOlder, variant: 'secondary' }}
        role="status"
      />
    ) : (
      <WorkStatePanel
        tone={MODULE_TONES.inbox}
        icon={icon}
        title={t('inboxEmptyCategoryTitle')}
        body={t('inboxEmptyCategoryDescription')}
        action={{
          label: t('inboxShowAnyCategory'),
          onClick: () => setCategory('any'),
          variant: 'secondary',
        }}
        role="status"
      />
    )
  }

  return (
    <>
      {toolbar}
      <div className="wb-work wb-inbox" ref={rootRef} onKeyDown={onKeyDown}>
        <div className="wb-inbox-bar">
          <div className="wb-inbox-seg" role="group" aria-label={t('inboxTitle')}>
            {(['all', 'unread'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className="wb-inbox-seg-btn"
                aria-pressed={filter === f}
                onClick={() => changeFilter(f)}
              >
                {t(f === 'all' ? 'inboxFilterAll' : 'inboxFilterUnread')}
              </button>
            ))}
          </div>
          <div className="wb-inbox-chips" role="group" aria-label={t('inboxCategoryLabel')}>
            {(['any', ...INBOX_CATEGORIES] as const).map((c) => {
              const n = c === 'any' ? 0 : counts[c]
              return (
                <button
                  key={c}
                  type="button"
                  className="wb-inbox-chip"
                  aria-pressed={category === c}
                  onClick={() => setCategory(c)}
                >
                  {t(c === 'any' ? 'inboxCategoryAny' : CATEGORY_LABEL[c])}
                  {n > 0 ? (
                    <>
                      <span className="wb-inbox-chip-count wb-num" aria-hidden="true">
                        {n}
                      </span>
                      <span className="uw-sr-only">
                        {t(n === 1 ? 'inboxCategoryUnreadOne' : 'inboxCategoryUnreadOther', { n })}
                      </span>
                    </>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>

        {state.error && rows ? (
          <p className="wb-ov-partial" role="alert">
            {t('inboxError')} ·{' '}
            <button type="button" className="wb-link" onClick={refresh}>
              {t('acctRetry')}
            </button>
          </p>
        ) : null}

        {rows === null ? (
          state.error ? (
            <WorkErrorState state={state.error} onRetry={refresh} />
          ) : (
            <WorkSkeleton rows={4} />
          )
        ) : visible.length === 0 ? (
          empty()
        ) : (
          <>
            <div className="wb-block wb-inbox-body">
              {groups.map((g) => (
                <section key={g.key} className="wb-inbox-group">
                  <h3 className="wb-inbox-group-head">
                    <strong>{t(GROUP_LABEL[g.key])}</strong>
                    <span className="wb-inbox-group-count wb-num">
                      {t(g.rows.length === 1 ? 'inboxGroupCountOne' : 'inboxGroupCountOther', {
                        n: g.rows.length,
                      })}
                    </span>
                  </h3>
                  <ul className="wb-inbox-list">
                    {g.rows.map((n) => (
                      <InboxRow
                        key={n.id}
                        n={n}
                        now={now.getTime()}
                        onOpen={() => void open(n)}
                        onToggleRead={() => void setRead(n, !n.read_at)}
                        onArchive={() => void archive(n)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            {state.error === null && state.olderError ? (
              <p className="wb-ov-partial" role="alert">
                {t('inboxError')}
              </p>
            ) : null}
            {state.next !== null ? (
              <div className="wb-inbox-more">
                <button
                  type="button"
                  className="wb-btn wb-btn-secondary"
                  disabled={state.loadingOlder}
                  aria-busy={state.loadingOlder}
                  onClick={showOlder}
                >
                  {t(state.loadingOlder ? 'inboxLoadingOlder' : 'inboxLoadOlder')}
                </button>
              </div>
            ) : state.paged ? (
              <p className="wb-ov-note wb-inbox-end">{t('inboxEndOfList')}</p>
            ) : null}
            <p className="wb-inbox-keys">
              <span>
                <kbd className="wb-kbd">j</kbd> <kbd className="wb-kbd">k</kbd> {t('inboxKeysMove')}
              </span>
              <span>
                <kbd className="wb-kbd">↵</kbd> {t('inboxKeysOpen')}
              </span>
              <span>
                <kbd className="wb-kbd">r</kbd> {t('inboxKeysRead')}
              </span>
              <span>
                <kbd className="wb-kbd">e</kbd> {t('inboxKeysArchive')}
              </span>
            </p>
          </>
        )}
      </div>
      {listFor ? (
        <DocChangeDialog
          key={listFor}
          notificationId={listFor}
          onClose={() => setListFor(null)}
          onLoaded={() => void markReadQuiet(listFor)}
          returnFocus={() =>
            rowEl(listFor)?.querySelector<HTMLElement>('.wb-inbox-main') ?? rootRef.current
          }
        />
      ) : null}
    </>
  )
}

function InboxRow({
  n,
  now,
  onOpen,
  onToggleRead,
  onArchive,
}: {
  n: WorkNotification
  now: number
  onOpen: () => void
  onToggleRead: () => void
  onArchive: () => void
}): ReactElement {
  const { t, dateLocale } = useI18n()
  const line = noticeLine(n, t, dateLocale)
  const unread = !n.read_at
  const isDocument = n.resource_type === 'document' && isDocumentKind(n.kind)
  const web = noticeTarget(n).to === 'web'
  const icon = CATEGORY_ICON[inboxCategory(n.kind)]
  // why a row with nothing to open says so; a change row shows the documents it names
  const sub = line.state.notice
    ? t(line.state.notice === 'deleted' ? 'uwErrDeleted' : 'wbNoticeNoAccess')
    : line.titles
  const time = relativeNoticeTime(n.created_at, now, dateLocale)
  const markLabel = t(unread ? 'inboxMarkRead' : 'inboxMarkUnread')
  return (
    <li
      data-notice-id={n.id}
      className={`wb-row wb-inbox-row${unread ? ' is-unread' : ''}${line.state.gone ? ' is-gone' : ''}`}
    >
      <button type="button" className="wb-inbox-main" onClick={onOpen}>
        <span className="wb-inbox-icon" style={tintStyle(icon.tint)} aria-hidden="true">
          <WbGlyph id={icon.glyph} />
        </span>
        <span className="wb-inbox-text">
          {unread ? <span className="uw-sr-only">{t('inboxUnreadDot')}</span> : null}
          <span className="wb-inbox-sentence">{line.sentence}</span>
          {sub ? <span className="wb-row-sub">{sub}</span> : null}
        </span>
        {/* inline with the sentence on a wide pane; a second line under it on a narrow one */}
        <span className="wb-inbox-meta">
          {isDocument ? (
            <span className={`wb-pill${line.changed ? '' : ' is-info'}`}>{t(notePillKey(n))}</span>
          ) : null}
          {web ? (
            <span className="wb-inbox-web" title={t('inboxOpensInBrowser')}>
              <WbGlyph id="external" size={14} />
              <span className="uw-sr-only">{t('inboxOpensInBrowser')}</span>
            </span>
          ) : null}
          {time ? (
            <time className="wb-inbox-time wb-num" dateTime={n.created_at}>
              {time}
            </time>
          ) : null}
          {unread ? <span className="wb-inbox-dot" aria-hidden="true" /> : null}
        </span>
      </button>
      <div className="wb-row-actions wb-inbox-actions">
        <WbIconBtn label={markLabel} onClick={onToggleRead}>
          <WbGlyph id={unread ? 'check' : 'dot'} size={15} />
        </WbIconBtn>
        <WbIconBtn label={t('inboxArchive')} onClick={onArchive}>
          <WbGlyph id="archive" size={15} />
        </WbIconBtn>
      </div>
    </li>
  )
}
