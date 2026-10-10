// @vitest-environment jsdom
/**
 * Contract tests of the Slides web bridge (GO-B5 S2): every preload method exists, open / save
 * / conflict / save-as / host requests map onto the protocol as documented in
 * web-slides-api.ts and web-host-io.ts, and exports / print / media / clipboard behave.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { appClipboard, sessions } from '../../../apps/slides/src/session'
import {
  createDraftRecovery,
  createIdbDraftStore,
  decryptDraft,
  type DraftChoice,
  type DraftHost,
  type DraftRecovery,
  type DraftStore,
} from '../../docs/bridge/draft-recovery'
import { createFakeIdb } from '../../docs/bridge/testing/fake-idb'
import { createMockPort, protocolError, type MockPort } from '../../docs/bridge/testing/mock-port'
import { encodePng } from './tiff'
import { cfbKind, createWebSlidesApi, type WebSlidesOptions } from './web-slides-api'
import { SLIDES_WEB_CAPABILITIES, slidesHostGrants } from './capabilities'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = new Uint8Array(readFileSync(join(here, '..', '..', 'fixtures', 'sample.pptx')))
const FIT = 1280

const flush = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
}

/** the keys of the Electron preload's `api` object (the contract the renderer codes against) */
function preloadKeys(): string[] {
  const src = readFileSync(
    join(here, '..', '..', '..', 'apps', 'slides', 'src', 'preload', 'index.ts'),
    'utf8',
  )
  const body = src.slice(
    src.indexOf('const api: SlidesApi = {'),
    src.indexOf('\n}\n', src.indexOf('const api: SlidesApi = {')),
  )
  return [...body.matchAll(/^ {2}([A-Za-z0-9]+)[:(]/gm)].map((m) => m[1]!)
}

interface Setup {
  mock: MockPort
  fileId: string
  api: ReturnType<typeof createWebSlidesApi>['slidesApi']
  web: ReturnType<typeof createWebSlidesApi>
  downloads: Array<{ name: string; blob: Blob }>
}

async function setup(
  opts: WebSlidesOptions & {
    capabilities?: Record<string, unknown>
    user?: string
    bytes?: Uint8Array
  } = {},
): Promise<Setup> {
  const mock = createMockPort()
  const file = mock.seed('deck.pptx', opts.bytes ?? FIXTURE)
  const downloads: Setup['downloads'] = []
  const web = createWebSlidesApi(
    {
      client: mock.port,
      capabilities: opts.capabilities ?? { ...SLIDES_WEB_CAPABILITIES, save: true, saveAs: true },
    },
    { download: (name, blob) => downloads.push({ name, blob }), editorStartMs: 1000, ...opts },
  )
  mock.init({
    documentId: file.fileId,
    ...(opts.user ? ({ user: { displayName: opts.user } } as object) : {}),
  })
  return { mock, fileId: file.fileId, api: web.slidesApi, web, downloads }
}

async function titleId(api: Setup['api']): Promise<string> {
  const slides = (await api.getRenderSlides())!
  return slides[0]!.nodes.find((n) => 'text' in n && n.text)!.sourceId
}

function clickChoice(marker: string, label: string): void {
  const root = document.querySelector(`[data-slides-web="${marker}"]`)
  const button = [...(root?.querySelectorAll('button') ?? [])].find((b) => b.textContent === label)
  if (!button) throw new Error(`no "${label}" button in the ${marker} dialog`)
  button.click()
}

async function waitFor<T>(fn: () => T | null | undefined, tries = 200): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = fn()
    if (v) return v
    await flush(1)
  }
  throw new Error('condition not met')
}

beforeEach(() => {
  // jsdom has no object URLs
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  sessions.clear()
  appClipboard.slide = null
  appClipboard.elements = null
  document.body.innerHTML = ''
})

