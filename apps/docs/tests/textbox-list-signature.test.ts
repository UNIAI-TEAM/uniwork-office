/**
 * The textbox paragraph signature must react to list identity alone: toggling
 * a list on an untouched paragraph (same runs, same align) has to reach the
 * byte patch. Marker TEXT stays out of the signature on purpose — per-box
 * counters are recomputed on both sides.
 */
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import {
  blocksToPmDoc,
  pmDocToSavePlan,
  textboxParaSignature,
  type PmNode,
} from '../src/renderer/editor/convert'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { insertShapeAt, insertTextboxAt } from '../src/renderer/components/ribbon-tabs'
import {
  EMPTY_PENDING_NUMBERING,
  type DocState,
  type PendingNumbering,
} from '../src/renderer/doc-state'
import {
  allocateListNumId,
  pruneUnreferencedNumbering,
  type NumberingContext,
} from '../src/renderer/numbering-actions'
import { parseDocx, saveDocx, type TextboxDisplay } from '@genoffice/docx-engine'
import { buildDocx } from '../../../packages/docx-engine/tests/helpers/build-docx'

type Para = TextboxDisplay['paras'][number]

const para = (over: Partial<Para> = {}): Para => ({ runs: [], ...over })

describe('textboxParaSignature list identity', () => {
  it('distinguishes the same paragraph with and without a list', () => {
    const plain = para()
    const listed = para({ listMarker: { text: '•', numId: '7', ilvl: 0, kind: 'bullet' } })
    expect(textboxParaSignature(plain)).not.toEqual(textboxParaSignature(listed))
  })

  it('distinguishes numId and ilvl, ignores marker text drift', () => {
    const a = para({ listMarker: { text: '1.', numId: '7', ilvl: 0, kind: 'ordered' } })
    const b = para({ listMarker: { text: '3.', numId: '7', ilvl: 0, kind: 'ordered' } })
    const c = para({ listMarker: { text: '1.', numId: '8', ilvl: 0, kind: 'ordered' } })
    const d = para({ listMarker: { text: '1.', numId: '7', ilvl: 1, kind: 'ordered' } })
    expect(textboxParaSignature(a)).toEqual(textboxParaSignature(b))
    expect(textboxParaSignature(a)).not.toEqual(textboxParaSignature(c))
    expect(textboxParaSignature(a)).not.toEqual(textboxParaSignature(d))
  })
})

describe('textboxParaSignature indent', () => {
  it('reacts to a moved left indent on otherwise identical paragraphs', () => {
    expect(textboxParaSignature(para())).not.toEqual(
      textboxParaSignature(para({ indentLeft: 720 })),
    )
  })
})

function makeNumberingHarness(editor: Editor, parsed: DocState['parsed']) {
  let pending: PendingNumbering = EMPTY_PENDING_NUMBERING
  const floor = { current: 0 }
  const doc: DocState = { parsed, filePath: null, fileName: 'test.docx', hash: '' }
  const ctx = (): NumberingContext => ({
    editor,
    doc,
    pendingNumbering: pending,
    setPendingNumbering: (update) => {
      pending = update(pending)
    },
    numIdFloorRef: floor,
    setStatus: () => {},
  })
  return {
    allocate: (kind: 'bullet' | 'ordered') => allocateListNumId(ctx(), kind),
    getPending: () => pending,
  }
}

