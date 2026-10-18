// UNI-1909 (S01B-V1 / S01-V2): the web frame's in-place save keeps the name the
// host reports — a host `file.renamed` landing mid-save is never overwritten by
// the save's stale start-path, a save result carrying a new name is adopted as
// the save path, and a host-declined save ("cancelled") sets no failure status.
// The App.tsx subscriber is replayed here (prev.filePath === oldPath) so this
// exercises exactly the renderer's divergence.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { buildBlankDocx } from '@genoffice/docx-engine'
import type { DocState } from '../src/renderer/doc-state'
import type { FileActionContext } from '../src/renderer/file-actions'
import { loadFile, save } from '../src/renderer/file-actions'
import { setDocBytesResolver } from '../src/renderer/doc-bytes'
import { setToastEmitter } from '../src/renderer/components/toast-bus'
import { createDocsEditor } from './helpers/docs-ai-run-harness'

const OLD_PATH = 'uniwork://files/f1/untitled.docx'
const NEW_PATH = 'uniwork://files/f1/Kế hoạch Q4.docx'
const NEW_NAME = 'Kế hoạch Q4.docx'

interface SaveAnswer {
  ok: boolean
  error?: string
  reason?: string
  path?: string
}

interface DesktopStub {
  saveDocx: (path: string, data: ArrayBuffer, auto?: boolean) => Promise<SaveAnswer>
  saveDocxAs: (name: string, data: ArrayBuffer, src?: string | null) => Promise<SaveAnswer>
  saveDocxNew: (name: string, data: ArrayBuffer) => Promise<SaveAnswer>
  docPasswordIntentRevision: () => Promise<number>
  getRecentFiles: () => Promise<string[]>
  reportOpenRefused: (info: unknown) => void
  discardDocPasswordIntents: () => Promise<void>
}

let blankBytes: Uint8Array
let docState: DocState | null
let statuses: unknown[]
let toasts: Array<{ text: string; kind: string }>
let desktop: DesktopStub
let saveCalls: number
let editor: Editor

/** the App.tsx onRenamedDocx subscriber, verbatim semantics */
function applyRename(oldPath: string, newPath: string): void {
  docState =
    docState && docState.filePath === oldPath
      ? { ...docState, filePath: newPath, fileName: newPath.split(/[\\/]/).pop()! }
      : docState
}

function makeCtx(): FileActionContext {
  const c = {
    get doc() {
      return docState
    },
    editor,
    dirtyRef: { current: false },
    saveInFlightRef: { current: false },
    saveIncompleteRef: { current: false },
    pendingMixedExportRef: { current: false as const },
    bumpPendingExportTick: () => {},
    printAutoOpenedPreviewRef: { current: false },
    setShowPrintDialog: () => {},
    setStatus: (v: unknown) => statuses.push(v),
    setRefusedMessage: () => {},
    setRecent: () => {},
    setShowAi: () => {},
    setDoc: (v: unknown) => {
      docState =
        typeof v === 'function'
          ? (v as (p: DocState | null) => DocState | null)(docState)
          : (v as DocState | null)
    },
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
    pendingNumbering: { newDefs: [], restartNums: [], levelEdits: [], picBullets: [] },
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
  return c as unknown as FileActionContext
}

beforeEach(async () => {
  // jsdom has no CSS.escape (doc-style-css uses it for [data-style] selectors)
  vi.stubGlobal('CSS', { escape: (v: string) => v })
  blankBytes = blankBytes ?? (await buildBlankDocx())
  setDocBytesResolver((url) => (url === 'doc://open' ? blankBytes : undefined))
  setToastEmitter((toast) => toasts.push(toast))
  docState = null
  statuses = []
  toasts = []
  saveCalls = 0
  editor = createDocsEditor(['body'])
  desktop = {
    saveDocx: async () => {
      saveCalls += 1
      return { ok: true }
    },
    saveDocxAs: async (name) => ({ ok: true, path: `uniwork://files/f2/${name}` }),
    saveDocxNew: async () => ({ ok: true, path: 'uniwork://files/f3/New.docx' }),
    docPasswordIntentRevision: async () => 0,
    discardDocPasswordIntents: async () => {},
    getRecentFiles: async () => [],
    reportOpenRefused: () => {},
  }
  ;(window as unknown as Record<string, unknown>).desktop = desktop
  await loadFile(makeCtx(), {
    path: OLD_PATH,
    name: 'untitled.docx',
    dataUrl: 'doc://open',
    hash: 'h',
  })
})

afterEach(() => {
  editor.destroy()
  setDocBytesResolver(null)
})

describe('UNI-1909: a host rename during save keeps the renderer on the new name', () => {
  it('file.renamed while the save runs: the write-back keeps the renamed path; Save As proposes it', async () => {
    // S01B-V1: the host emits file.renamed, then its reissued save lands
    desktop.saveDocx = async () => {
      saveCalls += 1
      applyRename(OLD_PATH, NEW_PATH)
      return { ok: true }
    }
    expect(await save(makeCtx(), false)).toBe(true)
    expect(docState!.filePath).toBe(NEW_PATH)
    expect(docState!.fileName).toBe(NEW_NAME)
    // File → Save as proposes "<new name>", not the stale "untitled"
    const proposed: string[] = []
    desktop.saveDocxAs = async (name) => {
      proposed.push(name)
      return { ok: true, path: `uniwork://files/f2/${name}` }
    }
    await save(makeCtx(), true)
    expect(proposed).toEqual([NEW_NAME])
  })

  it('a save result carrying a new name is adopted even before file.renamed lands', async () => {
    // the host's reissued api.save result carries the new name; the bridge merges
    // it and emits the rename once (remember() sees the name change)
    desktop.saveDocx = async () => {
      saveCalls += 1
      applyRename(OLD_PATH, NEW_PATH)
      return { ok: true }
    }
    expect(await save(makeCtx(), false)).toBe(true)
    expect(docState!.filePath).toBe(NEW_PATH)
    expect(docState!.fileName).toBe(NEW_NAME)
    // the file.renamed carrying the same name the bridge then swallows: a duplicate
    // emit for the same rename would still leave the document on the new name
    applyRename(NEW_PATH, NEW_PATH)
    expect(docState!.fileName).toBe(NEW_NAME)
  })

  it('a plain rename before the save still lands (regression guard)', async () => {
    applyRename(OLD_PATH, NEW_PATH)
    expect(await save(makeCtx(), false)).toBe(true)
    expect(docState!.filePath).toBe(NEW_PATH)
    expect(docState!.fileName).toBe(NEW_NAME)
  })
})

describe('UNI-1909: a host-declined save is silent', () => {
  it('saveDocx "cancelled": no failure status, no toast, the document stays dirty', async () => {
    const c = makeCtx()
    desktop.saveDocx = async () => {
      saveCalls += 1
      return { ok: false, reason: 'cancelled' }
    }
    expect(await save(c, false)).toBe(false)
    expect(
      statuses.filter(
        (s) => typeof s === 'object' && s !== null && 'key' in s && s.key === 'appSaveFailed',
      ),
    ).toEqual([])
    expect(toasts).toEqual([])
    // stays dirty: the next save runs a real pass instead of reusing this one
    expect(saveCalls).toBe(1)
    await save(c, false)
    expect(saveCalls).toBe(2)
  })
})
