import { describe, expect, it } from 'vitest'
import type {
  DeskDraft,
  RecentEntry,
  UniworkDocStatus,
  UniworkDocSummary,
} from '../src/shared/home-api'
import type { WorkNotification } from '../src/shared/uniwork-work-api'
import {
  applicableTools,
  docNotifications,
  freshShared,
  inProgressRows,
  initials,
  inTrayRows,
  noteSentence,
  notePillKey,
  syncProblems,
} from '../src/renderer/src/desk-model'
import { DOCUMENT_KINDS } from '../src/renderer/src/notices-model'

const note = (over: Partial<WorkNotification> = {}): WorkNotification => ({
  id: 'n1',
  kind: 'document_commented',
  workspace_id: 'w',
  resource_type: 'document',
  resource_id: 'd1',
  actor_kind: 'user',
  title_key: 'notifications.kind.document_commented',
  params: { actor: 'Lan', document: 'Contract' },
  created_at: '2026-10-14T01:00:00Z',
  ...over,
})
const doc = (over: Partial<UniworkDocSummary> = {}): UniworkDocSummary => ({
  id: 'd1',
  workspaceId: 'w',
  title: 'KPI.xlsx',
  format: 'xlsx',
  updatedAt: '2026-10-13T00:00:00Z',
  ...over,
})
const status = (over: Partial<UniworkDocStatus> = {}): UniworkDocStatus => ({
  path: '/c/a.docx',
  documentId: 'd9',
  workspaceId: 'w',
  title: 'Proposal',
  format: 'docx',
  access: 'edit',
  state: 'conflict',
  ...over,
})
const NOW = Date.parse('2026-10-14T00:00:00Z')

describe('applicableTools', () => {
  it('offers the PDF tools for one PDF, merge for several, export for an office file', () => {
    expect(applicableTools(['/a.pdf'])).toEqual([
      'pdf-to-docx',
      'pdf-to-xlsx',
      'pdf-to-pptx',
      'split-pdf',
    ])
    expect(applicableTools(['/a.pdf', '/b.PDF'])).toEqual(['merge-pdf'])
    expect(applicableTools(['/a.docx'])).toEqual(['export-pdf'])
    expect(applicableTools(['/n.md'])).toEqual(['export-pdf'])
  })

  it('offers nothing for folders, images, mixes or nothing', () => {
    expect(applicableTools([])).toEqual([])
    expect(applicableTools(['/folder'])).toEqual([])
    expect(applicableTools(['/p.png'])).toEqual([])
    expect(applicableTools(['/a.pdf', '/b.docx'])).toEqual([])
    expect(applicableTools(['/a.docx', '/b.docx'])).toEqual([])
  })
})

