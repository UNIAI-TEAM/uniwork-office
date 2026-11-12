import { describe, expect, it } from 'vitest'
import type { WorkNotification } from '../src/shared/uniwork-work-api'
import {
  documentChangedFacts,
  documentChangedHasPage,
  opensVersionHistory,
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
      viaClient: '',
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

// UNI-2501 B7 (the web's document-changed-kind.test.tsx cases): a save through an AI client names the client
// and opens the version history.
describe('version_created via an AI client (B7)', () => {
  const via = (params: Record<string, string> = {}, over: Partial<WorkNotification> = {}) =>
    change({
      ...over,
      params: {
        actor: 'An',
        verb: 'version_created',
        document_count: '1',
        via_client: 'ChatGPT',
        ...params,
      },
    })
  const withTitle = (n: WorkNotification) => ({ ...n, sample_documents: sample('Kế hoạch Q4') })
  const say = (lang: 'vi' | 'en', n: WorkNotification) => {
    const table = workbenchStrings[lang] as Record<string, string>
    const params = documentChangedTitleParams(n)
    return table[documentChangedSentenceKey(n)]!.replace(
      /\{(\w+)\}/g,
      (_, k: string) => params[k] ?? '',
    )
  }

  it('says who updated which file through which client, in vi and en', () => {
    expect(say('vi', withTitle(via()))).toBe('An đã cập nhật file "Kế hoạch Q4" qua ChatGPT')
    expect(say('en', withTitle(via()))).toBe('An updated the file "Kế hoạch Q4" via ChatGPT')
  })

  it('trims the client', () => {
    expect(documentChangedFacts(via({ via_client: '  Claude ' })).viaClient).toBe('Claude')
  })

  it('keeps the existing sentence without via_client, or with a blank one', () => {
    for (const via_client of ['', '   ']) {
      expect(say('vi', withTitle(via({ via_client })))).toBe(
        'An đã tạo phiên bản mới cho tài liệu “Kế hoạch Q4”',
      )
    }
    const plain = withTitle(change({ params: { actor: 'An', verb: 'version_created' } }))
    expect(documentChangedSentenceKey(plain)).toBe('wbNotif_document_changed_version_created_one')
    expect(say('en', plain)).toBe('An added a new version to “Kế hoạch Q4”')
  })

  it('keeps the existing sentence for several documents, an unreadable title, and any other verb', () => {
    expect(documentChangedSentenceKey(via({ document_count: '5' }))).toBe(
      'wbNotif_document_changed_version_created_many',
    )
    expect(documentChangedSentenceKey(via())).toBe(
      'wbNotif_document_changed_version_created_untitled',
    )
    expect(documentChangedSentenceKey(withTitle(via({ verb: 'renamed' })))).toBe(
      'wbNotif_document_changed_renamed_one',
    )
  })

  it('opens the version history only for one file saved through a client', () => {
    expect(opensVersionHistory(via())).toBe(true)
    expect(opensVersionHistory(via({ via_client: '  ' }))).toBe(false)
    expect(opensVersionHistory(change({ params: { verb: 'version_created' } }))).toBe(false)
    expect(opensVersionHistory(via({ verb: 'renamed' }))).toBe(false)
    expect(opensVersionHistory(via({ document_count: '4' }))).toBe(false)
    expect(opensVersionHistory(via({}, { resource_deleted: true }))).toBe(false)
    expect(opensVersionHistory(via({}, { kind: 'document_commented' }))).toBe(false)
  })

  it.each(Object.keys(workbenchStrings) as (keyof typeof workbenchStrings)[])(
    'locale %s words the via-client sentence with the actor, the document and the client',
    (lang) => {
      const text = (workbenchStrings[lang] as Record<string, string>)[
        'wbNotif_document_changed_version_created_via_one'
      ]
      expect(text).toContain('{actor}')
      expect(text).toContain('{document}')
      expect(text).toContain('{client}')
    },
  )
})
