/**
 * Underline / strikeout / squiggly on a rotated page. A page /Rotate of 90 or 270 is usually
 * applied to ordinary content, so the marked line runs along PDF x (sideways on screen). The
 * stroke used to assume text running along y: it came out as a short stub at the end of the
 * line and, with the line length taken for the line height, a stroke as thick as the line was
 * long (a filled blob once the file was reopened).
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
  degrees,
} from 'pdf-lib'
import { applySaveRequest } from '../src/main/save-pdf'
import { MarkupOverlay } from '../src/renderer/PdfPage'
import type { LocalMarkup, PageGeom } from '../src/renderer/annotations'
import { markupLineRotation } from '../src/shared/markup-line'
import type { SavePdfRequest } from '../src/shared/ipc'

const request = (over: Partial<SavePdfRequest>): SavePdfRequest => ({
  path: '/tmp/test.pdf',
  markups: [],
  drawings: [],
  formValues: [],
  stamps: [],
  ...over,
})

async function makePdf(rot: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792]).setRotation(degrees(rot))
  return doc.save({ useObjectStreams: false })
}

async function appearanceOps(
  rot: number,
  type: 'underline' | 'strikeout' | 'squiggly',
  quad: number[],
): Promise<string> {
  const { bytes } = await applySaveRequest(
    await makePdf(rot),
    request({ markups: [{ pageIndex: 0, type, color: [0.1, 0.3, 0.9], quads: [quad] }] }),
  )
  const out = await PDFDocument.load(bytes)
  const annot = out.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray).lookup(0, PDFDict)
  const apRef = annot.lookup(PDFName.of('AP'), PDFDict).lookup(PDFName.of('N'))
  return Buffer.from(decodePDFRawStream(out.context.lookup(apRef) as PDFRawStream).decode()).toString(
    'latin1',
  )
}

// canonical quad [x1,yMax,x2,yMax,x1,yMin,x2,yMin]
const quadOf = (x1: number, y1: number, x2: number, y2: number) => [x1, y2, x2, y2, x1, y1, x2, y1]

// ordinary content on a rotated page: the 300 pt line runs along x, 14 pt tall
const SIDEWAYS = quadOf(100, 400, 400, 414)
// content written upright in the rotated view: the line runs along y
const UPRIGHT = quadOf(200, 100, 214, 400)

const lineWidth = (ops: string) => Number(/^([\d.]+) w$/m.exec(ops)![1])

describe('markupLineRotation', () => {
  it('keeps the page rotation unless a wide quad sits on a 90/270 page', () => {
    expect(markupLineRotation(0, [100, 400, 400, 414])).toBe(0)
    expect(markupLineRotation(180, [100, 400, 400, 414])).toBe(180)
    expect(markupLineRotation(90, [100, 400, 400, 414])).toBe(0)
    expect(markupLineRotation(270, [100, 400, 400, 414])).toBe(0)
    expect(markupLineRotation(90, [200, 100, 214, 400])).toBe(90)
    expect(markupLineRotation(270, [200, 100, 214, 400])).toBe(270)
    // a roughly square box (a single wide letter) keeps the page reading
    expect(markupLineRotation(90, [200, 100, 214, 110])).toBe(90)
    expect(markupLineRotation(-90, [100, 400, 400, 414])).toBe(0)
  })
})

describe('saved underline / strikeout on a rotated page', () => {
  for (const rot of [90, 270]) {
    it(`page ${rot}: a sideways line gets a thin stroke along its whole length at the baseline`, async () => {
      const ops = await appearanceOps(rot, 'underline', SIDEWAYS)
      // 14 pt line height -> 0.84 pt stroke, not 18 pt (0.06 of the 300 pt length)
      expect(lineWidth(ops)).toBeCloseTo(0.84, 2)
      // the whole 300 pt, parallel to x, at y1 + 8% of the height
      expect(ops).toContain('100 401.12 m 400 401.12 l S')
    })

    it(`page ${rot}: a sideways strikeout runs through the middle of the line`, async () => {
      const ops = await appearanceOps(rot, 'strikeout', SIDEWAYS)
      expect(lineWidth(ops)).toBeCloseTo(0.84, 2)
      expect(ops).toContain('100 406.44 m 400 406.44 l S')
    })
  }

  it('page 90: a line written upright in the rotated view keeps its vertical stroke', async () => {
    const ops = await appearanceOps(90, 'underline', UPRIGHT)
    expect(ops).toContain('212.88 100 m 212.88 400 l S')
  })

  it('page 270: a line written upright in the rotated view keeps its vertical stroke', async () => {
    const ops = await appearanceOps(270, 'underline', UPRIGHT)
    expect(ops).toContain('201.12 100 m 201.12 400 l S')
  })

  it('page 0 is untouched: a wide quad underlines its bottom edge', async () => {
    const ops = await appearanceOps(0, 'underline', SIDEWAYS)
    expect(ops).toContain('100 401.12 m 400 401.12 l S')
  })

  it('squiggly on a sideways line walks along x, inside the quad', async () => {
    const ops = await appearanceOps(90, 'squiggly', SIDEWAYS)
    expect(lineWidth(ops)).toBeCloseTo(0.84, 2)
    const points = ops
      .split('\n')
      .filter((line) => / m$/.test(line.trim()))
      .map((line) => line.trim().split(/\s+/).map(Number))
    // starts at the left end of the line, one amplitude above the baseline offset
    expect(points[0]![0]).toBeCloseTo(100, 1)
    expect(points[0]![1]).toBeGreaterThanOrEqual(400)
    expect(points[0]![1]).toBeLessThanOrEqual(414)
    // the wave spans the whole line: its last curve ends at the right end
    const curves = ops.split('\n').filter((line) => / c$/.test(line.trim()))
    const last = curves.at(-1)!.trim().split(/\s+/).map(Number)
    expect(last[4]).toBeCloseTo(400, 1)
  })
})

describe('unsaved underline / strikeout / squiggly overlay on a rotated page', () => {
  const markup = (type: LocalMarkup['type'], quad: number[]): LocalMarkup => ({
    id: 'm1',
    pageIndex: 0,
    type,
    color: [0.1, 0.3, 0.9],
    quads: [quad],
  })
  const geom = (rot: number): PageGeom => ({ pw: 612, ph: 792, rot })
  const html = (type: LocalMarkup['type'], quad: number[], rot: number) =>
    renderToStaticMarkup(
      createElement(MarkupOverlay, {
        markups: [markup(type, quad)],
        geom: geom(rot),
        scale: 1,
        selectedId: null,
      }),
    )

  it('upright page: underline stays the bottom border', () => {
    expect(html('underline', quadOf(100, 400, 400, 414), 0)).toContain('border-bottom:2px solid')
  })

  it('page 90: a sideways underline is a left border along the whole line', () => {
    const out = html('underline', SIDEWAYS, 90)
    expect(out).toContain('border-left:2px solid')
    expect(out).not.toContain('border-bottom')
    // view box: 14 wide, the 300 pt line tall
    expect(out).toContain('width:14px')
    expect(out).toContain('height:300px')
  })

  it('page 270: a sideways underline is a right border', () => {
    expect(html('underline', SIDEWAYS, 270)).toContain('border-right:2px solid')
  })

  it('page 90: a line written upright in the rotated view keeps the bottom border', () => {
    expect(html('underline', UPRIGHT, 90)).toContain('border-bottom:2px solid')
  })

  it('a sideways strikeout is a vertical bar through the line', () => {
    const out = html('strikeout', SIDEWAYS, 90)
    expect(out).toContain('background-size:2px 100%')
    expect(out).toContain('background-position:46% 0')
  })

  it('a sideways squiggly lies along the line on the baseline side', () => {
    const left = html('squiggly', SIDEWAYS, 90)
    expect(left).toContain('viewBox="0 0 6 100"')
    expect(left).toContain('left:0')
    expect(html('squiggly', SIDEWAYS, 270)).toContain('right:0')
    // an upright page keeps the horizontal wave under the box
    expect(html('squiggly', quadOf(100, 400, 400, 414), 0)).toContain('viewBox="0 0 100 6"')
  })
})
