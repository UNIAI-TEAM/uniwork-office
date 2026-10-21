import { describe, expect, it } from 'vitest'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import {
  parseAccessRequests,
  parseRejectedItems,
  parseRequestDecision,
  parseShareAccess,
  parseShareCandidates,
  parseShareLinkCreated,
  parseShareSettings,
  parseShareUpdate,
} from '../src/main/uniwork-docs/share-parse'

/**
 * UNI-2047 SD-A: the lenient parse of the share routes, the same leniency the web
 * schemas have: unknown fields are ignored, missing optional fields get their
 * default, an unknown enum value narrows to "none", and a malformed top level is
 * a typed `malformed_response` error (never a guess).
 */

const malformed = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(UniworkDocError)
    expect((error as UniworkDocError).code).toBe('malformed_response')
    return
  }
  throw new Error('expected malformed_response')
}

describe('parseShareAccess (GET /documents/{id}/shares)', () => {
  it('reads the full manager answer', () => {
    const access = parseShareAccess({
      my_level: 'manage',
      admin_scope: false,
      via: 'member',
      my_sources: [
        { via: 'member', principal_type: 'workspace', principal_id: 'ws_1', level: 'edit' },
      ],
      home_workspace: { workspace_id: 'ws_1', workspace_name: 'Team', level: 'view' },
      acl_owner: { user_id: 'u_1', level: 'manage', via: 'member' },
      shares: [
        {
          id: 'sh_1',
          principal_type: 'user',
          principal_id: 'u_2',
          level: 'edit',
          active: true,
          effective_level: 'edit',
          effective_via: 'share',
          sources: [{ via: 'share', principal_type: 'user', principal_id: 'u_2', level: 'edit' }],
          warnings: ['direct_below_group', 'something_new'],
          granted_by: 'u_1',
          granted_by_kind: 'human',
          created_at: '2026-10-20T01:00:00Z',
          extra_field: 'ignored',
        },
      ],
      links: [
        {
          id: 'ln_1',
          expires_at: '2026-10-30T00:00:00Z',
          view_count: 3,
          created_by: 'u_1',
          created_by_kind: 'human',
          created_at: '2026-10-20T01:00:00Z',
        },
      ],
      break_glass: [
        {
          id: 'bg_1',
          document_id: 'd_1',
          actor_id: 'u_9',
          actor_name: 'Admin',
          level: 'view',
          reason: 'audit',
          granted_at: '2026-10-20T01:00:00Z',
          expires_at: '2026-10-21T01:00:00Z',
        },
      ],
      unknown_top: true,
    })
    expect(access).toEqual({
      myLevel: 'manage',
      adminScope: false,
      via: 'member',
      mySources: [
        { via: 'member', principalType: 'workspace', principalId: 'ws_1', level: 'edit' },
      ],
      homeWorkspace: { workspaceId: 'ws_1', workspaceName: 'Team', level: 'view' },
      owner: { userId: 'u_1', level: 'manage', via: 'member' },
      shares: [
        {
          id: 'sh_1',
          principalType: 'user',
          principalId: 'u_2',
          level: 'edit',
          active: true,
          effectiveLevel: 'edit',
          effectiveVia: 'share',
          sources: [{ via: 'share', principalType: 'user', principalId: 'u_2', level: 'edit' }],
          warnings: ['direct_below_group'],
          grantedBy: 'u_1',
          grantedByKind: 'human',
          createdAt: '2026-10-20T01:00:00Z',
        },
      ],
      links: [
        {
          id: 'ln_1',
          expiresAt: '2026-10-30T00:00:00Z',
          viewCount: 3,
          createdBy: 'u_1',
          createdByKind: 'human',
          createdAt: '2026-10-20T01:00:00Z',
        },
      ],
      breakGlass: [
        {
          id: 'bg_1',
          documentId: 'd_1',
          actorId: 'u_9',
          actorName: 'Admin',
          level: 'view',
          reason: 'audit',
          grantedAt: '2026-10-20T01:00:00Z',
          expiresAt: '2026-10-21T01:00:00Z',
        },
      ],
    })
  })

  it('reads the non-manager answer: my level only, the manager parts stay absent', () => {
    expect(parseShareAccess({ my_level: 'view' })).toEqual({
      myLevel: 'view',
      adminScope: false,
      via: '',
    })
  })

  it('defaults the optional parts of a row: active true, kind human, counts 0, empty text', () => {
    const access = parseShareAccess({
      my_level: 'manage',
      shares: [{ id: 'sh_1', principal_type: 'workspace', principal_id: 'ws_1' }],
      links: [{ id: 'ln_1' }],
    })
    expect(access.shares).toEqual([
      {
        id: 'sh_1',
        principalType: 'workspace',
        principalId: 'ws_1',
        level: null,
        active: true,
        grantedBy: '',
        grantedByKind: 'human',
        createdAt: '',
      },
    ])
    expect(access.links).toEqual([
      {
        id: 'ln_1',
        expiresAt: null,
        viewCount: 0,
        createdBy: '',
        createdByKind: 'human',
        createdAt: '',
      },
    ])
  })

  it('an admin with no level is readable by admin_scope alone', () => {
    expect(parseShareAccess({ admin_scope: true })).toEqual({
      myLevel: '',
      adminScope: true,
      via: '',
    })
  })

  it('narrows an unknown level to none and keeps a null home-workspace row', () => {
    const access = parseShareAccess({
      my_level: 'owner-of-all',
      home_workspace: null,
      shares: [{ id: 's', principal_type: 'user', principal_id: 'u', level: 'superuser' }],
    })
    expect(access.myLevel).toBe('')
    expect(access.homeWorkspace).toBeNull()
    expect(access.shares![0]!.level).toBeNull()
  })

  it('drops a malformed source / break-glass entry on its own and keeps the rest', () => {
    const access = parseShareAccess({
      my_level: 'edit',
      my_sources: [{ via: 'member', level: 'edit' }, { nope: true }, 7],
      break_glass: [{ id: 'bg_x' }],
    })
    expect(access.mySources).toEqual([{ via: 'member', level: 'edit' }])
    expect(access.breakGlass).toEqual([])
  })

  it('a malformed home-workspace row reads as not sent', () => {
    expect(
      parseShareAccess({ my_level: 'view', home_workspace: { level: 'view' } }).homeWorkspace,
    ).toBe(undefined)
  })

  it('a malformed top level is malformed_response', () => {
    malformed(() => parseShareAccess(null))
    malformed(() => parseShareAccess('x'))
    malformed(() => parseShareAccess([]))
    // neither a level nor admin scope: the server told us nothing about the viewer
    malformed(() => parseShareAccess({ shares: [] }))
    // a grant that cannot be read is never silently left out of a manager's list
    malformed(() => parseShareAccess({ my_level: 'manage', shares: [{ id: 's' }] }))
    malformed(() => parseShareAccess({ my_level: 'manage', links: [{ view_count: 1 }] }))
  })
})

