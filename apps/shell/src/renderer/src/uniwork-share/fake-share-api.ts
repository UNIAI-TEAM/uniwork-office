// An in-memory UniworkShareApi for the renderer tests of the Share dialog (SD-B, SD-C, SD-D).
// It behaves like the server where the dialog depends on it: the manager / viewer split of the
// access overview, atomic updates with per-item rejections, a dry run that writes nothing, the
// public-links policy and limit, and an access request that can be handled once. Seeded with
// one document: an owner, three people, the home workspace row, one link and one request.
import {
  BREAK_GLASS_REASON_MAX,
  BREAK_GLASS_REASON_MIN,
  FOLDER_CONTENTS_ACCESS_MAX_ITEMS,
  FOLDER_CONTENTS_ACCESS_MODES,
  SHARE_LEVELS,
  SHARE_OWNER_KEEP_LEVELS,
} from '../../../shared/share-api'
import type {
  FolderContentsAccessBatch,
  FolderContentsAccessBatchRequest,
  FolderContentsAccessCounts,
  FolderContentsAccessRequest,
  FolderContentsAccessResult,
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
  ShareOwnerCandidate,
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

/**
 * UNI-2244: the one seeded folder of `folderContentsAccess`. The counts are deterministic: of
 * `total` documents, `notManageable` and `locked` are skipped, `unchanged` already hold the asked
 * access, and the rest change. A run of `total <= syncMax` answers at once (sync); a bigger one is a
 * background batch that moves one step on each `folderContentsAccessBatch` call.
 */
export interface FakeFolderContentsOptions {
  /** the seeded folder; the seeded document id is `not_a_folder`, any other id `not_found` (default `fld_1`) */
  folderId?: string
  /** documents under the folder (default 12) */
  total?: number
  notManageable?: number
  locked?: number
  unchanged?: number
  /** dry run of a `replace`: people who lose a document / whose level drops (default 0) */
  losingUsers?: number
  downgradedUsers?: number
  /** the largest total that runs inside the request (default 500, the server's) */
  syncMax?: number
  /** GETs a background batch needs to end (default 3: queued -> running -> ... -> ended) */
  batchSteps?: number
  /** the background batch ends `failed` instead of `completed` */
  batchFails?: boolean
}

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
  /** UNI-2078: the document is owned by a work product (`owner_kind`) */
  ownerKind?: string
  /** UNI-2078: the document sits in Archive (main refuses an owner transfer) */
  shelved?: boolean
  /** UNI-2078: the document's visibility is `restricted` */
  restricted?: boolean
  /** UNI-2078: the signed-in user (default `u_admin`, the break-glass actor) */
  selfUserId?: string
  /** UNI-2244: the folder contents access command's data (defaults apply when omitted) */
  folderContents?: FakeFolderContentsOptions
  /** UNI-2078: the owner transfer answers this refusal; `endpoint_missing` = a server without the route */
  ownerTransferRefuses?:
    | 'owner_target_not_member'
    | 'break_glass_required'
    | 'document_owned_by_work_product'
    | 'my_folder_locked'
    | 'document_shelved'
    | 'server_error'
    | 'endpoint_missing'
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

// UNI-2078: the document's workspace (the owner, three people, the admin and a deactivated person)
// and the organization's active people who may own a document
const WORKSPACE_MEMBER_IDS = ['u_owner', 'u_minh', 'u_an', 'u_binh', 'u_admin', 'u_off'] as const
const ACTIVE_PEOPLE: ShareOwnerCandidate[] = [
  { userId: 'u_owner', name: 'Hoa Nguyễn', email: 'hoa@acme.test' },
  ...PEOPLE.map((p) => ({ userId: p.id, name: p.name, email: p.email })),
  { userId: 'u_admin', name: 'Admin An', email: 'admin@acme.test' },
]
const OWNER_REFUSAL_STATUS = {
  owner_target_not_member: 422,
  break_glass_required: 403,
  document_owned_by_work_product: 409,
  my_folder_locked: 409,
  document_shelved: 409,
  server_error: 500,
} as const

const keyOf = (type: string, id: string) => `${type}:${id}`

const pick = (item: { principalType: SharePrincipalType; principalId: string }) => ({
  principalType: item.principalType,
  principalId: item.principalId,
})

const NO_COUNTS: FolderContentsAccessCounts = {
  changed: 0,
  unchanged: 0,
  skippedNotManageable: 0,
  skippedLocked: 0,
}

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
  let ownerId = 'u_owner'
  const selfUserId = options.selfUserId ?? 'u_admin'

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
        owner: { userId: ownerId, level: 'manage', via: 'member' },
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

  /** main's owner gate: manage or admin scope, not a work product, not shelved */
  const ownerGate = (id: string): Failure | { selfExcluded: boolean } => {
    if (!known(id)) return fail('not_found')
    if (!manages) return fail('forbidden', 403)
    if (options.ownerKind) return fail('document_owned_by_work_product')
    if (options.shelved) return fail('document_shelved')
    return { selfExcluded: adminScope && myLevel !== 'manage' && options.restricted === true }
  }

  const ownerCandidates = (id: string): ShareResult<ShareOwnerCandidate[]> => {
    const gate = ownerGate(id)
    if ('ok' in gate) return gate
    const value = WORKSPACE_MEMBER_IDS.flatMap((userId) => {
      const person = ACTIVE_PEOPLE.find((p) => p.userId === userId)
      if (!person || userId === ownerId) return []
      if (gate.selfExcluded && userId === selfUserId) return []
      return [{ ...person }]
    })
    return { ok: true, value }
  }

  const transferOwner = (input: {
    documentId: string
    userId: string
    previousOwnerLevel?: string
  }): ShareResult<{
    documentId: string
    aclOwnerId: string
    previousOwnerId: string
    previousOwnerShareId: string
  }> => {
    const gate = ownerGate(input.documentId)
    if ('ok' in gate) return gate
    const keep = input.previousOwnerLevel ?? 'edit'
    if (!(SHARE_OWNER_KEEP_LEVELS as readonly string[]).includes(keep)) {
      return fail('invalid_request')
    }
    if (input.userId === ownerId) return fail('invalid_request')
    if (gate.selfExcluded && input.userId === selfUserId) return fail('break_glass_required', 403)
    const refusal = options.ownerTransferRefuses
    if (refusal === 'endpoint_missing') {
      return { ok: false, error: 'not_found', status: 404, endpointMissing: true }
    }
    if (refusal) return fail(refusal, OWNER_REFUSAL_STATUS[refusal])
    if (!ACTIVE_PEOPLE.some((p) => p.userId === input.userId)) {
      return fail('owner_target_not_member', 422)
    }
    const previous = ownerId
    ownerId = input.userId
    // the new owner needs no grant of their own; the previous one keeps what was asked
    grants.delete(keyOf('user', input.userId))
    let shareId = ''
    if (keep !== 'none') {
      shareId = grants.get(keyOf('user', previous))?.id ?? nextId('sh')
      grant('user', previous, keep as ShareLevel, shareId)
    }
    return {
      ok: true,
      value: {
        documentId: input.documentId,
        aclOwnerId: input.userId,
        previousOwnerId: previous,
        previousOwnerShareId: shareId,
      },
    }
  }

  // UNI-2244: the folder contents access command
  const folderOptions = options.folderContents ?? {}
  const folderId = folderOptions.folderId ?? 'fld_1'
  const folderTotal = folderOptions.total ?? 12
  const syncMax = folderOptions.syncMax ?? 500
  const batchSteps = Math.max(1, folderOptions.batchSteps ?? 3)
  const folderCounts = (): FolderContentsAccessCounts => {
    const skippedNotManageable = folderOptions.notManageable ?? 0
    const skippedLocked = folderOptions.locked ?? 0
    const unchanged = folderOptions.unchanged ?? 0
    return {
      changed: Math.max(0, folderTotal - skippedNotManageable - skippedLocked - unchanged),
      unchanged,
      skippedNotManageable,
      skippedLocked,
    }
  }
  const batches = new Map<string, { gets: number; folderId: string }>()
  /** the batch that still holds the folder (not ended), if any */
  const runningBatch = (): string | undefined => {
    for (const [id, batch] of batches) {
      if (batch.folderId === folderId && batch.gets < batchSteps) return id
    }
    return undefined
  }
  const principalKnown = (type: SharePrincipalType, id: string): boolean =>
    type === 'user'
      ? ACTIVE_PEOPLE.some((p) => p.userId === id)
      : type === 'workspace'
        ? WORKSPACES.some((w) => w.id === id)
        : id === ORG.id

  const folderContentsAccess = (
    req: FolderContentsAccessRequest,
  ): ShareResult<FolderContentsAccessResult> => {
    if (req.folderId === documentId) return fail('not_a_folder', 422)
    if (req.folderId !== folderId) return fail('not_found', 404)
    if (
      !(FOLDER_CONTENTS_ACCESS_MODES as readonly string[]).includes(req.mode) ||
      typeof req.dryRun !== 'boolean' ||
      !Array.isArray(req.items) ||
      req.items.length > FOLDER_CONTENTS_ACCESS_MAX_ITEMS ||
      (req.items.length === 0 && req.mode !== 'replace') ||
      req.items.some((item) => !(SHARE_LEVELS as readonly string[]).includes(item.level))
    ) {
      return fail('invalid_request', 400)
    }
    // the whole list is checked before anything is written: any bad item refuses the run
    const rejected: ShareRejectedItem[] = []
    const seen = new Set<string>()
    req.items.forEach((item, index) => {
      const key = keyOf(item.principalType, item.principalId)
      if (seen.has(key)) {
        rejected.push({ index, ...pick(item), code: 'duplicate_principal' })
      } else if (!principalKnown(item.principalType, item.principalId)) {
        rejected.push({ index, ...pick(item), code: 'principal_not_in_organization' })
      }
      seen.add(key)
    })
    if (rejected.length > 0) return { ...fail('document_access_rejected', 422), rejected }
    const running = runningBatch()
    if (running) return { ...fail('folder_access_batch_running', 409), batchId: running }
    const counts = folderCounts()
    if (req.dryRun) {
      const warnings: string[] = []
      if (req.items.some((i) => i.principalType !== 'user')) warnings.push('wide_scope')
      if (req.mode === 'replace') {
        if (
          !req.items.some(
            (i) => keyOf(i.principalType, i.principalId) === keyOf('workspace', HOME_WORKSPACE),
          )
        ) {
          warnings.push('to_private')
        }
        if ((folderOptions.downgradedUsers ?? 0) > 0) warnings.push('downgrade')
      }
      const replace = req.mode === 'replace'
      return {
        ok: true,
        value: {
          kind: 'dryRun',
          total: folderTotal,
          preview: {
            ...counts,
            losingUsers: replace ? (folderOptions.losingUsers ?? 0) : 0,
            downgradedUsers: replace ? (folderOptions.downgradedUsers ?? 0) : 0,
            warnings,
          },
        },
      }
    }
    const batchId = nextId('fb')
    if (folderTotal <= syncMax) {
      return { ok: true, value: { kind: 'sync', batchId, total: folderTotal, ...counts } }
    }
    batches.set(batchId, { gets: 0, folderId })
    return { ok: true, value: { kind: 'background', batchId, total: folderTotal } }
  }

  /** each call moves a background batch one step: queued, running ..., then completed (or failed) */
  const folderContentsAccessBatch = (
    req: FolderContentsAccessBatchRequest,
  ): ShareResult<FolderContentsAccessBatch> => {
    const batch = batches.get(req.batchId)
    if (req.folderId !== folderId || !batch) return fail('not_found', 404)
    batch.gets = Math.min(batch.gets + 1, batchSteps)
    const ended = batch.gets >= batchSteps
    const processed = ended
      ? folderTotal
      : Math.min(folderTotal, Math.ceil((folderTotal * (batch.gets - 1)) / batchSteps))
    const status: FolderContentsAccessBatch['status'] = ended
      ? folderOptions.batchFails
        ? 'failed'
        : 'completed'
      : batch.gets === 1
        ? 'queued'
        : 'running'
    return {
      ok: true,
      value: {
        batchId: req.batchId,
        status,
        total: folderTotal,
        processed,
        ...(ended && !folderOptions.batchFails ? folderCounts() : NO_COUNTS),
        ...(ended ? { finishedAt: NOW } : {}),
      },
    }
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

    ownerCandidates: (id) => call('ownerCandidates', [id], () => ownerCandidates(id)),

    transferOwner: (input) => call('transferOwner', [input], () => transferOwner(input)),

    folderContentsAccess: (req) =>
      call('folderContentsAccess', [req], () => folderContentsAccess(req)),

    folderContentsAccessBatch: (req) =>
      call('folderContentsAccessBatch', [req], () => folderContentsAccessBatch(req)),

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
