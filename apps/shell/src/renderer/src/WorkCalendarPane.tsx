import type { ReactElement } from 'react'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import type { WorkCalendarEvent, WorkWebTarget } from '../../shared/uniwork-work-api'
import { useI18n, type StringKey, type TFunc } from './locale'
import { MODULE_TONES } from './module-tones'
import { useWorkLoad } from './work-cache'
import { AGENDA_DAYS, agendaRange, agendaRequest, groupAgenda, rowTime } from './work-calendar'
import { clock, formatDay } from './work-home'
import { localIsoDate } from './work-tasks'
import {
  WorkNoWorkspace,
  WorkStaleNote,
  WorkStatePanel,
  workLoadState,
  type WorkPaneProps,
} from './WorkErrorState'
import { WbGlyph, WorkbenchIcon } from './WorkbenchIcons'
import { WorkToolbar, type WorkToolbarProps } from './WorkToolbar'

type AgendaKind = 'task' | 'meeting' | 'external'

/** the kind's name; its tint is the `.is-<kind>` bar and legend swatch (home.css) */
const KIND_LABEL: Record<AgendaKind, StringKey> = {
  meeting: 'wbCalKindMeeting',
  task: 'wbCalKindTask',
  external: 'wbCalKindExternal',
}

const kindOf = (e: WorkCalendarEvent): AgendaKind =>
  e.kind === 'task' ? 'task' : e.kind === 'meeting' ? 'meeting' : 'external'

function webTarget(e: WorkCalendarEvent, ws: UniworkWorkspaceRef): WorkWebTarget {
  const at = { orgSlug: ws.orgSlug, wsSlug: ws.slug }
  if (e.kind === 'task') return { kind: 'task', ...at, id: e.entity_id }
  if (e.kind === 'meeting') return { kind: 'meeting', ...at, id: e.entity_id }
  return { kind: 'calendar', ...at }
}

/** "45 min" / "1 h"; null when the row has no readable end after its start */
function duration(e: WorkCalendarEvent, t: TFunc): string | null {
  if (e.kind === 'task' || e.all_day || !e.end) return null
  const minutes = Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60_000)
  if (!(minutes > 0)) return null
  return minutes % 60 === 0
    ? t('wbCalHours', { count: minutes / 60 })
    : t('wbOvMinutes', { count: minutes })
}

/**
 * Calendar tab (redesign spec 4.3): the next 14 days (device-local) of the user's
 * UniWork tasks and meetings in one card, a sticky head per day; a title opens
 * the item on the web, a live meeting offers Join.
 */
