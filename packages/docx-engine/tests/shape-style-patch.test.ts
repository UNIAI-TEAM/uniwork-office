import { describe, expect, it } from 'vitest'
import { buildLineParagraphXml, buildShapeParagraphXml, patchShapeStyles } from '../src/generate'
import { parseDocx } from '../src/parse'
import { buildDocx } from './helpers/build-docx'

const SHAPE = buildShapeParagraphXml({
  prst: 'heart',
  fillHex: '4472C4',
  borderHex: '2F5496',
  withTextbox: true,
})

const firstBox = async (paragraphXml: string) => {
  const doc = await parseDocx(await buildDocx({ bodyXml: paragraphXml }))
  return doc.blocks.find((b) => b.textboxes?.length)?.textboxes?.[0]
}

describe('patchShapeStyles rotation', () => {
  it('writes a:xfrm@rot in 60000ths of a degree', () => {
    const out = patchShapeStyles(SHAPE, [{ rotDeg: 90 }])
    expect(out).toContain('<a:xfrm rot="5400000">')
    // the generated xfrm carried no rotation before the patch
    expect(SHAPE).not.toContain('rot="')
  })

  it('keeps fractional degrees and normalizes into one turn', () => {
    expect(patchShapeStyles(SHAPE, [{ rotDeg: 45.5 }])).toContain('rot="2730000"')
    expect(patchShapeStyles(SHAPE, [{ rotDeg: 270 }])).toContain('rot="16200000"')
    expect(patchShapeStyles(SHAPE, [{ rotDeg: -90 }])).toContain('rot="16200000"')
    expect(patchShapeStyles(SHAPE, [{ rotDeg: 765 }])).toContain('rot="2700000"')
  })

  it('replaces an existing rotation instead of appending a second one', () => {
    const once = patchShapeStyles(SHAPE, [{ rotDeg: 90 }])
    const twice = patchShapeStyles(once, [{ rotDeg: 180 }])
    expect(twice).toContain('rot="10800000"')
    expect(twice).not.toContain('5400000')
    expect(twice.match(/rot="/g)).toHaveLength(1)
  })

  it('clears the attribute with null and with 0', () => {
    const rotated = patchShapeStyles(SHAPE, [{ rotDeg: 90 }])
    for (const clear of [null, 0, 360]) {
      const out = patchShapeStyles(rotated, [{ rotDeg: clear }])
      expect(out).not.toContain('rot="')
      expect(out).toContain('<a:xfrm>')
      // everything else survives the clear
      expect(out).toContain('4472C4')
      expect(out).toContain('2F5496')
    }
  })

  it('leaves fill and outline untouched when only the rotation is patched', () => {
    const out = patchShapeStyles(SHAPE, [{ rotDeg: 90 }])
    expect(out).toContain('<a:solidFill><a:srgbClr val="4472C4"/></a:solidFill>')
    expect(out).toContain('<a:ln><a:solidFill><a:srgbClr val="2F5496"/></a:solidFill></a:ln>')
  })
})

describe('patchShapeStyles outline width', () => {
  it('writes a:ln@w in EMU from CSS pixels', () => {
    const out = patchShapeStyles(SHAPE, [{ borderWidthPx: 2 }])
    expect(out).toContain('<a:ln w="19050">')
    // the colour slot the generator wrote is still there
    expect(out).toContain('<a:srgbClr val="2F5496"/>')
  })

  it('replaces an existing width', () => {
    const twice = patchShapeStyles(patchShapeStyles(SHAPE, [{ borderWidthPx: 2 }]), [
      { borderWidthPx: 4 },
    ])
    expect(twice).toContain('<a:ln w="38100">')
    expect(twice).not.toContain('19050')
  })

  it('clears the attribute with null', () => {
    const sized = patchShapeStyles(SHAPE, [{ borderWidthPx: 2 }])
    const out = patchShapeStyles(sized, [{ borderWidthPx: null }])
    expect(out).not.toContain('w="19050"')
    expect(out).toContain('<a:ln><a:solidFill><a:srgbClr val="2F5496"/></a:solidFill></a:ln>')
  })

  it('leaves the rotation and colours untouched when only the width is patched', () => {
    const rotated = patchShapeStyles(SHAPE, [{ rotDeg: 90 }])
    const out = patchShapeStyles(rotated, [{ borderWidthPx: 2 }])
    expect(out).toContain('rot="5400000"')
    expect(out).toContain('4472C4')
  })

  it('sets the width on a stroke-only connector without losing its arrow end', () => {
    const line = buildLineParagraphXml({ kind: 'lineArrow' })
    const out = patchShapeStyles(line, [{ borderWidthPx: 3 }])
    expect(out).toContain('<a:ln w="28575">')
    expect(out).toContain('<a:tailEnd type="triangle"/>')
  })
})

describe('patchShapeStyles no-op', () => {
  it('returns the paragraph byte-identically when nothing is requested', () => {
    expect(patchShapeStyles(SHAPE, [{}])).toBe(SHAPE)
    expect(patchShapeStyles(SHAPE, [null, undefined])).toBe(SHAPE)
  })

  it('patches rotation, outline width, fill, and border on a text-less shape and keeps an untouched one byte-identical', () => {
    const textless = buildShapeParagraphXml({
      prst: 'rect',
      fillHex: '4472C4',
      borderHex: '2F5496',
      withTextbox: false,
    })
    expect(textless).not.toContain('<w:txbxContent')
    expect(patchShapeStyles(textless, [{}])).toBe(textless)
    expect(patchShapeStyles(textless, [null, undefined])).toBe(textless)

    const patched = patchShapeStyles(textless, [
      { rotDeg: 285, borderWidthPx: 8, fillHex: 'FF0000', borderHex: '00B050' },
    ])
    expect(patched).toContain('<a:xfrm rot="17100000">')
    expect(patched).toContain(
      '<a:ln w="76200"><a:solidFill><a:srgbClr val="00B050"/></a:solidFill></a:ln>',
    )
    expect(patched).toContain('<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>')
  })

  it('patches rotation and outline width on a text-less custom-geometry shape', () => {
    const custXml = buildShapeParagraphXml({
      prst: 'rect',
      fillHex: '4472C4',
      borderHex: '2F5496',
      withTextbox: false,
    }).replace(
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
      '<a:custGeom><a:pathLst/></a:custGeom>',
    )
    const out = patchShapeStyles(custXml, [{ rotDeg: 90, borderWidthPx: 2 }])
    expect(out).toContain('<a:xfrm rot="5400000">')
    expect(out).toContain('<a:ln w="19050">')
  })
})

describe('rotation and outline width round-trip through the parser', () => {
  it('restores rotDeg and borderWidthPx on the display box', async () => {
    const out = patchShapeStyles(SHAPE, [{ rotDeg: 90, borderWidthPx: 2 }])
    const box = await firstBox(out)
    expect(box?.rotDeg).toBe(90)
    expect(box?.borderWidthPx).toBe(2)
  })

  it('round-trips a rotated connector', async () => {
    const xml = patchShapeStyles(buildLineParagraphXml({ kind: 'line' }), [{ rotDeg: 270 }])
    const box = await firstBox(xml)
    expect(box?.rotDeg).toBe(270)
  })

  it('round-trips a connector stroke width', async () => {
    const xml = patchShapeStyles(buildLineParagraphXml({ kind: 'lineArrow' }), [
      { borderWidthPx: 3 },
    ])
    const box = await firstBox(xml)
    expect(box?.borderWidthPx).toBe(3)
  })
})
