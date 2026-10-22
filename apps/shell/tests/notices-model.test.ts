import { describe, expect, it } from 'vitest'
import { LANGS } from '@genoffice/i18n'
import type { WorkNotification } from '../src/shared/uniwork-work-api'
import {
  DOCUMENT_KINDS,
  groupInbox,
  inboxCategory,
  INBOX_CATEGORIES,
  localizeNoticeParams,
  noticeSentence,
  noticeTarget,
  notePillKey,
  unreadByCategory,
} from '../src/renderer/src/notices-model'
import { workbenchStrings } from '../src/renderer/src/i18n/strings-workbench'
import { shareLevelKey } from '../src/renderer/src/notices-model'

const row = (over: Partial<WorkNotification> = {}): WorkNotification => ({
  id: 'n1',
  kind: 'document_commented',
  workspace_id: 'w1',
  resource_type: 'document',
  resource_id: 'd1',
  actor_kind: 'user',
  title_key: 'notifications.kind.document_commented',
  params: { actor: 'Lan', document: 'Contract' },
  created_at: '2026-10-14T01:00:00Z',
  ...over,
})
const kindRow = (kind: string, params: Record<string, string> = {}) =>
  row({
    kind,
    title_key: `notifications.kind.${kind}`,
    params: { actor: 'Lan', document: 'Contract', ...params },
  })

/** server/internal/notification/kinds.go:31-78 */
const SERVER_DOCUMENT_KINDS = [
  'document_commented',
  'document_mentioned',
  'document_body_mentioned',
  'document_comment_replied',
  'document_discussion_mentioned',
  'document_discussion_replied',
  'document_comment_resolved',
  'document_edit_requested',
  'document_edit_request_answered',
  'document_edit_taken_over',
  'document_break_glass',
  'document_access_requested',
  'document_access_approved',
  'document_access_declined',
  'document_shared',
  'document_trashed_by_other',
  'document_changed',
]

const en = workbenchStrings.en as Record<string, string>
const vi = workbenchStrings.vi as Record<string, string>

describe('DOCUMENT_KINDS', () => {
  it('is the 17 document kinds the server sends', () => {
    expect([...DOCUMENT_KINDS].sort()).toEqual([...SERVER_DOCUMENT_KINDS].sort())
  })
})

describe('inboxCategory', () => {
  it.each([
    ['document_commented', 'mentions'],
    ['document_mentioned', 'mentions'],
    ['document_body_mentioned', 'mentions'],
    ['document_comment_replied', 'mentions'],
    ['document_discussion_mentioned', 'mentions'],
    ['document_discussion_replied', 'mentions'],
    ['document_comment_resolved', 'mentions'],
    ['document_edit_requested', 'mentions'],
    ['document_access_requested', 'mentions'],
    ['document_edit_request_answered', 'updates'],
    ['document_edit_taken_over', 'updates'],
    ['document_access_approved', 'updates'],
    ['document_access_declined', 'updates'],
    ['document_shared', 'updates'],
    ['document_changed', 'updates'],
    ['document_break_glass', 'workspace'],
    ['document_trashed_by_other', 'workspace'],
    ['task_assigned', 'assigned'],
    ['task_status_changed', 'updates'],
    ['task_commented', 'mentions'],
    ['mentioned', 'mentions'],
    ['meeting_invited', 'meetings'],
    ['meeting_starting', 'meetings'],
    ['meeting_summary_reminder', 'meetings'],
    ['member_added', 'workspace'],
    ['role_changed', 'workspace'],
    ['audit_export_ready', 'workspace'],
    ['chat_follow_up', 'mentions'],
    ['chat_reminder', 'mentions'],
    ['chat_mentioned', 'mentions'],
    ['chat_dm', 'mentions'],
    ['chat_thread_replied', 'mentions'],
    ['chat_call_incoming', 'mentions'],
    ['email_hub_new_mail', 'updates'],
  ])('%s -> %s', (kind, category) => {
    expect(inboxCategory(kind)).toBe(category)
  })

  it('puts a kind from a newer server under workspace', () => {
    expect(inboxCategory('something_new')).toBe('workspace')
  })

  it('lists the five categories in the web order', () => {
    expect([...INBOX_CATEGORIES]).toEqual([
      'mentions',
      'assigned',
      'meetings',
      'updates',
      'workspace',
    ])
  })

  it('counts unread rows per category and skips read ones', () => {
    const rows = [
      row({ id: 'a' }),
      row({ id: 'b', kind: 'task_assigned', resource_type: 'task' }),
      row({ id: 'c', read_at: '2026-10-14T02:00:00Z' }),
      row({ id: 'd', kind: 'unknown_kind' }),
    ]
    expect(unreadByCategory(rows)).toEqual({
      mentions: 1,
      assigned: 1,
      meetings: 0,
      updates: 0,
      workspace: 1,
    })
  })
})

