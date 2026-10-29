// The panel's in-tool generators (per-page, style skill, planning) call aiStream directly, not
// through the agent loop. With UniWork AI picked, the desktop runner refuses a request marked as
// a one-shot (it is not a conversation turn), so every such request has to carry the mark.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import type { RenderSlide } from '@genoffice/pptx-render'
import {
  deckOutlineWriter,
  deckStyleWriter,
  oneShotStreamRequest,
  slidePageWriter,
  writerRefusalIsFinal,
} from '../src/renderer/ai/llm-request'
import {
  DEFAULT_DECK_STYLE,
  createSlidesSkill,
  type DeckAccess,
} from '../src/renderer/ai/slides-skill'
import type { AiSettings } from '../src/shared/ipc'

const settings = { provider: 'uniwork', providers: {} } as unknown as AiSettings

describe('Slides one-shot stream request', () => {
  it('is marked as a one-shot so UniWork AI refuses it', () => {
    const req = oneShotStreamRequest({ requestId: 'r1', settings, system: 'sys', user: 'page 3' })
    expect(req.purpose).toBe('one-shot')
    expect(req.system).toBe('sys')
    expect(req.messages).toEqual([{ role: 'user', text: 'page 3' }])
    expect(req).not.toHaveProperty('maxTokens')
  })

  it('keeps the output cap when given', () => {
    const req = oneShotStreamRequest({
      requestId: 'r2',
      settings,
      system: 's',
      user: 'u',
      maxTokens: 4096,
    })
    expect(req).toMatchObject({ purpose: 'one-shot', maxTokens: 4096 })
  })

  it('carries the writer and the chat session, so UniWork AI runs it in the open turn', () => {
    const writer = deckStyleWriter({ topic: 'Q3 review' })
    const req = oneShotStreamRequest(
      { requestId: 'r3', settings, system: 'sys', user: 'u', sessionId: 'sess-chat' },
      writer,
    )
    expect(req).toMatchObject({
      purpose: 'one-shot',
      sessionId: 'sess-chat',
      writer: { kind: 'slides.deck_style', input: { topic: 'Q3 review' } },
      // BYOK still reads the prompt
      system: 'sys',
      messages: [{ role: 'user', text: 'u' }],
    })
    const bare = oneShotStreamRequest({ requestId: 'r4', settings, system: 's', user: 'u' })
    expect(bare).not.toHaveProperty('writer')
    expect(bare).not.toHaveProperty('sessionId')
  })

  it('the panel sends its direct generator request through the builder', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/ai/AiPanel.tsx'),
      'utf8',
    )
    // the panel's only direct aiStream call is the one-shot generator; an inlined request would
    // lose the purpose mark and UniWork AI would refuse it
    expect(source.match(/\.aiStream\(/g)).toHaveLength(1)
    expect(source).toContain('.aiStream(oneShotStreamRequest(')
    // each generator names its writer (style, outline, page)
    expect(source).toContain('deckStyleWriter(')
    expect(source).toContain('deckOutlineWriter(')
    expect(source).toContain('slidePageWriter(')
  })
})

