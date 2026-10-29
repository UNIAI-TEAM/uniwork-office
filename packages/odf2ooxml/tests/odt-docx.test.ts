import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  convertOdtToDocx,
  MAX_ODT_DOCUMENT_TABLE_CELLS,
  MAX_ODT_TABLE_CELLS,
  OdfConvertError,
} from '../src/index'

const NAMESPACES =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"' +
  ' xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"' +
  ' xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"' +
  ' xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"' +
  ' xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"' +
  ' xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"' +
  ' xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"' +
  ' xmlns:xlink="http://www.w3.org/1999/xlink"'

/** 1×1 red PNG */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

function contentXml(body: string, automaticStyles = ''): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NAMESPACES} office:version="1.2">` +
    `<office:automatic-styles>${automaticStyles}</office:automatic-styles>` +
    `<office:body><office:text>${body}</office:text></office:body></office:document-content>`
  )
}

function stylesXml(named: string, automatic = ''): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${NAMESPACES} office:version="1.2">` +
    `<office:styles>${named}</office:styles>` +
    `<office:automatic-styles>${automatic}</office:automatic-styles>` +
    `<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="PM1"/></office:master-styles>` +
    '</office:document-styles>'
  )
}

const PAGE_A4 =
  '<style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm"' +
  ' fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2cm" fo:margin-right="2cm"/></style:page-layout>'

async function buildOdt(content: string, styles?: string): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text')
  zip.file('content.xml', content)
  if (styles) zip.file('styles.xml', styles)
  return zip.generateAsync({ type: 'uint8array' })
}

async function readDocxEntry(docx: Uint8Array, path: string): Promise<string | null> {
  const zip = await JSZip.loadAsync(docx)
  const entry = zip.file(path)
  return entry ? entry.async('string') : null
}

async function docxHasMedia(docx: Uint8Array, suffix: string): Promise<boolean> {
  const zip = await JSZip.loadAsync(docx)
  return Object.keys(zip.files).some(
    (path) => path.startsWith('word/media/') && path.endsWith(suffix),
  )
}

