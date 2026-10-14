/**
 * G8-14: buildRenderSlide carries the caller's p:sldId as RenderSlide.sldId (the identity a server
 * comment anchors a slide by) next to partPath; without one the field stays absent.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { openPptx } from '@genoffice/pptx-engine'
import { buildRenderSlide } from '../src/index'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = () =>
  readFileSync(
    join(here, '..', '..', 'pptx-engine', 'tests', 'fixtures', '01_standard_business.pptx'),
  )

describe('RenderSlide.sldId', () => {
  it('copies BuildOptions.sldId', async () => {
    const { deck } = await openPptx(fixture())
    const rs = buildRenderSlide(deck.slides[1]!, deck.size, { fitWidthPx: 640, sldId: '257' })
    expect(rs.sldId).toBe('257')
    expect(rs.partPath).toBe(deck.slides[1]!.path)
  })

  it('is absent when the caller has no id', async () => {
    const { deck } = await openPptx(fixture())
    const rs = buildRenderSlide(deck.slides[0]!, deck.size, { fitWidthPx: 640 })
    expect('sldId' in rs).toBe(false)
  })
})
