import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serialize } from 'node:v8'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import UTIF from 'utif2'

type IpcHandler = (event: { sender: { id: number } }, ...args: unknown[]) => unknown
type ProtocolHandler = (request: { url: string }) => Response | Promise<Response>

const handlers = new Map<string, IpcHandler>()
const protocolHandlers = new Map<string, ProtocolHandler>()
const broadcasts: Array<{ id: number; channel: string; payload: unknown }> = []

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getName: () => 'slides-test',
    getVersion: () => '0',
    whenReady: () => Promise.resolve(),
  },
  dialog: {},
  clipboard: {
    writeBuffer: () => {},
    readBuffer: () => Buffer.alloc(0),
    readImage: () => ({ isEmpty: () => true }),
    readText: () => '',
    availableFormats: () => [],
  },
  ipcMain: {
    handle: (channel: string, fn: IpcHandler) => handlers.set(channel, fn),
    on: () => {},
    removeHandler: () => {},
  },
  BrowserWindow: class {},
  webContents: {
    getAllWebContents: () => [],
    fromId: (id: number) => ({
      send: (channel: string, payload: unknown) => broadcasts.push({ id, channel, payload }),
    }),
  },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  session: {
    defaultSession: {
      protocol: {
        handle: (scheme: string, fn: ProtocolHandler) => protocolHandlers.set(scheme, fn),
      },
      setDisplayMediaRequestHandler: () => {},
    },
  },
  nativeImage: {},
  shell: {},
  desktopCapturer: { getSources: async () => [] },
  WebContentsView: class {},
}))
// The shaping chain loads a harfbuzz wasm that cannot resolve in the unit-test env;
// none of the handlers under test measure text.
vi.mock('../src/main/shaped-metrics', () => ({
  shapedMetricsReady: async () => {},
  refineComplexWidths: async () => {},
  complexScriptOf: () => null,
  initShapedMetrics: () => {},
  gtMeasure: (t: string) => ({ width: t.length * 8 }),
  shapedFamily: () => null,
  shapedMeasure: () => ({ width: 0 }),
}))

import {
  addPicture,
  addElement,
  addMedia,
  addModel3d,
  createBlankPptx,
  duplicateSlide,
  openPptx,
  savePptx,
  replacePictureBytes,
  type PictureElement,
  type TextElement,
} from '@genoffice/pptx-engine'
import { registerSlidesIpc } from '../src/main/slides-main'
import {
  buildAllRenderSlides,
  makeMediaResolver,
  rebuildSlide,
  readSlideMedia,
  pruneMediaSources,
  takeSnapshot,
  sessions,
  type Session,
} from '../src/main/session-state'
import { buildPdfExportHtml } from '../src/main/pdf-export'
import { buildPrintDocumentHtml } from '../src/shared/print-html'
import { mergeBroadcastUpdate, mergeSlideUpdate } from '../src/shared/slide-update'
import type { PasteSlideResult, SectionInfo, SlideUpdate } from '../src/shared/ipc'
import type {
  GroupRenderNode,
  PictureRenderNode,
  RenderNode,
  RenderSlide,
  ShapeRenderNode,
} from '@genoffice/pptx-render'

const here = dirname(fileURLToPath(import.meta.url))
const FIT = 1280
const WC = 1
let session: Session

function call<T = SlideUpdate & { index: number; count: number; sections: SectionInfo[] }>(
  channel: string,
  ...args: unknown[]
): T {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`Missing handler for ${channel}`)
  return fn({ sender: { id: WC } }, ...args) as T
}

function collectSlideImageUrls(slides: RenderSlide[]): string[] {
  const urls: string[] = []
  const visitNode = (node: RenderNode): void => {
    if (node.type === 'picture' && node.dataUrl) urls.push(node.dataUrl)
    if (
      'fill' in node &&
      node.fill &&
      typeof node.fill === 'object' &&
      node.fill.kind === 'image' &&
      node.fill.dataUrl
    ) {
      urls.push(node.fill.dataUrl)
    }
    if (node.type === 'group') {
      for (const child of (node as GroupRenderNode).children) visitNode(child)
    }
  }
  for (const slide of slides) {
    if (slide.background?.kind === 'image' && slide.background.dataUrl) {
      urls.push(slide.background.dataUrl)
    }
    for (const node of slide.nodes) visitNode(node)
  }
  return urls
}

function makeTiff(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 180
    rgba[i + 1] = 90
    rgba[i + 2] = 45
    rgba[i + 3] = 255
  }
  return new Uint8Array(UTIF.encodeImage(rgba, width, height))
}

function makeEmf(): Uint8Array {
  const emf = new Uint8Array(88)
  const view = new DataView(emf.buffer)
  view.setUint32(0, 1, true) // EMR_HEADER
  view.setUint32(4, 88, true) // nSize
  view.setUint32(40, 0x464d4520, true) // ' EMF' signature
  return emf
}

beforeAll(() => registerSlidesIpc())
beforeEach(async () => {
  await new Promise<void>((resolve) => setImmediate(resolve))
  broadcasts.length = 0
  sessions.clear()
  session = {
    path: '',
    fitWidthPx: FIT,
    undoStack: [],
    redoStack: [],
    opened: await openPptx(await createBlankPptx()),
  }
  sessions.set(WC, session)
})

function addImage(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  // A valid 1px PNG followed by padding models a large embedded image without a fixture.
  bytes.set(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS9sAAAAASUVORK5CYII=',
      'base64',
    ),
  )
  expect(
    addPicture(session.opened, session.opened.deck.slides[0]!, {
      bytes,
      ext: 'png',
      offset: { x: 0, y: 0, cx: 914400, cy: 914400 },
    }),
  ).toBeTruthy()
  expect(duplicateSlide(session.opened, 0)).toBeTruthy()
  return bytes
}

