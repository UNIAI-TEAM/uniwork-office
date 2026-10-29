/**
 * The fragment suggester's main-side half: what a note offers behind `[[Note#`
 * is read from the file — headings, fenced code, the frontmatter block and the
 * lone-marker layout the resolver and the id writer already agree on.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_HEAD_ENTRIES_PER_KIND, parseWikiHeads, wikiHeads } from '../src/main/wiki-heads'

describe('parseWikiHeads', () => {
  it('a full note: frontmatter skipped, headings, code skipped, trailing and lone markers', () => {
    const raw = [
      '---',
      'tags: [x]',
      '# not a heading',
      '---',
      '',
      '# Setup',
      '',
      'Body paragraph. ^body-1',
      '',
      '```js',
      '// code ^not-an-id',
      'const x = 1',
      '```',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '^table-1',
      '',
      '## Second ^sec-1',
      '',
      'Tail.',
    ].join('\n')
    expect(parseWikiHeads(raw)).toEqual([
      { kind: 'heading', text: 'Setup', level: 1 },
      { kind: 'block', id: 'body-1', text: 'Body paragraph.' },
      { kind: 'block', id: 'table-1', text: '| 1 | 2 |' },
      { kind: 'heading', text: 'Second', level: 2 },
      { kind: 'block', id: 'sec-1', text: '## Second' },
    ])
  })

  it('a lone marker after a heading borrows the heading line as its context', () => {
    const raw = '# Rules\n\n^rules\n\nBody.'
    expect(parseWikiHeads(raw)).toEqual([
      { kind: 'heading', text: 'Rules', level: 1 },
      { kind: 'block', id: 'rules', text: '# Rules' },
    ])
  })

  it('an empty or absent note parses to nothing', () => {
    expect(parseWikiHeads('')).toEqual([])
    expect(parseWikiHeads('plain text only\n')).toEqual([])
  })

  it('closes a fence only on the same character, so ~~~ does not close ```', () => {
    const raw = '```\n~~~\n# inside\n```\n\n# Outside'
    expect(parseWikiHeads(raw)).toEqual([{ kind: 'heading', text: 'Outside', level: 1 }])
  })

  it('a closing-bracket hash run is trimmed off the heading text', () => {
    expect(parseWikiHeads('### Title ###\n')).toEqual([
      { kind: 'heading', text: 'Title', level: 3 },
    ])
  })

  it('caps headings and blocks independently at MAX_HEAD_ENTRIES_PER_KIND', () => {
    const lines: string[] = []
    for (let i = 0; i < MAX_HEAD_ENTRIES_PER_KIND + 20; i++) {
      lines.push(`# Head ${i} ^blk-${i}`)
    }
    const parsed = parseWikiHeads(lines.join('\n'))
    expect(parsed.filter((e) => e.kind === 'heading')).toHaveLength(MAX_HEAD_ENTRIES_PER_KIND)
    expect(parsed.filter((e) => e.kind === 'block')).toHaveLength(MAX_HEAD_ENTRIES_PER_KIND)
  })
})

describe('wikiHeads', () => {
  it('reads only notes the resolver finds inside the allowed roots and refuses non-notes or escapes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wikiheads-'))
    try {
      const vault = join(dir, 'vault')
      mkdirSync(join(vault, 'sub'), { recursive: true })
      writeFileSync(join(vault, 'Alpha.md'), '# Alpha Head\n\nBody ^b1\n')
      writeFileSync(join(vault, 'Figure.png'), '# Not a note\n')
      writeFileSync(join(dir, 'outside.md'), '# Secret\n')
      const doc = join(vault, 'sub', 'doc.md')
      writeFileSync(doc, '# Doc\n')

      expect(await wikiHeads('Alpha', doc, vault)).toEqual([
        { kind: 'heading', text: 'Alpha Head', level: 1 },
        { kind: 'block', id: 'b1', text: 'Body' },
      ])
      expect(await wikiHeads('../../outside', doc, vault)).toEqual([])
      expect(await wikiHeads('/etc/passwd', doc, vault)).toEqual([])
      expect(await wikiHeads('Figure.png', doc, vault)).toEqual([])
      expect(await wikiHeads('', doc, vault)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