describe('groupInbox', () => {
  // local noon, so the day edges below hold in any time zone
  const now = new Date(2026, 9, 14, 12, 0, 0)
  const at = (daysAgo: number, hour = 9) => new Date(2026, 9, 14 - daysAgo, hour).toISOString()
  const read = (id: string, daysAgo: number) =>
    row({ id, created_at: at(daysAgo), read_at: at(0, 11) })

  it('puts all unread first, then reads by the viewer day, newest first inside each', () => {
    const rows = [
      row({ id: 'u1', created_at: at(5) }),
      read('t1', 0),
      read('y1', 1),
      read('w1', 3),
      read('o1', 9),
      read('t2', 0),
    ]
    expect(groupInbox(rows, now).map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
      ['unread', ['u1']],
      ['today', ['t1', 't2']],
      ['yesterday', ['y1']],
      ['week', ['w1']],
      ['older', ['o1']],
    ])
  })

  it('drops empty groups', () => {
    expect(groupInbox([read('y1', 1)], now).map((g) => g.key)).toEqual(['yesterday'])
    expect(groupInbox([], now)).toEqual([])
  })

  it('files a row with an unreadable date under today and the 7th day under older', () => {
    const rows = [
      row({ id: 'bad', created_at: 'nope', read_at: at(0, 11) }),
      read('d6', 6),
      read('d7', 7),
    ]
    expect(groupInbox(rows, now).map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([
      ['today', ['bad']],
      ['week', ['d6']],
      ['older', ['d7']],
    ])
  })

  it('keeps a pinned row in its recorded group whatever its read state is now', () => {
    const rows = [read('p', 0), row({ id: 'q', created_at: at(0) })]
    const groups = groupInbox(rows, now, new Map([['p', 'unread' as const]]))
    expect(groups.map((g) => [g.key, g.rows.map((r) => r.id)])).toEqual([['unread', ['p', 'q']]])
  })
})