describe('convertOdtToDocx', () => {
  it('maps headings, character formatting and hyperlinks', async () => {
    const body =
      '<text:h text:style-name="Heading_20_1" text:outline-level="1">Quarterly Report</text:h>' +
      '<text:p>plain <text:span text:style-name="T1">bold</text:span> tail</text:p>' +
      '<text:p>see <text:a xlink:type="simple" xlink:href="https://example.com/doc">the site</text:a></text:p>'
    const named =
      '<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold" fo:font-style="italic"/></style:style>'
    const result = await convertOdtToDocx(await buildOdt(contentXml(body), stylesXml(named)))
    const document = (await readDocxEntry(result.docx, 'word/document.xml')) ?? ''
    expect(document).toContain('w:pStyle w:val="Heading1"')
    expect(document).toContain('Quarterly Report')
    expect(document).toContain('<w:b/>')
    expect(document).toContain('<w:i/>')
    expect(document).toContain('bold')
    expect(document).toContain('<w:hyperlink')
    const rels = (await readDocxEntry(result.docx, 'word/_rels/document.xml.rels')) ?? ''
    expect(rels).toContain('https://example.com/doc')
  })

  it('resolves the parent style chain and character properties from styles.xml', async () => {
    const body = '<text:p text:style-name="P1">styled</text:p>'
    const named =
      '<style:style style:name="Base" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/></style:style>' +
      '<style:style style:name="P1" style:family="paragraph" style:parent-style-name="Base"><style:text-properties fo:color="#C9211E"/></style:style>'
    const result = await convertOdtToDocx(await buildOdt(contentXml(body), stylesXml(named)))
    const document = (await readDocxEntry(result.docx, 'word/document.xml')) ?? ''
    expect(document).toContain('<w:jc w:val="center"/>')
    expect(document).toContain('<w:color w:val="C9211E"/>')
  })

  it('keeps tabs, line breaks and repeated spaces', async () => {
    const body = '<text:p>a<text:tab/>b<text:line-break/>c<text:s text:c="3"/>d</text:p>'
    const result = await convertOdtToDocx(await buildOdt(contentXml(body)))
    const document = (await readDocxEntry(result.docx, 'word/document.xml')) ?? ''
    expect(document).toContain('<w:tab/>')
    expect(document).toContain('<w:br/>')
    expect(document).toContain('c   d')
  })

  it('imports lists with per-level bullet and number formats', async () => {
    const body =
      '<text:list text:style-name="L1"><text:list-item><text:p>first</text:p>' +
      '<text:list text:style-name="L1"><text:list-item><text:p>sub</text:p></text:list-item></text:list>' +
      '</text:list-item><text:list-item><text:p>second</text:p></text:list-item></text:list>'
    const listStyle =
      '<text:list-style style:name="L1">' +
      '<text:list-level-style-bullet text:level="1" style:bullet-char="•">' +
      '<style:list-level-properties text:space-before="0.5cm" text:min-label-width="0.4cm"/></text:list-level-style-bullet>' +
      '<text:list-level-style-number text:level="2" style:num-format="1" style:num-suffix=".">' +
      '<style:list-level-properties text:space-before="1cm" text:min-label-width="0.4cm"/></text:list-level-style-number>' +
      '</text:list-style>'
    const result = await convertOdtToDocx(await buildOdt(contentXml(body, listStyle)))
    const document = (await readDocxEntry(result.docx, 'word/document.xml')) ?? ''
    expect(document).toContain('<w:numPr>')
    const numbering = (await readDocxEntry(result.docx, 'word/numbering.xml')) ?? ''
    expect(numbering).toContain('w:numFmt w:val="bullet"')
    expect(numbering).toContain('w:numFmt w:val="decimal"')
    expect(numbering).toContain('w:lvlText w:val="%2."')
  })

  it('imports a table with widths, spans and a cell fill', async () => {
    const automatic =
      '<style:style style:name="co1" style:family="table-column"><style:column-properties style:column-width="3cm"/></style:style>' +
      '<style:style style:name="ce1" style:family="table-cell"><style:table-cell-properties fo:background-color="#ffff99"/></style:style>'
    const body =
      '<table:table table:name="T" table:style-name="T1">' +
      '<table:table-column table:style-name="co1" table:number-columns-repeated="2"/>' +
      '<table:table-row><table:table-cell table:style-name="ce1" office:value-type="string" table:number-columns-spanned="2"><text:p>wide</text:p></table:table-cell></table:table-row>' +
      '<table:table-row><table:table-cell><text:p>left</text:p></table:table-cell><table:table-cell><text:p>right</text:p></table:table-cell></table:table-row>' +
      '</table:table>'
    const result = await convertOdtToDocx(await buildOdt(contentXml(body, automatic)))
    const document = (await readDocxEntry(result.docx, 'word/document.xml')) ?? ''
    expect(document).toContain('<w:tbl>')
    expect(document).toContain('<w:gridSpan w:val="2"/>')
    expect(document).toContain('w:fill="FFFF99"')
    expect(document).toContain(
      '<w:tblGrid><w:gridCol w:w="1701"/><w:gridCol w:w="1701"/></w:tblGrid>',
    )
  })

  it('does not shift cells when a vertical merge emits covered-table-cell elements', async () => {
    // LibreOffice writes <table:covered-table-cell/> in the row below a vertical
    // merge; the occupancy grid already reserves those slots from rowSpan, so
    // emitting a cell for covered-table-cell would shift the remaining cells
    // right and drop the last column.
    const body =
      '<table:table table:name="Bang1">' +
      '<table:table-column table:number-columns-repeated="3"/>' +
      '<table:table-row>' +
      '<table:table-cell table:number-columns-spanned="3"><text:p>Header 3 cols</text:p></table:table-cell>' +
      '<table:covered-table-cell/><table:covered-table-cell/>' +
      '</table:table-row>' +
      '<table:table-row>' +
      '<table:table-cell table:number-rows-spanned="2"><text:p>Span 2 rows</text:p></table:table-cell>' +
      '<table:table-cell><text:p>B2</text:p></table:table-cell>' +
      '<table:table-cell><text:p>C2</text:p></table:table-cell>' +
      '</table:table-row>' +
      '<table:table-row>' +
      '<table:covered-table-cell/>' +
      '<table:table-cell><text:p>B3</text:p></table:table-cell>' +
      '<table:table-cell><text:p>C3</text:p></table:table-cell>' +
      '</table:table-row>' +
      '</table:table>'
    const result = await convertOdtToDocx(await buildOdt(contentXml(body)))
    const document = (await readDocxEntry(result.docx, 'word/document.xml')) ?? ''
    expect(document).toContain('<w:vMerge w:val="restart"/>')
    expect(document).toContain('<w:vMerge/>')
    expect(document).toContain('B2')
    expect(document).toContain('C2')
    expect(document).toContain('B3')
    expect(document).toContain('C3')
    const rows = [...document.matchAll(/<w:tr>([\s\S]*?)<\/w:tr>/g)].map((m) => m[1])
    expect(rows).toHaveLength(3)
    // Row 3 has 3 cells: the vMerge continuation, B3, and C3
    const row3Cells = [...rows[2].matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map((m) => m[1])
    expect(row3Cells).toHaveLength(3)
    expect(row3Cells[0]).toContain('<w:vMerge/>')
    expect(row3Cells[1]).toContain('B3')
    expect(row3Cells[2]).toContain('C3')
  })

  it('clamps oversized and non-finite row/column spans to existing table dimensions instead of hanging or OOM', async () => {
    // Reviewer B1 case 1: 1x1 table declaring table:number-rows-spanned="1000000"
    const spanMillion =
      '<table:table><table:table-column/>' +
      '<table:table-row><table:table-cell table:number-rows-spanned="1000000"><text:p>X</text:p></table:table-cell></table:table-row>' +
      '</table:table>'
    const r1 = await convertOdtToDocx(await buildOdt(contentXml(spanMillion)))
    const doc1 = (await readDocxEntry(r1.docx, 'word/document.xml')) ?? ''
    expect([...doc1.matchAll(/<w:tr>/g)]).toHaveLength(1)
    expect(doc1).toContain('X')
    expect(doc1).not.toContain('vMerge')

    // Reviewer B1 case 2: 1x1 table declaring table:number-rows-spanned="Infinity" and non-integer colSpan
    const spanInfinity =
      '<table:table><table:table-column/>' +
      '<table:table-row><table:table-cell table:number-rows-spanned="Infinity" table:number-columns-spanned="Infinity"><text:p>Y</text:p></table:table-cell></table:table-row>' +
      '</table:table>'
    const r2 = await convertOdtToDocx(await buildOdt(contentXml(spanInfinity)))
    const doc2 = (await readDocxEntry(r2.docx, 'word/document.xml')) ?? ''
    expect([...doc2.matchAll(/<w:tr>/g)]).toHaveLength(1)
    expect(doc2).toContain('Y')
  })

  it('refuses tables that exceed the per-table or per-document occupancy cell budget', async () => {
    // Single table over MAX_ODT_TABLE_CELLS (200 rows x 600 cols = 120,000 > 100,000)
    const rowXml =
      '<table:table-row><table:table-cell><text:p>x</text:p></table:table-cell></table:table-row>'
    const overTable =
      '<table:table>' +
      '<table:table-column table:number-columns-repeated="600"/>' +
      rowXml.repeat(200) +
      '</table:table>'
    expect(600 * 200).toBeGreaterThan(MAX_ODT_TABLE_CELLS)
    await expect(convertOdtToDocx(await buildOdt(contentXml(overTable)))).rejects.toThrow(
      new OdfConvertError('unreadable'),
    )

    // Three tables each within MAX_ODT_TABLE_CELLS (90,000 cells each) whose sum (270,000) exceeds MAX_ODT_DOCUMENT_TABLE_CELLS (250,000)
    const oneTable90k =
      '<table:table>' +
      '<table:table-column table:number-columns-repeated="900"/>' +
      rowXml.repeat(100) +
      '</table:table>'
    expect(900 * 100).toBeLessThanOrEqual(MAX_ODT_TABLE_CELLS)
    expect(900 * 100 * 3).toBeGreaterThan(MAX_ODT_DOCUMENT_TABLE_CELLS)
    await expect(
      convertOdtToDocx(await buildOdt(contentXml(oneTable90k.repeat(3)))),
    ).rejects.toThrow(new OdfConvertError('unreadable'))
  })

  it('preserves text:index-title paragraphs inside a table of contents without reporting unhandled-blocks', async () => {
    const body =
      '<text:table-of-content text:name="Table of Contents1">' +
      '<text:table-of-content-source text:outline-level="10">' +
      '<text:index-title-template text:style-name="Contents_20_Heading">Mục lục</text:index-title-template>' +
      '</text:table-of-content-source>' +
      '<text:index-body>' +
      '<text:index-title text:name="Table of Contents1_Head">' +
      '<text:p text:style-name="Contents_20_Heading">Mục lục</text:p>' +
      '</text:index-title>' +
      '<text:p text:style-name="Contents_20_1">1. Giới thiệu OpenDocument<text:tab/>1</text:p>' +
      '</text:index-body>' +
      '</text:table-of-content>'
    const result = await convertOdtToDocx(await buildOdt(contentXml(body)))
    expect(result.dropped).toEqual([])
    const document = (await readDocxEntry(result.docx, 'word/document.xml')) ?? ''
    expect(document).toContain('Mục lục')
    expect(document).toContain('1. Giới thiệu OpenDocument')
  })

  it('carries the page geometry into the section properties', async () => {
    const body = '<text:p>page</text:p>'
    const result = await convertOdtToDocx(await buildOdt(contentXml(body), stylesXml('', PAGE_A4)))
    const document = (await readDocxEntry(result.docx, 'word/document.xml')) ?? ''
    // 21cm → 11906 twips, 29.7cm → 16838 twips, 2cm → 1134
    expect(document).toContain('w:pgSz w:w="11906" w:h="16838"')
    expect(document).toContain('w:pgMar w:top="1134"')
  })

  it('imports framed and inline images', async () => {
    const body =
      '<text:p>before</text:p>' +
      `<draw:frame svg:width="4cm" svg:height="3cm"><draw:image xlink:href="Pictures/red.png"/></draw:frame>` +
      '<text:p>with <draw:frame svg:x="0cm" svg:y="0cm" svg:width="2cm" svg:height="2cm"><draw:image xlink:href="Pictures/red.png"/></draw:frame> inline</text:p>'
    const zip = new JSZip()
    zip.file('content.xml', contentXml(body))
    zip.file('Pictures/red.png', PNG_BASE64, { base64: true })
    const result = await convertOdtToDocx(await zip.generateAsync({ type: 'uint8array' }))
    expect(await docxHasMedia(result.docx, '.png')).toBe(true)
    const document = (await readDocxEntry(result.docx, 'word/document.xml')) ?? ''
    expect(document).toContain('<w:drawing>')
  })

  it('does not blame the first table for an image a paragraph already emitted', async () => {
    // The paragraph's inline image is collected in the shared walk context; a
    // table cell only has its own images to account for, so a leftover from
    // the paragraph above would be counted as dropped here.
    const body =
      '<text:p>with <draw:frame svg:x="0cm" svg:y="0cm" svg:width="2cm" svg:height="2cm"><draw:image xlink:href="Pictures/red.png"/></draw:frame> inline</text:p>' +
      '<table:table table:name="T">' +
      '<table:table-row><table:table-cell><text:p>left</text:p></table:table-cell></table:table-row>' +
      '</table:table>'
    const zip = new JSZip()
    zip.file('content.xml', contentXml(body))
    zip.file('Pictures/red.png', PNG_BASE64, { base64: true })
    const result = await convertOdtToDocx(await zip.generateAsync({ type: 'uint8array' }))
    // the image really is in the package, so nothing was dropped
    expect(await docxHasMedia(result.docx, '.png')).toBe(true)
    expect(result.dropped).not.toContainEqual(expect.objectContaining({ what: 'images' }))
    // and the table is still imported
    expect((await readDocxEntry(result.docx, 'word/document.xml')) ?? '').toContain('<w:tbl>')
  })

  it('still counts an image a table cell cannot hold', async () => {
    const body =
      '<table:table table:name="T">' +
      '<table:table-row><table:table-cell><text:p><draw:frame svg:x="0cm" svg:y="0cm" svg:width="2cm" svg:height="2cm"><draw:image xlink:href="Pictures/red.png"/></draw:frame></text:p></table:table-cell></table:table-row>' +
      '</table:table>'
    const zip = new JSZip()
    zip.file('content.xml', contentXml(body))
    zip.file('Pictures/red.png', PNG_BASE64, { base64: true })
    const result = await convertOdtToDocx(await zip.generateAsync({ type: 'uint8array' }))
    expect(result.dropped).toContainEqual({ what: 'images', count: 1 })
    expect(await docxHasMedia(result.docx, '.png')).toBe(false)
  })

  it('does not report an empty office:forms as a dropped block, but does report form controls', async () => {
    const FORM_NS = 'xmlns:form="urn:oasis:names:tc:opendocument:xmlns:form:1.0"'
    const empty =
      `<office:forms ${FORM_NS} form:automatic-focus="false" form:apply-design-mode="false"/>` +
      '<text:p>hello</text:p>'
    const emptyResult = await convertOdtToDocx(await buildOdt(contentXml(empty)))
    expect(emptyResult.dropped).not.toContainEqual(
      expect.objectContaining({ what: 'unhandled-blocks' }),
    )
    const withControl =
      `<office:forms ${FORM_NS}><form:form form:name="F1"><form:text form:name="t"/></form:form></office:forms>` +
      '<text:p>hello</text:p>'
    const controlResult = await convertOdtToDocx(await buildOdt(contentXml(withControl)))
    expect(controlResult.dropped).toContainEqual({ what: 'unhandled-blocks', count: 1 })
  })

  it('counts constructs it cannot represent instead of guessing', async () => {
    const body =
      '<text:p>keep <text:note text:id="n1" text:note-class="footnote"><text:note-body><text:p>lost</text:p></text:note-body></text:note></text:p>' +
      '<draw:rect svg:width="1cm" svg:height="1cm"/>'
    const result = await convertOdtToDocx(await buildOdt(contentXml(body)))
    expect(result.dropped).toContainEqual({ what: 'footnotes', count: 1 })
    expect(result.dropped).toContainEqual({ what: 'shapes', count: 1 })
    const document = (await readDocxEntry(result.docx, 'word/document.xml')) ?? ''
    expect(document).toContain('keep')
    expect(document).not.toContain('lost')
  })

  it('reports master-page headers/footers and tracked changes in dropped', async () => {
    const body =
      '<text:tracked-changes text:track-changes="true">' +
      '<text:changed-region text:id="ct1"><text:insertion><office:change-info/></text:insertion></text:changed-region>' +
      '<text:changed-region text:id="ct2"><text:deletion><office:change-info/><text:p>deleted words</text:p></text:deletion></text:changed-region>' +
      '</text:tracked-changes>' +
      '<text:p>body with <text:change-start text:change-id="ct1"/>inserted<text:change-end text:change-id="ct1"/> and <text:change text:change-id="ct2"/>text</text:p>'
    const styles =
      `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${NAMESPACES} office:version="1.2">` +
      '<office:master-styles>' +
      '<style:master-page style:name="Standard" style:page-layout-name="PM1">' +
      '<style:header><text:p>Header text</text:p></style:header>' +
      '<style:footer><text:p>Footer text</text:p></style:footer>' +
      '<style:header-left style:display="false"><text:p>Hidden</text:p></style:header-left>' +
      '</style:master-page>' +
      '</office:master-styles>' +
      '</office:document-styles>'
    const result = await convertOdtToDocx(await buildOdt(contentXml(body), styles))
    expect(result.dropped).toEqual([
      { what: 'headers-footers', count: 2 },
      { what: 'tracked-changes', count: 2 },
    ])
    const document = (await readDocxEntry(result.docx, 'word/document.xml')) ?? ''
    expect(document).toContain('body with inserted and text')
    expect(document).not.toContain('deleted words')
  })

  it('flattens a text frame into the flow and says so', async () => {
    const body =
      '<draw:frame svg:width="8cm" svg:height="2cm"><draw:text-box><text:p>boxed words</text:p></draw:text-box></draw:frame>'
    const result = await convertOdtToDocx(await buildOdt(contentXml(body)))
    expect(result.dropped).toContainEqual({ what: 'textboxes-flattened', count: 1 })
    const document = (await readDocxEntry(result.docx, 'word/document.xml')) ?? ''
    expect(document).toContain('boxed words')
  })

  it('accepts .ott templates (a -template mimetype, same body shape)', async () => {
    const body = '<text:h text:outline-level="1">From a template</text:h><text:p>body</text:p>'
    const zip = new JSZip()
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text-template')
    zip.file('content.xml', contentXml(body))
    const result = await convertOdtToDocx(await zip.generateAsync({ type: 'uint8array' }))
    const document = (await readDocxEntry(result.docx, 'word/document.xml')) ?? ''
    expect(document).toContain('From a template')
  })

  it('rejects bytes that are not an ODF package and zips with no text body', async () => {
    await expect(convertOdtToDocx(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: 'unreadable',
    })
    await expect(
      convertOdtToDocx(
        await buildOdt(
          contentXml('<text:p>x</text:p>').replace('office:text', 'office:wordprocessing'),
        ),
      ),
    ).rejects.toBeInstanceOf(OdfConvertError)
  })
})