describe('slidesApi contract', () => {
  it('implements every preload method (no Proxy fallback)', async () => {
    const { api } = await setup()
    const keys = preloadKeys()
    expect(keys.length).toBeGreaterThanOrEqual(181)
    expect(keys.filter((k) => !(k in api))).toEqual([])
    // the web-only optional members (SlidesApi: the desktop never sets them)
    expect(Object.keys(api).filter((k) => !keys.includes(k))).toEqual([
      'openInDesktopApp',
      'presenterOpenAudience',
      'presenterCloseAudience',
      'onPresenterAudience',
    ])
  })

  it('the installed web capabilities keep AI, autosave and desktop-only features off', () => {
    for (const key of [
      'ai',
      'autoSave',
      'autoSaveToDisk',
      'open',
      'recents',
      'fontDownload',
      'fontInstallLocal',
      'model3d',
      'headlessExport',
    ])
      expect(SLIDES_WEB_CAPABILITIES[key]).toBe(false)
    // the presenter view's audience window works in the browser (SP1)
    expect(SLIDES_WEB_CAPABILITIES.presenterWindow).toBe(true)
  })
})

describe('open', () => {
  it('opens init.documentId through api.open at boot and reports title / clean state', async () => {
    const { mock, api } = await setup()
    const opened = (await api.consumePendingOpen(FIT))!
    expect(opened.slides).toHaveLength(5)
    expect(opened.path).toMatch(/^uniwork:\/\/files\/f1\/deck\.pptx$/)
    expect(mock.titles).toContain('deck.pptx')
    expect(mock.calls.map((c) => c.type)).toContain('api.open')
    expect(await api.isDirty()).toBe(false)
  })

  it('refuses legacy .ppt / encrypted containers with a fatal notice', async () => {
    const cfb = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])
    expect(cfbKind(cfb)).toBe('legacy')
    const enc = new Uint8Array([
      ...cfb,
      ...new TextEncoder().encode('E\0n\0c\0r\0y\0p\0t\0e\0d\0P\0a\0c\0k\0a\0g\0e\0'),
    ])
    expect(cfbKind(enc)).toBe('encrypted')
    const { mock, api } = await setup({ bytes: cfb })
    expect(await api.consumePendingOpen(FIT)).toBeNull()
    expect(document.querySelector('[data-slides-web="fatal"]')).not.toBeNull()
    expect(mock.errors.at(-1)?.fatal).toBe(true)
    expect(await api.save()).toMatchObject({ ok: false })
  })

  it('a host `open` replaces the deck and notifies onOpened', async () => {
    const { mock, api } = await setup()
    await api.consumePendingOpen(FIT)
    const other = mock.seed('other.pptx', FIXTURE)
    const seen: string[] = []
    api.onOpened((r) => seen.push(r.path))
    await mock.host.open(mock.openPayload(other.fileId))
    expect(seen).toEqual([`uniwork://files/${other.fileId}/other.pptx`])
  })
})

