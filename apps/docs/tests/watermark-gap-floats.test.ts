/**
 * UNI-1920 residual w1: the canvas pagination effect reads `watermarkDirty` when it
 * builds the per-page floating-header-image layer (gap strips + the first-page
 * `page-float-host`). Design → Watermark only flips `watermark`/`watermarkDirty`
 * state — for a text watermark nothing else in the effect's dependency array
 * changes (pendingWatermarkImage stays null), so without `watermarkDirty` in the
 * deps the layer keeps painting the parsed WordArt shape behind the new
 * `.page-watermark` ghost: two watermarks on the page (and removing a watermark
 * keeps the parsed one). This mounts the real App against a docx whose header
 * carries a VML text watermark and drives the ribbon's watermark dropdown.
 */
import { Buffer } from 'node:buffer'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDocx } from '../../../packages/docx-engine/tests/helpers/build-docx'
import { AI_PROVIDERS, type AiSettings } from '../src/shared/ipc'
import { App } from '../src/renderer/App'
import { LocaleProvider, setModuleLang, t } from '../src/renderer/i18n/locale'
import { resetCapabilitiesForTest } from '../src/renderer/capabilities'

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'

/** header1.xml carrying Word's VML textpath watermark ("DRAFT", behind text) */
const WATERMARK_HEADER_XML =
  `${XML_DECL}<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
  `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
  `xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" ` +
  `xmlns:w10="urn:schemas-microsoft-com:office:word">` +
  '<w:p><w:r><w:pict>' +
  '<v:shape id="PowerPlusWaterMarkObject1" o:spid="_x0000_s2049" type="#_x0000_t75" ' +
  'style="position:absolute;margin-left:0;margin-top:0;width:468pt;height:117pt;' +
  'rotation:315;z-index:-251654144;mso-position-horizontal:center;' +
  'mso-position-horizontal-relative:margin;mso-position-vertical:center;' +
  'mso-position-vertical-relative:margin" fillcolor="silver" stroked="f">' +
  '<v:fill opacity=".5"/>' +
  '<v:textpath style="font-family:&quot;Calibri&quot;;font-size:1pt" ' +
  'string="DRAFT" on="t" fitshape="t"/>' +
  '<w10:wrap anchorx="margin" anchory="margin"/>' +
  '</v:shape>' +
  '</w:pict></w:r></w:p></w:hdr>'

const harnessSettings: AiSettings = {
  provider: 'anthropic',
  providers: Object.fromEntries(
    AI_PROVIDERS.map((p) => [p.id, { apiKey: 'k', model: p.defaultModel }]),
  ) as AiSettings['providers'],
}

const winHost = window as unknown as { desktop?: Record<string, unknown> }
const docHost = document as unknown as { fonts?: unknown }

/**
 * Integration mount: the App load path goes through undici fetch + React's own
 * scheduler, which fake timers cannot drive — tick the macrotask queue inside
 * act() instead of awaiting a named promise the boot sequence does not expose.
 * Each loadFile await step (fetch, zip walk, parse, fonts) needs its own real
 * tick, so wait for the mounted surface, not a fixed count.
 */
const tick = async (): Promise<void> => {
  // Promise.withResolvers is above the app tsconfig's lib target; the harness
  // convention (docs-ai-run-harness.ts) uses the executor form for the same tick
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await tick()
}
const untilMounted = async (): Promise<void> => {
  for (let i = 0; i < 200 && !document.querySelector('.ProseMirror'); i++) await tick()
}

let host: HTMLElement | null = null
let root: Root | null = null