export function WorkCalendarPane({
  workspace,
  workspaceError,
  onReload,
  head,
}: WorkPaneProps & {
  /** the tab toolbar, drawn here so its summary can count the loaded days */
  head?: WorkToolbarProps
}): ReactElement {
  const { t, dateLocale } = useI18n()
  const wsId = workspace?.id ?? null
  const load = useWorkLoad<WorkCalendarEvent[]>(wsId ? `calendar:${wsId}` : null, () =>
    window.uniworkWork.calendarEvents({
      workspaceId: wsId ?? '',
      ...agendaRequest(localIsoDate(new Date())),
    }),
  )
  const openWeb = (target: WorkWebTarget) =>
    void window.uniworkWork.openWeb(target).catch(() => false)

  const today = localIsoDate(new Date())
  const { from, to } = agendaRange(today)
  const days = load.value ? groupAgenda(load.value, from, to) : null
  const items = days?.reduce((n, d) => n + d.events.length, 0) ?? 0

  const summary = days ? (
    <>
      <strong>{t('wbCalNextDays', { count: AGENDA_DAYS })}</strong>
      {` · ${t('wbCalItemCount', { count: items })}`}
      <span className="wb-agenda-legend" role="group" aria-label={t('wbCalLegend')}>
        {(['meeting', 'task', 'external'] as const).map((kind) => (
          <span key={kind}>
            <span className={`wb-agenda-swatch is-${kind}`} aria-hidden="true" />
            {t(KIND_LABEL[kind])}
          </span>
        ))}
      </span>
    </>
  ) : (
    head?.summary
  )
  const actions = workspace ? (
    <button
      type="button"
      className="wb-btn wb-btn-ghost wb-btn-sm"
      onClick={() =>
        openWeb({ kind: 'calendar', orgSlug: workspace.orgSlug, wsSlug: workspace.slug })
      }
    >
      {t('wbCalOpenOnWeb')}
      <WbGlyph id="external" size={14} />
    </button>
  ) : undefined
  const header = head ? <WorkToolbar {...head} summary={summary} actions={actions} /> : null

  if (!workspace) {
    return (
      <>
        {header}
        <WorkNoWorkspace error={workspaceError} onRetry={onReload} />
      </>
    )
  }
  const blocked = workLoadState(load, 'agenda')
  if (blocked || !days) {
    return (
      <>
        {header}
        {blocked}
      </>
    )
  }

  const now = Date.now()
  const tomorrow = agendaRange(today, 2).to

  return (
    <>
      {header}
      <div className="wb-work">
        {load.stale && load.updatedAt !== null ? (
          <WorkStaleNote at={load.updatedAt} onRetry={onReload} />
        ) : null}
        {days.length === 0 ? (
          <WorkStatePanel
            tone={MODULE_TONES.calendar}
            icon={<WorkbenchIcon id="calendar" size={20} />}
            title={t('wbCalEmpty')}
          />
        ) : (
          <div className="wb-block wb-agenda">
            {days.map(({ day, events: rows }) => (
              <section key={day} className="wb-agenda-day">
                <h3 className={`wb-agenda-head${day === today ? ' is-today' : ''}`}>
                  {day === today ? <span className="wb-agenda-dot" aria-hidden="true" /> : null}
                  {day === today || day === tomorrow ? (
                    <>
                      <strong>{t(day === today ? 'wbTasksGroupToday' : 'wbOvTomorrow')}</strong>
                      <span className="wb-agenda-head-date">
                        {formatDay(day, dateLocale, true)}
                      </span>
                    </>
                  ) : (
                    <strong>{formatDay(day, dateLocale, true)}</strong>
                  )}
                  <span className="wb-agenda-head-count wb-num">
                    {t('wbCalItemCount', { count: rows.length })}
                  </span>
                </h3>
                <ul>
                  {rows.map((e) => {
                    const kind = kindOf(e)
                    const end = e.end ? Date.parse(e.end) : NaN
                    const live =
                      kind === 'meeting' &&
                      (e.status === 'IN_PROGRESS' || (Date.parse(e.start) <= now && now < end))
                    const past = !live && kind !== 'task' && !e.all_day && end <= now
                    const dur = duration(e, t)
                    return (
                      <li key={e.id} className={`wb-row wb-agenda-row${past ? ' is-past' : ''}`}>
                        {e.all_day ? (
                          <span className="wb-agenda-time">
                            <span className="wb-agenda-allday">{t('wbCalAllDay')}</span>
                          </span>
                        ) : (
                          <span className="wb-agenda-time">
                            {clock(rowTime(e), dateLocale)}
                            {dur ? <span className="wb-agenda-dur">{dur}</span> : null}
                          </span>
                        )}
                        <span className={`wb-agenda-bar is-${kind}`} aria-hidden="true" />
                        <div className="wb-agenda-main">
                          <button
                            type="button"
                            className="wb-row-title"
                            title={t('wbWorkOpenOnWeb')}
                            onClick={() => openWeb(webTarget(e, workspace))}
                          >
                            {e.title}
                          </button>
                          <span className="wb-row-sub">
                            {live ? (
                              <span className="wb-pill is-success">{t('wbOvLive')}</span>
                            ) : null}
                            {past
                              ? `${t(KIND_LABEL[kind])} · ${t('wbCalEnded')}`
                              : t(KIND_LABEL[kind])}
                          </span>
                        </div>
                        {live ? (
                          <button
                            type="button"
                            className="wb-btn wb-btn-secondary wb-btn-sm"
                            onClick={() =>
                              openWeb({
                                kind: 'room',
                                orgSlug: workspace.orgSlug,
                                wsSlug: workspace.slug,
                                id: e.entity_id,
                              })
                            }
                          >
                            <WbGlyph id="video" size={14} />
                            {t('wbOvJoin')}
                          </button>
                        ) : kind === 'task' && day === today ? (
                          <span className="wb-pill is-warning">{t('wbTasksGroupToday')}</span>
                        ) : (
                          <span />
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