describe('save', () => {
  it('edits mark dirty; save sends api.save with the etag, no auto flag, and clears dirty', async () => {
    const { mock, api, fileId } = await setup()
    await api.consumePendingOpen(FIT)
    await api.editText({
      slideIndex: 0,
      sourceId: await titleId(api),
      paragraphs: [{ runs: [{ text: 'x' }] }],
    })
    await flush()
    expect(mock.dirty.at(-1)).toBe(true)
    const r = await api.save()
    expect(r).toMatchObject({ ok: true, path: `uniwork://files/${fileId}/deck.pptx` })
    const call = mock.calls.find((c) => c.type === 'api.save')!
    expect(call.payload).toMatchObject({ fileId, etag: `"${fileId}-v1"` })
    expect(call.payload).not.toHaveProperty('auto')
    expect(mock.saved.at(-1)).toMatchObject({ initiatedByFrame: true })
    await flush()
    expect(mock.dirty.at(-1)).toBe(false)
    expect(await api.isDirty()).toBe(false)
  })

  it('conflict dialog focuses Cancel, not Reload latest (discards edits) or the destructive Overwrite', async () => {
    const { mock, api, fileId } = await setup()
    await api.consumePendingOpen(FIT)
    await api.setNotes({ slideIndex: 0, text: 'mine' })
    mock.bumpRemote(fileId)
    const pending = api.save()
    await waitFor(() => document.querySelector('[data-slides-web="conflict"]'))
    expect((document.activeElement as HTMLElement | null)?.textContent).toBe('Cancel')
    expect(document.querySelector('[data-slides-web="conflict"] .ow-dlg-close')).not.toBeNull()
    clickChoice('conflict', 'Cancel')
    await pending
  })

  it('a network failure on save reads as localised text, without the raw browser error', async () => {
    const { mock, api } = await setup()
    await api.consumePendingOpen(FIT)
    await api.setNotes({ slideIndex: 0, text: 'mine' })
    mock.override('api.save', () => Promise.reject(protocolError('network', 'Failed to fetch')))
    const res = (await api.save()) as { ok: boolean; error?: string }
    expect(res.ok).toBe(false)
    expect(res.error).toBe('UniWork could not be reached. Check your connection and try again.')
    expect(res.error).not.toMatch(/Failed to fetch|^Error:/)
  })

  it('conflict -> Overwrite re-reads the head etag and saves again', async () => {
    const { mock, api, fileId } = await setup()
    await api.consumePendingOpen(FIT)
    await api.setNotes({ slideIndex: 0, text: 'mine' })
    mock.bumpRemote(fileId)
    const pending = api.save()
    await waitFor(() => document.querySelector('[data-slides-web="conflict"]'))
    expect(mock.errors.at(-1)?.error).toMatchObject({ code: 'conflict' })
    clickChoice('conflict', 'Overwrite')
    expect(await pending).toMatchObject({ ok: true })
    expect(mock.calls.filter((c) => c.type === 'api.save')).toHaveLength(2)
  })

  it('conflict -> Reload latest replaces the deck; Cancel keeps it dirty', async () => {
    const { mock, api, fileId } = await setup()
    await api.consumePendingOpen(FIT)
    const reloaded: string[] = []
    api.onOpened((r) => reloaded.push(r.path))
    await api.setNotes({ slideIndex: 0, text: 'mine' })
    mock.bumpRemote(fileId)
    let pending = api.save()
    await waitFor(() => document.querySelector('[data-slides-web="conflict"]'))
    clickChoice('conflict', 'Cancel')
    expect(await pending).toMatchObject({
      ok: false,
      error: expect.stringMatching(/changed elsewhere/),
    })
    expect(await api.isDirty()).toBe(true)
    pending = api.save()
    await waitFor(() => document.querySelector('[data-slides-web="conflict"]'))
    clickChoice('conflict', 'Reload latest')
    expect(await pending).toMatchObject({ ok: false })
    expect(reloaded).toHaveLength(1)
    expect(await api.isDirty()).toBe(false)
  })

  it('a host `save` request runs the renderer save flow and owns the conflict (no prompt)', async () => {
    const { mock, api, fileId } = await setup()
    await api.consumePendingOpen(FIT)
    api.onCloseSaveRequest(() => {
      void api.save().then((r) => api.reportCloseSaveResult(r.ok))
    })
    await api.setNotes({ slideIndex: 0, text: 'host save' })
    expect(await mock.host.save({ reason: 'navigate' } as never)).toMatchObject({ ok: true })
    expect(mock.saved.at(-1)).toMatchObject({ initiatedByFrame: false })
    await api.setNotes({ slideIndex: 0, text: 'again' })
    mock.bumpRemote(fileId)
    expect(await mock.host.save({ reason: 'navigate' } as never)).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    })
    expect(document.querySelector('[data-slides-web="conflict"]')).toBeNull()
  })

  it('save as: the renderer flow under a host `saveAs` uses the host name; cancel -> ok:false', async () => {
    const { mock, api } = await setup()
    await api.consumePendingOpen(FIT)
    api.onMenuCommand((cmd) => {
      if (cmd === 'save-as') void api.saveAs('Renderer default')
    })
    const renamed: string[] = []
    api.onRenamed((p) => renamed.push(p))
    const res = await mock.host.saveAs({ name: 'Host name' } as never)
    expect(res).toMatchObject({ ok: true, file: { name: 'Host name.pptx' } })
    expect(renamed.at(-1)).toMatch(/Host name\.pptx$/)
    mock.override('api.saveAs', () => Promise.reject(protocolError('cancelled')))
    expect(await api.saveAs('Copy')).toEqual({ ok: false })
  })

  it('closeCheck reports dirty and never autosave', async () => {
    const { mock, api } = await setup()
    await api.consumePendingOpen(FIT)
    expect(await mock.host['doc.closeCheck']({} as never)).toEqual({
      dirty: false,
      autoSave: false,
    })
    await api.setNotes({ slideIndex: 0, text: 'x' })
    expect(await mock.host['doc.closeCheck']({} as never)).toEqual({ dirty: true, autoSave: false })
  })

  // S-01 (visual test): text typed on the canvas is not in the session until the box commits,
  // yet the leave dialog and the header chip must already see it
  it('typing in the on-canvas editor or the notes pane is dirty before it is committed', async () => {
    const { mock, api, web } = await setup()
    await api.consumePendingOpen(FIT)
    const editor = document.createElement('div')
    editor.className = 'slide-text-editor'
    editor.contentEditable = 'true'
    document.body.append(editor)
    try {
      expect(web.isDirty()).toBe(false)
      editor.dispatchEvent(new Event('input', { bubbles: true }))
      expect(mock.dirty.at(-1)).toBe(true)
      expect(web.isDirty()).toBe(true)
      expect(await mock.host['doc.closeCheck']({} as never)).toEqual({
        dirty: true,
        autoSave: false,
      })
      // cancelled (Escape removes the box, nothing was committed): clean again
      editor.remove()
      await new Promise((r) => setTimeout(r, 800)) // the watcher notices the removed editor
      expect(mock.dirty.at(-1)).toBe(false)
      expect(web.isDirty()).toBe(false)

      const notes = document.createElement('div')
      notes.className = 'notes-pane'
      const area = document.createElement('textarea')
      notes.append(area)
      document.body.append(notes)
      area.dispatchEvent(new Event('input', { bubbles: true }))
      expect(web.isDirty()).toBe(true)
      // blur: the page commits the notes to the session, which carries the edit from here on
      await api.setNotes({ slideIndex: 0, text: 'typed' })
      area.dispatchEvent(new Event('focusout', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 400))
      expect(web.isDirty()).toBe(true) // still dirty, now through the session
      notes.remove()
    } finally {
      editor.remove()
    }
  })

  it('text typed outside the slide editors (dialogs, search boxes) does not mark the deck dirty', async () => {
    const { api, web } = await setup()
    await api.consumePendingOpen(FIT)
    const field = document.createElement('input')
    document.body.append(field)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    expect(web.isDirty()).toBe(false)
    field.remove()
  })

  // S-02 (visual test): "Deck Vietnamese Notes.pptx" keeps the note in a plain shape named
  // "Notes Placeholder" with no <p:ph>; the editor pane and the Presenter View read it with getNotes
  it('getNotes reads notes held in a plain "Notes" shape without a placeholder', async () => {
    const zip = await JSZip.loadAsync(FIXTURE)
    const slide1Rels = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')
    expect(slide1Rels).not.toContain('notesSlide')
    zip.file(
      'ppt/slides/_rels/slide1.xml.rels',
      slide1Rels.replace(
        '</Relationships>',
        '<Relationship Id="rIdN1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
      ),
    )
    zip.file(
      'ppt/notesSlides/notesSlide1.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r><a:rPr lang="vi-VN" sz="2400"/><a:t>Ghi chú trình bày cho buổi họp tuần.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>',
    )
    const ct = await zip.file('[Content_Types].xml')!.async('string')
    zip.file(
      '[Content_Types].xml',
      ct.replace(
        '</Types>',
        '<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>',
      ),
    )
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const { api } = await setup({ bytes })
    await api.consumePendingOpen(FIT)
    expect(await api.getNotes(0)).toBe('Ghi chú trình bày cho buổi họp tuần.')
  })
})

