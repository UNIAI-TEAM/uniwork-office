// @vitest-environment node
/**
 * G8-14 (UNI-1409) RBE14-05: pins the RenderSlide.sldId wiring in the session core
 * (session/render.ts). The engine reader and buildRenderSlide are each covered in
 * isolation elsewhere; this asserts the field the server anchors a comment by is
 * actually present on the render tree the session builds from a real deck — on a
 * full-deck rebuild, a single-slide rebuild and a reparse rebuild — and that a
 * reorder keeps each slide's own p:sldId.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { moveSlide, openPptx, slideIdOfPath, type OpenedPptx } from '@genoffice/pptx-engine'
import type { RenderSlide } from '@genoffice/pptx-render'
import {
  buildAllRenderSlides,
  createSession,
  rebuildSlide,
  rebuildSlideWithReparse,
  sessions,
} from '../src/session'

const here = dirname(fileURLToPath(import.meta.url))
const FIT = 1280
let clientId = 900

const open = () =>
  openPptx(
    new Uint8Array(
      readFileSync(
        join(
          here,
          '..',
          '..',
          '..',
          'packages',
          'pptx-engine',
          'tests',
          'fixtures',
          '01_standard_business.pptx',
        ),
      ),
    ),
  )

function withSession(opened: OpenedPptx) {
  const id = ++clientId
  return createSession(id, { path: 'deck.pptx', opened, fitWidthPx: FIT })
}

afterAll(() => {
  sessions.clear()
})

describe('RenderSlide.sldId wiring in the session core', () => {
  it("buildAllRenderSlides puts each slide's p:sldId on its RenderSlide", async () => {
    const opened = await open()
    const slides = buildAllRenderSlides(opened, FIT)
    expect(slides.map((s) => s.sldId)).toEqual(
      opened.deck.slides.map((s) => slideIdOfPath(opened, s.path)),
    )
    expect(slides.every((s) => s.sldId)).toBe(true)
  })

  it("rebuildSlide returns the slide's p:sldId", async () => {
    const session = withSession(await open())
    const rebuilt = rebuildSlide(session, 2)
    expect(rebuilt).toBeTruthy()
    expect(rebuilt!.sldId).toBe(slideIdOfPath(session.opened, session.opened.deck.slides[2]!.path))
  })

  it("rebuildSlideWithReparse (chart/table path) keeps the slide's p:sldId", async () => {
    const session = withSession(await open())
    const expected = slideIdOfPath(session.opened, session.opened.deck.slides[3]!.path)
    const rebuilt = rebuildSlideWithReparse(session, 3)
    expect(rebuilt).toBeTruthy()
    expect(rebuilt!.sldId).toBe(expected)
  })

  it("a reorder keeps each slide's own p:sldId on the rebuilt tree", async () => {
    const opened = await open()
    const before = buildAllRenderSlides(opened, FIT)
    const idOfThird = before[2]!.sldId
    // move slide 2 to the front: the same RenderSlide identity follows it
    expect(moveSlide(opened, 2, 0)).toBeTruthy()
    const after = buildAllRenderSlides(opened, FIT)
    expect(after[0]!.partPath).toBe(before[2]!.partPath)
    expect(after[0]!.sldId).toBe(idOfThird)
    // every slide still carries an id, in presentation order
    expect(after.map((s: RenderSlide) => s.sldId)).toEqual(
      opened.deck.slides.map((s) => slideIdOfPath(opened, s.path)),
    )
  })
})