beforeEach(async () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  setModuleLang('en')
  localStorage.clear()
  resetCapabilitiesForTest()

  // jsdom lacks the browser APIs the app shell leans on; all are guarded or
  // degrade to the no-op paths below
  Element.prototype.scrollTo ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
  window.requestAnimationFrame ??= (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(performance.now()), 0)
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  window.IntersectionObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  } as unknown as typeof IntersectionObserver
  window.CSS ??= {
    escape: (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`),
  } as typeof CSS
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: {
      status: 'loaded',
      ready: Promise.resolve(),
      addEventListener() {},
      removeEventListener() {},
    },
  })

  const bytes = await buildDocx({
    bodyXml: '<w:p><w:r><w:t>one</w:t></w:r></w:p><w:p><w:r><w:t>two</w:t></w:r></w:p>',
    sectPrExtra:
      '<w:headerReference w:type="default" r:id="rIdWm"/>' +
      '<w:headerReference w:type="first" r:id="rIdWm"/>',
    extraRels:
      '<Relationship Id="rIdWm" ' +
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" ' +
      'Target="header1.xml"/>',
    extraParts: [
      {
        path: 'word/header1.xml',
        xml: WATERMARK_HEADER_XML,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml',
      },
    ],
  })
  const dataUrl = `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${Buffer.from(bytes).toString('base64')}`
  winHost.desktop = {
    // document open path (loadFile → fetchDocBytes handles data: URLs)
    consumePendingOpenDocx: () =>
      Promise.resolve({
        path: '/docs/watermarked.docx',
        name: 'watermarked.docx',
        dataUrl,
        hash: 'h',
      }),
    consumeNewBlankDoc: () => Promise.resolve(false),
    consumeAiDocContent: () => Promise.resolve(null),
    consumeAiPreset: () => Promise.resolve(null),
    consumeHeadlessExport: () => Promise.resolve(null),
    onOpenDocx: () => () => {},
    onRenamedDocx: () => () => {},
    onAiPreset: () => () => {},
    // unguarded subscriptions / settings
    getAiSettings: () => Promise.resolve(harnessSettings),
    onAiSettingsChanged: () => () => {},
    getRecentFiles: () => Promise.resolve([]),
    docPasswordIntentRevision: () => Promise.resolve(0),
    discardDocPasswordIntents: () => Promise.resolve(),
    onZoteroRequest: () => () => {},
    provideDocBytes: () => () => {},
    onMenuCommand: () => () => {},
    onTeardown: () => () => {},
    onViewImage: () => () => {},
    getCommentAuthor: () => Promise.resolve(null),
    onCommentAuthorChanged: () => () => {},
    onContextMenuRequest: () => () => {},
    armContextMenu: () => {},
    confirmDocumentReplace: () => Promise.resolve(true),
    respellKick: () => Promise.resolve(),
    spellLanguages: () => Promise.resolve(['en']),
    onLanguageChanged: () => () => {},
    getPathForFile: () => '',
    // no-ops called on demand only, kept so an accidental call never throws
    onAiStream: () => () => {},
    aiStream: () => Promise.resolve(),
    aiStreamCancel: () => Promise.resolve(),
    saveDocx: () => Promise.resolve({ ok: true }),
    saveDocxAs: () => Promise.resolve({ ok: false }),
    saveDocxCopy: () => Promise.resolve({ ok: false }),
    openDocx: () => Promise.resolve(null),
    openDocxPath: () => Promise.resolve(null),
    openDocxDecrypt: () => Promise.resolve({ ok: false, reason: 'error' }),
    print: () => {},
    pickImage: () => Promise.resolve(null),
    fetchImage: () => Promise.resolve(null),
    saveImageAs: () => {},
    noteDocumentMounted: () => {},
    headlessExportDone: () => {},
    reportViewMenuState: () => {},
    reportCloseCheck: () => {},
    reportCloseSaveResult: () => {},
    onCloseCheck: () => () => {},
    onCloseSaveRequest: () => () => {},
    claimContextMenu: () => {},
    respondToZotero: () => {},
    setDocPassword: () => Promise.resolve({ ok: true }),
    aiGskStatus: () => Promise.resolve(null),
    spellDiag: () => {},
    spellAddWord: () => {},
    spellIgnoreWord: () => {},
    spellReplace: () => {},
    spellSetLanguages: () => {},
    setAiSettings: () => Promise.resolve(),
    setAiPanelPrefs: () => {},
    openInApp: () => {},
    openNewTab: () => {},
    listDocsTabs: () => Promise.resolve([]),
    focusDocsTab: () => {},
    zoteroCommand: () => Promise.resolve(null),
    uniworkState: () => Promise.resolve(null),
  }

  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(LocaleProvider, { initial: 'en', children: createElement(App) }))
  })
  await untilMounted()
  await settle()
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  delete winHost.desktop
  delete docHost.fonts
  resetCapabilitiesForTest()
})

const clickButton = (btn: HTMLElement | null, why: string) => {
  expect(btn, why).not.toBeNull()
  act(() => btn!.click())
}

const floatImages = () => document.querySelectorAll('.page-hf-float-img')
/** Bounded poll: the docx load (fetch + zip + parse) has no tick count we can rely on. */
const untilFloat = async (): Promise<void> => {
  for (let i = 0; i < 200 && floatImages().length === 0; i++) await tick()
}
const openWatermarkMenu = () => {
  clickButton(
    [...document.querySelectorAll<HTMLElement>('.ribbon-tab')].find(
      (b) => b.textContent === t('ribbonTabDesign'),
    ) ?? null,
    'Design ribbon tab',
  )
  clickButton(
    [...document.querySelectorAll<HTMLElement>('.rb-big')].find(
      (b) => b.getAttribute('data-tip') === t('ribbonWatermarkTip'),
    ) ?? null,
    'Watermark dropdown button',
  )
}
const pickWatermarkItem = (label: string, why: string) =>
  clickButton(
    [...document.querySelectorAll<HTMLElement>('.layout-menu button')].find(
      (b) => b.textContent === label,
    ) ?? null,
    why,
  )

describe('canvas watermark layer when the pending watermark changes', () => {
  it('dropping a new text watermark hides the parsed WordArt float on the page', async () => {
    // the mounted document shows its parsed watermark as a behind-text float
    expect(document.querySelector('.ProseMirror'), 'editor mounted').not.toBeNull()
    await untilFloat()
    expect(floatImages().length, 'parsed watermark paints as a page float').toBeGreaterThan(0)
    expect(document.querySelector('.page-watermark'), 'no pending ghost yet').toBeNull()

    // Design → Watermark → preset: only App state changes (watermarkDirty → true)
    openWatermarkMenu()
    pickWatermarkItem(t('ribbonWatermarkDraft'), 'DRAFT preset')
    await settle()

    // the ghost text overlay shows the pending watermark…
    expect(document.querySelector('.page-watermark'), 'pending ghost drawn').not.toBeNull()
    // …and the parsed WordArt shape must be filtered out of the float layer —
    // it stays a float until the next pagination rebuild, which the
    // watermarkDirty dep is there to schedule
    expect(floatImages(), 'parsed watermark float dropped').toHaveLength(0)
  })

  it('removing the watermark drops the parsed WordArt float too', async () => {
    await untilFloat()
    expect(floatImages().length, 'parsed watermark paints as a page float').toBeGreaterThan(0)

    openWatermarkMenu()
    pickWatermarkItem(t('ribbonWatermarkRemove'), 'Remove watermark item')
    await settle()

    expect(document.querySelector('.page-watermark'), 'no ghost after remove').toBeNull()
    expect(floatImages(), 'parsed watermark float dropped').toHaveLength(0)
  })
})
