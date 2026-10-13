/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMentionToken, parseBody, serialize } from '../src/collab/body'
import { CollabBody } from '../src/collab/CollabBody'
import type { CollabMention } from '../src/collab/types'

/** the shared body fixture (copy of web/docs/protocol/test/comments.test.ts): a mention token + every Markdown-subset part */
const BODY_FIXTURE =
  'Xem lại [@Nguyễn \\[An\\]](mention://member/01J8X4USR0AAAAAAAAAAAAAAAA) giúp nhé:\n' +
  '**đậm**, *nghiêng*, `code [@x](mention://member/01J8X4USR0BBBBBBBBBBBBBBBB)`,\n' +
  '[liên kết](https://example.com/a?b=1&c=2)  \nxuống dòng — <b>không HTML</b> ✓'

const AN = '01J8X4USR0AAAAAAAAAAAAAAAA'
const MENTIONS: CollabMention[] = [{ user_id: AN, display_name: 'Nguyễn An', state: 'ok' }]

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

function render(body: string, mentions: CollabMention[] = MENTIONS): HTMLElement {
  act(() => root.render(createElement(CollabBody, { body, mentions })))
  return host.firstElementChild as HTMLElement
}

describe('parseBody / serialize', () => {
  it('round-trips the shared fixture byte-identical', () => {
    expect(serialize(parseBody(BODY_FIXTURE))).toBe(BODY_FIXTURE)
  })

  it('round-trips awkward input byte-identical', () => {
    const samples = [
      '',
      '\n\n',
      'a\r\nb\r\n\r\nc',
      '  lead and trail  ',
      '**unclosed and *also unclosed and `tick',
      '``double`` and ***triple***',
      '[x](javascript:alert(1)) [y](data:text/html,<b>) [@z](mention://member/short)',
      'a\n \t \nb\n\n\n\nc',
      '\\[escaped\\] \\* \\`',
      '[@a\\](mention://member/01J8X4USR0AAAAAAAAAAAAAAAA)',
      '😀 *é* **ü** `ß`',
    ]
    for (const s of samples) expect(serialize(parseBody(s))).toBe(s)
  })

  it('stays linear on a maximum-size body of unclosed markup', () => {
    for (const unit of ['*a ', '**a ', '[a ', '`a ', '[@a](mention://member/', ' ', '\\']) {
      const big = unit.repeat(Math.ceil(1_048_576 / unit.length))
      const t0 = performance.now()
      expect(serialize(parseBody(big))).toBe(big)
      expect(performance.now() - t0).toBeLessThan(2000)
    }
  })

  it('recognises every subset part', () => {
    const types = parseBody(BODY_FIXTURE)
      .map((t) => t.type)
      .filter((t, i, all) => all.indexOf(t) === i)
    expect(types).toEqual(
      expect.arrayContaining(['text', 'mention', 'bold', 'italic', 'code', 'link', 'break']),
    )
  })

  it('unescapes the mention label and normalises the id', () => {
    const [, mention] = parseBody('x [@Ann \\[B\\]](mention://member/01j8x4usr0aaaaaaaaaaaaaaaa)')
    expect(mention).toMatchObject({ type: 'mention', label: 'Ann [B]', userId: AN })
  })

  it('keeps a mention token inside inline code verbatim', () => {
    const tokens = parseBody('`[@x](mention://member/01J8X4USR0BBBBBBBBBBBBBBBB)`')
    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toMatchObject({ type: 'code' })
  })

  it('splits paragraphs on a blank line and breaks on a single newline', () => {
    const types = parseBody('a\nb\n\nc').map((t) => t.type)
    expect(types).toEqual(['text', 'break', 'text', 'paragraph', 'text'])
  })

  it('only accepts http(s) links', () => {
    const ok = parseBody('[a](http://x.test/p) [b](https://x.test/p)').filter(
      (t) => t.type === 'link',
    )
    expect(ok).toHaveLength(2)
    for (const bad of [
      '[a](javascript:alert(1))',
      '[a](data:text/html,hi)',
      '[a](ftp://x.test)',
      '[a](mailto:me@x.test)',
      '[a](//x.test)',
      '[a](https://)',
    ]) {
      expect(parseBody(bad).some((t) => t.type === 'link')).toBe(false)
    }
  })
})

