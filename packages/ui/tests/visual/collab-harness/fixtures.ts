import type {
  CollabAnchor,
  CollabComment,
  CollabMention,
  CollabRevision,
} from '@genoffice/ui/collab'

export const ME = 'me'

/** member ids are 26-char ULIDs on the wire; the mention token only parses with one */
export const ulid = (s: string): string => ('01J8X4' + s).padEnd(26, '0').slice(0, 26).toUpperCase()
export const MINH = ulid('MINH')
export const MAI = ulid('MAI')
export const GONE = ulid('GONE')

let n = 0
/** a comment with a growing timestamp so the list keeps the order it is written in */
export function cm(over: Partial<CollabComment> & { id: string }): CollabComment {
  n += 1
  const at = `2026-10-12T${String(8 + Math.floor(n / 6)).padStart(2, '0')}:${String((n * 7) % 60).padStart(2, '0')}:00Z`
  return {
    document_id: 'harness',
    author_id: MAI,
    parent_id: null,
    body: `Comment ${over.id}`,
    kind: 'comment',
    revision: 1,
    anchor: null,
    created_at: at,
    updated_at: at,
    display_name: 'Mai Nguyen',
    ...over,
  }
}

export const docx = (quote: string): CollabAnchor => ({ format: 'docx', v: 1, quote })
export const xlsx = (sheet: string, range: string): CollabAnchor => ({
  format: 'xlsx',
  v: 1,
  sheet,
  range,
})
export const pptx = (slide_index: number): CollabAnchor => ({ format: 'pptx', v: 1, slide_index })
export const pdf = (page: number): CollabAnchor => ({ format: 'pdf', v: 1, page })

export const LONG_QUOTE =
  'The committee will review the revised budget at the end of the quarter and report any variance above five percent to the board before the next planning cycle begins.'

/** a body with a mention token + the Markdown subset the body renderer knows */
export const BODY_FIXTURE =
  'Thanks ' +
  `[@Minh Anh Tran](mention://member/${MINH}), I **agree** with the *new* wording.\n\n` +
  'One open point: see `Section 4.2` and the [style guide](https://example.com/style).\n' +
  `Could [@Former Member](mention://member/${GONE}) have a look too?`

export const MENTIONS: CollabMention[] = [
  { user_id: MINH, display_name: 'Minh Anh Tran', state: 'ok' },
  { user_id: GONE, state: 'unavailable' },
]

const mine = { author_id: ME, display_name: 'You' }
const minh = { author_id: MINH, display_name: 'Minh Anh Tran' }

/** the located / stale / lost trio for one format (stale = the editor cannot find it; lost = the server says so) */
export function anchorTrio(
  make: (i: number) => CollabAnchor,
  exactBody: string,
): { comments: CollabComment[]; stale: CollabAnchor[] } {
  const exact = make(1)
  const stale = make(2)
  const lost = make(3)
  return {
    comments: [
      cm({ id: 'a-exact', anchor: exact, body: exactBody }),
      cm({
        id: 'a-stale',
        anchor: stale,
        body: 'The editor can no longer find this spot.',
        ...minh,
      }),
      cm({
        id: 'a-lost',
        anchor: lost,
        anchor_state: 'lost',
        body: 'The text this was attached to has been deleted.',
        ...mine,
      }),
    ],
    stale: [stale],
  }
}

export const THREAD_WITH_REPLIES: CollabComment[] = (() => {
  const root = cm({
    id: 'r1',
    anchor: docx('Net revenue grew 12% year over year'),
    body: BODY_FIXTURE,
    ...minh,
  })
  return [
    root,
    cm({
      id: 'r2',
      parent_id: 'r1',
      body: 'Agreed, I will update the **figures** tonight.',
      ...mine,
    }),
    cm({ id: 'r3', parent_id: 'r1', body: 'Please also check the footnote.' }),
    cm({
      id: 'r4',
      parent_id: 'r1',
      body: 'Edited: footnote checked.',
      revision: 2,
      updated_at: '2026-10-12T16:30:00Z',
      ...mine,
    }),
  ]
})()

export const TOMBSTONES: CollabComment[] = [
  cm({
    id: 'g1',
    anchor: docx('Appendix B'),
    body: '',
    deleted_at: '2026-10-12T09:00:00Z',
    author_id: null,
  }),
  cm({ id: 'g2', anchor: docx('Appendix C'), body: 'A thread whose reply was deleted.', ...minh }),
  cm({ id: 'g3', parent_id: 'g2', body: '', deleted_at: '2026-10-12T10:00:00Z' }),
  cm({ id: 'g4', parent_id: 'g2', body: 'This reply is still here.', ...mine }),
]

export const RESOLVED: CollabComment[] = [
  cm({
    id: 'x1',
    anchor: docx('Executive summary'),
    body: 'Still open: tighten the intro.',
    ...minh,
  }),
  cm({
    id: 'x2',
    anchor: docx('Risk register'),
    body: 'Fixed in the latest draft.',
    resolved_at: '2026-10-12T11:00:00Z',
    ...mine,
  }),
  cm({ id: 'x3', parent_id: 'x2', body: 'Thanks, closing this.' }),
  cm({
    id: 'x4',
    anchor: docx('Glossary'),
    body: 'Typo in the second term.',
    resolved_at: '2026-10-12T11:30:00Z',
  }),
]

export const DISCUSSION: CollabComment[] = [
  cm({ id: 'd1', kind: 'discussion', body: 'Kick-off notes are in the shared folder.', ...minh }),
  cm({ id: 'd2', kind: 'discussion', body: BODY_FIXTURE, ...mine }),
  cm({ id: 'd3', kind: 'discussion', parent_id: 'd2', body: 'Looks good to me.' }),
  cm({
    id: 'd4',
    kind: 'discussion',
    body: '',
    deleted_at: '2026-10-12T12:30:00Z',
    author_id: null,
  }),
]

export const REVISIONS: CollabRevision[] = [
  {
    id: 'rev3',
    revision: 3,
    body: 'Agreed, I will update the **figures** tonight.',
    created_by_id: ME,
    created_at: '2026-10-12T15:00:00Z',
  },
  {
    id: 'rev2',
    revision: 2,
    body: 'Agreed, I will update the figures.',
    created_by_id: ME,
    created_at: '2026-10-12T14:00:00Z',
  },
  {
    id: 'rev1',
    revision: 1,
    body: 'Will update.',
    created_by_id: ME,
    created_at: '2026-10-12T13:00:00Z',
  },
]

/** the single comment the edit / history / delete sections act on (own, so every action shows) */
export const OWN_ONE: CollabComment[] = [
  cm({
    id: 'o1',
    anchor: docx('Net revenue grew 12% year over year'),
    body: 'Agreed, I will update the **figures** tonight.',
    revision: 3,
    updated_at: '2026-10-12T15:00:00Z',
    ...mine,
  }),
]