describe('draft recovery (C18)', () => {
  /** one browser profile: the IndexedDB store and the host's session key outlive the tabs */
  async function browserProfile() {
    const store: DraftStore = createIdbDraftStore(createFakeIdb().idb)
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    const grant = { key, scope: 'u1:f1' }
    const live: DraftRecovery[] = []
    let answer: DraftChoice = 'restore'
    const prompt = vi.fn(async () => answer)
    /** one frame (tab) of the Slides module in this profile */
    const tab = async () => {
      let recovery!: DraftRecovery
      const s = await setup({
        drafts: (host: DraftHost) => {
          recovery = createDraftRecovery({
            module: 'slides',
            host,
            prompt,
            store,
            recovery: () => grant,
            target: new EventTarget() as unknown as Window,
          })
          live.push(recovery)
          return recovery
        },
      })
      return { ...s, recovery }
    }
    return {
      store,
      grant,
      prompt,
      tab,
      answer: (c: DraftChoice) => {
        answer = c
      },
      dispose: () => live.forEach((r) => r.dispose()),
    }
  }

  let profile: Awaited<ReturnType<typeof browserProfile>> | null = null
  afterEach(() => {
    profile?.dispose()
    profile = null
  })

  /** tab 1 edits the notes and keeps a draft, then "crashes" (its session is gone) */
  async function crashedTab(p: NonNullable<typeof profile>) {
    const first = await p.tab()
    await first.api.consumePendingOpen(FIT)
    await first.recovery.flush()
    expect(await p.store.list('u1:f1:')).toEqual([]) // clean: nothing is written
    await first.api.setNotes({ slideIndex: 0, text: 'draft notes' })
    await first.recovery.flush()
    first.recovery.dispose()
    sessions.clear()
    document.body.innerHTML = ''
  }

  it('writes an encrypted pptx while dirty, keyed by scope, etag and tab', async () => {
    profile = await browserProfile()
    await crashedTab(profile)
    const records = await profile.store.list('u1:f1:')
    expect(records).toHaveLength(1)
    expect(records[0]!.key).toMatch(/^u1:f1:"f1-v1":[0-9a-f]{16}$/)
    const { record } = records[0]!
    expect(record).toMatchObject({ module: 'slides', name: 'deck.pptx', baseEtag: '"f1-v1"' })
    // stored as ciphertext, not as a zip
    expect([...new Uint8Array(record.ciphertext, 0, 2)]).not.toEqual([0x50, 0x4b])
    const plain = await decryptDraft(profile.grant.key, records[0]!.key, record)
    expect([...new Uint8Array(plain!, 0, 2)]).toEqual([0x50, 0x4b])
  })

  it('Restore opens the draft bytes as a dirty deck; a save deletes the draft', async () => {
    profile = await browserProfile()
    await crashedTab(profile)
    profile.answer('restore')
    const { mock, api, fileId } = await profile.tab()
    const opened = await api.consumePendingOpen(FIT)
    expect(opened?.path).toBe(`uniwork://files/${fileId}/deck.pptx`)
    expect(profile.prompt).toHaveBeenCalledTimes(1)
    expect(await api.getNotes(0)).toBe('draft notes')
    expect(await api.isDirty()).toBe(true)
    await flush()
    expect(mock.dirty.at(-1)).toBe(true)
    // the save goes to the same file with the etag the draft was opened against
    expect(await api.save()).toMatchObject({ ok: true })
    const call = mock.calls.find((c) => c.type === 'api.save')!
    expect(call.payload).toMatchObject({ fileId, etag: `"${fileId}-v1"` })
    await flush()
    expect(await profile.store.list('u1:f1:')).toEqual([])
    expect(await api.isDirty()).toBe(false)
  })

  it('Discard opens the server bytes clean and deletes the draft', async () => {
    profile = await browserProfile()
    await crashedTab(profile)
    profile.answer('discard')
    const { mock, api } = await profile.tab()
    await api.consumePendingOpen(FIT)
    expect(profile.prompt).toHaveBeenCalledTimes(1)
    expect(await api.getNotes(0)).not.toBe('draft notes')
    expect(await api.isDirty()).toBe(false)
    expect(mock.dirty.at(-1) ?? false).toBe(false)
    expect(await profile.store.list('u1:f1:')).toEqual([])
  })

  it('another document (not the init one) gets no draft written', async () => {
    profile = await browserProfile()
    const { mock, api, recovery } = await profile.tab()
    await api.consumePendingOpen(FIT)
    const other = mock.seed('other.pptx', FIXTURE)
    await mock.host.open(mock.openPayload(other.fileId))
    await api.setNotes({ slideIndex: 0, text: 'other edits' })
    await recovery.flush()
    expect(await profile.store.list('u1:')).toEqual([])
  })
})

