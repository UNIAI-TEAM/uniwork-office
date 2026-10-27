import { describe, expect, it, vi } from 'vitest'
import { parseDocx, saveDocx } from '../src/index'
import { convertWmfToDataUrl } from '../src/vendor/emf-converter/index.mjs'
import { buildDocx } from './helpers/build-docx'

// Canvas is unavailable under vitest; mock the metafile converter to test the wiring.
vi.mock('../src/vendor/emf-converter/index.mjs', () => ({
  convertEmfToDataUrl: vi.fn(async () => 'data:image/png;base64,EMFPNG'),
  convertWmfToDataUrl: vi.fn(async () => 'data:image/png;base64,WMFPNG'),
}))

/**
 * Legacy .doc -> .docx (LibreOffice) leaves VML in a docx: bare shapetype ids
 * (type="_x0000_t109", no '#'), v:line shapes inside a v:group, and a
 * v:imagedata that points at a WMF picture. Each must draw, or leave a
 * neutral frame of the declared size, and stay byte-identical on save.
 */

const NS =
  'xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"'

// vn-bca-bieu-mau-mt1.doc: the small checkbox squares, bare type id
const CHECKBOX_TYPE =
  `<v:shapetype ${NS} id="_x0000_t109" coordsize="21600,21600" o:spt="109" ` +
  'path="m,l21600,l21600,21600l,21600xe"><v:stroke joinstyle="miter"/></v:shapetype>'
const CHECKBOX_PARA =
  '<w:p><w:r><w:t xml:space="preserve">Nam: </w:t></w:r><w:r><w:pict>' +
  CHECKBOX_TYPE +
  `<v:shape ${NS} id="shape_0" fillcolor="white" stroked="t" o:allowincell="t" ` +
  'style="position:absolute;margin-left:100.95pt;margin-top:4.55pt;width:9.7pt;height:7.1pt;mso-wrap-style:none" type="_x0000_t109">' +
  '<v:fill type="solid" color2="black"/><v:stroke color="black" weight="9360" joinstyle="miter" endcap="flat"/>' +
  '<w10:wrap type="none"/></v:shape></w:pict></w:r></w:p>'

// poi-testPictures.doc: an inline canvas with an invisible frame and two crossing lines
const LINE_GROUP =
  '<w:p><w:r><w:pict>' +
  `<v:group ${NS} id="shape_0" style="position:absolute;margin-left:0pt;margin-top:0pt;width:476.95pt;height:287.95pt" coordorigin="0,0" coordsize="9539,5759">` +
  '<v:rect id="shape_0" stroked="f" style="position:absolute;left:0;top:0;width:9538;height:5758"><v:fill on="false"/></v:rect>' +
  '<v:line id="shape_1" from="899,1439" to="5218,3957" stroked="t" style="position:absolute">' +
  '<v:stroke color="black" weight="9360" joinstyle="miter"/><v:fill on="false"/></v:line>' +
  '<v:line id="shape_2" from="1979,1079" to="3958,4317" stroked="t" style="position:absolute;flip:x">' +
  '<v:stroke color="black" weight="9360" joinstyle="miter"/><v:fill on="false"/></v:line>' +
  '</v:group></w:pict></w:r></w:p>'

const DOTTED_LINE =
  '<w:p><w:r><w:pict>' +
  `<v:line ${NS} id="shape_3" from="0,0" to="200pt,0" stroked="t" style="position:absolute;margin-left:10pt;margin-top:4pt">` +
  '<v:stroke color="#ff0000" weight="1pt" dashstyle="dot"/></v:line></w:pict></w:r></w:p>'

const CURVED_SHAPE =
  '<w:p><w:r><w:t>x</w:t></w:r><w:r><w:pict>' +
  `<v:shape ${NS} id="shape_4" coordsize="21600,21600" path="m,c0,10800,10800,21600,21600,21600xe" stroked="t" strokecolor="#ff0000" ` +
  'style="position:absolute;margin-left:10pt;margin-top:20pt;width:30pt;height:30pt"/></w:pict></w:r></w:p>'

const WMF_REL =
  '<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image5.wmf"/>'
const WMF_PART = {
  path: 'word/media/image5.wmf',
  base64: Buffer.from('not-a-real-wmf-payload').toString('base64'),
  extension: 'wmf',
  contentType: 'image/x-wmf',
}
const WMF_PICT = (rid: string) =>
  '<w:p><w:r><w:pict>' +
  `<v:shape ${NS} id="shape_5" type="#_x0000_t75" style="width:150pt;height:90pt">` +
  `<v:imagedata r:id="${rid}" o:title=""/></v:shape></w:pict></w:r></w:p>`

const decode = (url: string | undefined) => decodeURIComponent(url ?? '')

const unchangedSave = async (bytes: Uint8Array) => {
  const doc = await parseDocx(bytes)
  return saveDocx(
    doc,
    doc.blocks
      .filter((b) => !b.hidden)
      .map((b) => ({ kind: 'original' as const, docxIndex: b.docxIndex! })),
  )
}

