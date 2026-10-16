import { describe, expect, it } from 'vitest'
import type { Block } from '@genoffice/docx-engine'
import {
  CHARS_PER_BLOCK,
  HUGE_DOC_REFUSE_CHARS,
  HUGE_DOC_REFUSE_WEIGHT,
  LARGE_DOC_READ_ONLY_WEIGHT,
  LITE_DOC_WEIGHT,
  docTextLength,
  docWeight,
  openTierFor,
  refusalMeasureFor,
} from '../src/renderer/large-document'

describe('openTierFor', () => {
  it('tiers by weight with inclusive lower bounds', () => {
    expect(openTierFor(0)).toBe('normal')
    expect(openTierFor(LITE_DOC_WEIGHT)).toBe('normal')
    expect(openTierFor(LITE_DOC_WEIGHT + 1)).toBe('lite')
    expect(openTierFor(LARGE_DOC_READ_ONLY_WEIGHT)).toBe('lite')
    expect(openTierFor(LARGE_DOC_READ_ONLY_WEIGHT + 1)).toBe('readOnly')
    expect(openTierFor(HUGE_DOC_REFUSE_WEIGHT)).toBe('readOnly')
    expect(openTierFor(HUGE_DOC_REFUSE_WEIGHT + 1)).toBe('refuse')
  })
})

const para = (text: string): Block =>
  ({ id: 'p', type: 'paragraph', docxIndex: null, originalXml: null, runs: [{ text }] }) as Block

const table = (cells: string[][], nested?: Block): Block =>
  ({
    id: 't',
    type: 'table',
    docxIndex: null,
    originalXml: null,
    table: {
      rows: cells.map((row) =>
        row.map((text) => ({
          paras: [text],
          ...(nested ? { nestedTables: [nested.table] } : {}),
        })),
      ),
    },
  }) as unknown as Block

describe('docWeight', () => {
  it('counts blocks plus characters of paragraph runs and table cells, nested tables included', () => {
    const blocks = [para('a'.repeat(220)), table([['bb', 'cc']], table([['dddd']]))]
    expect(docTextLength(blocks)).toBe(220 + 4 + 4 + 4)
    expect(docWeight(blocks)).toBe(2 + Math.round(232 / CHARS_PER_BLOCK))
  })

  it('a long-paragraph document outweighs a short one with more blocks', () => {
    const short = Array.from({ length: 300 }, () => para('x'.repeat(100)))
    const long = Array.from({ length: 100 }, () => para('x'.repeat(700)))
    expect(docWeight(long)).toBeGreaterThan(docWeight(short))
  })

  it('refusalMeasureFor reports paragraphs when block count dominates and characters when text length dominates', () => {
    const manyBlocks = Array.from({ length: 10 }, () => para('x'))
    expect(refusalMeasureFor(manyBlocks)).toEqual({
      kind: 'paragraphs',
      value: 10,
      limit: HUGE_DOC_REFUSE_WEIGHT,
    })
    const longText = [para('x'.repeat(1_000))]
    expect(refusalMeasureFor(longText)).toEqual({
      kind: 'characters',
      value: 1_000,
      limit: HUGE_DOC_REFUSE_CHARS,
    })
  })
})