describe('in-tray sources', () => {
  it('keeps unread document notices only', () => {
    const inbox = [
      note(),
      note({ id: 'n2', kind: 'document_mentioned' }),
      note({ id: 'n3', read_at: '2026-10-14T02:00:00Z' }),
      note({ id: 'n4', kind: 'task_assigned', resource_type: 'task' }),
    ]
    expect(docNotifications(inbox).map((n) => n.id)).toEqual(['n1', 'n2'])
  })

  it('also keeps unread document changes and resolved comments', () => {
    const inbox = [
      note({ id: 'c1', kind: 'document_changed' }),
      note({ id: 'c2', kind: 'document_comment_resolved' }),
      note({ id: 'c3', kind: 'document_changed', read_at: '2026-10-14T02:00:00Z' }),
      note({ id: 'c4', kind: 'task_assigned', resource_type: 'task' }),
      note({ id: 'c5', kind: 'document_shared', resource_type: 'task' }),
    ]
    expect(docNotifications(inbox).map((n) => n.id)).toEqual(['c1', 'c2'])
  })

  it('keeps every document kind the server sends, unread, on a document', () => {
    const inbox = DOCUMENT_KINDS.map((kind, i) => note({ id: `k${i}`, kind }))
    expect(docNotifications(inbox)).toHaveLength(DOCUMENT_KINDS.length)
    expect(docNotifications(inbox.map((n) => ({ ...n, read_at: '2026-10-14T02:00:00Z' })))).toEqual(
      [],
    )
    expect(docNotifications([note({ kind: 'document_access_approved' })])).toHaveLength(1)
  })

  it('counts a folded change row once: the Today foot is unread minus the tray notes', () => {
    const inbox = [
      note({ id: 'c1', kind: 'document_changed', count: 40 }),
      note({ id: 'n1' }),
      note({ id: 'x', kind: 'task_assigned', resource_type: 'task' }),
    ]
    const unread = 3
    expect(unread - docNotifications(inbox).length).toBe(1)
  })

  it('words a note: change rows by verb and shape, resolved comments with or without a title', () => {
    const changed = note({
      kind: 'document_changed',
      params: { actor: 'Lan', verb: 'trashed', document_count: '2' },
      sample_documents: [{ id: 'd1', title: 'A' }],
    })
    expect(noteSentence(changed).key).toBe('wbNotif_document_changed_trashed_many')
    expect(noteSentence(changed).params).toMatchObject({ actor: 'Lan', count: '2' })
    const resolved = note({ kind: 'document_comment_resolved' })
    expect(noteSentence(resolved).key).toBe('wbNotif_document_comment_resolved')
    expect(noteSentence({ ...resolved, params: { actor: 'Lan' } }).key).toBe(
      'wbNotif_document_comment_resolved_untitled',
    )
    expect(noteSentence(note()).key).toBe('wbNotif_document_commented')
    expect(noteSentence(note()).params).toEqual({ actor: 'Lan', document: 'Contract' })
  })

  it('picks the pill by kind', () => {
    expect(notePillKey(note())).toBe('wbDeskPillComment')
    expect(notePillKey(note({ kind: 'document_mentioned' }))).toBe('wbDeskPillMention')
    expect(notePillKey(note({ kind: 'document_changed' }))).toBe('wbDeskPillChanged')
    expect(notePillKey(note({ kind: 'document_comment_resolved' }))).toBe('wbDeskPillResolved')
    expect(notePillKey(note({ kind: 'document_comment_replied' }))).toBe('wbDeskPillReply')
    expect(notePillKey(note({ kind: 'document_access_requested' }))).toBe('wbDeskPillAccess')
  })

  it('keeps shared documents from the last 7 days that were never opened here', () => {
    const recents = [{ path: '/c/k.xlsx', uniwork: { documentId: 'd2' } } as RecentEntry]
    const shared = [
      doc(),
      doc({ id: 'd2' }),
      doc({ id: 'd3', updatedAt: '2026-10-06T00:00:00Z' }),
      doc({ id: 'd4', archived: true }),
    ]
    expect(freshShared(shared, recents, NOW).map((d) => d.id)).toEqual(['d1'])
  })

  it('treats conflicts, failures and pauses as problems, not saving or offline', () => {
    const list = ['conflict', 'failed', 'paused_user', 'saving', 'paused_offline', 'saved'].map(
      (state) => status({ path: state, state: state as UniworkDocStatus['state'] }),
    )
    expect(syncProblems(list).map((s) => s.path)).toEqual(['conflict', 'failed', 'paused_user'])
  })

  it('orders rows: sync problems, then notes, then shares, newest first in each', () => {
    const rows = inTrayRows({
      notes: [note({ id: 'old', created_at: '2026-10-13T00:00:00Z' }), note({ id: 'new' })],
      shared: [doc()],
      sync: [status()],
    })
    expect(rows.map((r) => (r.kind === 'note' ? r.note.id : r.kind))).toEqual([
      'sync',
      'new',
      'old',
      'shared',
    ])
  })
})

describe('inProgressRows', () => {
  it('puts drafts first, drops a recent row a draft already shows, and caps the list', () => {
    const drafts: DeskDraft[] = [
      { kind: 'unsaved', title: 'Report', app: 'docs', tabId: 't1', filePath: '/w/r.docx' },
    ]
    const local = (path: string) => ({ source: 'local' as const, entry: { path } as RecentEntry })
    const rows = inProgressRows(
      drafts,
      [local('/w/r.docx'), local('/w/x.xlsx'), local('/w/y.pptx')],
      [],
      2,
    )
    expect(
      rows.map((r) =>
        r.kind === 'draft' ? r.draft.title : r.doc.source === 'local' ? r.doc.entry.path : '',
      ),
    ).toEqual(['Report', '/w/x.xlsx'])
  })

  it('drops the cloud row of a UniWork document whose working copy is a draft', () => {
    const drafts: DeskDraft[] = [
      { kind: 'recovery', title: 'P', app: 'docs', filePath: '/c/p.docx', modifiedMs: 1 },
    ]
    const local = [
      { path: '/c/p.docx', uniwork: { documentId: 'd9' } } as RecentEntry,
      { path: '/c/q.docx', uniwork: { documentId: 'd7' } } as RecentEntry,
    ]
    const rows = inProgressRows(
      drafts,
      [
        { source: 'uniwork', doc: doc({ id: 'd9' }) },
        { source: 'uniwork', doc: doc({ id: 'd7' }) },
      ],
      local,
    )
    expect(
      rows.map((r) =>
        r.kind === 'draft' ? r.draft.title : r.doc.source === 'uniwork' ? r.doc.doc.id : '',
      ),
    ).toEqual(['P', 'd7'])
  })
})

describe('initials', () => {
  it('takes the first and last words, upper case, and copes with one word or none', () => {
    expect(initials('Lan Phạm')).toBe('LP')
    expect(initials('  Phan Đức Quang ')).toBe('PQ')
    expect(initials('ada')).toBe('A')
    expect(initials('')).toBe('')
  })
})