describe('noticeSentence', () => {
  it('has a sentence in en and vi for every document kind, titled and untitled', () => {
    for (const kind of DOCUMENT_KINDS) {
      const titled = noticeSentence(kindRow(kind, { level: 'edit', date: '2026-10-30T00:00:00Z' }))
      expect(en[titled.key], titled.key).toBeTruthy()
      expect(vi[titled.key], titled.key).toBeTruthy()
      const untitled = noticeSentence(
        kindRow(kind, { document: '', level: 'edit', date: '2026-10-30T00:00:00Z' }),
      )
      expect(en[untitled.key], untitled.key).toBeTruthy()
      expect(vi[untitled.key], untitled.key).toBeTruthy()
    }
  })

  it('keeps the UNI-2067 change and resolved behaviour', () => {
    const changed = row({
      kind: 'document_changed',
      params: { actor: 'Lan', verb: 'trashed', document_count: '2' },
      sample_documents: [{ id: 'd1', title: 'A' }],
    })
    expect(noticeSentence(changed).key).toBe('wbNotif_document_changed_trashed_many')
    expect(noticeSentence(changed).params).toMatchObject({ actor: 'Lan', count: '2' })
    const resolved = kindRow('document_comment_resolved')
    expect(noticeSentence(resolved).key).toBe('wbNotif_document_comment_resolved')
    expect(noticeSentence({ ...resolved, params: { actor: 'Lan' } }).key).toBe(
      'wbNotif_document_comment_resolved_untitled',
    )
  })

  it('words each new document kind with the web sentence', () => {
    expect(noticeSentence(kindRow('document_comment_replied')).key).toBe(
      'wbNotif_document_comment_replied',
    )
    expect(noticeSentence(kindRow('document_body_mentioned', { document: ' ' })).key).toBe(
      'wbNotif_document_body_mentioned_untitled',
    )
    expect(en.wbNotif_document_comment_replied).toBe(
      '{actor} replied to your comment in “{document}”.',
    )
    expect(vi.wbNotif_document_discussion_replied).toBe(
      '{actor} đã phản hồi nội dung thảo luận của bạn trong tài liệu “{document}”.',
    )
    expect(en.wbNotif_document_access_declined).toBe(
      'Your request to access a document was declined.',
    )
    expect(vi.wbNotif_document_mentioned).toBe(
      '{actor} đã nhắc đến bạn trong bình luận tại tài liệu “{document}”.',
    )
  })

  it('has no untitled variant for the edit-lock kinds and the declined request', () => {
    for (const kind of [
      'document_edit_requested',
      'document_edit_request_answered',
      'document_edit_taken_over',
      'document_access_declined',
    ]) {
      expect(noticeSentence(kindRow(kind, { document: '' })).key).toBe(`wbNotif_${kind}`)
    }
  })

  it('words a declined edit request apart from a handed-over one', () => {
    expect(
      noticeSentence(kindRow('document_edit_request_answered', { decision: 'decline' })).key,
    ).toBe('wbNotif_document_edit_request_answered_declined')
    expect(noticeSentence(kindRow('document_edit_request_answered')).key).toBe(
      'wbNotif_document_edit_request_answered',
    )
  })

  it('drops the level clause of a share whose level is missing or not one the app words', () => {
    expect(noticeSentence(kindRow('document_shared', { level: 'view' })).key).toBe(
      'wbNotif_document_shared',
    )
    expect(noticeSentence(kindRow('document_shared', { level: '' })).key).toBe(
      'wbNotif_document_shared_nolevel',
    )
    expect(noticeSentence(kindRow('document_shared', { level: 'owner' })).key).toBe(
      'wbNotif_document_shared_nolevel',
    )
    expect(noticeSentence(kindRow('document_shared', { level: 'edit', document: '' })).key).toBe(
      'wbNotif_document_shared_untitled',
    )
    expect(noticeSentence(kindRow('document_shared', { document: '' })).key).toBe(
      'wbNotif_document_shared_untitled_nolevel',
    )
  })

  it('says no deadline for a trash notice whose date cannot be read', () => {
    const date = '2026-10-30T00:00:00Z'
    expect(noticeSentence(kindRow('document_trashed_by_other', { date })).key).toBe(
      'wbNotif_document_trashed_by_other',
    )
    expect(noticeSentence(kindRow('document_trashed_by_other', { date: 'x' })).key).toBe(
      'wbNotif_document_trashed_by_other_nodate',
    )
    expect(
      noticeSentence(kindRow('document_trashed_by_other', { date: '', document: '' })).key,
    ).toBe('wbNotif_document_trashed_by_other_untitled_nodate')
  })

  it('words the non-document kinds the same way as before', () => {
    const task = row({
      kind: 'task_assigned',
      resource_type: 'task',
      params: { actor: 'Lan', task: 'Fix' },
    })
    expect(noticeSentence(task)).toEqual({
      key: 'wbNotif_task_assigned',
      params: { actor: 'Lan', task: 'Fix' },
    })
    expect(
      noticeSentence(row({ kind: 'chat_call_incoming', resource_type: 'chat_room' })).key,
    ).toBe('wbNotif_chat_call_incoming')
  })

  it('reads a kind from a newer server as the generic new notification', () => {
    expect(noticeSentence(row({ kind: 'brand_new_kind', resource_type: 'thing' })).key).toBe(
      'wbNotifFallback',
    )
  })

  it('localizes the level and the purge date of a notice', () => {
    const t = (key: string) => `<${key}>`
    expect(
      localizeNoticeParams(
        { actor: 'Lan', level: 'view', date: '2026-10-30T00:00:00Z' },
        t as never,
        'en-US',
        new Date(2026, 9, 14),
      ),
    ).toEqual({ actor: 'Lan', level: '<shrLevelView>', date: 'Oct 30' })
    expect(shareLevelKey('manage')).toBe('shrLevelManage')
    expect(shareLevelKey('owner')).toBeNull()
    expect(localizeNoticeParams({ date: 'x' }, t as never, 'en-US').date).toBe('')
  })
})

