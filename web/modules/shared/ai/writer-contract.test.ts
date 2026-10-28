// The format contract of the UniWork AI writer route (UNI-2276): writer-contract.json is a byte copy
// of the UniWork server's server/internal/ai/testdata/office_writer_contract.json. The server tests
// that its prompts ask for these strings; here the fork's own constants and parsers must accept
// what the prompts ask for.
//
// It reads the editors' renderer sources (their own workspaces typecheck them, with the window
// APIs and editor command types this program does not load), so web/modules/tsconfig.json leaves
// this file out; vitest runs it with the rest of web/modules.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { WriterCall } from '@genoffice/agent-core'
import { SHAPE_KINDS, parsePageSpec } from '../../../../packages/pipelines/src/slides/page-spec'
import {
  buildDocWriterRequest,
  extractFragment,
} from '../../../../apps/docs/src/renderer/ai/doc-writer'
import { HTML_RULES, parseHtmlFragment } from '../../../../apps/docs/src/renderer/ai/protocol'
import { extractMarkdown } from '../../../../apps/markdown/src/renderer/ai/doc-writer'
import { extractPageHtml } from '../../../../apps/html/src/renderer/ai/page-writer'
import {
  extractBriefJson,
  parseBriefJson,
} from '../../../../apps/html/src/renderer/ai/brief-writer'
import { parseOutlineJson } from '../../../../apps/slides/src/renderer/ai/outline-json'

interface ContractEntry {
  output: string
  must_contain: string[]
}
const CONTRACT = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'writer-contract.json'), 'utf8'),
) as Record<WriterCall['kind'], ContractEntry>

/** one reply per kind in the format the server's prompt asks for */
const SAMPLES: Record<WriterCall['kind'], string> = {
  'docs.write_document':
    '<h1>Report</h1>\n<p>Revenue rose <formula>x^2</formula>.</p>\n<table><tr><th>A</th></tr><tr><td>1</td></tr></table>',
  'markdown.write_document': '# Report\n\nRevenue rose.\n\n| A |\n| - |\n| 1 |',
  'html.page':
    '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>T</title><style>:root{}</style></head><body><section data-section="hero"><h1>T</h1></section></body></html>',
  'html.brief':
    '{"core_hook":"Costs fell 20%","style":{"name":"Bold"},"alternatives":[],"sections":[{"title":"Hero"}],"meta":{"title":"T"},"context":"facts"}',
  'slides.deck_style':
    'Color rules (must use concrete hex values)\n  Main background: #101820\nFonts\n  Body font: Inter',
  'slides.deck_outline':
    '{"core_hook":"3x faster","pages":[{"title":"Cover","type":"cover","brief":"b","layout":"cover_dark_minimal","image_queries":[]}]}',
  'slides.page':
    '{"background":"#101820","elements":[{"type":"shape","shape":"roundRect","x":80,"y":120,"w":360,"h":200,"fill":"#FFFFFF"},{"type":"text","x":80,"y":60,"w":800,"h":90,"paragraphs":[{"runs":[{"text":"Revenue","sizePt":32}]}]}]}',
}

describe('writer-contract.json (byte copy of the UniWork server file)', () => {
  it('names the seven kinds of the writer route', () => {
    expect(Object.keys(CONTRACT).sort()).toEqual(Object.keys(SAMPLES).sort())
  })

  it('slides.page: the shape names are exactly the page spec whitelist', () => {
    const shapes = CONTRACT['slides.page'].must_contain.filter(
      (s) => !['1280x720', '"background"', '"elements"'].includes(s),
    )
    expect(new Set(shapes)).toEqual(SHAPE_KINDS)
  })

  it('docs.write_document: the tag list and formula rule are HTML_RULES, all of it the docs writer prompt', () => {
    const [tags, formula] = CONTRACT['docs.write_document'].must_contain
    expect(HTML_RULES).toContain(tags)
    expect(HTML_RULES).toContain(formula)
    const { system } = buildDocWriterRequest({ plan: 'p', instruction: '' }, '')
    for (const s of CONTRACT['docs.write_document'].must_contain) expect(system).toContain(s)
  })

  it('a reply in each kind format passes the fork parser of that kind', () => {
    const numIds = { bullet: '1', ordered: '2' }
    const docs = parseHtmlFragment(extractFragment(SAMPLES['docs.write_document']), numIds)
    expect(docs.length).toBeGreaterThanOrEqual(3)
    expect(extractMarkdown(SAMPLES['markdown.write_document'])).toContain('# Report')
    expect(extractPageHtml(SAMPLES['html.page'])).toMatchObject({ complete: true })
    const brief = extractBriefJson(SAMPLES['html.brief'])
    expect(brief.complete).toBe(true)
    expect(Object.keys(parseBriefJson(brief.text) ?? {})).toEqual(
      CONTRACT['html.brief'].must_contain,
    )
    expect(SAMPLES['slides.deck_style'].trim()).not.toBe('')
    const outline = parseOutlineJson(SAMPLES['slides.deck_outline'])
    expect(outline?.core_hook).toBe('3x faster')
    expect(Array.isArray(outline?.pages)).toBe(true)
    const page = parsePageSpec(SAMPLES['slides.page'])
    expect(page.ok).toBe(true)
    if (page.ok) expect(page.spec.elements).toHaveLength(2)
  })
})