describe('view-only (no host save grant)', () => {
  it('serves reads, refuses edits and saves, ignores Ctrl+S', async () => {
    const { api, mock } = await setup({ capabilities: { ...SLIDES_WEB_CAPABILITIES } })
    expect((await api.consumePendingOpen(FIT))?.slides).toHaveLength(5)
    expect(await api.getRenderSlides()).toHaveLength(5)
    expect(await api.setNotes({ slideIndex: 0, text: 'x' })).toBeNull()
    expect(await api.getNotes(0)).not.toBe('x')
    expect(await api.isDirty()).toBe(false)
    expect(await api.save()).toMatchObject({ ok: false, error: expect.any(String) })
    const seen: string[] = []
    api.onMenuCommand((c) => seen.push(c))
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }),
    )
    expect(seen).toEqual([])
    expect(mock.calls.filter((c) => c.type === 'api.save')).toHaveLength(0)
  })

  // N-02 (visual round 2): with a token `can_edit: false` the canvas still took typing
  it('answers uniworkState readOnly so the renderer keeps Reading view, and typing never marks dirty', async () => {
    const view = await setup({ capabilities: { ...SLIDES_WEB_CAPABILITIES } })
    await view.api.consumePendingOpen(FIT)
    expect(await view.api.uniworkState()).toEqual({ bound: false, readOnly: true })
    const editor = document.createElement('div')
    editor.className = 'slide-text-editor'
    editor.contentEditable = 'true'
    document.body.append(editor)
    editor.dispatchEvent(new Event('input', { bubbles: true }))
    expect(view.web.isDirty()).toBe(false)
    expect(view.mock.dirty.at(-1)).not.toBe(true)
    expect(await view.api.save()).toMatchObject({ ok: false })
    editor.remove()
  })

  it('an editing frame is not read-only', async () => {
    const { api } = await setup()
    expect(await api.uniworkState()).toEqual({ bound: false, readOnly: false })
  })

  it('host grants turn save / saveAs / open / recents on', () => {
    expect(slidesHostGrants({ save: true, saveAs: true, filePick: true, recents: true })).toEqual({
      save: true,
      saveAs: true,
      open: true,
      recents: true,
      desktopOpen: false,
    })
    expect(slidesHostGrants({ desktopOpen: true }).desktopOpen).toBe(true)
    expect(slidesHostGrants({})).toEqual({
      save: false,
      saveAs: false,
      open: false,
      recents: false,
      desktopOpen: false,
    })
  })
})