describe('parseShareUpdate (PUT /documents/{id}/access)', () => {
  it('reads a write answer and defaults the preview', () => {
    expect(
      parseShareUpdate({ batch_id: 'b_1', results: [{ index: 0, status: 'granted' }] }),
    ).toEqual({
      batchId: 'b_1',
      dryRun: false,
      results: [{ index: 0, status: 'granted' }],
      preview: { users: [], groups: [], warnings: [] },
    })
  })

  it('reads a dry-run preview: users, groups, warnings', () => {
    const update = parseShareUpdate({
      dry_run: true,
      results: [
        { index: 0, status: 'updated' },
        { index: 1, status: 'brand_new_status' },
      ],
      preview: {
        users: [
          {
            user_id: 'u_2',
            before: { level: 'edit', via: 'share' },
            after: { level: null },
          },
          { bad: true },
        ],
        groups: [
          { principal_type: 'workspace', principal_id: 'ws_1', member_count: 12, losing_count: 2 },
        ],
        warnings: [{ code: 'downgrade', index: 0 }, { code: 'wide_scope', index: 1 }, { code: 3 }],
      },
    })
    expect(update.dryRun).toBe(true)
    expect(update.results).toHaveLength(2)
    expect(update.preview.users).toEqual([
      {
        userId: 'u_2',
        before: { level: 'edit', via: 'share' },
        after: { level: '', via: '' },
      },
    ])
    expect(update.preview.groups).toEqual([
      { principalType: 'workspace', principalId: 'ws_1', memberCount: 12, losingCount: 2 },
    ])
    expect(update.preview.warnings).toEqual([
      { code: 'downgrade', index: 0 },
      { code: 'wide_scope', index: 1 },
    ])
  })

  it('a malformed top level is malformed_response (a write must be provable)', () => {
    malformed(() => parseShareUpdate(null))
    malformed(() => parseShareUpdate({}))
    malformed(() => parseShareUpdate({ results: [] }))
    malformed(() => parseShareUpdate({ results: [{ status: 'granted' }] }))
    malformed(() => parseShareUpdate({ results: [{ index: -1, status: 'granted' }] }))
  })
})

