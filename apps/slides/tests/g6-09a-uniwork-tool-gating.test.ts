// G6-09a (UNI-1374) N1: under UniWork AI the slides skill must not offer the tools the
// signed policy turns off (web stubs, deck generation, style templates). BYOK turns keep
// every tool. The predicate is live: it is re-read on every `tools` / `systemPrompt` read.
import { describe, expect, it } from 'vitest'
import { createSlidesSkill, type DeckAccess } from '../src/renderer/ai/slides-skill'

const UNIWORK_HIDDEN = [
  'insert_web_image',
  'replace_image',
  'regenerate_slide',
  'save_style_template',
  'generate_deck',
]

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
  it('hides the five stub / generation tools when the provider is UniWork AI', () => {
    const got = names(createSlidesSkill(mkAccess({ uniworkAi: () => true })))
    for (const n of UNIWORK_HIDDEN) expect(got).not.toContain(n)
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
    expect(names(skill)).toContain('generate_deck')
    uniwork = true
    expect(names(skill)).not.toContain('generate_deck')
    uniwork = false
    expect(names(skill)).toContain('generate_deck')
  })

  it('tells the model the tools are gone only under UniWork AI (live)', () => {
    let uniwork = true
    const skill = createSlidesSkill(mkAccess({ uniworkAi: () => uniwork }))
    expect(skill.systemPrompt).toContain('generate_deck is unavailable')
    uniwork = false
    expect(skill.systemPrompt).not.toContain('generate_deck is unavailable')
  })

  it('composes with the media-tool hides without dropping either set', () => {
    const got = names(
      createSlidesSkill(mkAccess({ uniworkAi: () => true, imageGenAvailable: () => false })),
    )
    expect(got).not.toContain('generate_image')
    expect(got).not.toContain('insert_web_image')
  })
})
