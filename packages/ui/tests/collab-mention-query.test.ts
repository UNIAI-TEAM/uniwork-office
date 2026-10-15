import { describe, expect, it } from 'vitest'
import { buildMentionToken } from '../src/collab/body'
import {
  MENTION_DEBOUNCE_MS,
  MENTION_MAX_ROWS,
  findMentionTrigger,
  formatMentionNames,
  applyMentionEdit,
  insertMention,
  mentionDocFromBody,
  mentionDocToBody,
  pickMention,
} from '../src/collab/mention-query'
import { ULID_A } from './collab-composer-fixtures'

describe('constants', () => {
  it('debounces 150 ms and caps the picker at 20 rows', () => {
    expect(MENTION_DEBOUNCE_MS).toBe(150)
    expect(MENTION_MAX_ROWS).toBe(20)
  })
})

describe('findMentionTrigger', () => {
  it('opens on an @ at the very start', () => {
    expect(findMentionTrigger('@', 1)).toEqual({ start: 0, query: '' })
    expect(findMentionTrigger('@mi', 3)).toEqual({ start: 0, query: 'mi' })
  })

  it('opens on an @ at a word start (after a space or a newline)', () => {
    expect(findMentionTrigger('Nhờ @mi', 7)).toEqual({ start: 4, query: 'mi' })
    expect(findMentionTrigger('line\n@x', 7)).toEqual({ start: 5, query: 'x' })
  })

  it('does not open on an @ inside a word (email address)', () => {
    expect(findMentionTrigger('mail a@b', 8)).toBeNull()
    expect(findMentionTrigger('a@', 2)).toBeNull()
  })

  it('uses the text between the @ and the caret, not what follows the caret', () => {
    expect(findMentionTrigger('@minh anh', 3)).toEqual({ start: 0, query: 'mi' })
  })

  it('closes once whitespace sits between the @ and the caret', () => {
    expect(findMentionTrigger('@mi ', 4)).toBeNull()
    expect(findMentionTrigger('@mi\nx', 5)).toBeNull()
  })

  it('does not open when the caret is before the @', () => {
    expect(findMentionTrigger('hi @mi', 2)).toBeNull()
  })

  it('ignores the @ of an existing mention token (pasted or picked)', () => {
    const token = buildMentionToken(ULID_A, 'Nguyễn An')
    expect(findMentionTrigger(token, token.length)).toBeNull()
    expect(findMentionTrigger(`Xem ${token} `, token.length + 5)).toBeNull()
  })

  it('rejects a second @ inside the query', () => {
    expect(findMentionTrigger('@a@b', 4)).toBeNull()
  })
})

describe('insertMention', () => {
  const token = buildMentionToken(ULID_A, 'Minh Anh')

  it('replaces @query with the token and one space, caret after the space', () => {
    const text = 'Nhờ @mi'
    const trigger = findMentionTrigger(text, text.length)!
    const out = insertMention(text, trigger, text.length, token)
    expect(out.text).toBe(`Nhờ ${token} `)
    expect(out.caret).toBe(out.text.length)
  })

  it('keeps the text after the caret and lands the caret right after the inserted space', () => {
    const text = '@mi tail'
    const trigger = findMentionTrigger(text, 3)!
    const out = insertMention(text, trigger, 3, token)
    expect(out.text).toBe(`${token}  tail`)
    expect(out.caret).toBe(token.length + 1)
  })
})

