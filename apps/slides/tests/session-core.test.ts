// @vitest-environment node
/**
 * The session core without Electron: handlers called straight from the registry with
 * the in-memory HostIO, the platform event sink, and the Buffer-free byte helpers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openPptx } from '@genoffice/pptx-engine'
import {
  MemoryHostIO,
  base64ToBytes,
  bytesToBase64,
  callSessionHandler,
  configureSessionPlatform,
  createSession,
  sessions,
  utf8Decode,
  type HandlerContext,
} from '../src/session'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(
      join(here, '..', '..', '..', 'packages', 'pptx-engine', 'tests', 'fixtures', name),
    ),
  )
const PNG = base64ToBytes(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
)
const FIT = 1280

const events: Array<{ kind: string; ids: number[]; payload: unknown }> = []
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

beforeAll(() => {
  configureSessionPlatform({
    events: {
      historyChanged: (ids, payload) => events.push({ kind: 'history', ids, payload }),
      deckChanged: (ids, payload) => events.push({ kind: 'deck', ids, payload }),
    },
  })
})

afterAll(() => {
  sessions.clear()
})

async function openClient(clientId: number, host = new MemoryHostIO()): Promise<HandlerContext> {
  const opened = await openPptx(fixture('01_standard_business.pptx'))
  createSession(clientId, { path: 'deck.pptx', opened, fitWidthPx: FIT })
  return { clientId, host }
}

describe('byte helpers', () => {
  it('match Buffer base64 and utf-8 for arbitrary bytes', () => {
    for (let n = 0; n < 70; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + n * 13) & 255)
      const b64 = Buffer.from(bytes).toString('base64')
      expect(bytesToBase64(bytes)).toBe(b64)
      expect(base64ToBytes(b64)).toEqual(new Uint8Array(Buffer.from(b64, 'base64')))
      const url = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      expect(base64ToBytes(url)).toEqual(new Uint8Array(Buffer.from(url, 'base64')))
    }
    const text = '﻿Tiếng Việt 中文 🎉'
    expect(utf8Decode(new Uint8Array(Buffer.from(text, 'utf8')))).toBe(
      Buffer.from(text, 'utf8').toString('utf8'),
    )
  })
})

describe('session handlers with the in-memory host', () => {
  it('reports history through the event sink and undoes an edit', async () => {
    const ctx = await openClient(101)
    await flush()
    events.length = 0
    const added = callSessionHandler('slides:add-element', ctx, {
      slideIndex: 0,
      kind: 'rect',
      xPx: 10,
      yPx: 10,
      wPx: 100,
      hPx: 50,
      fitWidthPx: FIT,
    })
    expect(added?.sourceId).toBeTruthy()
    await flush()
    expect(events).toContainEqual({
      kind: 'history',
      ids: [101],
      payload: { canUndo: true, canRedo: false },
    })
    expect(callSessionHandler('slides:is-dirty', ctx)).toBe(true)
    expect(callSessionHandler('slides:undo', ctx)).toHaveLength(5)
  })

  it('inserts a picked image and answers null when the picker is canceled', async () => {
    const host = new MemoryHostIO()
    const ctx = await openClient(102, host)
    host.imagePicks.push({ bytes: PNG, name: 'p.png', ext: 'png' })
    const inserted = await callSessionHandler('slides:insert-image', ctx, 0, FIT)
    expect(inserted && 'sourceId' in inserted ? inserted.sourceId : null).toBeTruthy()
    expect(await callSessionHandler('slides:insert-image', ctx, 0, FIT)).toBeNull()
    expect(host.calls.filter((c) => c.kind === 'pickImage')).toHaveLength(2)
    host.imagePicks.push({ bytes: PNG, name: 'p.png', ext: 'png' })
    expect(await callSessionHandler('slides:pick-picture-file', ctx)).toEqual({
      base64: bytesToBase64(PNG),
      ext: 'png',
    })
  })

  it('asks the host before simplifying an imported chart and stops on cancel', async () => {
    const host = new MemoryHostIO()
    const ctx = await openClient(103, host)
    const chart = callSessionHandler('slides:add-chart', ctx, {
      slideIndex: 1,
      kind: 'bar',
      categories: ['A', 'B'],
      series: [{ name: 'S', values: [1, 2] }],
      xPx: 0,
      yPx: 0,
      wPx: 300,
      hPx: 200,
      fitWidthPx: FIT,
    })
    expect(chart).toBeTruthy()
    // App-created charts carry the aislides-chart marker: no confirmation needed
    const edited = await callSessionHandler('slides:edit-chart', ctx, {
      slideIndex: 1,
      sourceId: chart!.sourceId,
      title: 'T',
    })
    expect(edited).toBeTruthy()
    expect(host.calls.some((c) => c.kind === 'confirm')).toBe(false)
  })

  it('round-trips the app clipboard markers through the host clipboard', async () => {
    const host = new MemoryHostIO()
    const ctx = await openClient(104, host)
    const ids = (callSessionHandler('slides:get-render-slides', ctx) ?? [])[0]!.nodes.map(
      (n) => n.sourceId,
    )
    expect(callSessionHandler('slides:copy-elements', ctx, { slideIndex: 0, sourceIds: ids })).toBe(
      ids.length,
    )
    expect(callSessionHandler('slides:clipboard-external', ctx)).toEqual({ kind: 'internal' })
    host.externalCopy({ image: PNG })
    expect(callSessionHandler('slides:clipboard-external', ctx)).toEqual({
      kind: 'image',
      base64: bytesToBase64(PNG),
      ext: 'png',
    })
    host.externalCopy({ text: 'hello' })
    expect(callSessionHandler('slides:clipboard-probe', ctx)).toBe(true)
    expect(callSessionHandler('slides:clipboard-external', ctx)).toEqual({
      kind: 'text',
      text: 'hello',
    })
  })

  it('saves through the host and clears dirty; save-as moves the path', async () => {
    const host = new MemoryHostIO()
    const ctx = await openClient(105, host)
    callSessionHandler('slides:set-notes', ctx, { slideIndex: 0, text: 'note' })
    const saved = await callSessionHandler('slides:save', ctx)
    expect(saved).toMatchObject({ ok: true, path: 'deck.pptx' })
    expect(host.files.get('deck.pptx')?.length).toBeGreaterThan(0)
    expect(callSessionHandler('slides:is-dirty', ctx)).toBe(false)
    host.saveAsTargets.push('copy.pptx')
    expect(await callSessionHandler('slides:save-as', ctx, 'Deck')).toMatchObject({
      ok: true,
      path: 'copy.pptx',
    })
    expect(await callSessionHandler('slides:save-as', ctx, 'Deck')).toEqual({ ok: false })
    expect(await callSessionHandler('slides:recent', ctx)).toEqual(['copy.pptx', 'deck.pptx'])
    expect(host.calls.filter((c) => c.kind === 'saved').map((c) => c.detail)).toEqual([
      { kind: 'save', path: 'deck.pptx' },
      { kind: 'saveAs', path: 'copy.pptx' },
    ])
  })

  it('gives an untitled deck the host target before writing', async () => {
    const host = new MemoryHostIO()
    const ctx: HandlerContext = { clientId: 106, host }
    await callSessionHandler('slides:new-blank', ctx, FIT)
    host.untitledPath = 'Untitled 1.pptx'
    expect(await callSessionHandler('slides:save', ctx)).toMatchObject({
      ok: true,
      path: 'Untitled 1.pptx',
    })
    expect(host.calls.filter((c) => c.kind === 'saved').map((c) => c.detail)).toEqual([
      { kind: 'untitled', path: 'Untitled 1.pptx' },
      { kind: 'save', path: 'Untitled 1.pptx' },
    ])
  })

  it('broadcasts deck changes to every client sharing a session', async () => {
    const ctx = await openClient(107)
    sessions.set(108, sessions.get(107)!)
    await flush()
    events.length = 0
    callSessionHandler('slides:set-hidden', ctx, { slideIndex: 0, hidden: true })
    await flush()
    expect(events.find((e) => e.kind === 'deck')?.ids).toEqual([107, 108])
  })
})