describe('loadFile refuse tier (SIZE-F1)', () => {
  it(
    'returns refused (never failed -> blank Untitled.docx), clears and locks the editor, and reports open_refused',
    { timeout: 20_000 },
    async () => {
      const JSZip = (await import('jszip')).default
      const { buildBlankDocx } = await import('@genoffice/docx-engine')
      const { loadFile, newFile } = await import('../src/renderer/file-actions')
      const { setDocBytesResolver } = await import('../src/renderer/doc-bytes')
      const { setToastEmitter } = await import('../src/renderer/components/toast-bus')
      const { setModuleLang, statusText, t } = await import('../src/renderer/i18n/locale')

      const blankBytes = await buildBlankDocx()
      const zip = await JSZip.loadAsync(blankBytes)
      const paraText = 'a'.repeat(10_500)
      const paraXml = `<w:p><w:r><w:t>${paraText}</w:t></w:r></w:p>`
      const body = Array.from({ length: 2_500 }, () => paraXml).join('')
      zip.file(
        'word/document.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
          `<w:body>${body}</w:body></w:document>`,
      )
      const hugeBytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
      const dataUrl = 'in-memory://huge-docx'
      setDocBytesResolver((url) => (url === dataUrl ? hugeBytes : undefined))

      const reported: unknown[] = []
      const toasts: Array<{ text: string; kind: string }> = []
      setToastEmitter((toast) => toasts.push(toast))
      const g = globalThis as unknown as {
        window?: Record<string, unknown>
        document?: Record<string, unknown>
      }
      g.window = g.window ?? {}
      g.window.desktop = {
        reportOpenRefused: (p: unknown) => reported.push(p),
        docPasswordIntentRevision: async () => 0,
        discardDocPasswordIntents: async () => {},
      }
      g.document = g.document ?? { activeElement: null, body: {} }

      let docState: unknown = {
        fileName: 'Previous.docx',
        filePath: 'uniwork://files/f1/Prev.docx',
      }
      let readModeState = false
      let refusedMessageState: unknown = ''
      let editableState = true
      let clearedCount = 0
      const chainObj = {
        setMeta: () => chainObj,
        clearContent: () => {
          clearedCount += 1
          return chainObj
        },
        setContent: () => chainObj,
        run: () => true,
      }
      const fakeEditor = {
        isDestroyed: false,
        isEditable: true,
        state: { plugins: [] },
        storage: {
          tabStops: {},
          listNumbering: {},
          justifyShrink: {},
          cjkPunctShrink: {},
        },
        chain: () => chainObj,
        commands: {
          setContent: () => {},
          focus: () => {},
        },
        setEditable: (v: boolean) => {
          editableState = v
          fakeEditor.isEditable = v
        },
        view: { dom: { setAttribute: () => {}, removeAttribute: () => {} } },
      }
      const ctx = {
        editor: fakeEditor as never,
        doc: docState as never,
        dirtyRef: { current: true },
        saveInFlightRef: { current: false },
        saveIncompleteRef: { current: false },
        pendingMixedExportRef: { current: false as const },
        bumpPendingExportTick: () => {},
        printAutoOpenedPreviewRef: { current: false },
        setShowPrintDialog: () => {},
        setStatus: () => {},
        setRefusedMessage: (v: unknown) => {
          refusedMessageState = v
        },
        setRecent: () => {},
        setShowAi: () => {},
        setDoc: (v: unknown) => {
          docState = typeof v === 'function' ? (v as (p: unknown) => unknown)(docState) : v
        },
        setAiPanelKey: () => {},
        setDocCss: () => {},
        setDocLoading: () => {},
        setReadMode: (v: boolean) => {
          readModeState = v
        },
        setLargeDocSpellOff: () => {},
        setShowPagePreview: () => {},
        section: null,
        sectionDirty: false,
        sections: [],
        sectionsDirty: [],
        trailingStartType: null,
        setSection: () => {},
        setSections: () => {},
        setSectionDirty: () => {},
        setSectionsDirty: () => {},
        setTrailingStartType: () => {},
        pageColor: null,
        pageColorDirty: false,
        setPageColor: () => {},
        setPageColorDirty: () => {},
        header: null,
        headerDirty: false,
        footer: null,
        footerDirty: false,
        setHeader: () => {},
        setHeaderDirty: () => {},
        setFooter: () => {},
        setFooterDirty: () => {},
        hfVariants: {},
        hfVariantsDirty: [],
        setHfVariants: () => {},
        setHfVariantsDirty: () => {},
        sectionHfEdits: {},
        setSectionHfEdits: () => {},
        hfLinks: {},
        setHfLinks: () => {},
        titlePg: false,
        titlePgDirty: false,
        evenOddHf: false,
        evenOddHfDirty: false,
        mirrorMargins: false,
        mirrorMarginsDirty: false,
        setTitlePg: () => {},
        setTitlePgDirty: () => {},
        setEvenOddHf: () => {},
        setEvenOddHfDirty: () => {},
        setMirrorMargins: () => {},
        setMirrorMarginsDirty: () => {},
        pgNumEdit: null,
        pgNumDirtySections: [],
        setPgNumEdit: () => {},
        setPgNumDirtySections: () => {},
        pendingNumbering: { abstractNums: [], nums: [] },
        numberingDirty: false,
        setPendingNumbering: () => {},
        styleUpserts: {},
        setStyleUpserts: () => {},
        comments: [],
        commentsDirty: false,
        setComments: () => {},
        setCommentsDirty: () => {},
        setShowComments: () => {},
        setCommentComposing: () => {},
        watermark: null,
        watermarkDirty: false,
        setWatermark: () => {},
        setWatermarkDirty: () => {},
        watermarkStyle: null,
        setWatermarkStyle: () => {},
        watermarkPicture: null,
        setWatermarkPicture: () => {},
        inkAnnotations: [],
        inksDirty: false,
        setInkAnnotations: () => {},
        setInksDirty: () => {},
        setInkTool: () => {},
        footnotes: [],
        endnotes: [],
        notesDirty: false,
        setFootnotes: () => {},
        setEndnotes: () => {},
        setNotesDirty: () => {},
        sources: [],
        sourcesDirty: false,
        setSources: () => {},
        setSourcesDirty: () => {},
        zoteroDocumentData: '',
        zoteroDocumentDataDirty: false,
        setZoteroDocumentData: () => {},
        setZoteroDocumentDataDirty: () => {},
        themeFonts: null,
        themeFontsDirty: false,
        themeColors: null,
        themeColorsDirty: false,
        setThemeFonts: () => {},
        setThemeFontsDirty: () => {},
        setThemeColors: () => {},
        setThemeColorsDirty: () => {},
        setTrackChanges: () => {},
        protection: null,
        protectionDirty: false,
        setProtection: () => {},
        setProtectionDirty: () => {},
        writeProtection: null,
        writeProtectionDirty: false,
        setWriteProtection: () => {},
        setWriteProtectionDirty: () => {},
        removePersonalInfo: false,
        removePersonalInfoDirty: false,
        setRemovePersonalInfo: () => {},
        setRemovePersonalInfoDirty: () => {},
        onWriteProtectionLoaded: () => {},
        onRevisionsLoaded: () => {},
        setCompareResult: () => {},
        promptDocxPassword: () => {},
        promptAppOnlyEncrypted: () => {},
      }

      const outcome = await loadFile(ctx as never, {
        path: 'uniwork://files/f1/Huge.docx',
        name: 'Huge.docx',
        dataUrl,
        hash: 'h1',
      })
      setDocBytesResolver(null)
      setToastEmitter(null)
      expect(outcome).toBe('refused')
      expect(docState).toBeNull()
      expect(readModeState).toBe(false)
      expect(editableState).toBe(false)
      expect(clearedCount).toBe(1)
      // d2-5: no toast when the refused screen shows
      expect(toasts).toEqual([])
      // d2-6: refusedMessage is stored as key+params (StatusMessage) so UI language switches re-render it
      expect(refusedMessageState).toEqual({
        key: 'appDocTooLargeBlocks',
        params: {
          name: 'Huge.docx',
          blocks: 2_500,
          chars: 26_250_000,
        },
      })
      setModuleLang('vi')
      const viRendered = statusText(refusedMessageState as never, t)
      setModuleLang('en')
      const enRendered = statusText(refusedMessageState as never, t)
      expect(viRendered).not.toBe(enRendered)
      expect(viRendered).toContain('Huge.docx')
      expect(enRendered).toContain('Huge.docx')
      expect(reported).toEqual([
        expect.objectContaining({
          path: 'uniwork://files/f1/Huge.docx',
          reason: 'too_large_to_open',
          bytes: hugeBytes.byteLength,
          measure: {
            kind: 'characters',
            value: 26_250_000,
            limit: HUGE_DOC_REFUSE_CHARS,
          },
        }),
      ])
      // d2-7: newFile in the web frame while refused/fatal is a no-op and never mounts a blank Untitled.docx
      ;(ctx as Record<string, unknown>).refusedMessage = refusedMessageState
      expect(await newFile(ctx as never)).toBe(false)
      expect(docState).toBeNull()
      expect(refusedMessageState).toBeTruthy()
    },
  )

  it('classifies corrupt zip inflate as failed (not refused) and localizes zip part-count refusal copy without toast (d2-4, d2-5)', async () => {
    const { loadFile } = await import('../src/renderer/file-actions')
    const { setDocBytesResolver } = await import('../src/renderer/doc-bytes')
    const { setToastEmitter } = await import('../src/renderer/components/toast-bus')
    const { setModuleLang, statusText, t } = await import('../src/renderer/i18n/locale')

    const reported: unknown[] = []
    const toasts: Array<{ text: string; kind: string }> = []
    const g = globalThis as unknown as {
      window?: Record<string, unknown>
      document?: Record<string, unknown>
    }
    g.window = g.window ?? {}
    g.window.desktop = {
      reportOpenRefused: (p: unknown) => reported.push(p),
      docPasswordIntentRevision: async () => 0,
      discardDocPasswordIntents: async () => {},
    }
    g.document = g.document ?? { activeElement: null, body: {} }

    let refusedMessageState: unknown = ''
    let statusState: unknown = ''
    const chainObj = {
      setMeta: () => chainObj,
      clearContent: () => chainObj,
      setContent: () => chainObj,
      run: () => true,
    }
    const fakeEditor = {
      isDestroyed: false,
      isEditable: true,
      state: { plugins: [] },
      storage: { tabStops: {}, listNumbering: {}, justifyShrink: {}, cjkPunctShrink: {} },
      chain: () => chainObj,
      commands: { setContent: () => {}, focus: () => {} },
      setEditable: () => {},
      view: { dom: { setAttribute: () => {}, removeAttribute: () => {} } },
    }
    const ctx = {
      editor: fakeEditor as never,
      doc: null,
      dirtyRef: { current: false },
      saveInFlightRef: { current: false },
      saveIncompleteRef: { current: false },
      pendingMixedExportRef: { current: false as const },
      bumpPendingExportTick: () => {},
      printAutoOpenedPreviewRef: { current: false },
      setShowPrintDialog: () => {},
      setStatus: (v: unknown) => {
        statusState = v
      },
      setRefusedMessage: (v: unknown) => {
        refusedMessageState = v
      },
      setRecent: () => {},
      setShowAi: () => {},
      setDoc: () => {},
      setAiPanelKey: () => {},
      setDocCss: () => {},
      setDocLoading: () => {},
      setReadMode: () => {},
      setLargeDocSpellOff: () => {},
      setShowPagePreview: () => {},
      section: null,
      sectionDirty: false,
      sections: [],
      sectionsDirty: [],
      trailingStartType: null,
      setSection: () => {},
      setSections: () => {},
      setSectionDirty: () => {},
      setSectionsDirty: () => {},
      setTrailingStartType: () => {},
      pageColor: null,
      pageColorDirty: false,
      setPageColor: () => {},
      setPageColorDirty: () => {},
      header: null,
      headerDirty: false,
      footer: null,
      footerDirty: false,
      setHeader: () => {},
      setHeaderDirty: () => {},
      setFooter: () => {},
      setFooterDirty: () => {},
      hfVariants: {},
      hfVariantsDirty: [],
      setHfVariants: () => {},
      setHfVariantsDirty: () => {},
      sectionHfEdits: {},
      setSectionHfEdits: () => {},
      hfLinks: {},
      setHfLinks: () => {},
      titlePg: false,
      titlePgDirty: false,
      evenOddHf: false,
      evenOddHfDirty: false,
      mirrorMargins: false,
      mirrorMarginsDirty: false,
      setTitlePg: () => {},
      setTitlePgDirty: () => {},
      setEvenOddHf: () => {},
      setEvenOddHfDirty: () => {},
      setMirrorMargins: () => {},
      setMirrorMarginsDirty: () => {},
      pgNumEdit: null,
      pgNumDirtySections: [],
      setPgNumEdit: () => {},
      setPgNumDirtySections: () => {},
      pendingNumbering: { abstractNums: [], nums: [] },
      numberingDirty: false,
      setPendingNumbering: () => {},
      styleUpserts: {},
      setStyleUpserts: () => {},
      comments: [],
      commentsDirty: false,
      setComments: () => {},
      setCommentsDirty: () => {},
      setShowComments: () => {},
      setCommentComposing: () => {},
      watermark: null,
      watermarkDirty: false,
      setWatermark: () => {},
      setWatermarkDirty: () => {},
      watermarkStyle: null,
      setWatermarkStyle: () => {},
      watermarkPicture: null,
      setWatermarkPicture: () => {},
      inkAnnotations: [],
      inksDirty: false,
      setInkAnnotations: () => {},
      setInksDirty: () => {},
      setInkTool: () => {},
      footnotes: [],
      endnotes: [],
      notesDirty: false,
      setFootnotes: () => {},
      setEndnotes: () => {},
      setNotesDirty: () => {},
      sources: [],
      sourcesDirty: false,
      setSources: () => {},
      setSourcesDirty: () => {},
      zoteroDocumentData: '',
      zoteroDocumentDataDirty: false,
      setZoteroDocumentData: () => {},
      setZoteroDocumentDataDirty: () => {},
      themeFonts: null,
      themeFontsDirty: false,
      themeColors: null,
      themeColorsDirty: false,
      setThemeFonts: () => {},
      setThemeFontsDirty: () => {},
      setThemeColors: () => {},
      setThemeColorsDirty: () => {},
      setTrackChanges: () => {},
      protection: null,
      protectionDirty: false,
      setProtection: () => {},
      setProtectionDirty: () => {},
      writeProtection: null,
      writeProtectionDirty: false,
      setWriteProtection: () => {},
      setWriteProtectionDirty: () => {},
      removePersonalInfo: false,
      removePersonalInfoDirty: false,
      setRemovePersonalInfo: () => {},
      setRemovePersonalInfoDirty: () => {},
      onWriteProtectionLoaded: () => {},
      onRevisionsLoaded: () => {},
      setCompareResult: () => {},
      promptDocxPassword: () => {},
      promptAppOnlyEncrypted: () => {},
    }

    setDocBytesResolver(() => {
      throw new Error(
        'zip rejected: part word/document.xml cannot be inflated: invalid distance too far back',
      )
    })
    expect(
      await loadFile(ctx as never, {
        path: 'uniwork://files/f1/Corrupt.docx',
        name: 'Corrupt.docx',
        dataUrl: 'in-memory://corrupt',
        hash: 'h-corrupt',
      }),
    ).toBe('failed')
    expect(reported).toEqual([])

    // d2-5: zip part-count refusal -> localized copy, no raw "zip rejected:", no toast
    toasts.length = 0
    setToastEmitter((toast) => toasts.push(toast))
    setModuleLang('vi')
    setDocBytesResolver(() => {
      throw new Error('zip rejected: 12000 parts exceeds the 10000 limit')
    })
    expect(
      await loadFile(ctx as never, {
        path: 'uniwork://files/f2/ManyParts.docx',
        name: 'ManyParts.docx',
        dataUrl: 'in-memory://parts',
        hash: 'h-parts',
      }),
    ).toBe('refused')
    expect(toasts).toEqual([])
    expect(reported).toHaveLength(1)
    expect(reported[0]).toMatchObject({
      reason: 'too_complex',
      measure: { kind: 'zip_parts', value: 12_000, limit: 10_000 },
    })
    const partsVi = statusText(refusedMessageState as never, t)
    expect(partsVi).toContain('12000')
    expect(partsVi).not.toMatch(/zip rejected:|parts exceeds/i)
    expect(statusState).toEqual(refusedMessageState)

    setDocBytesResolver(null)
    setToastEmitter(null)
  })
})