describe('parseShareCandidates (GET /documents/{id}/share-candidates)', () => {
  it('reads people, workspaces and the organization with their existing level', () => {
    expect(
      parseShareCandidates({
        items: [
          {
            principal_type: 'user',
            principal_id: 'u_2',
            name: 'Minh',
            secondary: 'minh@x.vn',
            direct_level: 'edit',
          },
          {
            principal_type: 'workspace',
            principal_id: 'ws_1',
            name: 'Team',
            is_home_workspace: true,
          },
          {
            principal_type: 'organization',
            principal_id: 'org_1',
            name: 'Acme',
            direct_level: 'weird',
          },
        ],
        next_cursor: 'c2',
      }),
    ).toEqual({
      items: [
        {
          principalType: 'user',
          principalId: 'u_2',
          name: 'Minh',
          secondary: 'minh@x.vn',
          directLevel: 'edit',
          isHomeWorkspace: false,
        },
        {
          principalType: 'workspace',
          principalId: 'ws_1',
          name: 'Team',
          secondary: '',
          directLevel: null,
          isHomeWorkspace: true,
        },
        {
          principalType: 'organization',
          principalId: 'org_1',
          name: 'Acme',
          secondary: '',
          directLevel: null,
          isHomeWorkspace: false,
        },
      ],
      nextCursor: 'c2',
    })
  })

  it('drops a row of an unknown principal type or a broken row, and defaults the cursor', () => {
    const page = parseShareCandidates({
      items: [
        { principal_type: 'team', principal_id: 't_1', name: 'New kind' },
        { principal_type: 'user', name: 'no id' },
        { principal_type: 'user', principal_id: 'u_3', name: 'Ok' },
      ],
      next_cursor: null,
    })
    expect(page.items.map((c) => c.principalId)).toEqual(['u_3'])
    expect(page.nextCursor).toBe('')
  })

  it('a malformed top level is malformed_response', () => {
    malformed(() => parseShareCandidates(undefined))
    malformed(() => parseShareCandidates({ items: 'x' }))
    malformed(() => parseShareCandidates({}))
  })
})

describe('parseShareLinkCreated (POST /documents/{id}/links)', () => {
  it('reads the link and its one-time token and url', () => {
    expect(
      parseShareLinkCreated({
        link: { id: 'ln_1', expires_at: null, view_count: 0 },
        token: 'tok',
        url: 'https://uniwork.example/p/tok',
      }),
    ).toEqual({
      link: {
        id: 'ln_1',
        expiresAt: null,
        viewCount: 0,
        createdBy: '',
        createdByKind: 'human',
        createdAt: '',
      },
      token: 'tok',
      url: 'https://uniwork.example/p/tok',
    })
  })

  it('malformed (missing link / token / url) is malformed_response', () => {
    malformed(() => parseShareLinkCreated({ link: { id: 'x' }, token: 't' }))
    malformed(() => parseShareLinkCreated({ token: 't', url: 'u' }))
    malformed(() => parseShareLinkCreated(null))
  })
})