describe('open in the desktop app (A7 contract, app.open)', () => {
  it('asks the host to run its flow with the opaque feature tag and relays the outcome', async () => {
    const { api, mock } = await setup()
    mock.override('app.open', () => ({ outcome: 'installer' }))
    await expect(api.openInDesktopApp!('slides.linkedMedia')).resolves.toEqual({
      outcome: 'installer',
    })
    expect(mock.calls.filter((c) => c.type === 'app.open').map((c) => c.payload)).toEqual([
      { feature: 'slides.linkedMedia' },
    ])
  })

  it('an old host without app.open (unsupported) or a failing flow answers unavailable', async () => {
    const { api, mock } = await setup()
    mock.override('app.open', () => {
      throw Object.assign(new Error('nope'), { code: 'unsupported' })
    })
    await expect(api.openInDesktopApp!('slides.printPdf')).resolves.toEqual({
      outcome: 'unavailable',
    })
  })
})

describe('menu accelerators', () => {
  it('mod+S / mod+Shift+S become the save / save-as menu commands; mod+O only when granted', async () => {
    const { api } = await setup()
    await api.consumePendingOpen(FIT)
    const seen: string[] = []
    api.onMenuCommand((c) => seen.push(c))
    const press = (key: string, shiftKey = false) => {
      const e = new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey, cancelable: true })
      window.dispatchEvent(e)
      return e.defaultPrevented
    }
    expect(press('s')).toBe(true)
    expect(press('S', true)).toBe(true)
    expect(press('o')).toBe(true)
    expect(press('z')).toBe(false)
    expect(seen).toEqual(['save', 'save-as'])
  })
})

