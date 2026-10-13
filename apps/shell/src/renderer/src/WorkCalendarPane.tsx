import type { ReactElement } from 'react'
import type { UniworkWorkspaceRef } from '../../shared/home-api'
import type { WorkCalendarEvent, WorkWebTarget } from '../../shared/uniwork-work-api'
import { useI18n, type StringKey } from './locale'
import { MEETING_TINT, MODULE_TONES, tintStyle, type Tint } from './module-tones'
import { useWorkLoad } from './work-cache'
import { agendaRange, agendaRequest, groupAgenda, rowTime } from './work-calendar'
import { clock, formatDay } from './work-home'
import { localIsoDate } from './work-tasks'
import {
  WorkNoWorkspace,
  WorkStaleNote,
  WorkStatePanel,
  workLoadState,
  type WorkPaneProps,
} from './WorkErrorState'
import { WorkbenchIcon } from './WorkbenchIcons'

type AgendaKind = 'task' | 'meeting' | 'external'

const KIND: Record<AgendaKind, { tint: Tint; label: StringKey }> = {
  task: { tint: MODULE_TONES.tasks, label: 'wbCalKindTask' },
  meeting: { tint: MEETING_TINT, label: 'wbCalKindMeeting' },
  external: { tint: 'gray', label: 'wbCalKindExternal' },
}

const kindOf = (e: WorkCalendarEvent): AgendaKind =>
  e.kind === 'task' ? 'task' : e.kind === 'meeting' ? 'meeting' : 'external'

function webTarget(e: WorkCalendarEvent, ws: UniworkWorkspaceRef): WorkWebTarget {
  const at = { orgSlug: ws.orgSlug, wsSlug: ws.slug }
  if (e.kind === 'task') return { kind: 'task', ...at, id: e.entity_id }
  if (e.kind === 'meeting') return { kind: 'meeting', ...at, id: e.entity_id }
  return { kind: 'calendar', ...at }
}

function KindIcon({ kind }: { kind: AgendaKind }): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {kind === 'task' ? (
        <path
          d="M3.5 8.5l3 3 6-7"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : kind === 'meeting' ? (
        <>
          <rect
            x="2"
            y="4.5"
            width="8"
            height="7"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path
            d="M10 7l4-2v6l-4-2"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <rect
            x="2.5"
            y="3.5"
            width="11"
            height="10"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.4"
          />
          <path d="M2.5 6.5h11" stroke="currentColor" strokeWidth="1.4" />
        </>
      )}
    </svg>
  )
}

/** Calendar tab: the next 14 days (device-local) of the user's UniWork tasks and meetings, by day; a row opens on the web. */
export function WorkCalendarPane({
  workspace,
  workspaceError,
  onReload,
}: WorkPaneProps): ReactElement {
  const { t, dateLocale } = useI18n()
  const wsId = workspace?.id ?? null
  const load = useWorkLoad<WorkCalendarEvent[]>(wsId ? `calendar:${wsId}` : null, () =>
    window.uniworkWork.calendarEvents({
      workspaceId: wsId ?? '',
      ...agendaRequest(localIsoDate(new Date())),
    }),
  )

  if (!workspace) return <WorkNoWorkspace error={workspaceError} onRetry={onReload} />
  const blocked = workLoadState(load)
  if (blocked) return blocked

  const today = localIsoDate(new Date())
  const { from, to } = agendaRange(today)
  const days = groupAgenda(load.value ?? [], from, to)

  return (
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
        days.map(({ day, events: rows }) => (
          <section key={day} className="wb-agenda-day">
            <h3 className={`wb-agenda-head${day === today ? ' is-today' : ''}`}>
              {day === today ? (
                <>
                  <span className="wb-agenda-dot" aria-hidden="true" />
                  {`${t('wbTasksGroupToday')} · `}
                </>
              ) : null}
              <span className="wb-num">{formatDay(day, dateLocale, true)}</span>
            </h3>
            <ul className="wb-block">
              {rows.map((e) => {
                const kind = kindOf(e)
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      className="wb-agenda-row"
                      title={t('wbWorkOpenOnWeb')}
                      onClick={() =>
                        void window.uniworkWork.openWeb(webTarget(e, workspace)).catch(() => false)
                      }
                    >
                      {e.all_day ? (
                        <span className="wb-agenda-time">{t('wbCalAllDay')}</span>
                      ) : (
                        <span className="wb-agenda-time wb-mono">
                          {clock(rowTime(e), dateLocale)}
                        </span>
                      )}
                      <span
                        className="wb-agenda-icon"
                        style={tintStyle(KIND[kind].tint)}
                        role="img"
                        aria-label={t(KIND[kind].label)}
                      >
                        <KindIcon kind={kind} />
                      </span>
                      <span className="wb-agenda-title">{e.title}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