describe('legacy .doc VML shapes', () => {
  it('a shape whose type is a bare shapetype id (no #) still draws its template geometry', async () => {
    const doc = await parseDocx(await buildDocx({ bodyXml: CHECKBOX_PARA }))
    const box = doc.blocks[0].textboxes?.[0]
    expect(box?.floating).toBe(true)
    expect(box?.widthPx).toBe(Math.round((9.7 / 72) * 96))
    const svg = decode(box?.fillImageDataUrl)
    expect(svg).toContain('<path d="M ')
    expect(svg).toContain('stroke="#000000"')
    // the paragraph text stays a real line next to the box
    expect(doc.blocks[0].previewText ?? '').not.toContain('Embedded')
  })

  it('v:line children of a v:group draw as SVG lines at their scaled group coordinates, flip:x mirrored', async () => {
    const doc = await parseDocx(await buildDocx({ bodyXml: LINE_GROUP }))
    const boxes = doc.blocks[0].textboxes ?? []
    expect(boxes).toHaveLength(2)
    const sx = (476.95 * 96) / 72 / 9539
    const [a, b] = boxes
    expect(a!.floating).toBe(true)
    expect(a!.widthPx! / (5218 - 899)).toBeGreaterThan(sx * 0.99)
    expect(decode(a!.fillImageDataUrl)).toMatch(
      /<line x1="[\d.]+" y1="[\d.]+" x2="[\d.]+" y2="[\d.]+" stroke="#000000"/,
    )
    // second line runs top-right -> bottom-left through flip:x
    const m = /x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/.exec(
      decode(b!.fillImageDataUrl),
    )!
    expect(parseFloat(m[1]!)).toBeGreaterThan(parseFloat(m[3]!))
    expect(parseFloat(m[2]!)).toBeLessThan(parseFloat(m[4]!))
  })

  it('a dotted v:line keeps color, weight and dash style at its pt margins', async () => {
    const doc = await parseDocx(await buildDocx({ bodyXml: DOTTED_LINE }))
    const box = doc.blocks[0].textboxes?.[0]
    expect(box?.floating).toBe(true)
    expect(box?.widthPx).toBeGreaterThan(266)
    const svg = decode(box?.fillImageDataUrl)
    expect(svg).toContain('stroke="#ff0000"')
    expect(svg).toContain('stroke-width="1.33"')
    expect(svg).toContain('stroke-dasharray="1.33 1.33"')
  })

  it('a visible shape with a curved path leaves a neutral frame of its size, not nothing', async () => {
    const doc = await parseDocx(await buildDocx({ bodyXml: CURVED_SHAPE }))
    const box = doc.blocks[0].textboxes?.[0]
    expect(box).toBeDefined()
    expect(box?.widthPx).toBe(40)
    expect(box?.heightPx).toBe(40)
    expect(box?.borderColor).toBe('9CA3AF')
    expect(box?.fill).toBeUndefined()
    expect(box?.pathData).toBeUndefined()
  })
})

describe('legacy .doc VML picture with a WMF', () => {
  it('rasterizes the WMF behind v:imagedata and keeps the declared size', async () => {
    const doc = await parseDocx(
      await buildDocx({
        bodyXml: WMF_PICT('rId10'),
        extraRels: WMF_REL,
        binaryParts: [WMF_PART],
      }),
    )
    const block = doc.blocks[0]
    expect(block.type).toBe('image')
    expect(block.imageDataUrl).toBe('data:image/png;base64,WMFPNG')
    expect(block.imageWidthPx).toBe(200)
    expect(block.imageHeightPx).toBe(120)
  })

  it('an unconvertible WMF leaves the empty frame at the declared size, not an unsized chip', async () => {
    vi.mocked(convertWmfToDataUrl).mockResolvedValue(null)
    try {
      const doc = await parseDocx(
        await buildDocx({
          bodyXml: WMF_PICT('rId10'),
          extraRels: WMF_REL,
          binaryParts: [WMF_PART],
        }),
      )
      const block = doc.blocks[0]
      expect(block.type).toBe('passthrough')
      expect(block.brokenImage).toBe(true)
      expect(block.imageWidthPx).toBe(200)
      expect(block.imageHeightPx).toBe(120)
    } finally {
      vi.mocked(convertWmfToDataUrl).mockResolvedValue('data:image/png;base64,WMFPNG')
    }
  })
})

describe('round trip', () => {
  it('rendering these shapes does not change the saved package: byte-identical without edits', async () => {
    for (const opts of [
      { bodyXml: CHECKBOX_PARA },
      { bodyXml: LINE_GROUP },
      { bodyXml: DOTTED_LINE },
      { bodyXml: CURVED_SHAPE },
      { bodyXml: WMF_PICT('rId10'), extraRels: WMF_REL, binaryParts: [WMF_PART] },
    ]) {
      const bytes = await buildDocx(opts)
      expect(await unchangedSave(bytes)).toBe(bytes)
    }
  })
})
