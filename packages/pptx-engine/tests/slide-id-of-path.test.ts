/**
 * G8-14: slideIdOfPath reads a slide part's p:sldId/@id from presentation.xml, the stable
 * identity a server comment anchors a slide by. It follows the part through a reorder and a
 * save -> reopen, and is undefined for a part presentation.xml does not list.
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { moveSlide, openPptx, savePptx, slideIdOfPath, slideIdsByPath } from '../src/index'

const here = dirname(fileURLToPath(import.meta.url))
const open = () => openPptx(readFileSync(join(here, 'fixtures', '01_standard_business.pptx')))

describe('slideIdOfPath', () => {
  it('names each slide part by its p:sldId/@id, in presentation.xml order', async () => {
    const opened = await open()
    const pres = opened.archive.readText('ppt/presentation.xml')!
    const listed = [...pres.matchAll(/<p:sldId\b[^>]*\bid="(\d+)"/g)].map((m) => m[1])
    const ids = opened.deck.slides.map((s) => slideIdOfPath(opened, s.path))
    expect(ids).toEqual(listed)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('follows the slide through a reorder and a save -> reopen', async () => {
    const opened = await open()
    const third = opened.deck.slides[2]!.path
    const id = slideIdOfPath(opened, third)
    expect(id).toBeTruthy()
    expect(moveSlide(opened, 2, 0)).toBeTruthy()
    expect(opened.deck.slides[0]!.path).toBe(third)
    expect(slideIdOfPath(opened, third)).toBe(id)
    const reopened = await openPptx(await savePptx(opened))
    expect(reopened.deck.slides[0]!.path).toBe(third)
    expect(slideIdOfPath(reopened, third)).toBe(id)
  })

  it('is undefined for a part presentation.xml does not list', async () => {
    const opened = await open()
    expect(slideIdOfPath(opened, 'ppt/slides/slide99.xml')).toBeUndefined()
  })
})

describe('slideIdsByPath (deck-wide id lookup)', () => {
  it('reads presentation.xml and its rels once for the whole deck, not once per slide', async () => {
    const opened = await open()
    const PRES = 'ppt/presentation.xml'
    const textSpy = vi.spyOn(opened.archive, 'readText')
    const relsSpy = vi.spyOn(opened.archive, 'readRels')

    const ids = slideIdsByPath(opened)

    // A full-deck rebuild must not re-parse presentation.xml per slide (that made it O(N^2))
    expect(textSpy.mock.calls.filter(([p]) => p === PRES)).toHaveLength(1)
    expect(relsSpy.mock.calls.filter(([p]) => p === PRES)).toHaveLength(1)

    // Same answer a per-slide slideIdOfPath would give, keyed by part path
    expect(ids.size).toBe(opened.deck.slides.length)
    expect([...ids.entries()]).toEqual(
      opened.deck.slides.map((s) => [s.path, slideIdOfPath(opened, s.path)]),
    )
  })

  it('follows the ids through a reorder (the map is rebuilt from the current presentation.xml)', async () => {
    const opened = await open()
    const third = opened.deck.slides[2]!.path
    const id = slideIdsByPath(opened).get(third)
    expect(id).toBeTruthy()
    expect(moveSlide(opened, 2, 0)).toBeTruthy()
    expect(slideIdsByPath(opened).get(third)).toBe(id)
  })
})