describe('textbox list and indent save round-trip (DOCS-V21)', () => {
  it('persists bullets, numbering, and indent made inside a new Simple Text Box and defines numIds in numbering.xml', async () => {
    const source = await buildDocx({ bodyXml: '<w:p><w:r><w:t>Body text</w:t></w:r></w:p>' })
    const parsed = await parseDocx(source)
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: blocksToPmDoc(parsed.blocks) as never,
    })
    editor.storage.listNumbering.defs = parsed.numbering
    const numbering = makeNumberingHarness(editor, parsed)

    const pos = insertTextboxAt(editor)
    expect(pos).not.toBeNull()
    const subDom = editor.view.dom.querySelector('.doc-textbox .doc-textbox-editor')
    const sub = (subDom as (HTMLElement & { editor?: Editor }) | null)?.editor
    expect(sub).toBeDefined()

    const bulletNumId = numbering.allocate('bullet')!
    const orderedNumId = numbering.allocate('ordered')!
    expect(bulletNumId).toBeTruthy()
    expect(orderedNumId).toBeTruthy()

    // Build paragraphs inside the sub-editor using the same commands Ribbon.tsx dispatches:
    // Alpha (bullet), Beta (bullet + indent 720), Gamma (ordered 1.), Delta (ordered 2.)
    sub!
      .chain()
      .setContent({
        type: 'doc',
        content: [
          {
            type: 'docParagraph',
            attrs: { listMarker: { text: '•', kind: 'bullet', numId: bulletNumId, ilvl: 0 } },
            content: [{ type: 'text', text: 'Alpha' }],
          },
          {
            type: 'docParagraph',
            attrs: {
              listMarker: { text: '•', kind: 'bullet', numId: bulletNumId, ilvl: 0 },
              indentLeft: 720,
            },
            content: [{ type: 'text', text: 'Beta' }],
          },
          {
            type: 'docParagraph',
            attrs: { listMarker: { text: '1.', kind: 'ordered', numId: orderedNumId, ilvl: 0 } },
            content: [{ type: 'text', text: 'Gamma' }],
          },
          {
            type: 'docParagraph',
            attrs: { listMarker: { text: '1.', kind: 'ordered', numId: orderedNumId, ilvl: 0 } },
            content: [{ type: 'text', text: 'Delta' }],
          },
        ],
      })
      .run()

    window.dispatchEvent(new Event('ai-docs-commit-tables'))

    const pmJson = editor.getJSON() as PmNode
    const pruned = pruneUnreferencedNumbering(numbering.getPending(), pmJson)
    expect(pruned.newDefs.map((d) => d.numId)).toEqual([bulletNumId, orderedNumId])

    const plan = pmDocToSavePlan(pmJson, parsed.blocks)
    const xmlBlock = plan.saveBlocks.find((b) => b.kind === 'xml') as
      { kind: 'xml'; xml: string } | undefined
    expect(xmlBlock?.xml).toContain(
      `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${bulletNumId}"/></w:numPr>`,
    )
    expect(xmlBlock?.xml).toContain(
      `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${orderedNumId}"/></w:numPr>`,
    )
    expect(xmlBlock?.xml).toContain('<w:ind w:left="720" w:leftChars="0"/>')

    const saved = await saveDocx(parsed, plan.saveBlocks, { numbering: pruned })
    const reparsed = await parseDocx(saved)
    expect(reparsed.numbering.has(bulletNumId)).toBe(true)
    expect(reparsed.numbering.has(orderedNumId)).toBe(true)

    const box = reparsed.blocks.find((b) => b.textboxes)?.textboxes?.[0]
    expect(box?.paras.map((p) => p.runs.map((r) => r.text).join(''))).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
      'Delta',
    ])
    expect(box?.paras[0].listMarker).toMatchObject({
      numId: bulletNumId,
      ilvl: 0,
      kind: 'bullet',
    })
    expect(box?.paras[1].listMarker).toMatchObject({
      numId: bulletNumId,
      ilvl: 0,
      kind: 'bullet',
    })
    expect(box?.paras[1].indentLeft).toBe(720)
    expect(box?.paras[2].listMarker).toMatchObject({
      text: '1.',
      numId: orderedNumId,
      ilvl: 0,
      kind: 'ordered',
    })
    expect(box?.paras[3].listMarker).toMatchObject({
      text: '2.',
      numId: orderedNumId,
      ilvl: 0,
      kind: 'ordered',
    })
    editor.destroy()
  })

  it('persists lists and indent inside a newly inserted shape', async () => {
    const source = await buildDocx({ bodyXml: '<w:p><w:r><w:t>Body text</w:t></w:r></w:p>' })
    const parsed = await parseDocx(source)
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: blocksToPmDoc(parsed.blocks) as never,
    })
    editor.storage.listNumbering.defs = parsed.numbering
    const numbering = makeNumberingHarness(editor, parsed)

    insertShapeAt(editor, 'rect')
    const subDom = editor.view.dom.querySelector('.doc-textbox .doc-textbox-editor')
    const sub = (subDom as (HTMLElement & { editor?: Editor }) | null)?.editor
    expect(sub).toBeDefined()

    const numId = numbering.allocate('bullet')!
    sub!
      .chain()
      .setContent({
        type: 'doc',
        content: [
          {
            type: 'docParagraph',
            attrs: {
              align: 'center',
              listMarker: { text: '•', kind: 'bullet', numId, ilvl: 0 },
              indentLeft: 720,
            },
            content: [{ type: 'text', text: 'Shape item' }],
          },
        ],
      })
      .run()

    window.dispatchEvent(new Event('ai-docs-commit-tables'))
    const pmJson = editor.getJSON() as PmNode
    const pruned = pruneUnreferencedNumbering(numbering.getPending(), pmJson)
    const plan = pmDocToSavePlan(pmJson, parsed.blocks)
    const saved = await saveDocx(parsed, plan.saveBlocks, { numbering: pruned })
    const reparsed = await parseDocx(saved)
    const box = reparsed.blocks.find((b) => b.textboxes)?.textboxes?.[0]
    expect(box?.paras[0].runs[0].text).toBe('Shape item')
    expect(box?.paras[0].listMarker).toMatchObject({ numId, ilvl: 0, kind: 'bullet' })
    expect(box?.paras[0].indentLeft).toBe(720)
    editor.destroy()
  })

  it('round-trips list and indent changes on an existing (parsed) textbox', async () => {
    const numberingXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
      '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
      '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
      '</w:numbering>'
    const txbx =
      '<w:txbxContent>' +
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Second</w:t></w:r></w:p>' +
      '</w:txbxContent>'
    const bodyXml =
      '<w:p><w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">' +
      '<mc:Choice Requires="wps"><w:drawing>' +
      '<wp:anchor behindDoc="0" simplePos="0" locked="0" layoutInCell="1" allowOverlap="1">' +
      '<wp:simplePos x="0" y="0"/><wp:extent cx="1800000" cy="1080000"/>' +
      '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
      '<wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
      '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1800000" cy="1080000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>' +
      `<wps:txbx>${txbx}</wps:txbx><wps:bodyPr/></wps:wsp>` +
      '</a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>' +
      `<mc:Fallback><w:pict><v:rect xmlns:v="urn:schemas-microsoft-com:vml"><v:textbox>${txbx}</v:textbox></v:rect></w:pict></mc:Fallback>` +
      '</mc:AlternateContent></w:r></w:p>'

    const parsed = await parseDocx(await buildDocx({ bodyXml, numberingXml }))
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: blocksToPmDoc(parsed.blocks) as never,
    })
    editor.storage.listNumbering.defs = parsed.numbering

    const subDom = editor.view.dom.querySelector('.doc-textbox .doc-textbox-editor')
    const sub = (subDom as (HTMLElement & { editor?: Editor }) | null)?.editor
    expect(sub).toBeDefined()

    // Change First from bullet (numId 1) to plain paragraph with indent 1440,
    // and Second from plain to ordered list (numId 2)
    sub!
      .chain()
      .setContent({
        type: 'doc',
        content: [
          {
            type: 'docParagraph',
            attrs: { listMarker: null, indentLeft: 1440 },
            content: [{ type: 'text', text: 'First' }],
          },
          {
            type: 'docParagraph',
            attrs: { listMarker: { text: '1.', kind: 'ordered', numId: '2', ilvl: 0 } },
            content: [{ type: 'text', text: 'Second' }],
          },
        ],
      })
      .run()

    window.dispatchEvent(new Event('ai-docs-commit-tables'))
    const plan = pmDocToSavePlan(editor.getJSON() as PmNode, parsed.blocks)
    expect(plan.changedCount).toBe(1)
    const saved = await saveDocx(parsed, plan.saveBlocks)
    const reparsed = await parseDocx(saved)
    const box = reparsed.blocks.find((b) => b.textboxes)?.textboxes?.[0]
    expect(box?.paras[0].listMarker).toBeUndefined()
    expect(box?.paras[0].indentLeft).toBe(1440)
    expect(box?.paras[1].listMarker).toMatchObject({
      text: '1.',
      numId: '2',
      ilvl: 0,
      kind: 'ordered',
    })
    editor.destroy()
  })
})