// the writer inputs: the field names of the server's table (UniWork server/internal/ai/
// prompts_office_writer.go, writerFields); optional fields are left out when empty
describe('Slides writer inputs', () => {
  it('slides.deck_style: topic, style_hint, questionnaire', () => {
    expect(deckStyleWriter({ topic: 'T', styleHint: 'dark', questionnaire: 'Q: A' })).toEqual({
      kind: 'slides.deck_style',
      input: { topic: 'T', style_hint: 'dark', questionnaire: 'Q: A' },
    })
    expect(deckStyleWriter({ topic: 'T' })).toEqual({
      kind: 'slides.deck_style',
      input: { topic: 'T' },
    })
  })

  it('slides.deck_outline: the first batch, then a continuation with its start and hook', () => {
    expect(
      deckOutlineWriter({ topic: 'T', count: 12, startPage: 1, context: 'ref', styleSkill: 'S' }),
    ).toEqual({
      kind: 'slides.deck_outline',
      input: { topic: 'T', count: 12, context: 'ref', style_skill: 'S' },
    })
    expect(
      deckOutlineWriter({ topic: 'T', count: 4, startPage: 13, continueFrom: { coreHook: 'H' } }),
    ).toEqual({
      kind: 'slides.deck_outline',
      input: { topic: 'T', count: 4, start_page: 13, continue_core_hook: 'H' },
    })
  })

  it('slides.page: the page fields, images, and the repair note of a second attempt', () => {
    const args = {
      pageIndex: 2,
      totalPages: 5,
      coreHook: 'Hook',
      style: 'Style',
      title: 'Revenue',
      brief: 'KPIs',
      layout: 'kpi_cards_row',
      images: ['https://img/a.png'],
      context: 'ctx',
      topic: 'Deck',
      canvasW: 1280,
      canvasH: 720,
      skeleton: 'chrome',
    }
    expect(slidePageWriter(args)).toEqual({
      kind: 'slides.page',
      input: {
        style: 'Style',
        title: 'Revenue',
        brief: 'KPIs',
        page_index: 2,
        total_pages: 5,
        topic: 'Deck',
        core_hook: 'Hook',
        layout: 'kpi_cards_row',
        image_urls: ['https://img/a.png'],
        context: 'ctx',
        skeleton: 'chrome',
      },
    })
    const retry = slidePageWriter(
      { ...args, images: [], context: '', topic: undefined, skeleton: undefined },
      'bad JSON',
    )
    expect(retry.input).toEqual({
      style: 'Style',
      title: 'Revenue',
      brief: 'KPIs',
      page_index: 2,
      total_pages: 5,
      core_hook: 'Hook',
      layout: 'kpi_cards_row',
      previous_error: 'bad JSON',
    })
  })

  it('keeps every text within the field caps (the server answers 413 past them)', () => {
    const long = (n: number) => 'x'.repeat(n + 50)
    const page = slidePageWriter({
      pageIndex: 1,
      totalPages: 1,
      coreHook: long(1000),
      style: long(8000),
      title: long(300),
      brief: long(4000),
      layout: long(100),
      // a URL over the cap (a big data: URL) is useless cut short: it is left out
      images: [long(2000), ...Array.from({ length: 10 }, (_, i) => `https://img/${i}.png`)],
      context: long(4000),
      canvasW: 1280,
      canvasH: 720,
    }).input as Record<string, unknown>
    expect((page.style as string).length).toBe(8000)
    expect((page.title as string).length).toBe(300)
    expect((page.brief as string).length).toBe(4000)
    expect((page.core_hook as string).length).toBe(1000)
    expect((page.layout as string).length).toBe(100)
    expect((page.context as string).length).toBe(4000)
    expect(page.image_urls).toEqual(Array.from({ length: 8 }, (_, i) => `https://img/${i}.png`))
  })

  it('a page with no style or title still sends both (the server requires them)', () => {
    const page = slidePageWriter({
      pageIndex: 3,
      totalPages: 4,
      coreHook: '',
      style: '  ',
      title: '',
      brief: 'KPIs',
      layout: '',
      images: [],
      canvasW: 1280,
      canvasH: 720,
    })
    expect(page.input).toEqual({
      style: DEFAULT_DECK_STYLE,
      title: 'Slide 3',
      brief: 'KPIs',
      page_index: 3,
      total_pages: 4,
    })
  })

  it('regenerate_slide with no generate_deck before it and no title writes a full slides.page input', async () => {
    const pageSlide = { widthPx: 1280, heightPx: 720, nodes: [] } as unknown as RenderSlide
    const generatePageLocal = vi.fn(async () => ({ ok: true, marker: 'localpptx:P1' }))
    const access = {
      getSlides: () => [pageSlide, pageSlide],
      getCurrent: () => 0,
      getSelectedIds: () => [],
      applySlide: () => {},
      applyDeck: () => {},
      fitWidthPx: 1280,
      isCloudPageGenEnabled: async () => false,
      regenerateSlide: vi.fn(async () => ({ ok: true })),
      generatePageLocal,
      retryBackoffMs: 0,
    } as unknown as DeckAccess
    const r = await createSlidesSkill(access).executeTool!({
      id: 't',
      name: 'regenerate_slide',
      input: { slideIndex: 1, brief: 'Three cards' },
    })
    expect(r.isError).toBeUndefined()
    // the panel builds the UniWork AI writer from exactly these arguments
    const args = (
      generatePageLocal.mock.calls[0] as unknown as [Parameters<typeof slidePageWriter>[0]]
    )[0]
    const input = slidePageWriter(args).input
    expect(input.style).toBe(DEFAULT_DECK_STYLE)
    expect(input.title).toBe('Slide 2')
    expect(input).toMatchObject({ brief: 'Three cards', page_index: 2, total_pages: 2 })
  })
})

describe('writerRefusalIsFinal', () => {
  it('a refusal the same request cannot get past ends the retries', () => {
    for (const code of ['run_limit_reached', 'invalid_request', 'payload_too_large', 'unsupported'])
      expect(writerRefusalIsFinal(code)).toBe(true)
    for (const code of [undefined, 'ai_provider_error', 'ai_provider_timeout', 'disconnected'])
      expect(writerRefusalIsFinal(code)).toBe(false)
  })

  it('the panel generators stop on it and never feed it back as the repair note', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/ai/AiPanel.tsx'),
      'utf8',
    )
    // the page repair loop and the outline loop
    expect(source.match(/writerRefusalIsFinal\(r\.uniworkCode\)/g)).toHaveLength(2)
  })
})