describe('notePillKey', () => {
  it.each([
    ['document_commented', 'wbDeskPillComment'],
    ['document_mentioned', 'wbDeskPillMention'],
    ['document_body_mentioned', 'wbDeskPillMention'],
    ['document_discussion_mentioned', 'wbDeskPillMention'],
    ['document_comment_replied', 'wbDeskPillReply'],
    ['document_discussion_replied', 'wbDeskPillReply'],
    ['document_comment_resolved', 'wbDeskPillResolved'],
    ['document_changed', 'wbDeskPillChanged'],
    ['document_edit_requested', 'wbDeskPillEdit'],
    ['document_edit_request_answered', 'wbDeskPillEdit'],
    ['document_edit_taken_over', 'wbDeskPillEdit'],
    ['document_access_requested', 'wbDeskPillAccess'],
    ['document_access_approved', 'wbDeskPillAccess'],
    ['document_access_declined', 'wbDeskPillAccess'],
    ['document_shared', 'wbDeskPillShared'],
    ['document_trashed_by_other', 'wbDeskPillTrash'],
    ['document_break_glass', 'wbDeskPillBreakGlass'],
  ])('%s -> %s', (kind, pill) => {
    expect(notePillKey(kindRow(kind))).toBe(pill)
  })

  it('has a pill word in en and vi for every document kind', () => {
    for (const kind of DOCUMENT_KINDS) {
      const pill = notePillKey(kindRow(kind))
      expect(en[pill], pill).toBeTruthy()
      expect(vi[pill], pill).toBeTruthy()
    }
  })
})