describe('slide media IPC payload', () => {
  it.each(
    ['slides:paste-slide', 'slides:duplicate-slides', 'slides:add-slide'].flatMap((channel) =>
      [1024, 50 * 1024 * 1024].map((size) => [channel, size] as const),
    ),
  )('%s keeps a %i byte image outside the response', (channel, size) => {
    addImage(size)
    call('slides:copy-slides', { slideIndexes: [0] })
    const r = call(channel, { afterIndex: 0, sourceIndex: 0, slideIndexes: [0], fitWidthPx: FIT })
    const payloadBytes = serialize(r).byteLength
    process.stdout.write(`${channel} (${size} byte image): V8 payload ${payloadBytes} bytes\n`)
    expect(JSON.stringify(r).includes('data:image/')).toBe(false)
    expect(payloadBytes).toBeLessThan(32 * 1024)
    expect(r.slides).toHaveLength(1)
    const url = (r.slides[0]!.nodes[0] as PictureRenderNode).dataUrl!
    expect(url.startsWith('genoffice-slide-media://')).toBe(true)
    expect(readSlideMedia(url)?.body.byteLength).toBe(size)
  })

  it.each([1024, 50 * 1024 * 1024])(
    'inserts and deletes slides with %i byte media without sending the deck',
    async (size) => {
      addImage(size)
      const before = buildAllRenderSlides(session.opened, FIT)
      const added = call('slides:add-blank-slide', {
        sourceIndex: 0,
        before: true,
        fitWidthPx: FIT,
      })
      expect(serialize(added).byteLength).toBeLessThan(32 * 1024)
      let current = mergeSlideUpdate(before, added)
      expect(current.map((s) => s.partPath)).toEqual(added.order)
      expect(current.slice(1)).toEqual(before)
      const deleted = call('slides:delete-slides', { slideIndexes: [0, 2] })
      expect(serialize(deleted).byteLength).toBeLessThan(32 * 1024)
      current = mergeSlideUpdate(current, deleted)
      expect(current.map((s) => s.partPath)).toEqual([before[0]!.partPath])
      expect(call<RenderSlide[]>('slides:undo').map((s) => s.partPath)).toEqual(added.order)
      expect(call<RenderSlide[]>('slides:redo').map((s) => s.partPath)).toEqual(deleted.order)
      const saved = await openPptx(await savePptx(session.opened))
      expect(saved.deck.slides.map((s) => s.path)).toEqual(deleted.order)
      const picture = saved.deck.slides[0]!.elements.find(
        (e) => e.type === 'picture',
      ) as PictureElement
      expect(saved.archive.readBytes(picture.mediaRef!)?.byteLength).toBe(size)
    },
  )

  it.each([1024, 50 * 1024 * 1024])(
    'reorders, hides and deletes without transferring %i byte media',
    async (size) => {
      const bytes = addImage(size)
      duplicateSlide(session.opened, 1)
      let current = buildAllRenderSlides(session.opened, FIT)
      const original = current.map((s) => s.partPath)
      for (const [channel, op] of [
        ['slides:move-slide', { fromIndex: 0, toIndex: 2 }],
        ['slides:move-slides', { slideIndexes: [0, 1], insertAt: 3 }],
        ['slides:set-slides-hidden', { slideIndexes: [0, 1], hidden: true }],
        ['slides:delete-slide', 1],
      ] as const) {
        const result = call(channel, op)
        const payloadBytes = serialize(result).byteLength
        process.stdout.write(`${channel} (${size} byte image): V8 payload ${payloadBytes} bytes\n`)
        expect(payloadBytes).toBeLessThan(32 * 1024)
        current = mergeSlideUpdate(current, result)
        expect(current).toEqual(buildAllRenderSlides(session.opened, FIT))
        const undone = call<RenderSlide[]>('slides:undo')
        expect(serialize(undone).byteLength).toBeLessThan(32 * 1024)
        const redone = call<RenderSlide[]>('slides:redo')
        expect(redone).toEqual(current)
      }
      expect(current.map((s) => s.partPath)).not.toEqual(original)
      const reopened = await openPptx(await savePptx(session.opened))
      expect(reopened.deck.slides.map((s) => s.path)).toEqual(current.map((s) => s.partPath))
      const picture = reopened.deck.slides
        .flatMap((s) => s.elements)
        .find((e) => e.type === 'picture') as PictureElement
      expect(
        Buffer.compare(
          Buffer.from(reopened.archive.readBytes(picture.mediaRef!)!),
          Buffer.from(bytes),
        ),
      ).toBe(0)
    },
  )

  it.each(['slides:paste-slide', 'slides:duplicate-slides'] as const)(
    'preserves untouched package parts after %s and reopening',
    async (channel) => {
      const bytes = addImage(1024)
      const fixture = await savePptx(session.opened)
      session.opened = await openPptx(fixture)
      const original = await JSZip.loadAsync(fixture)
      call('slides:copy-slides', { slideIndexes: [0] })
      const result = call<PasteSlideResult>(channel, {
        afterIndex: 0,
        slideIndexes: [0],
        fitWidthPx: FIT,
      })
      const saved = await savePptx(session.opened)
      const reopened = await openPptx(saved)
      const output = await JSZip.loadAsync(saved)
      // Insertion changes the presentation manifest and its relationships.
      const changed = new Set([
        '[Content_Types].xml',
        'ppt/presentation.xml',
        'ppt/_rels/presentation.xml.rels',
      ])
      for (const [path, entry] of Object.entries(original.files)) {
        if (entry.dir || changed.has(path)) continue
        expect(output.file(path), path).not.toBeNull()
        expect(await output.file(path)!.async('uint8array'), path).toEqual(
          await entry.async('uint8array'),
        )
      }
      const picture = reopened.deck.slides[result.index]!.elements.find(
        (element) => element.type === 'picture',
      ) as PictureElement
      expect(reopened.archive.readBytes(picture.mediaRef!)).toEqual(bytes)
    },
  )

  it('keeps a paste into a 200-slide deck below 1 MB', () => {
    addImage(1024 * 1024)
    for (let i = 2; i < 200; i++) expect(duplicateSlide(session.opened, 0)).toBeTruthy()
    const before = buildAllRenderSlides(session.opened, FIT)
    call('slides:copy-slides', { slideIndexes: [0] })
    const result = call('slides:paste-slide', { afterIndex: 99, fitWidthPx: FIT })
    const payloadBytes = serialize(result).byteLength
    process.stdout.write(`200-slide paste: V8 payload ${payloadBytes} bytes\n`)
    expect(payloadBytes).toBeLessThan(1024 * 1024)
    expect(mergeSlideUpdate(before, result).map((s) => s.partPath)).toEqual(result.order)
  })

  it.each([1024, 50 * 1024 * 1024])(
    'updates only the background target with %i byte media',
    async (size) => {
      const bytes = addImage(size)
      const before = buildAllRenderSlides(session.opened, FIT)
      const result = await call<Promise<SlideUpdate>>('slides:edit-background', {
        slideIndex: 0,
        kind: 'solid',
        color: 'FF0000',
        fitWidthPx: FIT,
      })
      expect(serialize(result).byteLength).toBeLessThan(32 * 1024)
      expect(result.slides).toHaveLength(1)
      const updated = mergeSlideUpdate(before, result)
      expect(updated).toEqual(buildAllRenderSlides(session.opened, FIT))
      expect(call('slides:undo')).toEqual(before)
      expect(call('slides:redo')).toEqual(updated)
      const reopened = await openPptx(await savePptx(session.opened))
      const picture = reopened.deck.slides[0]!.elements.find(
        (e) => e.type === 'picture',
      ) as PictureElement
      expect(
        Buffer.compare(
          Buffer.from(reopened.archive.readBytes(picture.mediaRef!)!),
          Buffer.from(bytes),
        ),
      ).toBe(0)
    },
  )

  it.each([1024, 50 * 1024 * 1024])(
    'replaces text without transferring %i byte media',
    async (size) => {
      const bytes = addImage(size)
      addElement(session.opened.deck.slides[0]!, {
        kind: 'textbox',
        offset: { x: 0, y: 0, cx: 914400, cy: 914400 },
        paragraphs: [{ runs: [{ text: 'needle' }] }],
      })
      const before = buildAllRenderSlides(session.opened, FIT)
      const result = call<{ count: number; update: SlideUpdate }>('slides:find-replace', {
        find: 'needle',
        replace: 'replacement',
      })
      expect(result.count).toBe(1)
      expect(result.update.slides).toHaveLength(1)
      expect(serialize(result).byteLength).toBeLessThan(32 * 1024)
      const updated = mergeSlideUpdate(before, result.update)
      expect(updated).toEqual(buildAllRenderSlides(session.opened, FIT))
      expect(call('slides:undo')).toEqual(before)
      expect(call('slides:redo')).toEqual(updated)
      const reopened = await openPptx(await savePptx(session.opened))
      const picture = reopened.deck.slides[0]!.elements.find(
        (e) => e.type === 'picture',
      ) as PictureElement
      expect(
        Buffer.compare(
          Buffer.from(reopened.archive.readBytes(picture.mediaRef!)!),
          Buffer.from(bytes),
        ),
      ).toBe(0)
    },
  )

  it('keeps multiple large images outside the update and the open result', () => {
    const bytes = addImage(8 * 1024 * 1024)
    for (let i = 1; i < 6; i++) {
      addPicture(session.opened, session.opened.deck.slides[0]!, {
        bytes,
        ext: 'png',
        offset: { x: i * 914400, y: 0, cx: 914400, cy: 914400 },
      })
    }
    expect(serialize(buildAllRenderSlides(session.opened, FIT)).byteLength).toBeLessThan(32 * 1024)
    call('slides:copy-slides', { slideIndexes: [0] })
    const result = call('slides:paste-slide', { afterIndex: 0, fitWidthPx: FIT })
    expect(serialize(result).byteLength).toBeLessThan(32 * 1024)
    expect(
      result.slides[0]!.nodes.filter((n: { type: string }) => n.type === 'picture'),
    ).toHaveLength(6)
  })

  it('broadcasts only new pages to both attached windows and coalesces partial updates', async () => {
    addImage(1024 * 1024)
    sessions.set(2, session)
    const before = buildAllRenderSlides(session.opened, FIT)
    call('slides:copy-slides', { slideIndexes: [0] })
    call('slides:paste-slide', { afterIndex: 0, fitWidthPx: FIT })
    call('slides:duplicate-slides', { slideIndexes: [0], fitWidthPx: FIT })
    const expected = buildAllRenderSlides(session.opened, FIT)
    await new Promise<void>((resolve) => setImmediate(resolve))
    const messages = broadcasts.filter((b) => b.channel === 'slides:deck-changed')
    expect(messages.map((b) => b.id)).toEqual([1, 2])
    for (const message of messages) {
      const update = message.payload as PasteSlideResult
      expect(update.slides).toHaveLength(2)
      expect(serialize(update).byteLength).toBeLessThan(32 * 1024)
      expect(mergeSlideUpdate(before, update)).toEqual(expected)
    }
  })

  it('resyncs when undo shares a broadcast task with an insertion', async () => {
    addImage(1024)
    sessions.set(2, session)
    call('slides:duplicate-slides', { slideIndexes: [0], fitWidthPx: FIT })
    call('slides:undo')
    const expected = buildAllRenderSlides(session.opened, FIT)
    await new Promise<void>((resolve) => setImmediate(resolve))
    const messages = broadcasts.filter((b) => b.channel === 'slides:deck-changed')
    expect(messages).toHaveLength(2)
    const state = messages[0]!.payload as { slides: RenderSlide[]; order?: string[] }
    expect(state.order).toBeUndefined()
    expect(state.slides).toEqual(expected)
  })

  it('duplicates a noncontiguous selection in order after the last selected page', async () => {
    addImage(1024)
    duplicateSlide(session.opened, 1)
    duplicateSlide(session.opened, 2)
    const before = buildAllRenderSlides(session.opened, FIT)
    const result = call('slides:duplicate-slides', { slideIndexes: [2, 0, 2], fitWidthPx: FIT })
    const current = mergeSlideUpdate(before, result)
    expect(result.index).toBe(3)
    expect(result.slides).toHaveLength(2)
    expect(current.map((s) => s.partPath)).toEqual([
      before[0]!.partPath,
      before[1]!.partPath,
      before[2]!.partPath,
      result.slides[0]!.partPath,
      result.slides[1]!.partPath,
      before[3]!.partPath,
    ])
    const saved = await openPptx(await savePptx(session.opened))
    expect(saved.deck.slides).toHaveLength(6)
    expect(saved.deck.slides[3]!.elements.some((e) => e.type === 'picture')).toBe(true)
  })

  it('refreshes shifted slide-number fields and reverses the renumber on picture repaste', () => {
    const bytes = addImage(1024)
    const numbered = session.opened.deck.slides[1]!
    const text = addElement(numbered, {
      kind: 'textbox',
      offset: { x: 0, y: 0, cx: 914400, cy: 914400 },
      paragraphs: [{ runs: [{ text: '2', field: 'slidenum' }] }],
    }) as TextElement
    expect(text).toBeTruthy()
    const before = buildAllRenderSlides(session.opened, FIT)
    call('slides:copy-slides', { slideIndexes: [0], pngs: [Buffer.from(bytes).toString('base64')] })
    const pasted = call('slides:paste-slide', { afterIndex: 0, fitWidthPx: FIT })
    expect(pasted.slides.map((s: RenderSlide) => s.partPath)).toContain(numbered.path)
    let current = mergeSlideUpdate(before, pasted)
    expect(current[2]).toEqual(rebuildSlide(session, 2))
    expect(current[2]).not.toEqual(before[1])
    const picture = call('slides:repaste-slide', { fitWidthPx: FIT, mode: 'picture' })
    current = mergeSlideUpdate(current, picture)
    expect(current[1]).toEqual(rebuildSlide(session, 1))
    expect(current[1]).toEqual(before[1])
  })

  it.each(['theme', 'source'] as const)(
    'pastes between two pages in %s mode, undo/redoes and saves image bytes',
    async (mode) => {
      const bytes = addImage(1024 * 1024)
      const before = buildAllRenderSlides(session.opened, FIT)
      call('slides:copy-slides', { slideIndexes: [0] })
      const result = call<PasteSlideResult>('slides:paste-slide', {
        afterIndex: 0,
        fitWidthPx: FIT,
        mode,
      })
      const merged = mergeSlideUpdate(before, result)
      expect(result.index).toBe(1)
      expect(result.count).toBe(1)
      expect(merged).toHaveLength(3)
      expect(merged[0]).toBe(before[0])
      expect(merged[2]).toBe(before[1])
      const picture = merged[1]!.nodes.find((n) => n.type === 'picture') as PictureRenderNode
      expect(
        Buffer.compare(Buffer.from(readSlideMedia(picture.dataUrl!)!.body), Buffer.from(bytes)),
      ).toBe(0)
      const undone = call<RenderSlide[]>('slides:undo')
      expect(undone.map((s) => s.partPath)).toEqual(before.map((s) => s.partPath))
      const redone = call<RenderSlide[]>('slides:redo')
      expect(redone.map((s) => s.partPath)).toEqual(merged.map((s) => s.partPath))
      expect(serialize(redone).byteLength).toBeLessThan(32 * 1024)
      const saved = await openPptx(await savePptx(session.opened))
      expect(saved.deck.slides.map((s) => s.path)).toEqual(result.order)
      const savedPicture = saved.deck.slides[1]!.elements.find(
        (el) => el.type === 'picture',
      ) as PictureElement
      expect(
        Buffer.compare(
          Buffer.from(saved.archive.readBytes(savedPicture.mediaRef!)!),
          Buffer.from(bytes),
        ),
      ).toBe(0)
    },
  )

  it('repastes from slides to picture and back without leaving a stale inserted page', () => {
    const bytes = addImage(1024)
    const before = buildAllRenderSlides(session.opened, FIT)
    call('slides:copy-slides', { slideIndexes: [0], pngs: [Buffer.from(bytes).toString('base64')] })
    const pasted = call('slides:paste-slide', { afterIndex: 0, fitWidthPx: FIT, mode: 'theme' })
    let current = mergeSlideUpdate(before, pasted)
    const picture = call('slides:repaste-slide', { fitWidthPx: FIT, mode: 'picture' })
    current = mergeSlideUpdate(current, picture)
    expect(picture.count).toBe(0)
    expect(current).toHaveLength(2)
    expect(current[0]!.nodes.filter((n) => n.type === 'picture')).toHaveLength(2)
    const source = call('slides:repaste-slide', { fitWidthPx: FIT, mode: 'source' })
    current = mergeSlideUpdate(current, source)
    expect(current).toHaveLength(3)
    // Restoring the snapshot also removes the picture pasted on the anchor.
    expect(current[0]!.nodes.filter((n) => n.type === 'picture')).toHaveLength(1)
    expect(session.undoStack).toHaveLength(1)
  })

  it('prunes media absent from the archive and history while retaining rollback bytes', () => {
    addImage(1024)
    const slide = session.opened.deck.slides[0]!
    const pic = slide.elements.find((el) => el.type === 'picture') as PictureElement
    const original = makeMediaResolver(session.opened, slide.path)(pic.mediaRef!)!
    pruneMediaSources(session)
    expect(readSlideMedia(original)).not.toBeNull()
    const oldPath = pic.mediaRef!
    session.undoStack.push(takeSnapshot(session))
    const replacement = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1])
    expect(replacePictureBytes(session.opened, slide, pic.id, replacement, 'png')).toBe(true)
    const updated = makeMediaResolver(session.opened, slide.path)(pic.mediaRef!)!
    session.opened.archive.entries.delete(oldPath)
    pruneMediaSources(session)
    expect(readSlideMedia(original)).not.toBeNull()
    expect(readSlideMedia(updated)).not.toBeNull()
    session.undoStack = []
    pruneMediaSources(session)
    expect(readSlideMedia(original)).toBeNull()
    expect(readSlideMedia(updated)).not.toBeNull()
  })

  it('gives a replaced image a new URL and restores the original URL on undo', () => {
    addImage(1024)
    const slide = session.opened.deck.slides[0]!
    const pic = slide.elements.find((el) => el.type === 'picture') as PictureElement
    const original = makeMediaResolver(session.opened, slide.path)(pic.mediaRef!)!
    call('slides:copy-slides', { slideIndexes: [0] })
    call('slides:paste-slide', { afterIndex: 0, fitWidthPx: FIT })
    const replacement = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1])
    expect(replacePictureBytes(session.opened, slide, pic.id, replacement, 'png')).toBe(true)
    const updated = makeMediaResolver(session.opened, slide.path)(pic.mediaRef!)!
    expect(updated).not.toBe(original)
    expect(readSlideMedia(updated)?.body.byteLength).toBe(replacement.length)
    call('slides:undo')
    const restored = session.opened.deck.slides[0]!.elements.find(
      (el) => el.type === 'picture',
    ) as PictureElement
    expect(makeMediaResolver(session.opened, slide.path)(restored.mediaRef!)).toBe(original)
    expect(readSlideMedia('genoffice-slide-media://archive/unknown')).toBeNull()
  })

  // ── Fork-only test (1): multi-media deck round-trip ─────────────────────────
  it('round-trips a deck with PNG, video, audio, Record narration, 3D model, TIFF, themed SVG, and EMF through all slide edits', async () => {
    const pngBytes = addImage(2048)
    const s0 = session.opened.deck.slides[0]!

    // TIFF, themed SVG, EMF on slide 0
    const tiffBytes = makeTiff(8, 6)
    const svgBytes = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>.MsftOfcThm_accent1_Fill { fill:#000000; }</style><rect class="MsftOfcThm_accent1_Fill" width="10" height="10"/></svg>',
      'utf8',
    )
    const emfBytes = makeEmf()
    expect(
      addPicture(session.opened, s0, {
        bytes: tiffBytes,
        ext: 'tiff',
        offset: { x: 100000, y: 0, cx: 500000, cy: 500000 },
      }),
    ).toBeTruthy()
    const svgPic = addPicture(session.opened, s0, {
      bytes: new Uint8Array(svgBytes),
      ext: 'png',
      offset: { x: 200000, y: 0, cx: 500000, cy: 500000 },
    })
    expect(svgPic).toBeTruthy()
    const oldSvgPath = svgPic!.mediaRef!
    const newSvgPath = oldSvgPath.replace(/\.png$/, '.svg')
    session.opened.archive.entries.delete(oldSvgPath)
    session.opened.archive.entries.set(newSvgPath, new Uint8Array(svgBytes))
    svgPic!.mediaRef = newSvgPath
    const s0RelsPath = 'ppt/slides/_rels/slide1.xml.rels'
    session.opened.archive.entries.set(
      s0RelsPath,
      Buffer.from(
        session.opened.archive
          .readText(s0RelsPath)!
          .replace(oldSvgPath.replace('ppt/', '../'), '../media/' + newSvgPath.split('/').pop()!),
        'utf8',
      ),
    )
    session.opened.archive.entries.set(
      '[Content_Types].xml',
      Buffer.from(
        session.opened.archive
          .readText('[Content_Types].xml')!
          .replace('</Types>', '<Default Extension="svg" ContentType="image/svg+xml"/></Types>'),
        'utf8',
      ),
    )
    expect(
      addPicture(session.opened, s0, {
        bytes: emfBytes,
        ext: 'png',
        offset: { x: 300000, y: 0, cx: 500000, cy: 500000 },
      }),
    ).toBeTruthy()

    // Video, audio, and 3D model on slide 1
    const videoBytes = Uint8Array.from({ length: 128 }, (_, i) => (i * 7) & 0xff)
    const audioBytes = Uint8Array.from({ length: 96 }, (_, i) => (i * 11) & 0xff)
    const glbBytes = new Uint8Array(Buffer.from('Z2xURgIAAAAYAAAABAAAAEpTT057fSAg', 'base64'))
    expect(
      addMedia(session.opened, 1, {
        kind: 'video',
        bytes: videoBytes,
        ext: 'mp4',
        poster: { bytes: pngBytes, ext: 'png' },
        offset: { x: 0, y: 0, cx: 914400, cy: 914400 },
      }),
    ).toBeTruthy()
    expect(
      addMedia(session.opened, 1, {
        kind: 'audio',
        bytes: audioBytes,
        ext: 'mp3',
        offset: { x: 914400, y: 0, cx: 457200, cy: 457200 },
      }),
    ).toBeTruthy()
    expect(
      addModel3d(session.opened, 1, {
        bytes: glbBytes,
        ext: 'glb',
        poster: { bytes: pngBytes, ext: 'png' },
        offset: { x: 1828800, y: 0, cx: 914400, cy: 914400 },
      }),
    ).toBeTruthy()
    addElement(session.opened.deck.slides[1]!, {
      kind: 'textbox',
      offset: { x: 0, y: 914400, cx: 914400, cy: 457200 },
      paragraphs: [{ runs: [{ text: 'find-target' }] }],
    })

    // Record narration on slide 0 via session handler (returns SlideUpdate)
    const wavBase64 = 'UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQgAAAAAAAAAAAAAAA=='
    const recUpdate = call<SlideUpdate>('slides:save-recording', {
      slides: [{ slideIndex: 0, wavBase64, durationMs: 1000, advanceMs: 1200 }],
    })
    expect(recUpdate.slides).toHaveLength(1)
    expect(recUpdate.order).toHaveLength(2)

    // Snapshot the full multi-media fixture before slide-level operations
    const baselineBytes = await savePptx(session.opened)
    session.opened = await openPptx(baselineBytes)
    const baselineZip = await JSZip.loadAsync(baselineBytes)

    // Verify lazy protocol URLs + display conversions (TIFF -> PNG, SVG retint, EMF bytes)
    let current = buildAllRenderSlides(session.opened, FIT)
    const s0Urls = collectSlideImageUrls([current[0]!])
    expect(s0Urls.every((u) => u.startsWith('genoffice-slide-media://'))).toBe(true)
    const tiffUrl = s0Urls.find((u) => u.includes('image%2Ftiff'))!
    const svgUrl = s0Urls.find((u) => u.includes('image%2Fsvg%2Bxml'))!
    const emfUrl = s0Urls.find((u) => u.includes('image%2Fx-emf'))!
    const tiffServed = readSlideMedia(tiffUrl)!
    expect(tiffServed.mime).toBe('image/png')
    expect([...tiffServed.body.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    const svgServed = readSlideMedia(svgUrl)!
    expect(svgServed.mime).toBe('image/svg+xml')
    expect(Buffer.from(svgServed.body).toString('utf8')).not.toContain('fill:#000000')
    const emfServed = readSlideMedia(emfUrl)!
    expect(emfServed.mime).toBe('image/x-emf')
    expect(emfServed.body).toEqual(emfBytes)

    // Exercise insert / duplicate / move / hide / paste / find-replace / edit-background
    const added = call('slides:add-blank-slide', { sourceIndex: 1, fitWidthPx: FIT })
    current = mergeSlideUpdate(current, added)
    const deleted = call('slides:delete-slide', 2)
    current = mergeSlideUpdate(current, deleted)
    const duped = call('slides:duplicate-slides', { slideIndexes: [0], fitWidthPx: FIT })
    current = mergeSlideUpdate(current, duped)
    const moved = call('slides:move-slide', { fromIndex: 1, toIndex: 2 })
    current = mergeSlideUpdate(current, moved)
    const hidden = call('slides:set-slides-hidden', { slideIndexes: [1], hidden: true })
    current = mergeSlideUpdate(current, hidden)
    const unhidden = call('slides:set-slides-hidden', { slideIndexes: [1], hidden: false })
    current = mergeSlideUpdate(current, unhidden)
    call('slides:copy-slides', { slideIndexes: [1] })
    const pasted = call('slides:paste-slide', { afterIndex: 2, fitWidthPx: FIT })
    current = mergeSlideUpdate(current, pasted)
    const removedPaste = call('slides:delete-slides', { slideIndexes: [3] })
    current = mergeSlideUpdate(current, removedPaste)
    const replaced = call<{ count: number; update: SlideUpdate }>('slides:find-replace', {
      find: 'find-target',
      replace: 'replaced-target',
    })
    expect(replaced.count).toBe(1)
    current = mergeSlideUpdate(current, replaced.update)
    const bgUpdated = await call<Promise<SlideUpdate>>('slides:edit-background', {
      slideIndex: 1,
      kind: 'solid',
      color: 'E2F0D9',
      fitWidthPx: FIT,
    })
    current = mergeSlideUpdate(current, bgUpdated)
    expect(current).toEqual(buildAllRenderSlides(session.opened, FIT))

    // Save and reopen: verify untouched parts (slide1.xml, media, 3D model, theme, master) are byte-equal
    const savedBytes = await savePptx(session.opened)
    const reopened = await openPptx(savedBytes)
    const savedZip = await JSZip.loadAsync(savedBytes)
    const touchedParts = new Set([
      '[Content_Types].xml',
      'ppt/presentation.xml',
      'ppt/_rels/presentation.xml.rels',
      'ppt/slides/slide2.xml',
    ])
    for (const [path, entry] of Object.entries(baselineZip.files)) {
      if (entry.dir || touchedParts.has(path)) continue
      expect(savedZip.file(path), path).not.toBeNull()
      expect(await savedZip.file(path)!.async('uint8array'), path).toEqual(
        await entry.async('uint8array'),
      )
    }
    expect(reopened.deck.slides.map((s) => s.path)).toEqual(current.map((s) => s.partPath))
    for (const [path, entry] of Object.entries(baselineZip.files)) {
      if (entry.dir || (!path.startsWith('ppt/media/') && !path.startsWith('ppt/model3d/')))
        continue
      expect(reopened.archive.readBytes(path), path).toEqual(await entry.async('uint8array'))
    }
  })

  // ── Fork-only test (2): undo/redo/AI-snapshot restore retains all media URLs ──
  it('resolves every image URL across undo, redo, and AI-snapshot restore after pruneMediaSources', async () => {
    addImage(2048)
    const assertAllUrlsResolve = (slides: RenderSlide[]) => {
      const urls = collectSlideImageUrls(slides)
      expect(urls.length).toBeGreaterThan(0)
      for (const url of urls) {
        expect(url.startsWith('genoffice-slide-media://')).toBe(true)
        expect(readSlideMedia(url), url).not.toBeNull()
      }
    }

    let current = buildAllRenderSlides(session.opened, FIT)
    assertAllUrlsResolve(current)

    // Begin an AI history batch, replace picture bytes + duplicate slide, then end batch -> registers AI snapshot
    expect(call('slides:history-batch-begin')).toBe(true)
    const replace1 = new Uint8Array([
      ...Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS9sAAAAASUVORK5CYII=',
        'base64',
      ),
      11,
      22,
    ])
    const s0Pic = session.opened.deck.slides[0]!.elements.find(
      (e) => e.type === 'picture',
    ) as PictureElement
    call('slides:replace-picture-bytes', {
      slideIndex: 0,
      sourceId: s0Pic.id,
      base64: Buffer.from(replace1).toString('base64'),
      ext: 'png',
    })
    call('slides:duplicate-slides', { slideIndexes: [0], fitWidthPx: FIT })
    const snapId = call<number>('slides:history-batch-end')
    expect(snapId).toBeGreaterThan(0)
    await new Promise<void>((resolve) => setImmediate(resolve))
    current = buildAllRenderSlides(session.opened, FIT)
    assertAllUrlsResolve(current)

    // Another edit outside the batch: replace picture again + delete slide
    const replace2 = new Uint8Array([...replace1, 33, 44])
    const s0PicAfter = session.opened.deck.slides[0]!.elements.find(
      (e) => e.type === 'picture',
    ) as PictureElement
    call('slides:replace-picture-bytes', {
      slideIndex: 0,
      sourceId: s0PicAfter.id,
      base64: Buffer.from(replace2).toString('base64'),
      ext: 'png',
    })
    const delUpdate = call<SlideUpdate>('slides:delete-slide', 2)
    current = mergeSlideUpdate(buildAllRenderSlides(session.opened, FIT), delUpdate)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assertAllUrlsResolve(current)

    // Undo and redo each step while scheduleHistoryNotify runs pruneMediaSources
    const undone1 = call<RenderSlide[]>('slides:undo')
    await new Promise<void>((resolve) => setImmediate(resolve))
    assertAllUrlsResolve(undone1)

    const undone2 = call<RenderSlide[]>('slides:undo')
    await new Promise<void>((resolve) => setImmediate(resolve))
    assertAllUrlsResolve(undone2)

    const redone1 = call<RenderSlide[]>('slides:redo')
    await new Promise<void>((resolve) => setImmediate(resolve))
    assertAllUrlsResolve(redone1)

    // Restore AI snapshot: rolls back to pre-batch state and keeps all URLs resolvable
    const restoredAi = call<RenderSlide[]>('slides:ai-snapshot-restore', snapId)
    await new Promise<void>((resolve) => setImmediate(resolve))
    assertAllUrlsResolve(restoredAi)

    // Undo the AI snapshot restore itself
    const undoneAi = call<RenderSlide[]>('slides:undo')
    await new Promise<void>((resolve) => setImmediate(resolve))
    assertAllUrlsResolve(undoneAi)
  })

  // ── Fork-only test (3): 200 slides x 5 images payload bound + no memory leak ──
  it('keeps every handler result under 64 KB on a 200-slide x 5-image deck with no growth of pruned media sources', async () => {
    const imgBytes = addImage(32 * 1024)
    for (let k = 1; k < 5; k++) {
      addPicture(session.opened, session.opened.deck.slides[0]!, {
        bytes: new Uint8Array([...imgBytes, k]),
        ext: 'png',
        offset: { x: k * 457200, y: 0, cx: 457200, cy: 457200 },
      })
    }
    for (let i = 2; i < 200; i++) expect(duplicateSlide(session.opened, 0)).toBeTruthy()
    expect(session.opened.deck.slides).toHaveLength(200)

    let current = buildAllRenderSlides(session.opened, FIT)
    expect(serialize(current).byteLength).toBeLessThan(512 * 1024)

    const addRes = call('slides:add-slide', { sourceIndex: 100, fitWidthPx: FIT })
    expect(serialize(addRes).byteLength).toBeLessThan(64 * 1024)
    current = mergeSlideUpdate(current, addRes)

    const moveRes = call('slides:move-slide', { fromIndex: 101, toIndex: 50 })
    expect(serialize(moveRes).byteLength).toBeLessThan(64 * 1024)
    current = mergeSlideUpdate(current, moveRes)

    const hideRes = call('slides:set-slides-hidden', { slideIndexes: [50], hidden: true })
    expect(serialize(hideRes).byteLength).toBeLessThan(64 * 1024)
    current = mergeSlideUpdate(current, hideRes)

    const bgRes = await call<Promise<SlideUpdate>>('slides:edit-background', {
      slideIndex: 50,
      kind: 'solid',
      color: 'DDEBF7',
      fitWidthPx: FIT,
    })
    expect(serialize(bgRes).byteLength).toBeLessThan(64 * 1024)
    current = mergeSlideUpdate(current, bgRes)

    const delRes = call('slides:delete-slide', 50)
    expect(serialize(delRes).byteLength).toBeLessThan(64 * 1024)
    current = mergeSlideUpdate(current, delRes)
    expect(current).toHaveLength(200)

    // Repeated replacements that are overwritten and pruned from history must be collected
    const pic = session.opened.deck.slides[0]!.elements.find(
      (e) => e.type === 'picture',
    ) as PictureElement
    const transientUrls: string[] = []
    for (let step = 0; step < 5; step++) {
      const tempBytes = new Uint8Array([...imgBytes.subarray(0, 128), 100 + step])
      replacePictureBytes(session.opened, session.opened.deck.slides[0]!, pic.id, tempBytes, 'png')
      const u = makeMediaResolver(
        session.opened,
        session.opened.deck.slides[0]!.path,
      )(pic.mediaRef!)!
      transientUrls.push(u)
      expect(readSlideMedia(u)).not.toBeNull()
    }
    session.undoStack = []
    session.redoStack = []
    pruneMediaSources(session)
    // All 4 superseded URLs were pruned; only the live 5th URL remains
    for (const oldUrl of transientUrls.slice(0, 4)) {
      expect(readSlideMedia(oldUrl)).toBeNull()
    }
    expect(readSlideMedia(transientUrls[4]!)).not.toBeNull()
  })

  // ── Fork-only test (4): two attached clients partial -> full broadcast ordering + missing base refetch ──
  it('delivers partial then full broadcasts in order to two attached clients, and a client without base refetches', async () => {
    addImage(4096)
    sessions.set(2, session)
    const client1Base = buildAllRenderSlides(session.opened, FIT)
    let client1Slides: RenderSlide[] | null = client1Base
    let client2Slides: RenderSlide[] | null = null // Client 2 has no base yet
    const client2Refetches: RenderSlide[][] = []

    // Step 1: partial broadcast from slide insertion
    call('slides:add-blank-slide', { sourceIndex: 0, fitWidthPx: FIT })
    await new Promise<void>((resolve) => setImmediate(resolve))
    const batch1 = broadcasts.splice(0).filter((b) => b.channel === 'slides:deck-changed')
    expect(batch1.map((b) => b.id)).toEqual([1, 2])
    const partialPayload = batch1[0]!.payload as SlideUpdate & { size: { cx: number; cy: number } }
    expect(partialPayload.order).toHaveLength(3)
    expect(partialPayload.slides).toHaveLength(1)

    // Client 1 has the base -> merges without refetching
    const c1Refresh = vi.fn()
    client1Slides = mergeBroadcastUpdate(client1Slides, partialPayload, c1Refresh)
    await Promise.resolve()
    expect(c1Refresh).not.toHaveBeenCalled()
    expect(client1Slides).toEqual(buildAllRenderSlides(session.opened, FIT))

    // Client 2 lacks the base -> schedules refetch via getRenderSlides
    expect(
      mergeBroadcastUpdate(client2Slides, partialPayload, () => {
        client2Refetches.push(call<RenderSlide[]>('slides:get-render-slides'))
      }),
    ).toBeNull()
    await Promise.resolve()
    expect(client2Refetches).toHaveLength(1)
    client2Slides = client2Refetches[0]!
    expect(client2Slides).toEqual(client1Slides)

    // Step 2: full broadcast from undo
    call('slides:undo')
    await new Promise<void>((resolve) => setImmediate(resolve))
    const batch2 = broadcasts.splice(0).filter((b) => b.channel === 'slides:deck-changed')
    expect(batch2.map((b) => b.id)).toEqual([1, 2])
    const fullPayload = batch2[0]!.payload as { slides: RenderSlide[]; order?: string[] }
    expect(fullPayload.order).toBeUndefined()
    expect(fullPayload.slides).toHaveLength(2)
    expect(fullPayload.slides).toEqual(client1Base)
  })

  // ── Fork-only test (6): renumbering after move with slide-number field ──
  it('rebuilds shifted slides carrying a slidenum field on move-slide, move-slides, and move-section', () => {
    addImage(1024)
    duplicateSlide(session.opened, 1)
    // Add a slidenum field to slide 2 (index 2, slide number '3')
    const slide2 = session.opened.deck.slides[2]!
    addElement(slide2, {
      kind: 'textbox',
      offset: { x: 0, y: 0, cx: 914400, cy: 457200 },
      paragraphs: [{ runs: [{ text: '3', field: 'slidenum' }] }],
    })
    let current = buildAllRenderSlides(session.opened, FIT)
    const slideNumberText = (s: RenderSlide) =>
      s.nodes
        .filter((n): n is ShapeRenderNode => n.type === 'text' || n.type === 'shape')
        .flatMap((n) => n.text?.lines ?? [])
        .flatMap((l) => l.runs)
        .map((r) => r.text)
        .join('')
    expect(slideNumberText(current[2]!)).toBe('3')

    // Move slide 2 to index 0 -> its slide number changes from '3' to '1', so it must be in SlideUpdate.slides
    const moved = call('slides:move-slide', { fromIndex: 2, toIndex: 0 })
    expect(moved.slides.map((s) => s.partPath)).toContain(slide2.path)
    current = mergeSlideUpdate(current, moved)
    expect(slideNumberText(current[0]!)).toBe('1')

    // Move slides [1, 2] to index 0 -> slide2 shifts from index 0 to index 2 ('1' -> '3')
    const movedMulti = call('slides:move-slides', { slideIndexes: [1, 2], insertAt: 0 })
    expect(movedMulti.slides.map((s) => s.partPath)).toContain(slide2.path)
    current = mergeSlideUpdate(current, movedMulti)
    expect(slideNumberText(current[2]!)).toBe('3')

    // Create two sections and move section B up -> slide2 shifts again and is rebuilt
    call('slides:add-section', { atSlideIndex: 0, name: 'Sec A' })
    const secs = call<SectionInfo[]>('slides:add-section', { atSlideIndex: 2, name: 'Sec B' })
    const secB = secs.find((s) => s.name === 'Sec B')!
    const movedSec = call('slides:move-section', { id: secB.id, dir: 'up' })
    expect(movedSec.slides.map((s) => s.partPath)).toContain(slide2.path)
    current = mergeSlideUpdate(current, movedSec)
    expect(slideNumberText(current[0]!)).toBe('1')
  })

  // ── Design Point 4: CSP, protocol handler, and PDF/print/presenter/headless scheme safety ──
  it('registers the genoffice-slide-media protocol with CORS headers, allows it in renderer CSP, and keeps PDF/print markup scheme-free', () => {
    const bytes = addImage(1024)
    const slide = session.opened.deck.slides[0]!
    const pic = slide.elements.find((e) => e.type === 'picture') as PictureElement
    const url = makeMediaResolver(session.opened, slide.path)(pic.mediaRef!)!

    // 1. Protocol handler registered by slides-main serves 200 + CORS headers, 404 on unknown
    const proto = protocolHandlers.get('genoffice-slide-media')
    expect(proto).toBeTypeOf('function')
    const okRes = proto!({ url }) as Response
    expect(okRes.status).toBe(200)
    expect(okRes.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(okRes.headers.get('Content-Type')).toBe('image/png')
    expect(okRes.headers.get('Content-Length')).toBe(String(bytes.byteLength))
    const notFound = proto!({ url: 'genoffice-slide-media://archive/missing' }) as Response
    expect(notFound.status).toBe(404)

    // 2. Renderer index.html CSP (shared by editor, presenter, audience, and headless export windows)
    const html = readFileSync(join(here, '..', 'src', 'renderer', 'index.html'), 'utf8')
    expect(html).toMatch(/img-src[^;]*\bgenoffice-slide-media:/)
    expect(html).toMatch(/connect-src[^;]*\bgenoffice-slide-media:/)

    // 3. Hidden PDF export and print HTML builders use pre-rendered PNG/SVG pages and never emit genoffice-slide-media:
    const pdfHtml = buildPdfExportHtml([{ png: 'AAAA' }, { svg: '<svg></svg>' }], 13.333, 7.5)
    expect(pdfHtml).not.toContain('genoffice-slide-media:')
    expect(pdfHtml).toContain('data:image/png;base64,AAAA')
    const printHtml = buildPrintDocumentHtml({
      srcs: ['data:image/png;base64,AAAA'],
      ratio: 16 / 9,
      layout: 'full',
    })
    expect(printHtml).not.toContain('genoffice-slide-media:')
    expect(printHtml).toContain('data:image/png;base64,AAAA')
  })
})
