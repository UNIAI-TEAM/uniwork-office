/**
 * G6-12 #27 (spec §6.3 (c)): generate_deck writes its Style Skill to a
 * `.styleskill.json` sidecar next to the session's file. For a UniWork-bound
 * deck that file is the UniWork working copy, so the sidecar would land outside
 * the document: the skill skips it while bound. Local decks keep the sidecar.
 */
import { describe, expect, it } from 'vitest'
import type { RenderSlide } from '@genoffice/pptx-render'
import { createSlidesSkill, type DeckAccess } from '../src/renderer/ai/slides-skill'
import type { AgentToolCall } from '../src/shared/ipc'

function makeAccess(bound: boolean) {
  const sidecars: unknown[] = []
  let pages = 0
  const access: DeckAccess = {
    uniworkBound: () => bound,
    getSlides: () => [] as RenderSlide[],
    getCurrent: () => 0,
    getSelectedIds: () => [],
    applySlide: () => {},
    applyDeck: () => {},
    fitWidthPx: 1280,
    retryBackoffMs: 0,
    landGeneratedPages: async (markers, mode = 'replace') => {
      if (mode === 'append') {
        const from = pages
        pages += markers.length
        return { ok: true, pages, appendedFrom: from }
      }
      pages = markers.length
      return { ok: true, pages }
    },
    isCloudPageGenEnabled: async () => false,
    generatePageLocal: async (args) => ({ ok: true, marker: `localpptx:PAGE${args.pageIndex}` }),
    generateStyleSkill: async (a) => ({ ok: true, styleSkill: 'STYLE_FOR:' + a.topic }),
    saveSidecar: async (data) => {
      sidecars.push(data)
    },
  }
  return { access, sidecars, getPages: () => pages }
}

const deckCall: AgentToolCall = {
  id: 'c-deck',
  name: 'generate_deck',
  input: {
    core_hook: 'Doubled in a decade',
    style: 'Deep navy + gold',
    pages: [
      { title: 'One', brief: 'b1', layout: 'data' },
      { title: 'Two', brief: 'b2', layout: 'data' },
    ],
  },
}

describe('generate_deck style sidecar vs UniWork binding', () => {
  it('bound deck: pages land, no sidecar is written', async () => {
    const { access, sidecars, getPages } = makeAccess(true)
    const res = (await createSlidesSkill(access).executeTool(deckCall)) as { isError?: boolean }
    expect(res.isError).toBeFalsy()
    expect(getPages()).toBe(2)
    expect(sidecars).toEqual([])
  })

  it('local deck: the sidecar is written as before', async () => {
    const { access, sidecars, getPages } = makeAccess(false)
    await createSlidesSkill(access).executeTool(deckCall)
    expect(getPages()).toBe(2)
    expect(sidecars).toHaveLength(1)
  })
})
