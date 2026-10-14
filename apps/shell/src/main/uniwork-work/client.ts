import type {
  WorkCalendarEvent,
  WorkCreateTaskInput,
  WorkHomeSummary,
  WorkPerson,
  WorkTask,
  WorkTaskStatus,
} from '../../shared/uniwork-work-api'
import {
  METADATA_TIMEOUT_MS,
  createUniworkSend,
  uniworkId,
  type UniworkDocsClientOptions,
} from '../uniwork-docs/client'
import { UniworkDocError } from '../uniwork-docs/errors'
import {
  parseCalendarEvents,
  parseHome,
  parseOneTask,
  parsePerson,
  parseTaskList,
  parseTaskStatuses,
} from './parse'

/**
 * Main-process client for the UniWork work routes the Workbench reads and
 * writes. Same hardened request as the documents client (API origin +
 * /api/v1 only, no redirect, no cache, the token only inside `authorized`).
 * Throws UniworkDocError; wiring.ts turns it into a UniworkWorkError.
 * Workspaces and recent cloud documents are not here: the renderer reuses
 * aiOffice.uniworkListWorkspaces / uniworkListDocuments.
 */

export interface UniworkWorkClient {
  homeSummary(workspaceId: string): Promise<WorkHomeSummary>
  myTasks(workspaceId: string): Promise<WorkTask[]>
  taskStatuses(workspaceId: string): Promise<WorkTaskStatus[]>
  /** `status` is a catalogue key ('done', 'todo', ...), not a status id */
  setTaskStatus(taskId: string, status: string): Promise<WorkTask>
  createTask(input: WorkCreateTaskInput): Promise<WorkTask>
  calendarEvents(input: {
    workspaceId: string
    from: string
    to: string
  }): Promise<WorkCalendarEvent[]>
  person(orgSlug: string, userId: string): Promise<WorkPerson>
  /** POST /me/notifications/read: the caller's own ids (1-100); someone else's id is a 404 */
  markNotificationsRead(ids: string[]): Promise<null>
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const STATUS_KEY = /^[A-Za-z0-9_-]{1,64}$/
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/

/** a renderer value the server must never see */
function refuse(): never {
  throw new UniworkDocError('server_error')
}

export function createUniworkWorkClient(options: UniworkDocsClientOptions): UniworkWorkClient {
  const send = createUniworkSend(options)
  const timeoutMs = options.metadataTimeoutMs ?? METADATA_TIMEOUT_MS
  const read = (response: Response): Promise<unknown> => response.json()
  const get = (route: string, query?: URLSearchParams) =>
    send({ method: 'GET', route, query, timeoutMs, read })

  return {
    async homeSummary(workspaceId) {
      return parseHome(await get(`/workspaces/${uniworkId(workspaceId)}/home`))
    },

    async myTasks(workspaceId) {
      const query = new URLSearchParams({ limit: '200' })
      return parseTaskList(await get(`/workspaces/${uniworkId(workspaceId)}/my-tasks`, query))
    },

    async taskStatuses(workspaceId) {
      return parseTaskStatuses(await get(`/workspaces/${uniworkId(workspaceId)}/task-statuses`))
    },

    async setTaskStatus(taskId, status) {
      if (typeof status !== 'string' || !STATUS_KEY.test(status)) refuse()
      const raw = await send({
        method: 'PATCH',
        route: `/tasks/${uniworkId(taskId)}`,
        json: { status },
        timeoutMs,
        read,
      })
      return parseOneTask(raw)
    },

    async createTask(input) {
      const title = typeof input.title === 'string' ? input.title.trim() : ''
      if (!title) refuse()
      if (input.dueDate !== undefined && !DATE.test(input.dueDate)) refuse()
      if (typeof input.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
        refuse()
      }
      // no allow_duplicate: an open task with the same title is refused (409), like the web
      const raw = await send({
        method: 'POST',
        route: `/workspaces/${uniworkId(input.workspaceId)}/tasks`,
        json: { title, ...(input.dueDate ? { due_date: input.dueDate } : {}) },
        idempotencyKey: input.idempotencyKey,
        timeoutMs,
        read,
      })
      return parseOneTask(raw)
    },

    async calendarEvents({ workspaceId, from, to }) {
      if (!DATE.test(from) || !DATE.test(to)) refuse()
      const query = new URLSearchParams({ from, to, mine: 'true' })
      const raw = await get(`/workspaces/${uniworkId(workspaceId)}/calendar/events`, query)
      return parseCalendarEvents(raw)
    },

    async person(orgSlug, userId) {
      return parsePerson(await get(`/orgs/${uniworkId(orgSlug)}/people/${uniworkId(userId)}`))
    },

    async markNotificationsRead(ids) {
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100) refuse()
      // uniworkId checks each id; the JSON body carries them as they are
      for (const id of ids) uniworkId(id)
      await send({
        method: 'POST',
        route: '/me/notifications/read',
        json: { ids },
        timeoutMs,
        read,
      })
      return null
    },
  }
}