describe('mention ranges (the composer shows @Name, the stored body keeps the token)', () => {
  const AN = '01J8X4USR0AAAAAAAAAAAAAAAA'
  const BODY_FIXTURE =
    'Xem lại [@Nguyễn \\[An\\]](mention://member/01J8X4USR0AAAAAAAAAAAAAAAA) giúp nhé:\n' +
    '**đậm**, *nghiêng*, `code [@x](mention://member/01J8X4USR0BBBBBBBBBBBBBBBB)`,\n' +
    '[liên kết](https://example.com/a?b=1&c=2)  \nxuống dòng — <b>không HTML</b> ✓'
  const tok = buildMentionToken(AN, 'Minh Anh')

  it('turns a body with a token into @Name plus a range map', () => {
    const doc = mentionDocFromBody(`Nhờ ${tok} xem`)
    expect(doc.text).toBe('Nhờ @Minh Anh xem')
    expect(doc.ranges).toEqual([{ start: 4, end: 13, id: AN, label: 'Minh Anh', raw: tok }])
    expect(mentionDocToBody(doc)).toBe(`Nhờ ${tok} xem`)
  })

  it('round-trips the shared body fixture byte-identical (a token inside code stays code)', () => {
    const doc = mentionDocFromBody(BODY_FIXTURE)
    expect(doc.text).toContain('@Nguyễn [An] giúp nhé')
    expect(doc.text).toContain('`code [@x](mention://member/01J8X4USR0BBBBBBBBBBBBBBBB)`')
    expect(doc.ranges).toHaveLength(1)
    expect(mentionDocToBody(doc)).toBe(BODY_FIXTURE)
  })

  it('a body without tokens has no ranges', () => {
    expect(mentionDocFromBody('plain @Name')).toEqual({ text: 'plain @Name', ranges: [] })
  })

  it('text typed before a mention shifts its range; text after leaves it', () => {
    const doc = mentionDocFromBody(`Hi ${tok}!`)
    const before = applyMentionEdit(doc, 'Oh hi @Minh Anh!').doc
    expect(before.ranges[0]).toMatchObject({ start: 6, end: 15 })
    expect(mentionDocToBody(before)).toBe(`Oh hi ${tok}!`)
    const after = applyMentionEdit(doc, 'Hi @Minh Anh!!!').doc
    expect(after.ranges[0]).toMatchObject({ start: 3, end: 12 })
  })

  it('typing inside a mention, or deleting part of it, drops it (the text stays)', () => {
    const doc = mentionDocFromBody(`Hi ${tok} `)
    expect(applyMentionEdit(doc, 'Hi @Minh Xnh ').doc.ranges).toEqual([])
    expect(applyMentionEdit(doc, 'Hi @Minh An ').doc.ranges).toEqual([])
    const gone = applyMentionEdit(doc, 'Hi @Minh Anh ')
    expect(gone.doc.ranges).toHaveLength(1)
    expect(mentionDocToBody(applyMentionEdit(doc, 'Hi @Minh An ').doc)).toBe('Hi @Minh An ')
  })

  it('an @ typed right before a chip keeps the chip (the caret anchors the ambiguous edit)', () => {
    const doc = mentionDocFromBody(`${tok} hi`)
    const out = applyMentionEdit(doc, '@@Minh Anh hi', 1)
    expect(out.doc.text).toBe('@@Minh Anh hi')
    expect(out.doc.ranges).toHaveLength(1)
    expect(out.doc.ranges[0]).toMatchObject({ start: 1, end: 10, id: AN })
    expect(mentionDocToBody(out.doc)).toBe(`@${tok} hi`)
    // mid-text, with something before the chip
    const mid = applyMentionEdit(mentionDocFromBody(`Hi ${tok} `), 'Hi @@Minh Anh ', 4)
    expect(mid.doc.ranges[0]).toMatchObject({ start: 4, end: 13 })
  })

  it('deleting a plain @ right before a chip keeps the chip', () => {
    const doc = mentionDocFromBody(`@${tok} hi`)
    const out = applyMentionEdit(doc, '@Minh Anh hi', 0)
    expect(out.doc.ranges[0]).toMatchObject({ start: 0, end: 9 })
    expect(mentionDocToBody(out.doc)).toBe(`${tok} hi`)
  })

  it('a plain letter typed right before or right after a chip keeps and shifts it', () => {
    const doc = mentionDocFromBody(`${tok} hi`)
    const before = applyMentionEdit(doc, 'x@Minh Anh hi', 1)
    expect(before.doc.ranges[0]).toMatchObject({ start: 1, end: 10 })
    expect(mentionDocToBody(before.doc)).toBe(`x${tok} hi`)
    const after = applyMentionEdit(doc, '@Minh Anhh hi', 10)
    expect(after.doc.ranges[0]).toMatchObject({ start: 0, end: 9 })
    expect(mentionDocToBody(after.doc)).toBe(`${tok}h hi`)
    // the same letters without a caret keep working as before
    expect(applyMentionEdit(doc, 'x@Minh Anh hi').doc.ranges[0]).toMatchObject({ start: 1 })
    expect(applyMentionEdit(doc, '@Minh Anhh hi').doc.ranges).toHaveLength(1)
  })

  it('a caret that does not describe the edit is ignored (edit inside a chip still drops it)', () => {
    const doc = mentionDocFromBody(`Hi ${tok} `)
    expect(applyMentionEdit(doc, 'Hi @Minh Xnh ', 99).doc.ranges).toEqual([])
    expect(applyMentionEdit(doc, 'Hi @Minh Xnh ', 8).doc.ranges).toEqual([])
    expect(applyMentionEdit(doc, 'Hi @Minh An ', 8).doc.ranges).toEqual([])
  })

  it('deleting the whole mention removes it; a space right after it is kept', () => {
    const doc = mentionDocFromBody(`${tok} x`)
    expect(applyMentionEdit(doc, ' x').doc.ranges).toEqual([])
    expect(applyMentionEdit(doc, '@Minh Anhx').doc.ranges).toHaveLength(1)
  })

  it('a pasted token becomes @Name + a range and reports the caret shift', () => {
    const doc = mentionDocFromBody('A  B')
    const out = applyMentionEdit(doc, `A ${tok} B`)
    expect(out.doc.text).toBe('A @Minh Anh B')
    expect(out.doc.ranges[0]).toMatchObject({ start: 2, end: 11, id: AN })
    const caretAtEnd = `A ${tok} B`.length
    expect(out.mapCaret(caretAtEnd)).toBe(out.doc.text.length)
  })

  it('an @Name typed by hand is plain text, never a range', () => {
    const out = applyMentionEdit(mentionDocFromBody(''), 'Hi @Minh Anh')
    expect(out.doc.ranges).toEqual([])
  })

  it('a stale range (its text no longer reads @label) is dropped', () => {
    const doc = mentionDocFromBody(tok)
    expect(applyMentionEdit(doc, '@Minh Anh').doc.ranges).toHaveLength(1)
    const broken = { text: 'xxxxxxxxx', ranges: doc.ranges }
    expect(applyMentionEdit(broken, 'xxxxxxxxx!').doc.ranges).toEqual([])
  })

  it('adds a picked mention as a range and shifts the ranges after it', () => {
    const doc = mentionDocFromBody(`@mi tail ${tok}`)
    const trig = findMentionTrigger(doc.text, 3)!
    const out = pickMention(doc, trig, 3, { id: AN, label: 'Minh Anh', raw: tok })
    expect(out.doc.text).toBe('@Minh Anh  tail @Minh Anh')
    expect(out.doc.ranges.map((r) => [r.start, r.end])).toEqual([
      [0, 9],
      [16, 25],
    ])
    expect(out.caret).toBe(10)
    expect(mentionDocToBody(out.doc)).toBe(`${tok}  tail ${tok}`)
  })

  it('preserves canView on picked mentions across edits, while pasted tokens omit them (G8-18)', () => {
    const base = mentionDocFromBody('@mi')
    const trig = findMentionTrigger(base.text, 3)!
    const picked = pickMention(base, trig, 3, {
      id: AN,
      label: 'Minh Anh',
      raw: tok,
      canView: false,
    })
    expect(picked.doc.ranges[0]).toMatchObject({
      id: AN,
      label: 'Minh Anh',
      canView: false,
    })
    const editedPrefix = applyMentionEdit(picked.doc, 'Nhờ @Minh Anh ').doc
    const edited = applyMentionEdit(editedPrefix, 'Nhờ @Minh Anh xem').doc
    expect(edited.ranges[0]).toMatchObject({
      start: 4,
      end: 13,
      canView: false,
    })
    const fromBody = mentionDocFromBody(`Nhờ ${tok} xem`)
    expect(fromBody.ranges[0]?.canView).toBeUndefined()
    // per-person can_share is a post-send fact: a range never carries it (F5)
    expect(picked.doc.ranges[0]).not.toHaveProperty('canShare')
  })
})

describe('formatMentionNames (G8-18 Intl.ListFormat)', () => {
  it('lists 1, 2, and 3+ names in full without truncation', () => {
    expect(formatMentionNames(['Nguyễn An'], 'vi')).toBe('Nguyễn An')
    expect(formatMentionNames(['Nguyễn An', 'Trần Bình'], 'en')).toBe('Nguyễn An and Trần Bình')
    const threeVi = formatMentionNames(['Nguyễn An', 'Trần Bình', 'Lê Cường'], 'vi')
    expect(threeVi).toContain('Nguyễn An')
    expect(threeVi).toContain('Trần Bình')
    expect(threeVi).toContain('Lê Cường')
  })
})
