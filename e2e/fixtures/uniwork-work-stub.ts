/**
 * Work routes the Workbench Overview reads, on the documents stub's origin
 * (chained after its documents routes):
 *
 *   GET /workspaces/{ws}/home
 *
 * Shapes follow the server SDO (`uniwork:server/internal/handler/dto/sdo/home.go`).
 * The counts are distinct numbers so a spec can tell the five tiles apart.
 */
import { STUB_ACCOUNT, STUB_ORG, type StubRouteContext } from './uniwork-auth-stub'

export const STUB_HOME_COUNTS = { open: 7, overdue: 1, due_today: 2, meetings_today: 3, unread: 5 }

const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function taskDto(workspaceId: string, n: number, title: string, due: string) {
  return {
    id: `task_e2e_${n}`,
    organization_id: STUB_ORG.id,
    workspace_id: workspaceId,
    number: n,
    identifier: `ENG-${n}`,
    revision: 1,
    title,
    description: '',
    status: 'todo',
    priority: 'medium',
    due_date: due,
    position: n,
    created_by: STUB_ACCOUNT.id,
    created_at: '2026-10-01T09:00:00Z',
    updated_at: '2026-10-08T09:00:00Z',
  }
}

/** Answers the work routes; false for anything else (the auth stub then answers 404). */
export function workRoute(ctx: StubRouteContext): boolean {
  const m = /^\/workspaces\/([^/]+)\/home$/.exec(ctx.route)
  if (!m || ctx.req.method !== 'GET') return false
  const workspaceId = m[1]!
  const now = new Date()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const meetingStart = new Date(now.getTime() + 60 * 60_000)
  ctx.send(200, {
    today: localDay(now),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    counts: STUB_HOME_COUNTS,
    my_work: [
      taskDto(workspaceId, 1, 'Reconcile the September invoices', localDay(yesterday)),
      taskDto(workspaceId, 2, 'Send the weekly plan', localDay(now)),
    ],
    upcoming_meetings: [
      {
        id: 'meet_e2e_1',
        workspace_id: workspaceId,
        title: 'Weekly sync',
        description: '',
        starts_at: meetingStart.toISOString(),
        ends_at: new Date(meetingStart.getTime() + 30 * 60_000).toISOString(),
        room_name: 'weekly-sync',
        created_by: STUB_ACCOUNT.id,
        status: 'SCHEDULED',
      },
    ],
    inbox: [
      {
        id: 'ntf_e2e_1',
        kind: 'task_assigned',
        workspace_id: workspaceId,
        organization_id: STUB_ORG.id,
        resource_type: 'task',
        resource_id: 'task_e2e_2',
        actor_kind: 'human',
        actor_id: STUB_ACCOUNT.id,
        title_key: 'notifications.kind.task_assigned',
        params: { actor: 'E2E', task: 'Send the weekly plan' },
        created_at: now.toISOString(),
      },
    ],
    partial: [],
    generated_at: now.toISOString(),
  })
  return true
}
