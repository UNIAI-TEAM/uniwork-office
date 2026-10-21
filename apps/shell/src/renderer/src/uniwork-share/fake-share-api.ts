// An in-memory UniworkShareApi for the renderer tests of the Share dialog (SD-B, SD-C, SD-D).
// It behaves like the server where the dialog depends on it: the manager / viewer split of the
// access overview, atomic updates with per-item rejections, a dry run that writes nothing, the
// public-links policy and limit, and an access request that can be handled once. Seeded with
// one document: an owner, three people, the home workspace row, one link and one request.
import { BREAK_GLASS_REASON_MAX, BREAK_GLASS_REASON_MIN } from '../../../shared/share-api'
import type {
  ShareAccess,
  ShareAccessRequest,
  ShareBreakGlassGrant,
  ShareBulkPlan,
  ShareBulkResult,
  ShareCandidate,
  ShareErrorCode,
  ShareGrant,
  ShareLevel,
  ShareLink,
  ShareRejectedItem,
  ShareResult,
  ShareResultStatus,
  SharePreview,
  SharePrincipalType,
  ShareUpdate,
  ShareUpdateItem,
  ShareWarning,
  UniworkShareApi,
} from '../../../shared/share-api'

export interface FakeShareOptions {
  /** the seeded document; any other id is not_found (default `doc_1`) */
  documentId?: string
  /** the viewer's level: `manage` (default) sees everything, any other sees their own level only */
  myLevel?: ShareLevel | ''
  /** an admin with no level who administers the document */
  adminScope?: boolean
  /** the organization's public-links switch (default on) */
  publicLinksEnabled?: boolean
  /** live links allowed per document (default 5) */
  maxLinks?: number
  /** false = the server has no access-requests route (the list is a null value) */
  requestsAvailable?: boolean
  /** documents `bulk` refuses, with the code (the seeded document is not changed by a bulk run) */
  bulkRefuses?: Record<string, ShareErrorCode>
}

type Failure = Extract<ShareResult<never>, { ok: false }>

export interface FakeShareApi extends UniworkShareApi {
  /** every call, in order */
  readonly calls: Array<{ method: keyof UniworkShareApi; args: unknown[] }>
  /** the next call of `method` answers `failure` instead (once) */
  failNext(method: keyof UniworkShareApi, failure: Failure): void
}

const LEVEL_ORDER: Record<ShareLevel, number> = { view: 1, comment: 2, edit: 3, manage: 4 }
const NOW = '2026-10-20T01:00:00Z'

const PEOPLE = [
  { id: 'u_minh', name: 'Minh Trần', email: 'minh@acme.test' },
  { id: 'u_an', name: 'An Lê', email: 'an@acme.test' },
  { id: 'u_binh', name: 'Bình Phạm', email: 'binh@acme.test' },
  { id: 'u_chi', name: 'Chi Võ', email: 'chi@acme.test' },
  { id: 'u_req', name: 'Dũng Hoàng', email: 'dung@acme.test' },
] as const
const WORKSPACES = [
  { id: 'ws_1', name: 'Team', members: 12 },
  { id: 'ws_2', name: 'Design', members: 6 },
] as const
const ORG = { id: 'org_1', name: 'Acme', members: 40 }
const HOME_WORKSPACE = 'ws_1'

// the organization's members: the owner (who is not a candidate) and the people of the picker
const MEMBERS = [
  { id: 'u_owner', name: 'Hoa Nguyễn' },
  ...PEOPLE.map((p) => ({ id: p.id, name: p.name })),
]

const keyOf = (type: string, id: string) => `${type}:${id}`