describe('host io', () => {
  it('recents only when granted; comment author from init.user', async () => {
    const off = await setup({ user: 'Lan Anh' })
    await off.api.consumePendingOpen(FIT)
    expect(await off.api.getRecentFiles()).toEqual([])
    const comments = await off.api.addComment({ slideIndex: 0, text: 'hi' })
    expect(comments?.[0]).toMatchObject({ author: 'Lan Anh' })
    sessions.clear()
    const on = await setup({
      capabilities: { ...SLIDES_WEB_CAPABILITIES, save: true, saveAs: true, recents: true },
    })
    await on.api.consumePendingOpen(FIT)
    expect(await on.api.getRecentFiles()).toEqual([`uniwork://files/${on.fileId}/deck.pptx`])
  })

  it('inserts a picked image from the file input', async () => {
    const png = encodePng(new Uint8Array(4 * 4), 2, 2)
    const { api } = await setup({
      pickFiles: async () => [
        new File([png as Uint8Array<ArrayBuffer>], 'pic.png', { type: 'image/png' }),
      ],
    })
    await api.consumePendingOpen(FIT)
    const r = await api.insertImage(0, FIT)
    expect(r && 'sourceId' in r ? r.sourceId : null).toBeTruthy()
  })

  it('media playback gets a blob: URL, never a data: URL', async () => {
    const { api } = await setup()
    await api.consumePendingOpen(FIT)
    const added = (await api.addMediaBytes({
      slideIndex: 0,
      kind: 'video',
      base64: btoa('fake-webm-recording'),
      ext: 'webm',
      fitWidthPx: FIT,
    }))!
    const media = await api.getMediaData(0, added.sourceId)
    expect(media).toEqual({ kind: 'video', dataUrl: 'blob:test/1' })
    // cached per element
    expect(await api.getMediaData(0, added.sourceId)).toEqual(media)
  })

  it('clipboard: an in-app copy is recognised by its marker, an external copy wins', async () => {
    let text = ''
    const clipboard = {
      writeText: async (t: string) => {
        text = t
      },
      readText: async () => text,
    }
    const { api } = await setup({ clipboard })
    await api.consumePendingOpen(FIT)
    expect(await api.copyElements({ slideIndex: 0, sourceIds: [await titleId(api)] })).toBe(1)
    await flush()
    expect(await api.clipboardExternal()).toEqual({ kind: 'internal' })
    text = 'copied elsewhere'
    expect(await api.clipboardExternal()).toEqual({ kind: 'text', text: 'copied elsewhere' })
    expect(await api.clipboardProbe()).toBe(true)
  })
})

describe('export and print', () => {
  const png = () => btoa(String.fromCharCode(...encodePng(new Uint8Array(16), 2, 2)))

  it('exportImages downloads one zip of <base>-NN.png', async () => {
    const { api, downloads } = await setup()
    expect(await api.pickExportDir()).toBeTruthy()
    const r = await api.exportImages({
      dir: 'web-download',
      baseName: 'Deck',
      pngsBase64: [png(), png()],
    })
    expect(r).toEqual({ ok: true, paths: ['Deck-images.zip'] })
    const zip = await JSZip.loadAsync(await downloads[0]!.blob.arrayBuffer())
    expect(Object.keys(zip.files)).toEqual(['Deck-01.png', 'Deck-02.png'])
  })

  it('printSlides prints the desktop print document; a host print waits for it', async () => {
    const printed: string[] = []
    const { mock, api } = await setup({
      print: async (html) => {
        printed.push(html)
        return { ok: true }
      },
    })
    await api.consumePendingOpen(FIT)
    api.onMenuCommand((cmd) => {
      if (cmd === 'print')
        void api.printSlides({ pngsBase64: [png()], widthPx: 1280, heightPx: 720, layout: 'full' })
    })
    expect(await mock.host.print({} as never)).toEqual({ printed: true })
    expect(printed[0]).toContain('<img src="data:image/png;base64,')
    expect(printed[0]).toContain('@page')
  })

  it('pickExportPdfPath names a .pdf download (no path on the web)', async () => {
    const { api } = await setup()
    expect(await api.pickExportPdfPath('Quarterly review')).toBe('Quarterly review.pdf')
  })
})

describe('hidden features answer with typed stubs', () => {
  it('AI, fonts, presenter, headless', async () => {
    const { api } = await setup()
    expect(await api.cloudGenStatus()).toEqual({ enabled: false })
    expect(await api.landGeneratedPages([], FIT)).toHaveProperty('error')
    expect(await api.presenterStart()).toEqual({ audience: false })
    expect(await api.fontCatalog()).toEqual([])
    expect(await api.consumeHeadlessExport()).toBeNull()
    expect(await api.getAutoSaveDefault()).toEqual({ on: false, updatedAt: 0 })
    expect(typeof api.onAiStream(() => {})).toBe('function')
  })
})