describe('parseShareSettings (GET /orgs/{id}/documents/settings)', () => {
  it('reads the public-links switch and ignores audit fields', () => {
    expect(
      parseShareSettings({
        organization_id: 'org_1',
        public_links_enabled: true,
        updated_by: 'u_1',
      }),
    ).toEqual({ organizationId: 'org_1', publicLinksEnabled: true })
  })

  it('a missing switch is malformed_response: the policy is never guessed', () => {
    malformed(() => parseShareSettings({ organization_id: 'org_1' }))
    malformed(() => parseShareSettings({ public_links_enabled: 'yes' }))
    malformed(() => parseShareSettings(null))
  })
})

describe('parseAccessRequests / parseRequestDecision', () => {
  it('reads the pending requests with the web defaults', () => {
    expect(
      parseAccessRequests({
        requests: [
          {
            id: 'rq_1',
            requester_id: 'u_5',
            requester_name: 'An',
            requested_level: 'edit',
            message: 'please',
            source: { kind: 'task', id: 't_1', title: 'Plan' },
            created_at: '2026-10-20T01:00:00Z',
            expires_at: '2026-10-27T01:00:00Z',
          },
          { id: 'rq_2', requester_id: 'u_6', message: null, source: 'broken' },
          { requester_id: 'u_7' },
        ],
      }),
    ).toEqual([
      {
        id: 'rq_1',
        requesterId: 'u_5',
        requesterName: 'An',
        requestedLevel: 'edit',
        message: 'please',
        source: { kind: 'task', id: 't_1', title: 'Plan' },
        createdAt: '2026-10-20T01:00:00Z',
        expiresAt: '2026-10-27T01:00:00Z',
      },
      {
        id: 'rq_2',
        requesterId: 'u_6',
        requesterName: '',
        requestedLevel: 'view',
        message: '',
        source: null,
        createdAt: '',
        expiresAt: '',
      },
    ])
  })

  it('a malformed list is malformed_response', () => {
    malformed(() => parseAccessRequests({ requests: 'x' }))
    malformed(() => parseAccessRequests(null))
  })

  it('reads a decision; share_id defaults to empty', () => {
    expect(parseRequestDecision({ id: 'rq_1', status: 'approved', share_id: 'sh_9' })).toEqual({
      id: 'rq_1',
      status: 'approved',
      shareId: 'sh_9',
    })
    expect(parseRequestDecision({ id: 'rq_1', status: 'declined' }).shareId).toBe('')
    malformed(() => parseRequestDecision({ status: 'approved' }))
    malformed(() => parseRequestDecision(null))
  })
})

describe('parseRejectedItems (document_access_rejected fields)', () => {
  it('keeps the readable items and drops the rest', () => {
    expect(
      parseRejectedItems([
        {
          index: 0,
          principal_type: 'user',
          principal_id: 'u_2',
          code: 'principal_not_in_organization',
        },
        { index: 1, principal_type: 'workspace', principal_id: 'ws_1', code: 'level_not_allowed' },
        { index: 'x' },
        null,
      ]),
    ).toEqual([
      {
        index: 0,
        principalType: 'user',
        principalId: 'u_2',
        code: 'principal_not_in_organization',
      },
      { index: 1, principalType: 'workspace', principalId: 'ws_1', code: 'level_not_allowed' },
    ])
  })

  it('anything that is not a list is an empty list', () => {
    expect(parseRejectedItems(undefined)).toEqual([])
    expect(parseRejectedItems('x')).toEqual([])
  })
})
