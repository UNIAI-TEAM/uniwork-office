// G6-09a (UNI-1374) N1: under UniWork AI the slides skill must not offer the tools the
// signed policy turns off (web stubs, style templates). BYOK turns keep every tool. The
// predicate is live: it is re-read on every `tools` / `systemPrompt` read. Deck generation
// (generate_deck, regenerate_slide) runs under UniWork AI since UNI-2276: its pages go
// through the writer route.
import { describe, expect, it } from 'vitest'
import { createSlidesSkill, type DeckAccess } from '../src/renderer/ai/slides-skill'

const UNIWORK_HIDDEN = ['insert_web_image', 'replace_image', 'save_style_template']

/** offered to a UniWork AI turn since UNI-2276 (the server drops them on unbound decks) */
const UNIWORK_DECK_TOOLS = ['generate_deck', 'regenerate_slide']

function mkAccess(extra: Record<string, unknown> = {}): DeckAccess {
  return {
    getSlides: () => [],
    getCurrent: () => 0,
    getSelectedIds: () => [],
    applySlide: () => {},
    applyDeck: () => {},
    ...extra,
  } as unknown as DeckAccess
}

const names = (skill: ReturnType<typeof createSlidesSkill>) => skill.tools.map((t) => t.name)

describe('slides tools under UniWork AI', () => {
  it('hides the three stub / template tools when the provider is UniWork AI', () => {
    const got = names(createSlidesSkill(mkAccess({ uniworkAi: () => true })))
    for (const n of UNIWORK_HIDDEN) expect(got).not.toContain(n)
    for (const n of UNIWORK_DECK_TOOLS) expect(got).toContain(n)
    // the rest of the editing surface stays
    expect(got).toContain('apply_ops')
    expect(got).toContain('read_slide')
  })

  it('keeps every one of them for a BYOK turn (predicate false or absent)', () => {
    for (const access of [mkAccess({ uniworkAi: () => false }), mkAccess()]) {
      const got = names(createSlidesSkill(access))
      for (const n of UNIWORK_HIDDEN) expect(got).toContain(n)
    }
  })

  it('reads the predicate live between two `tools` reads', () => {
    let uniwork = false
    const skill = createSlidesSkill(mkAccess({ uniworkAi: () => uniwork }))
    expect(names(skill)).toContain('save_style_template')
    uniwork = true
    expect(names(skill)).not.toContain('save_style_template')
    uniwork = false
    expect(names(skill)).toContain('save_style_template')
  })

  it('tells the model the tools are gone only under UniWork AI (live)', () => {
    let uniwork = true
    const skill = createSlidesSkill(mkAccess({ uniworkAi: () => uniwork }))
    const note = 'insert_web_image, replace_image, save_style_template are not available here'
    expect(skill.systemPrompt).toContain(note)
    // deck generation is offered again: the note no longer turns it away
    expect(skill.systemPrompt).not.toContain('generate_deck is unavailable')
    uniwork = false
    expect(skill.systemPrompt).not.toContain(note)
  })

  it('composes with the media-tool hides without dropping either set', () => {
    const got = names(
      createSlidesSkill(mkAccess({ uniworkAi: () => true, imageGenAvailable: () => false })),
    )
    expect(got).not.toContain('generate_image')
    expect(got).not.toContain('insert_web_image')
  })
})

// RFA-1 (FE review r1): a tool the live `tools` getter hides must also be refused when the
// model calls it anyway (stale history, a provider switch mid-chat, an injected call).
describe('slides executeTool refuses what `tools` hides', () => {
  function spy(extra: Record<string, unknown>) {
    const touched: string[] = []
    const access = mkAccess({
      getSlides: () => {
        touched.push('getSlides')
        return []
      },
      ...extra,
    })
    return { access, touched }
  }
  const call = (name: string) => ({ id: 'c1', name, input: {} })

  it('refuses each UniWork-hidden tool under UniWork AI and touches nothing', async () => {
    for (const name of UNIWORK_HIDDEN) {
      const { access, touched } = spy({ uniworkAi: () => true })
      const res = await createSlidesSkill(access).executeTool(call(name))
      expect(res.isError, name).toBe(true)
      expect(res.mutated, name).toBeFalsy()
      expect(res.output, name).toContain(`${name} is unavailable`)
      expect(touched, name).toEqual([])
    }
  })

  it('refuses a media tool the media hides take away', async () => {
    const { access, touched } = spy({ imageGenAvailable: () => false })
    const res = await createSlidesSkill(access).executeTool(call('generate_image'))
    expect(res.isError).toBe(true)
    expect(res.output).toContain('generate_image is unavailable')
    expect(touched).toEqual([])
  })

  it('does not refuse for a BYOK turn (the tool runs its own path)', async () => {
    const { access, touched } = spy({ uniworkAi: () => false })
    await createSlidesSkill(access).executeTool(call('generate_deck'))
    expect(touched).toContain('getSlides')
  })

  it('runs the deck tools for a UniWork AI turn (not refused)', async () => {
    for (const name of UNIWORK_DECK_TOOLS) {
      const { access, touched } = spy({ uniworkAi: () => true })
      const res = await createSlidesSkill(access).executeTool(call(name))
      expect(res.output, name).not.toContain(`${name} is unavailable`)
      expect(touched, name).toContain('getSlides')
    }
  })

  it('follows the predicate live', async () => {
    let uniwork = true
    const { access } = spy({ uniworkAi: () => uniwork })
    const skill = createSlidesSkill(access)
    expect((await skill.executeTool(call('insert_web_image'))).output).toContain('is unavailable')
    uniwork = false
    expect((await skill.executeTool(call('insert_web_image'))).output).not.toContain(
      'insert_web_image is unavailable',
    )
  })
})

// RFA-4: the media-off note must not send the model to a tool UniWork AI hides.
describe('slides media-off note under UniWork AI', () => {
  it('drops the insert_web_image suggestion when the provider is UniWork AI', () => {
    const off = { imageGenAvailable: () => false }
    const uni = createSlidesSkill(mkAccess({ ...off, uniworkAi: () => true })).systemPrompt
    expect(uni).not.toContain('image_search + insert_web_image')
    const byok = createSlidesSkill(mkAccess({ ...off, uniworkAi: () => false })).systemPrompt
    expect(byok).toContain('image_search + insert_web_image')
  })
})