describe('noticeTarget', () => {
  it.each([
    'document_commented',
    'document_mentioned',
    'document_comment_replied',
    'document_comment_resolved',
  ])('%s opens the document and reveals the comment', (kind) => {
    expect(noticeTarget(kindRow(kind, { comment_id: 'c9' }))).toEqual({
      to: 'document',
      documentId: 'd1',
      commentId: 'c9',
    })
  })

  it('reveals a discussion post when the comment belongs to a discussion', () => {
    for (const kind of ['document_discussion_mentioned', 'document_discussion_replied']) {
      expect(noticeTarget(kindRow(kind, { comment_id: 'c9', kind: 'discussion' }))).toEqual({
        to: 'document',
        documentId: 'd1',
        commentId: 'c9',
        discussion: true,
      })
    }
  })

  it('opens the plain document when no comment id rides', () => {
    expect(noticeTarget(kindRow('document_commented'))).toEqual({
      to: 'document',
      documentId: 'd1',
    })
  })

  it('opens the plain document for a body mention, the edit kinds, a share and an approval', () => {
    for (const kind of [
      'document_body_mentioned',
      'document_edit_requested',
      'document_edit_request_answered',
      'document_edit_taken_over',
      'document_shared',
      'document_access_approved',
    ]) {
      expect(noticeTarget(kindRow(kind, { comment_id: 'c9' }))).toEqual({
        to: 'document',
        documentId: 'd1',
      })
    }
  })

  it('opens the document without a comment when the comment is gone (comment_deleted)', () => {
    expect(
      noticeTarget({
        ...kindRow('document_commented', { comment_id: 'c9' }),
        comment_deleted: true,
      }),
    ).toEqual({ to: 'document', documentId: 'd1' })
  })

  it('opens the Share dialog on the right section for requests and break glass', () => {
    expect(noticeTarget(kindRow('document_access_requested'))).toEqual({
      to: 'share',
      documentId: 'd1',
      workspaceId: 'w1',
      section: 'requests',
    })
    expect(noticeTarget(kindRow('document_break_glass'))).toEqual({
      to: 'share',
      documentId: 'd1',
      workspaceId: 'w1',
      section: 'break_glass',
    })
  })

  it('opens the Trash for a trashed-by-other notice', () => {
    expect(noticeTarget(kindRow('document_trashed_by_other'))).toEqual({
      to: 'trash',
      documentId: 'd1',
      workspaceId: 'w1',
    })
  })

  it('leaves document_changed to the UNI-2067 code', () => {
    expect(noticeTarget(kindRow('document_changed', { verb: 'renamed' }))).toEqual({
      to: 'changed',
    })
    expect(
      noticeTarget({ ...kindRow('document_changed'), resource_deleted: true, count: 3 }),
    ).toEqual({ to: 'changed' })
  })

  it('opens nothing for a declined request', () => {
    expect(noticeTarget(kindRow('document_access_declined'))).toEqual({ to: 'none' })
  })

  it('opens nothing for a document that is gone or out of reach, whatever the kind', () => {
    for (const kind of DOCUMENT_KINDS.filter((k) => k !== 'document_changed')) {
      expect(noticeTarget({ ...kindRow(kind), resource_deleted: true })).toEqual({ to: 'none' })
      expect(noticeTarget({ ...kindRow(kind), resource_access_lost: true })).toEqual({
        to: 'none',
      })
    }
  })

  it('sends task, meeting and chat notices to the web by their resource', () => {
    expect(
      noticeTarget(row({ kind: 'task_assigned', resource_type: 'task', resource_id: 't1' })),
    ).toEqual({ to: 'web', target: { kind: 'task', id: 't1' } })
    expect(
      noticeTarget(row({ kind: 'meeting_invited', resource_type: 'meeting', resource_id: 'm1' })),
    ).toEqual({ to: 'web', target: { kind: 'meeting', id: 'm1' } })
    expect(
      noticeTarget({
        ...row({ kind: 'chat_dm', resource_type: 'chat_message', resource_id: 'x' }),
        resource_parent_id: 'room1',
      }),
    ).toEqual({ to: 'web', target: { kind: 'room', id: 'room1' } })
    expect(
      noticeTarget(
        row({ kind: 'chat_call_incoming', resource_type: 'chat_room', resource_id: 'r2' }),
      ),
    ).toEqual({ to: 'web', target: { kind: 'room', id: 'r2' } })
  })

  it('sends a chat message with no known room, audit exports, mail and unknown kinds to the web inbox', () => {
    expect(
      noticeTarget(row({ kind: 'chat_dm', resource_type: 'chat_message', resource_id: 'x' })),
    ).toEqual({ to: 'web', target: { kind: 'inbox' } })
    for (const resource_type of ['audit_export', 'email_account', 'weird']) {
      expect(noticeTarget(row({ kind: 'x', resource_type }))).toEqual({
        to: 'web',
        target: { kind: 'inbox' },
      })
    }
  })

  it('opens nothing for a gone task, meeting or chat notice', () => {
    expect(
      noticeTarget(
        row({
          kind: 'task_assigned',
          resource_type: 'task',
          resource_id: 't1',
          resource_deleted: true,
        }),
      ),
    ).toEqual({ to: 'none' })
  })
})

describe('wbNotif_ strings', () => {
  it.each([...LANGS])(
    'locale %s has a sentence for every document kind, titled and untitled',
    (lang) => {
      const table = workbenchStrings[lang] as Record<string, string>
      const missing: string[] = []
      for (const kind of DOCUMENT_KINDS) {
        if (kind === 'document_changed') continue // wording pinned by desk-doc-change.test.ts
        const titled = noticeSentence(
          kindRow(kind, { level: 'edit', date: '2026-10-30T00:00:00Z' }),
        ).key
        const untitled = noticeSentence(
          kindRow(kind, { document: '', level: 'edit', date: '2026-10-30T00:00:00Z' }),
        ).key
        for (const key of [titled, untitled])
          if (!table[key]?.trim()) missing.push(`${lang}:${key}`)
      }
      expect(missing).toEqual([])
    },
  )

  it.each([...LANGS])('locale %s has the nodate and nolevel variants', (lang) => {
    const table = workbenchStrings[lang] as Record<string, string>
    const keys = [
      'wbNotif_document_shared_nolevel',
      'wbNotif_document_shared_untitled_nolevel',
      'wbNotif_document_trashed_by_other_nodate',
      'wbNotif_document_trashed_by_other_untitled_nodate',
      'wbNotif_document_edit_request_answered_declined',
      'wbNotif_chat_call_incoming',
    ]
    expect(keys.filter((k) => !table[k]?.trim())).toEqual([])
  })
})
