import { describe, expect, it } from 'vitest'
import type { WorkNotification } from '../src/shared/uniwork-work-api'
import {
  documentChangedFacts,
  documentChangedHasPage,
  documentChangedSentenceKey,
  documentChangedTitleParams,
  noticeState,
  opensDocumentList,
} from '../src/renderer/src/desk-doc-change'
import { workbenchStrings } from '../src/renderer/src/i18n/strings-workbench'

const VERBS = [
  'renamed',
  'moved',
  'trashed',
  'restored',
  'deleted',
  'shelved',
  'unshelved',
  'access_changed',
  'version_created',
  'relocated',
]

const change = (over: Partial<WorkNotification> = {}): WorkNotification => ({
  id: 'n1',
  kind: 'document_changed',
  workspace_id: 'w',
  resource_type: 'document',
  resource_id: 'd1',
  actor_kind: 'user',
  title_key: 'notifications.kind.document_changed',
  params: { actor: 'Lan', verb: 'renamed', document_count: '1' },
  created_at: '2026-10-14T01:00:00Z',
  ...over,
})
const sample = (...titles: string[]) => titles.map((title, i) => ({ id: `d${i + 1}`, title }))

describe('documentChangedFacts', () => {
  it('reads verb, count, titles and the remainder from the row', () => {
    const n = change({
      params: { actor: 'Lan', verb: 'moved', document_count: '5' },
      sample_documents: sample('A', 'B', 'C'),
    })
    expect(documentChangedFacts(n)).toEqual({
      verb: 'moved',
      count: 5,
      titles: ['A', 'B', 'C'],
      more: 2,
    })
  })

  it('takes the count from params, then the row count, then the titles, never below 1', () => {
    expect(
      documentChangedFacts(change({ params: { verb: 'moved', document_count: '3' }, count: 9 }))
        .count,
    ).toBe(3)
    expect(documentChangedFacts(change({ params: { verb: 'moved' }, count: 9 })).count).toBe(9)
    expect(
      documentChangedFacts(
        change({ params: { verb: 'moved' }, sample_documents: sample('A', 'B') }),
      ).count,
    ).toBe(2)
    expect(documentChangedFacts(change({ params: { verb: 'moved' } })).count).toBe(1)
    expect(
      documentChangedFacts(change({ params: { verb: 'moved', document_count: '0' } })).count,
    ).toBe(1)
  })

  it('skips blank titles and never lets more go negative', () => {
    const n = change({
      params: { verb: 'moved', document_count: '1' },
      sample_documents: sample('A', '  ', 'B'),
    })
    expect(documentChangedFacts(n)).toMatchObject({ titles: ['A', 'B'], more: 0 })
  })

  it('has no verb for one this client does not word', () => {
    expect(documentChangedFacts(change({ params: { verb: 'teleported' } })).verb).toBeNull()
    expect(documentChangedFacts(change({ params: {} })).verb).toBeNull()
  })
})

describe('documentChangedSentenceKey', () => {
  it.each(VERBS)('picks %s by shape: many, one, untitled', (verb) => {
    const params = { actor: 'Lan', verb, document_count: '4' }
    expect(documentChangedSentenceKey(change({ params }))).toBe(
      `wbNotif_document_changed_${verb}_many`,
    )
    expect(
      documentChangedSentenceKey(
        change({ params: { ...params, document_count: '1' }, sample_documents: sample('A') }),
      ),
    ).toBe(`wbNotif_document_changed_${verb}_one`)
    expect(documentChangedSentenceKey(change({ params: { ...params, document_count: '1' } }))).toBe(
      `wbNotif_document_changed_${verb}_untitled`,
    )
  })

  it('falls back to the generic sentences for an unknown verb', () => {
    const p = { actor: 'Lan', verb: 'teleported' }
    expect(documentChangedSentenceKey(change({ params: { ...p, document_count: '3' } }))).toBe(
      'wbNotif_document_changed',
    )
    expect(documentChangedSentenceKey(change({ params: p, sample_documents: sample('A') }))).toBe(
      'wbNotif_document_changed_generic_one',
    )
    expect(documentChangedSentenceKey(change({ params: p }))).toBe(
      'wbNotif_document_changed_generic_untitled',
    )
  })

  it('only returns keys the workbench dictionary defines', () => {
    const shapes = [
      { document_count: '3' },
      { document_count: '1', sample: true },
      { document_count: '1' },
    ]
    for (const verb of [...VERBS, 'unknown'])
      for (const s of shapes) {
        const n = change({
          params: { verb, document_count: s.document_count },
          sample_documents: s.sample ? sample('A') : undefined,
        })
        expect(Object.hasOwn(workbenchStrings.zh, documentChangedSentenceKey(n))).toBe(true)
      }
  })
})

describe('documentChangedTitleParams', () => {
  it('gives the actor, the first title and the count as strings', () => {
    const n = change({
      params: { actor: 'Lan', verb: 'moved', document_count: '5' },
      sample_documents: sample('A', 'B'),
    })
    expect(documentChangedTitleParams(n)).toMatchObject({ actor: 'Lan', document: 'A', count: '5' })
  })

  it('leaves the document empty when no title is readable (never an id)', () => {
    const p = documentChangedTitleParams(change({ params: { verb: 'moved' } }))
    expect(p.document).toBe('')
    expect(p.actor).toBe('')
  })
})

describe('page and list', () => {
  it('opens the list for several documents only', () => {
    expect(opensDocumentList(change({ params: { verb: 'moved', document_count: '2' } }))).toBe(true)
    expect(opensDocumentList(change())).toBe(false)
    expect(opensDocumentList(change({ kind: 'document_commented', count: 5 }))).toBe(false)
  })

  it('one document deleted or trashed has no page; several always open the list', () => {
    const one = (verb: string) => change({ params: { verb, document_count: '1' } })
    expect(documentChangedHasPage(one('renamed'))).toBe(true)
    expect(documentChangedHasPage(one('deleted'))).toBe(false)
    expect(documentChangedHasPage(one('trashed'))).toBe(false)
    expect(documentChangedHasPage(change({ ...one('renamed'), resource_deleted: true }))).toBe(
      false,
    )
    expect(
      documentChangedHasPage(change({ params: { verb: 'deleted', document_count: '3' } })),
    ).toBe(true)
  })
})

describe('noticeState', () => {
  it('reads the deleted and access-lost flags of any document kind', () => {
    expect(noticeState(change({ kind: 'document_commented' }))).toBe('open')
    expect(noticeState(change({ kind: 'document_commented', resource_deleted: true }))).toBe(
      'deleted',
    )
    expect(noticeState(change({ kind: 'document_mentioned', resource_access_lost: true }))).toBe(
      'no_access',
    )
    expect(noticeState(change({ kind: 'document_comment_resolved', resource_deleted: true }))).toBe(
      'deleted',
    )
  })

  it('treats deleted as the stronger state when both flags are set', () => {
    expect(noticeState(change({ resource_deleted: true, resource_access_lost: true }))).toBe(
      'deleted',
    )
  })
})
