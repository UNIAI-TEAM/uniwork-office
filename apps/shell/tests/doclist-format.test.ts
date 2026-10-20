import { describe, expect, it } from 'vitest'
import {
  activityKey,
  EMPTY_CELL,
  formatBytes,
  formatDaysLeft,
  formatListDate,
  formatShareWith,
} from '../src/renderer/src/doclist/format'
import { docListText } from '../src/renderer/src/doclist/text'

// the shared vectors (doclist-vectors.test.ts) pin the strings; these are the
// behaviours around them: locale spelling, the translated "yesterday" word,
// unusual inputs

const NOW = new Date('2099-03-18T09:05:00')

describe('formatListDate', () => {
  it('uses the app locales: vi-VN is Vietnamese, en-US and every other language read as en', () => {
    const at = '2099-03-10T12:00:00'
    expect(formatListDate(at, NOW, 'vi-VN')).toBe('10/03')
    expect(formatListDate(at, NOW, 'en-US')).toBe('Mar 10')
    expect(formatListDate(at, NOW, 'de-DE')).toBe('Mar 10')
    expect(formatListDate(at, NOW, 'zh-CN')).toBe('Mar 10')
  })

  it('takes the "yesterday" word from the caller when it passes its own t', () => {
    const t = (() => 'Gestern') as ReturnType<typeof docListText>
    expect(formatListDate('2099-03-17T16:30:00', NOW, 'de-DE', t)).toBe('Gestern, 16:30')
  })

  it('accepts a Date and an epoch number', () => {
    expect(formatListDate(new Date('2099-03-18T07:03:00'), NOW, 'en')).toBe('07:03')
    expect(formatListDate(new Date('2099-03-18T07:03:00').getTime(), NOW, 'en')).toBe('07:03')
  })

  it('reads an invalid Date and NaN as the empty cell', () => {
    expect(formatListDate(new Date('nope'), NOW, 'en')).toBe(EMPTY_CELL)
    expect(formatListDate(Number.NaN, NOW, 'en')).toBe(EMPTY_CELL)
  })
})

describe('formatBytes', () => {
  it('uses the decimal mark of the locale', () => {
    expect(formatBytes(2970, 'vi-VN')).toBe('2,9 KB')
    expect(formatBytes(2970, 'en-US')).toBe('2.9 KB')
  })

  it('never shows a size for NaN, Infinity or nothing', () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, undefined, null]) {
      expect(formatBytes(v, 'en')).toBe(EMPTY_CELL)
    }
  })

  it('stops at GB', () => {
    expect(formatBytes(3 * 1024 ** 4, 'en')).toMatch(/GB$/)
  })
})

describe('formatDaysLeft', () => {
  it('is null without a usable date, so a caller hides the part', () => {
    expect(formatDaysLeft(null, NOW, docListText('en'))).toBeNull()
    expect(formatDaysLeft('x', NOW, docListText('en'))).toBeNull()
  })
})

describe('formatShareWith', () => {
  const en = docListText('en')
  const vi = docListText('vi')

  it('joins the non-zero parts with a middle dot', () => {
    expect(formatShareWith({ people: 3, workspaces: 1, links: 1 }, en)).toBe(
      '3 people · 1 workspace · 1 link',
    )
    expect(formatShareWith({ people: 3, workspaces: 1, links: 1 }, vi)).toBe(
      '3 người · 1 workspace · 1 link',
    )
  })

  it('drops the parts that are zero or missing', () => {
    expect(formatShareWith({ people: 1, workspaces: 0, links: 2 }, en)).toBe('1 person · 2 links')
    expect(formatShareWith({ workspaces: 2 }, en)).toBe('2 workspaces')
  })

  it('reads as the empty cell when nothing is shared', () => {
    expect(formatShareWith({ people: 0, workspaces: 0, links: 0 }, en)).toBe(EMPTY_CELL)
    expect(formatShareWith(null, en)).toBe(EMPTY_CELL)
  })

  it('ignores negative or fractional counts a server should never send', () => {
    expect(formatShareWith({ people: -2, links: 1.5 }, en)).toBe(EMPTY_CELL)
  })
})

describe('activityKey', () => {
  it('names the copy of each activity kind and nothing for an unknown one', () => {
    expect(docListText('en')(activityKey('edited')!)).toBe('You edited')
    expect(docListText('en')(activityKey('opened')!)).toBe('You opened')
    expect(docListText('vi')(activityKey('commented')!)).toBe('Bạn đã bình luận')
    expect(activityKey('deleted')).toBeNull()
  })
})