export function createFakeShareApi(options: FakeShareOptions = {}): FakeShareApi {
  const documentId = options.documentId ?? 'doc_1'
  const myLevel: ShareLevel | '' = options.myLevel === undefined ? 'manage' : options.myLevel
  const adminScope = options.adminScope === true
  const publicLinksEnabled = options.publicLinksEnabled !== false
  const maxLinks = options.maxLinks ?? 5
  const requestsAvailable = options.requestsAvailable !== false
  const manages = myLevel === 'manage' || adminScope

  let counter = 100
  const nextId = (prefix: string) => `${prefix}_${++counter}`
  const grants = new Map<string, ShareGrant>()
  const grant = (type: SharePrincipalType, id: string, level: ShareLevel, grantId: string) =>
    grants.set(keyOf(type, id), {
      id: grantId,
      principalType: type,
      principalId: id,
      level,
      active: true,
      effectiveLevel: level,
      effectiveVia: 'share',
      grantedBy: 'u_owner',
      grantedByKind: 'human',
      createdAt: NOW,
    })
  grant('user', 'u_minh', 'edit', 'sh_1')
  grant('user', 'u_an', 'comment', 'sh_2')
  grant('workspace', HOME_WORKSPACE, 'view', 'sh_3')
  let links: ShareLink[] = [
    {
      id: 'ln_1',
      expiresAt: '2026-11-20T00:00:00Z',
      viewCount: 3,
      createdBy: 'u_owner',
      createdByKind: 'human',
      createdAt: NOW,
    },
  ]
  let requests: ShareAccessRequest[] = [
    {
      id: 'rq_1',
      requesterId: 'u_req',
      requesterName: 'Dũng Hoàng',
      requestedLevel: 'edit',
      message: 'Em cần sửa phần số liệu.',
      source: null,
      createdAt: NOW,
      expiresAt: '2026-10-27T01:00:00Z',
    },
  ]

  let breakGlass: ShareBreakGlassGrant[] = []

  const calls: FakeShareApi['calls'] = []
  const failures = new Map<keyof UniworkShareApi, Failure>()

  /** records the call and answers the queued failure, if any, before running it */
  const call = <T>(
    method: keyof UniworkShareApi,
    args: unknown[],
    run: () => ShareResult<T>,
  ): Promise<ShareResult<T>> => {
    calls.push({ method, args })
    const queued = failures.get(method)
    if (queued) {
      failures.delete(method)
      return Promise.resolve(queued)
    }
    return Promise.resolve(run())
  }

  const fail = (error: ShareErrorCode, status?: number): Failure => ({
    ok: false,
    error,
    ...(status === undefined ? {} : { status }),
  })
  const known = (id: string) => id === documentId

  const levelOf = (type: SharePrincipalType, id: string): ShareLevel | null =>
    grants.get(keyOf(type, id))?.level ?? null

  const get = (id: string): ShareResult<ShareAccess> => {
    if (!known(id)) return fail('not_found')
    if (!manages) {
      return {
        ok: true,
        value: {
          myLevel,
          adminScope: false,
          via: 'share',
          ...(myLevel ? { mySources: [{ via: 'share', level: myLevel }] } : {}),
        },
      }
    }
    return {
      ok: true,
      value: {
        myLevel,
        adminScope,
        via: adminScope ? '' : 'member',
        homeWorkspace: {
          workspaceId: HOME_WORKSPACE,
          workspaceName: 'Team',
          level: levelOf('workspace', HOME_WORKSPACE),
        },
        owner: { userId: 'u_owner', level: 'manage', via: 'member' },
        shares: [...grants.values()].map((g) => ({ ...g })),
        links: links.map((l) => ({ ...l })),
        breakGlass: breakGlass.map((g) => ({ ...g })),
      },
    }
  }

  const principalExists = (type: SharePrincipalType, id: string): boolean => {
    if (type === 'user') return PEOPLE.some((p) => p.id === id)
    if (type === 'workspace') return WORKSPACES.some((w) => w.id === id)
    return id === ORG.id
  }

  /** the refusals of an update, by item index; nothing is written when there is one */
  const rejectionsOf = (items: ShareUpdateItem[]): ShareRejectedItem[] => {
    const seen = new Set<string>()
    const rejected: ShareRejectedItem[] = []
    items.forEach((item, index) => {
      const at = { index, principalType: item.principalType, principalId: item.principalId }
      if (!principalExists(item.principalType, item.principalId)) {
        rejected.push({ ...at, code: 'principal_not_in_organization' })
      } else if (item.principalType !== 'user' && item.level === 'manage') {
        rejected.push({ ...at, code: 'level_not_allowed' })
      } else if (seen.has(keyOf(item.principalType, item.principalId))) {
        rejected.push({ ...at, code: 'duplicate_principal' })
      }
      seen.add(keyOf(item.principalType, item.principalId))
    })
    return rejected
  }

  const update = (input: {
    documentId: string
    items: ShareUpdateItem[]
    dryRun?: boolean
  }): ShareResult<ShareUpdate> => {
    if (!known(input.documentId)) return fail('not_found')
    if (!manages) return fail('forbidden', 403)
    const rejected = rejectionsOf(input.items)
    if (rejected.length > 0) return { ...fail('document_access_rejected', 422), rejected }

    const preview: SharePreview = { users: [], groups: [], warnings: [] }
    const warn = (code: ShareWarning['code'], index: number) =>
      preview.warnings.push({ code, index })
    const workspaceLevel = levelOf('workspace', HOME_WORKSPACE)
    const results = input.items.map((item, index) => {
      const existing = levelOf(item.principalType, item.principalId)
      let status: ShareResultStatus
      let after: ShareLevel | null = existing
      if (item.level === null) {
        status = existing ? 'revoked' : 'unchanged'
        after = null
      } else if (!existing) {
        status = 'granted'
        after = item.level
      } else if (existing === item.level) {
        status = 'unchanged'
      } else if (item.onExisting === 'keep') {
        status = 'kept'
      } else {
        status = 'updated'
        after = item.level
      }
      if (item.principalType === 'user') {
        preview.users.push({
          userId: item.principalId,
          before: { level: existing ?? '', via: existing ? 'share' : '' },
          after: { level: after ?? '', via: after ? 'share' : '' },
        })
        if (
          after &&
          item.principalType === 'user' &&
          workspaceLevel &&
          LEVEL_ORDER[after] < LEVEL_ORDER[workspaceLevel]
        ) {
          warn('direct_below_group', index)
        }
      } else {
        const group =
          item.principalType === 'workspace'
            ? WORKSPACES.find((w) => w.id === item.principalId)!
            : ORG
        preview.groups.push({
          principalType: item.principalType,
          principalId: item.principalId,
          memberCount: group.members,
          losingCount: 0,
        })
        if (item.principalType === 'organization' && item.level !== null) warn('wide_scope', index)
      }
      if (existing && after && LEVEL_ORDER[after] < LEVEL_ORDER[existing]) warn('downgrade', index)
      if (input.dryRun !== true) {
        const key = keyOf(item.principalType, item.principalId)
        if (after === null) grants.delete(key)
        else if (status === 'granted')
          grant(item.principalType, item.principalId, after, nextId('sh'))
        else if (status === 'updated')
          grants.set(key, { ...grants.get(key)!, level: after, effectiveLevel: after })
      }
      return { index, status }
    })
    return {
      ok: true,
      value: {
        batchId: input.dryRun === true ? '' : nextId('batch'),
        dryRun: input.dryRun === true,
        results,
        preview,
      },
    }
  }

  const candidatePool = (): ShareCandidate[] => [
    ...PEOPLE.map((p) => ({
      principalType: 'user' as const,
      principalId: p.id,
      name: p.name,
      secondary: p.email,
      directLevel: levelOf('user', p.id),
      isHomeWorkspace: false,
    })),
    ...WORKSPACES.map((w) => ({
      principalType: 'workspace' as const,
      principalId: w.id,
      name: w.name,
      secondary: `${w.members} members`,
      directLevel: levelOf('workspace', w.id),
      isHomeWorkspace: w.id === HOME_WORKSPACE,
    })),
    {
      principalType: 'organization',
      principalId: ORG.id,
      name: ORG.name,
      secondary: `${ORG.members} members`,
      directLevel: levelOf('organization', ORG.id),
      isHomeWorkspace: false,
    },
  ]

  const decide = (
    input: { documentId: string; requestId: string; level?: ShareLevel },
    approve: boolean,
  ): ShareResult<{ id: string; status: string; shareId: string }> => {
    if (!known(input.documentId)) return fail('not_found')
    if (!manages) return fail('forbidden', 403)
    const row = requests.find((r) => r.id === input.requestId)
    if (!row) return fail('access_request_closed', 409)
    requests = requests.filter((r) => r.id !== row.id)
    if (!approve) return { ok: true, value: { id: row.id, status: 'declined', shareId: '' } }
    const level = (input.level ?? row.requestedLevel) as ShareLevel
    const existing = grants.get(keyOf('user', row.requesterId))
    const shareId = existing?.id ?? nextId('sh')
    grant('user', row.requesterId, level, shareId)
    return { ok: true, value: { id: row.id, status: 'approved', shareId } }
  }

  const api: FakeShareApi = {
    calls,
    failNext: (method, failure) => void failures.set(method, failure),

    get: (id) => call('get', [id], () => get(id)),

    update: (input) => call('update', [input], () => update(input)),

    candidates: (input) =>
      call('candidates', [input], () => {
        if (!known(input.documentId)) return fail('not_found')
        const q = input.q?.trim().toLowerCase() ?? ''
        const all = candidatePool().filter(
          (c) => !q || c.name.toLowerCase().includes(q) || c.secondary.toLowerCase().includes(q),
        )
        const start = input.cursor ? Number(input.cursor) || 0 : 0
        const limit = input.limit && input.limit > 0 ? input.limit : all.length
        const items = all.slice(start, start + limit)
        const next = start + limit < all.length ? String(start + limit) : ''
        return { ok: true, value: { items, nextCursor: next } }
      }),

    linkCreate: (input) =>
      call('linkCreate', [input], () => {
        if (!known(input.documentId)) return fail('not_found')
        if (!manages) return fail('forbidden', 403)
        if (!publicLinksEnabled) return fail('document_links_disabled', 403)
        if (links.length >= maxLinks) return fail('document_link_limit', 409)
        const id = nextId('ln')
        const token = `tok_${id}`
        const days = input.expiresInDays ?? 7
        const link: ShareLink = {
          id,
          expiresAt: new Date(Date.parse(NOW) + days * 86_400_000).toISOString(),
          viewCount: 0,
          createdBy: 'u_owner',
          createdByKind: 'human',
          createdAt: NOW,
        }
        links = [...links, link]
        return { ok: true, value: { link, token, url: `https://fake.uniwork.test/p/${token}` } }
      }),

    linkRevoke: (input) =>
      call('linkRevoke', [input], () => {
        if (!known(input.documentId)) return fail('not_found')
        if (!manages) return fail('forbidden', 403)
        if (!links.some((l) => l.id === input.linkId)) return fail('not_found')
        links = links.filter((l) => l.id !== input.linkId)
        return { ok: true, value: { documentId: input.documentId, linkId: input.linkId } }
      }),

    settings: () =>
      call('settings', [], () => ({
        ok: true,
        value: { organizationId: ORG.id, publicLinksEnabled },
      })),

    requests: (id) =>
      call('requests', [id], () => {
        if (!known(id)) return fail('not_found')
        if (!requestsAvailable) return { ok: true, value: null }
        return { ok: true, value: manages ? requests.map((r) => ({ ...r })) : [] }
      }),

    requestApprove: (input) => call('requestApprove', [input], () => decide(input, true)),

    requestDecline: (input) => call('requestDecline', [input], () => decide(input, false)),

    breakGlassGrant: (input) =>
      call('breakGlassGrant', [input], () => {
        if (!known(input.documentId)) return fail('not_found')
        // only an administering admin (no level of their own) opens one
        if (!adminScope) return fail('forbidden', 403)
        const reason = input.reason.trim()
        const length = Array.from(reason).length
        if (length < BREAK_GLASS_REASON_MIN || length > BREAK_GLASS_REASON_MAX) {
          return fail('break_glass_reason_invalid', 422)
        }
        const grantRow: ShareBreakGlassGrant = {
          id: nextId('bg'),
          documentId,
          actorId: 'u_admin',
          actorName: 'Admin An',
          level: 'view',
          reason,
          grantedAt: NOW,
          expiresAt: '2026-10-21T01:00:00Z',
        }
        breakGlass = [...breakGlass, grantRow]
        return { ok: true, value: { ...grantRow } }
      }),

    breakGlassRevoke: (input) =>
      call('breakGlassRevoke', [input], () => {
        if (!known(input.documentId)) return fail('not_found')
        if (!adminScope) return fail('forbidden', 403)
        if (!breakGlass.some((g) => g.id === input.grantId)) return fail('not_found')
        breakGlass = breakGlass.filter((g) => g.id !== input.grantId)
        return { ok: true, value: { documentId: input.documentId, grantId: input.grantId } }
      }),

    members: (input) =>
      call('members', [input], () => {
        const start = input.cursor ? Number(input.cursor) || 0 : 0
        const limit = input.limit && input.limit > 0 ? input.limit : MEMBERS.length
        const page = MEMBERS.slice(start, start + limit).map((m) => ({
          userId: m.id,
          displayName: m.name,
        }))
        const next = start + limit < MEMBERS.length ? String(start + limit) : ''
        return { ok: true, value: { members: page, nextCursor: next } }
      }),

    bulk: (plan: ShareBulkPlan) =>
      call('bulk', [plan], () => {
        const result: ShareBulkResult = { ok: [], failed: [], links: [] }
        for (const doc of new Map(plan.docs.map((d) => [d.id, d])).values()) {
          const refusal = options.bulkRefuses?.[doc.id]
          if (refusal) {
            result.failed.push({ id: doc.id, error: refusal })
            continue
          }
          result.ok.push(doc.id)
          if (plan.link === 'create') {
            result.links.push({ id: doc.id, url: `https://fake.uniwork.test/p/bulk-${doc.id}` })
          }
        }
        return { ok: true, value: result }
      }),
  }
  return api
}