describe('buildMentionToken', () => {
  it('builds the contracted token', () => {
    expect(buildMentionToken(AN, 'Nguyễn An')).toBe(`[@Nguyễn An](mention://member/${AN})`)
  })

  it('escapes brackets, parentheses and backslashes in the label', () => {
    expect(buildMentionToken(AN, 'A [b] (c)')).toBe(`[@A \\[b\\] \\(c\\)](mention://member/${AN})`)
    expect(buildMentionToken(AN, 'x\\')).toBe(`[@x\\\\](mention://member/${AN})`)
  })

  it('stays a single token the parser reads back with the original label', () => {
    for (const label of ['A [b] (c)', 'x\\', ']](', 'two\nlines']) {
      const tokens = parseBody(buildMentionToken(AN, label))
      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toMatchObject({
        type: 'mention',
        userId: AN,
        label: label.replace(/[\r\n]+/g, ' '),
      })
    }
  })
})

describe('CollabBody', () => {
  it('renders the fixture: paragraphs, breaks, bold, italic, code, link', () => {
    const el = render(BODY_FIXTURE)
    expect(el.querySelectorAll('br').length).toBeGreaterThanOrEqual(3)
    expect(el.querySelector('strong')?.textContent).toBe('đậm')
    expect(el.querySelector('em')?.textContent).toBe('nghiêng')
    expect(el.querySelector('code')?.textContent).toBe(
      'code [@x](mention://member/01J8X4USR0BBBBBBBBBBBBBBBB)',
    )
    const a = el.querySelector('a') as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe('https://example.com/a?b=1&c=2')
    expect(a.textContent).toBe('liên kết')
  })

  it('renders blank-line separated paragraphs as separate blocks', () => {
    const el = render('one\n\ntwo\n\n\n\nthree')
    expect([...el.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['one', 'two', 'three'])
  })

  it('opens links externally without an opener', () => {
    const a = render('[x](https://example.com)').querySelector('a') as HTMLAnchorElement
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('renders javascript:, data: and other schemes as text', () => {
    const body = '[a](javascript:alert(1)) [b](data:text/html,x) [c](ftp://x.test)'
    const el = render(body)
    expect(el.querySelector('a')).toBeNull()
    expect(el.textContent).toBe(body)
  })

  it('never emits raw HTML', () => {
    const body = '<script>alert(1)</script> <img src=x onerror=alert(1)> <b>bold</b>'
    const el = render(body)
    expect(el.querySelector('script, img, b')).toBeNull()
    expect(el.textContent).toBe(body)
  })

  it('renders unknown Markdown verbatim', () => {
    const body = '# heading\n- item\n> quote\n__u__ ~~s~~ ![i](https://x.test/i.png) ```fence```'
    const el = render(body)
    expect(el.querySelector('h1, ul, li, blockquote, img, del, u')).toBeNull()
    expect(el.textContent).toBe(body.replace(/\n/g, ''))
  })

  it('lets long words wrap through a CSS class on the root', () => {
    const el = render('x'.repeat(400))
    expect(el.classList.contains('collab-body')).toBe(true)
    expect(el.textContent).toHaveLength(400)
  })

  it('shows the CURRENT name for a mention by user id, not the token label', () => {
    const chip = render(BODY_FIXTURE).querySelector('.collab-mention') as HTMLElement
    expect(chip.textContent).toBe('@Nguyễn An')
    expect(chip.getAttribute('data-user-id')).toBe(AN)
    expect(chip.closest('a')).toBeNull()
  })

  it('matches the mention id case-insensitively', () => {
    const el = render('[@old](mention://member/01j8x4usr0aaaaaaaaaaaaaaaa)')
    expect(el.querySelector('.collab-mention')?.textContent).toBe('@Nguyễn An')
  })

  it('falls back to the token label, without a link, for an unavailable mention', () => {
    const el = render(BODY_FIXTURE, [
      { user_id: AN, display_name: 'Nguyễn An', state: 'unavailable' },
    ])
    const chip = el.querySelector('.collab-mention-unavailable') as HTMLElement
    expect(chip.textContent).toBe('@Nguyễn [An]')
    expect(el.querySelector('a[href^="mention:"], .collab-mention[data-user-id]')).toBeNull()
  })

  it('falls back to the token label when the id is missing from the mentions table', () => {
    const el = render(BODY_FIXTURE, [])
    expect(el.querySelector('.collab-mention-unavailable')?.textContent).toBe('@Nguyễn [An]')
    expect(el.querySelector('a')?.getAttribute('href')).toBe('https://example.com/a?b=1&c=2')
  })

  it('falls back to the token label when an ok mention has no display name', () => {
    const el = render(BODY_FIXTURE, [{ user_id: AN, state: 'ok' }])
    expect(el.querySelector('.collab-mention')?.textContent).toBe('@Nguyễn [An]')
  })

  it('renders an empty body as an empty block', () => {
    expect(render('').textContent).toBe('')
  })
})
