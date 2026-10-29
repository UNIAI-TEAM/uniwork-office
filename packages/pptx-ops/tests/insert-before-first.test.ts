import { describe, it, expect } from 'vitest'
import { addElement, createBlankPptx, duplicateSlide, openPptx } from '@genoffice/pptx-engine'
import { runTxn } from '../src/ops/executor'
import '../src/ops/index'

// The Slides app inserts a blank slide above slide 1 as one transaction; the
// plan validates every op against the pre-transaction deck, so the move must
// target the pre-existing slide, even when it is the only one.
describe('blank slide above the first slide in one transaction', () => {
  it('lands the new slide at index 0 of a single-slide deck', async () => {
    const opened = await openPptx(await createBlankPptx())
    const original = opened.deck.slides[0]!.path
    const r = runTxn(opened, {
      ops: [
        { op: 'addBlankSlide', target: { slide: 0 } },
        { op: 'moveSlide', target: { slide: 0 }, to: 1 },
      ],
    })
    expect(r.applied).toBe(true)
    expect(opened.deck.slides.map((s) => s.path)).toHaveLength(2)
    expect(opened.deck.slides[1]!.path).toBe(original)
    expect(opened.deck.slides[0]!.path).not.toBe(original)
  })
})

describe('findReplace op record', () => {
  it('reports changedSlides indices in after alongside count', async () => {
    const opened = await openPptx(await createBlankPptx())
    duplicateSlide(opened, 0)
    duplicateSlide(opened, 0)
    addElement(opened.deck.slides[0]!, {
      kind: 'textbox',
      offset: { x: 0, y: 0, cx: 914400, cy: 457200 },
      paragraphs: [{ runs: [{ text: 'token-here' }] }],
    })
    addElement(opened.deck.slides[2]!, {
      kind: 'textbox',
      offset: { x: 0, y: 0, cx: 914400, cy: 457200 },
      paragraphs: [{ runs: [{ text: 'token-here twice token-here' }] }],
    })
    const r = runTxn(opened, {
      ops: [{ op: 'findReplace', find: 'token-here', replace: 'patched' }],
    })
    expect(r.applied).toBe(true)
    expect(r.records?.[0]?.after).toEqual({
      count: 3,
      changedSlides: [0, 2],
    })
  })
})
