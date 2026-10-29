import { describe, expect, it } from 'vitest'
import { formatLength, parseCalibration } from '../src/renderer/measure'
import { applySaveRequest } from '../src/main/save-pdf'
import { AnnotationMode, OPS, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  StandardFonts,
} from 'pdf-lib'
import type { SavePdfRequest } from '../src/shared/ipc'

describe('formatLength', () => {
  const scale = { unitsPerPt: 100, unit: 'm' }
  it('converts points through the scale with two decimals', () => {
    expect(formatLength(235, scale)).toBe('2.35 m')
  })
  it('rounds to two decimals', () => {
    expect(formatLength(100, scale)).toBe('1.00 m')
    expect(formatLength(333.333, scale)).toBe('3.33 m')
  })
})

describe('parseCalibration', () => {
  it('scales by the drawn reference line: points per unit over the typed length', () => {
    expect(parseCalibration('2', 'm', 200)).toEqual({ unitsPerPt: 100, unit: 'm' })
  })
  it('rejects zero, negatives, garbage, overlong units and a degenerate line', () => {
    expect(parseCalibration('0', 'm', 200)).toBeNull()
    expect(parseCalibration('-5', 'm', 200)).toBeNull()
    expect(parseCalibration('abc', 'm', 200)).toBeNull()
    expect(parseCalibration('10', '', 200)).toBeNull()
    expect(parseCalibration('10', 'x'.repeat(13), 200)).toBeNull()
    expect(parseCalibration('10', 'm', 0)).toBeNull()
  })
})

describe('the measure annotation in a save', () => {
  it('writes a Line annotation whose appearance renders the label', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([300, 300])
    const request: SavePdfRequest = {
      path: 'fixture.pdf',
      markups: [],
      drawings: [
        {
          kind: 'measure',
          pageIndex: 0,
          color: [0.2, 0.4, 0.9],
          width: 1.5,
          from: [50, 60],
          to: [250, 60],
          label: '2.00 m',
        },
      ],
      formValues: [],
      stamps: [],
    }
    const { bytes } = await applySaveRequest(await doc.save(), request)
    const pdoc = await getDocument({ data: bytes.slice() }).promise
    const page = await pdoc.getPage(1)
    const annots = await page.getAnnotations()
    const line = annots.find((a) => a.subtype === 'Line')
    expect(line).toBeTruthy()
    expect(line!.lineCoordinates).toEqual([50, 60, 250, 60])
    // pdf.js v6 exposes /Contents as contentsObj; plain  is only set on some paths
    expect(line!.contentsObj?.str).toBe('2.00 m')
    // render level: pdf.js evaluates the appearance stream here, so a font
    // the /Resources dict does not name or a malformed Tm — pdf.js drops the
    // op and the label never draws — fails from here on
    const ops = await page.getOperatorList({ annotationMode: AnnotationMode.ENABLE })
    const textAt = ops.fnArray.indexOf(OPS.showText)
    expect(textAt).toBeGreaterThanOrEqual(0)
    const glyphs = ops.argsArray[textAt]![0] as { unicode?: string }[]
    expect(glyphs.map((g) => g.unicode).join('')).toBe('2.00 m')
    // the label rides a six-operand Tm (cos sin -sin cos mx my): tilt 0 on a
    // horizontal line, midpoint (150, 66)
    const tmAt = ops.fnArray.lastIndexOf(OPS.setTextMatrix, textAt)
    expect(tmAt).toBeGreaterThanOrEqual(0)
    const tm = Array.from(ops.argsArray[tmAt]![0] as ArrayLike<number>)
    const want = [1, 0, 0, 1, 150, 66]
    expect(tm).toHaveLength(6)
    tm.forEach((v, i) => expect(Math.abs(v - want[i]!)).toBeLessThan(0.01))
  })

  it('embeds the label font only when a measure drawing is written', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([300, 300])
    const plain = await applySaveRequest(await doc.save(), {
      path: 'fixture.pdf',
      markups: [],
      drawings: [
        {
          kind: 'line',
          pageIndex: 0,
          color: [0.2, 0.4, 0.9],
          width: 1.5,
          from: [50, 60],
          to: [250, 60],
        },
      ],
      formValues: [],
      stamps: [],
    })
    // standard-14 Helvetica carries no bytes, but its /BaseFont dict would sit
    // in the file if the save embedded it for a document that draws no label
    expect(Buffer.from(plain.bytes).toString('latin1')).not.toContain('/BaseFont /Helvetica')
  })

  it('grows /Rect and the appearance /BBox to contain the label box for any line angle', async () => {
    const cases: { from: [number, number]; to: [number, number]; label: string }[] = [
      { from: [50, 60], to: [250, 60], label: '2.40 m' },
      { from: [250, 60], to: [50, 60], label: '1.20 m' },
      { from: [120, 40], to: [120, 180], label: '14.00 cm' },
      { from: [200, 180], to: [80, 50], label: '99.99 mm' },
    ]
    for (const c of cases) {
      const doc = await PDFDocument.create()
      doc.addPage([300, 300])
      const font = await doc.embedFont(StandardFonts.Helvetica)
      const labelW = font.widthOfTextAtSize(c.label, 9)
      const labelH = font.heightAtSize(9)
      const labelDesc = Math.max(2, labelH - font.heightAtSize(9, { descender: false }))
      const { bytes } = await applySaveRequest(await doc.save(), {
        path: 'fixture.pdf',
        markups: [],
        drawings: [
          {
            kind: 'measure',
            pageIndex: 0,
            color: [0.86, 0.22, 0.18],
            width: 1.5,
            from: c.from,
            to: c.to,
            label: c.label,
          },
        ],
        formValues: [],
        stamps: [],
      })
      const saved = await PDFDocument.load(bytes, { updateMetadata: false })
      const { context } = saved
      const annots = context.lookup(saved.getPages()[0]!.node.get(PDFName.of('Annots')), PDFArray)
      const annot = context.lookup(annots.get(0), PDFDict)
      const rectArr = context.lookup(annot.get(PDFName.of('Rect')), PDFArray)
      const ap = context.lookup(annot.get(PDFName.of('AP')), PDFDict)
      const stream = context.lookup(ap.get(PDFName.of('N')), PDFRawStream)
      const bboxArr = context.lookup(stream.dict.get(PDFName.of('BBox')), PDFArray)
      const rect = rectArr.asArray().map((n) => (n as PDFNumber).asNumber())
      const bbox = bboxArr.asArray().map((n) => (n as PDFNumber).asNumber())
      expect(bbox).toEqual(rect)

      const mx = (c.from[0] + c.to[0]) / 2
      const my = (c.from[1] + c.to[1]) / 2
      const ang = Math.atan2(c.to[1] - c.from[1], c.to[0] - c.from[0])
      const tilt = Math.abs(ang) > Math.PI / 2 ? ang + Math.PI : ang
      const cos = Math.cos(tilt)
      const sin = Math.sin(tilt)
      for (const lx of [0, labelW]) {
        for (const ly of [-labelDesc, labelH]) {
          const px = mx + lx * cos - ly * sin
          const py = my + 6 + lx * sin + ly * cos
          expect(px).toBeGreaterThanOrEqual(rect[0])
          expect(px).toBeLessThanOrEqual(rect[2])
          expect(py).toBeGreaterThanOrEqual(rect[1])
          expect(py).toBeLessThanOrEqual(rect[3])
        }
      }
    }
  })
})
