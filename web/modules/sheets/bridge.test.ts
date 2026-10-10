// @vitest-environment jsdom
// UNI-1016: the Sheets web bridge over a fake engine transport and the mocked protocol port.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DesktopApi,
  WorkbookFile,
  WorkbookSaveRequest,
} from '../../../apps/sheets/src/shared/desktop-api'
import { createMockPort, protocolError, type MockPort } from '../../docs/bridge/testing/mock-port'
import { installModuleBridge } from '../../docs/bridge/module-bridge'
import { createSheetsWebApi, pathFor, withExt } from './bridge'
import { sheetsHostGrants, sheetsWebCapabilities } from './capabilities'
import {
  ENGINE_UNAVAILABLE,
  EngineUnavailableError,
  isEngineUnavailable,
  type EngineOpenInput,
  type SheetsEngineTransport,
} from './engine/transport'
import { createUnavailableTransport } from './engine/unavailable'
import type { AskFn } from './notice'
import {
  DRAFTS_DB,
  DRAFTS_STORE,
  createDraftRecovery,
  createIdbDraftStore,
  decryptDraft,
  type DraftChoice,
  type DraftRecord,
  type DraftRecovery,
} from '../../docs/bridge/draft-recovery'
import { createFakeIdb } from '../../docs/bridge/testing/fake-idb'

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: ArrayBuffer | Uint8Array | undefined) =>
  b ? new TextDecoder().decode(b instanceof Uint8Array ? b : new Uint8Array(b)) : ''

/** an in-memory engine: a session holds the bytes it was opened from; a save appends the edits */
function fakeTransport(features: Partial<SheetsEngineTransport['features']> = {}) {
  let next = 0
  const sessions = new Map<string, string>()
  const opened: EngineOpenInput[] = []
  const serialized: WorkbookSaveRequest[] = []
  const uuid = () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`
  const workbook = (sessionId: string, name: string): WorkbookFile =>
    ({
      sessionId,
      name,
      sheets: [{ id: 'sheet-1', name: 'Sheet1' }],
      readOnly: false,
    }) as unknown as WorkbookFile
  const transport: SheetsEngineTransport = {
    kind: 'wasm',
    features: { xlsImport: false, pivotRefresh: false, recalcFallback: false, ...features },
    async open(input) {
      opened.push(input)
      const id = uuid()
      sessions.set(id, dec(input.data))
      return workbook(id, input.name)
    },
    readRange: vi.fn(async () => ({ cells: [], rows: [] }) as never),
    readFormulaCells: vi.fn(async () => ({ cells: [] }) as never),
    readMedia: vi.fn(async () => ({ mediaType: 'image/png', base64: 'AA==' })),
    readPivotDefinition: vi.fn(async () => ({}) as never),
    recalc: vi.fn(async () => ({ cells: [] })),
    async serialize(request) {
      serialized.push(request)
      const base = sessions.get(request.sessionId)
      if (base === undefined) throw new Error('unknown session')
      const edits = request.edits.map((e) => `${e.row}:${e.column}=${String(e.value)}`).join(',')
      return { data: enc(`${base}|${edits}`).buffer, touchedEntries: ['xl/worksheets/sheet1.xml'] }
    },
    async replaceSession(input) {
      sessions.delete(input.sessionId)
      return transport.open(input)
    },
    close: vi.fn(async (sessionId: string) => {
      sessions.delete(sessionId)
    }),
  }
  return { transport, opened, serialized, sessions }
}

function saveRequest(
  sessionId: string,
  edits: Array<[number, number, number]>,
  mode: 'save' | 'save-as' = 'save',
) {
  return {
    sessionId,
    mode,
    edits: edits.map(([row, column, value]) => ({
      sheetId: 'sheet-1',
      row,
      column,
      value,
      writeValue: true,
    })),
  } as unknown as WorkbookSaveRequest
}

const ALL_GRANTS = { save: true, saveAs: true, filePick: true, print: true, exportPdf: true }

function setup(
  opts: {
    grants?: Record<string, boolean>
    ask?: AskFn
    transport?: SheetsEngineTransport
    features?: Partial<SheetsEngineTransport['features']>
    drafts?: (host: import('../../docs/bridge/draft-recovery').DraftHost) => DraftRecovery
  } = {},
) {
  const mock = createMockPort({ documentId: 'pending' })
  const file = mock.seed('Budget.xlsx', enc('v1'))
  const fake = fakeTransport(opts.features)
  const transport = opts.transport ?? fake.transport
  const print = vi.fn(async () => ({ ok: true }))
  const download = vi.fn()
  const target: Record<string, unknown> = {}
  let api!: ReturnType<typeof createSheetsWebApi>
  const installed = installModuleBridge({
    module: 'sheets',
    frameCapabilities: ALL_GRANTS,
    capabilities: { defaults: sheetsWebCapabilities(transport), grants: sheetsHostGrants },
    client: mock.port,
    target,
    globals: {
      desktopApi: (ctx) => {
        api = createSheetsWebApi(ctx.client, {
          transport,
          capabilities: ctx.capabilities,
          ask: opts.ask ?? (async (o) => o.cancelId),
          print,
          download,
          locale: () => 'en',
          editorStartMs: 200,
          saveTimeoutMs: 500,
          ...(opts.drafts ? { drafts: opts.drafts } : {}),
        })
        return api.desktopApi
      },
    },
  })
  const desktop = target.desktopApi as typeof api.desktopApi
  return {
    mock,
    file,
    fake,
    transport,
    api,
    desktop,
    caps: installed.capabilities,
    print,
    download,
    async boot(): Promise<WorkbookFile> {
      mock.init({ documentId: file.fileId, capabilities: opts.grants ?? ALL_GRANTS })
      await flush()
      expect(await desktop.hasQueuedWorkbook()).toBe(true)
      const wb = await desktop.selectWorkbook()
      expect(wb).not.toBeNull()
      return wb!
    },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('capabilities', () => {
  it('web defaults: AI, autosave and the C11 sidecar-only keys are off; the recovery tick is on', () => {
    const caps = sheetsWebCapabilities(fakeTransport().transport)
    // the renderer's 30 s recovery tick feeds draft recovery (C18), never a save
    expect(caps.recoveryCopy).toBe(true)
    for (const key of [
      'ai',
      'autoSave',
      'screenshot',
      'recalcFallback',
      'mergeWorkbooks',
      'save',
      'saveAs',
      'open',
      'recents',
    ] as const)
      expect(caps[key], key).toBe(false)
    expect(caps.xlsxEngine).toBe(true)
    expect(caps.exportCsv).toBe(true)
  })

  it('the engine stub turns the whole workbook surface off', () => {
    const caps = sheetsWebCapabilities(createUnavailableTransport())
    expect(caps.xlsxEngine).toBe(false)
    expect(caps.xlsImport).toBe(false)
    expect(caps.pivotRefresh).toBe(false)
  })

  it('recalc fallback stays hidden even when the engine supports it (C11)', () => {
    const caps = sheetsWebCapabilities(
      fakeTransport({ recalcFallback: true, pivotRefresh: true, xlsImport: true }).transport,
    )
    expect(caps.recalcFallback).toBe(false)
    expect(caps.mergeWorkbooks).toBe(false)
    expect(caps.pivotRefresh).toBe(true)
    expect(caps.xlsImport).toBe(true)
  })

  it('host grants switch open / recents / save / saveAs on', () => {
    expect(sheetsHostGrants(undefined)).toEqual({
      open: false,
      recents: false,
      save: false,
      saveAs: false,
    })
    expect(sheetsHostGrants({ filePick: true, save: true, saveAs: true, recents: true })).toEqual({
      open: true,
      recents: true,
      save: true,
      saveAs: true,
    })
  })
})

describe('open', () => {
  it('boot: the host document bytes reach the engine; the renderer gets a bridge path', async () => {
    const t = setup()
    const wb = await t.boot()
    expect(t.fake.opened).toHaveLength(1)
    expect(dec(t.fake.opened[0]!.data)).toBe('v1')
    expect(t.fake.opened[0]!.name).toBe('Budget.xlsx')
    expect(wb.path).toBe(pathFor(t.file))
    expect(wb.readOnly).toBe(false)
    expect(t.mock.calls.filter((c) => c.type === 'api.open')).toHaveLength(1)
    // nothing more queued: File > Open goes to the host picker
    expect(t.api.state.currentFileId()).toBe(t.file.fileId)
  })

  it('init.open bytes are used without another api.open round trip', async () => {
    const t = setup()
    t.mock.init({
      documentId: t.file.fileId,
      capabilities: ALL_GRANTS,
      open: t.mock.openPayload(t.file.fileId),
    })
    await flush()
    await t.desktop.selectWorkbook()
    expect(t.mock.calls.filter((c) => c.type === 'api.open')).toHaveLength(0)
  })

  it('File > Open uses file.pick with the xlsx types (xls only when the engine converts)', async () => {
    const t = setup()
    await t.boot()
    const wb = await t.desktop.selectWorkbook()
    expect(wb).not.toBeNull()
    const pick = t.mock.calls.find((c) => c.type === 'file.pick')
    expect(pick?.payload).toEqual({ purpose: 'open', accept: ['xlsx', 'xlsm'] })
  })

  it('without the filePick grant File > Open does nothing', async () => {
    const t = setup({ grants: { save: true } })
    await t.boot()
    expect(await t.desktop.selectWorkbook()).toBeNull()
    expect(t.mock.calls.some((c) => c.type === 'file.pick')).toBe(false)
  })

  it('a host `open` request queues the document and drives the renderer open action', async () => {
    const t = setup()
    await t.boot()
    const other = t.mock.seed('Other.xlsx', enc('other'))
    const actions: string[] = []
    t.desktop.onMenuAction((a) => actions.push(a))
    const res = await t.mock.host.open(t.mock.openPayload(other.fileId))
    expect(res).toEqual({ opened: true, title: 'Other.xlsx' })
    expect(actions).toEqual(['open'])
    const wb = await t.desktop.selectWorkbook()
    expect(wb?.name).toBe('Other.xlsx')
    expect(dec(t.fake.opened.at(-1)!.data)).toBe('other')
  })
})

describe('save', () => {
  it('open -> edit -> save: the engine bytes reach api.save with the etag, never `auto`', async () => {
    const t = setup()
    const wb = await t.boot()
    t.desktop.notifyPendingEdits(2)
    expect(t.mock.dirty.at(-1)).toBe(true)
    const result = await t.desktop.saveWorkbookEdits(
      saveRequest(wb.sessionId, [
        [0, 0, 42],
        [1, 2, 7],
      ]),
    )
    expect(t.fake.serialized).toHaveLength(1)
    const save = t.mock.calls.find((c) => c.type === 'api.save')!
    const payload = save.payload as {
      fileId: string
      data: ArrayBuffer
      etag?: string
      auto?: boolean
    }
    expect(payload.fileId).toBe(t.file.fileId)
    expect(payload.etag).toBe(t.file.etag)
    expect('auto' in payload).toBe(false)
    expect(dec(t.mock.bytesOf(t.file.fileId))).toBe('v1|0:0=42,1:2=7')
    // the session swapped onto the saved bytes
    expect(result.canceled).toBe(false)
    if (result.canceled) return
    expect(result.file.sessionId).not.toBe(wb.sessionId)
    expect(result.touchedEntries).toEqual(['xl/worksheets/sheet1.xml'])
    expect(t.fake.sessions.get(result.file.sessionId)).toBe('v1|0:0=42,1:2=7')
    expect(t.fake.sessions.has(wb.sessionId)).toBe(false)
    expect(t.mock.saved).toHaveLength(1)
    expect(t.mock.saved[0]!.initiatedByFrame).toBe(true)
    expect(t.mock.dirty.at(-1)).toBe(false)
    // the next save uses the new etag (no false conflict)
    await t.desktop.saveWorkbookEdits(saveRequest(result.file.sessionId, [[3, 3, 1]]))
    expect(dec(t.mock.bytesOf(t.file.fileId))).toBe('v1|0:0=42,1:2=7|3:3=1')
  })

  it('large edit sets arrive through the chunked transfer and are spliced back in', async () => {
    const t = setup()
    const wb = await t.boot()
    const transferId = '11111111-1111-4111-8111-111111111111'
    await t.desktop.beginSaveEditsTransfer({ sessionId: wb.sessionId, transferId, total: 2 })
    const edits = saveRequest(wb.sessionId, [
      [5, 0, 1],
      [6, 0, 2],
    ]).edits
    await t.desktop.sendSaveEditsChunk({
      sessionId: wb.sessionId,
      transferId,
      seq: 0,
      editsJson: JSON.stringify(edits),
    })
    await t.desktop.saveWorkbookEdits({
      ...saveRequest(wb.sessionId, []),
      editsTransferId: transferId,
    })
    expect(t.fake.serialized[0]!.edits).toHaveLength(2)
    expect('editsTransferId' in t.fake.serialized[0]!).toBe(false)
    expect(dec(t.mock.bytesOf(t.file.fileId))).toBe('v1|5:0=1,6:0=2')
  })

  it('save as: api.saveAs with an .xlsx name and the source file; a cancelled dialog is a cancel', async () => {
    const t = setup()
    const wb = await t.boot()
    const result = await t.desktop.saveWorkbookEdits(
      saveRequest(wb.sessionId, [[0, 0, 1]], 'save-as'),
    )
    const call = t.mock.calls.find((c) => c.type === 'api.saveAs')!
    expect(call.payload).toMatchObject({ name: 'Budget.xlsx', sourceFileId: t.file.fileId })
    expect(result.canceled).toBe(false)
    if (!result.canceled) expect(result.file.path).toMatch(/^uniwork:\/\/files\/f2\/Budget\.xlsx$/)

    t.mock.override('api.saveAs', () => Promise.reject(protocolError('cancelled')))
    const after = (result as { file: WorkbookFile }).file
    expect(await t.desktop.saveWorkbookEdits(saveRequest(after.sessionId, [], 'save-as'))).toEqual({
      canceled: true,
    })
  })

  it('a host `save` request runs the renderer save flow and answers with the saved file', async () => {
    const t = setup()
    const wb = await t.boot()
    let session = wb.sessionId
    t.desktop.onCloseSaveRequest(() => {
      void t.desktop.saveWorkbookEdits(saveRequest(session, [[0, 0, 9]])).then((r) => {
        if (!r.canceled) session = r.file.sessionId
        t.desktop.reportCloseSaveResult(true)
      })
    })
    const res = await t.mock.host.save({ reason: 'user' })
    expect(res).toMatchObject({ ok: true, file: { fileId: t.file.fileId } })
    expect(t.mock.saved[0]!.initiatedByFrame).toBe(false)
  })

  it('a host `saveAs` request names the copy', async () => {
    const t = setup()
    const wb = await t.boot()
    // unsubscribed below: the document keydown listener of every bridge outlives its test, so a
    // later Ctrl+Shift+S would reach this handler with a session that no longer exists
    const off = t.desktop.onMenuAction((action) => {
      if (action === 'save-as')
        void t.desktop.saveWorkbookEdits(saveRequest(wb.sessionId, [], 'save-as'))
    })
    const res = await t.mock.host.saveAs({ name: 'Copy.xlsx' })
    off()
    expect(res).toMatchObject({ ok: true, file: { name: 'Copy.xlsx' } })
  })
})

describe('engine crash and failed session swap', () => {
  it('an engine crash during a save keeps the edits saveable under the same session id (RF 2)', async () => {
    const fake = fakeTransport()
    const crashes = { left: 1 }
    const inner = fake.transport.serialize
    // what createWasmTransport does after a trap: the call fails once, the session is reopened
    // from its retained bytes under the same renderer-facing id, the next call works
    const transport: SheetsEngineTransport = {
      ...fake.transport,
      async serialize(request) {
        if (crashes.left-- > 0) {
          throw Object.assign(new Error('engine_crashed: injected'), { code: 'engine_crashed' })
        }
        return inner(request)
      },
    }
    const t = setup({ transport })
    const wb = await t.boot()
    t.desktop.notifyPendingEdits(1)
    const edits = saveRequest(wb.sessionId, [[0, 0, 42]])
    await expect(t.desktop.saveWorkbookEdits(edits)).rejects.toThrow(/engine_crashed/)
    // nothing reached the host, the workbook is still dirty and its session is still valid
    expect(t.mock.calls.some((c) => c.type === 'api.save')).toBe(false)
    expect(t.mock.dirty.at(-1)).toBe(true)
    const retry = await t.desktop.saveWorkbookEdits(edits)
    expect(retry.canceled).toBe(false)
    expect(dec(t.mock.bytesOf(t.file.fileId))).toBe('v1|0:0=42')
    expect(t.mock.dirty.at(-1)).toBe(false)
  })

  it('the host accepted the bytes but the engine cannot reopen them: dirty and drafts clear, the error surfaces (RF 8)', async () => {
    const fake = fakeTransport()
    const transport: SheetsEngineTransport = {
      ...fake.transport,
      replaceSession: vi.fn(async () => {
        throw new Error('out of memory')
      }),
    }
    const saved = vi.fn(async () => {})
    const t = setup({
      transport,
      drafts: () => ({
        opened: async () => {},
        saved,
        flush: async () => {},
        dispose: () => {},
      }),
    })
    const wb = await t.boot()
    t.desktop.notifyPendingEdits(1)
    await expect(
      t.desktop.saveWorkbookEdits(saveRequest(wb.sessionId, [[0, 0, 9]])),
    ).rejects.toThrow(/out of memory/)
    // the version exists on the server
    expect(dec(t.mock.bytesOf(t.file.fileId))).toBe('v1|0:0=9')
    expect(t.mock.saved).toHaveLength(1)
    expect(t.mock.dirty.at(-1)).toBe(false)
    expect(saved).toHaveBeenCalledOnce()
  })
})

describe('save conflicts', () => {
  it('Overwrite re-reads the head etag and saves again', async () => {
    const ask = vi.fn(async () => 'overwrite') as unknown as AskFn
    const t = setup({ ask })
    const wb = await t.boot()
    t.mock.bumpRemote(t.file.fileId) // someone else saved
    const result = await t.desktop.saveWorkbookEdits(saveRequest(wb.sessionId, [[0, 0, 1]]))
    expect(ask).toHaveBeenCalledOnce()
    expect(result.canceled).toBe(false)
    expect(dec(t.mock.bytesOf(t.file.fileId))).toBe('v1|0:0=1')
    expect(t.mock.errors.some((e) => (e.error as { code?: string }).code === 'conflict')).toBe(true)
  })

  it('Reload latest cancels the save and reopens the newest version through the open action', async () => {
    const ask = vi.fn(async () => 'reload') as unknown as AskFn
    const t = setup({ ask })
    const wb = await t.boot()
    t.mock.commit(t.file.fileId, enc('v2-remote'))
    const actions: string[] = []
    t.desktop.onMenuAction((a) => actions.push(a))
    const result = await t.desktop.saveWorkbookEdits(saveRequest(wb.sessionId, [[0, 0, 1]]))
    expect(result).toEqual({ canceled: true })
    expect(actions).toEqual(['open'])
    await t.desktop.selectWorkbook()
    expect(dec(t.fake.opened.at(-1)!.data)).toBe('v2-remote')
    expect(dec(t.mock.bytesOf(t.file.fileId))).toBe('v2-remote')
  })

  it('Cancel keeps the edits and fails the save with the localized reason', async () => {
    const t = setup()
    const wb = await t.boot()
    t.mock.bumpRemote(t.file.fileId)
    await expect(
      t.desktop.saveWorkbookEdits(saveRequest(wb.sessionId, [[0, 0, 1]])),
    ).rejects.toThrow(/newer version/)
    expect(t.fake.sessions.has(wb.sessionId)).toBe(true)
  })

  it('a host-initiated save gets the conflict in its result (the host owns the UI)', async () => {
    const ask = vi.fn(async () => 'overwrite') as unknown as AskFn
    const t = setup({ ask })
    const wb = await t.boot()
    t.mock.bumpRemote(t.file.fileId)
    t.desktop.onCloseSaveRequest(() => {
      void t.desktop.saveWorkbookEdits(saveRequest(wb.sessionId, [[0, 0, 1]])).then(
        () => t.desktop.reportCloseSaveResult(true),
        () => t.desktop.reportCloseSaveResult(false),
      )
    })
    const res = await t.mock.host.save({ reason: 'user' })
    expect(res).toMatchObject({ ok: false, error: { code: 'conflict' } })
    expect(ask).not.toHaveBeenCalled()
  })
})

describe('view-only (no save grant)', () => {
  it('the workbook opens read-only and every save is refused before the engine runs', async () => {
    const t = setup({ grants: { filePick: true } })
    const wb = await t.boot()
    expect(wb.readOnly).toBe(true)
    expect(t.caps.save).toBe(false)
    await expect(
      t.desktop.saveWorkbookEdits(saveRequest(wb.sessionId, [[0, 0, 1]])),
    ).rejects.toThrow(/View only/)
    expect(t.fake.serialized).toHaveLength(0)
    expect(t.mock.calls.some((c) => c.type === 'api.save' || c.type === 'api.saveAs')).toBe(false)
    expect(await t.mock.host.save({ reason: 'user' })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' },
    })
  })
})

describe('too large (frame size gate)', () => {
  it('the open fails with too_large and the host hears a fatal too_large (it opens G3)', async () => {
    const fake = fakeTransport()
    const tooLarge = {
      ...fake.transport,
      open: async () => {
        throw Object.assign(new Error('too_large: 42 MB of worksheet XML'), { code: 'too_large' })
      },
    }
    const t = setup({ transport: tooLarge })
    t.mock.init({ documentId: t.file.fileId, capabilities: ALL_GRANTS })
    await flush()
    const err = await t.desktop.selectWorkbook().catch((e: unknown) => e)
    expect((err as { code?: string }).code).toBe('too_large')
    const fatal = t.mock.errors.filter((e) => (e.error as { code?: string }).code === 'too_large')
    expect(fatal).toHaveLength(1)
    expect(fatal[0]!.fatal).toBe(true)
  })
})

describe('keyboard accelerators (the desktop File menu keys)', () => {
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', {
      key,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      ...init,
    })
    document.dispatchEvent(event)
    return event
  }

  it('Ctrl+S saves, Ctrl+Shift+S saves as, Ctrl+P prints; the browser defaults are suppressed', async () => {
    const t = setup()
    await t.boot()
    const actions: string[] = []
    const off = t.desktop.onMenuAction((a) => actions.push(a))
    expect(press('s').defaultPrevented).toBe(true)
    press('S', { shiftKey: true })
    press('p')
    off()
    expect(actions).toEqual(['save', 'save-as', 'print'])
  })

  it('view-only: Ctrl+S is swallowed but saves nothing', async () => {
    const t = setup({ grants: { filePick: true } })
    await t.boot()
    const actions: string[] = []
    const off = t.desktop.onMenuAction((a) => actions.push(a))
    expect(press('s').defaultPrevented).toBe(true)
    off()
    expect(actions).toEqual([])
  })
})

describe('engine unavailable', () => {
  it('the stub answers engine-unavailable for every operation; close is a no-op', async () => {
    const stub = createUnavailableTransport()
    expect(stub.kind).toBe('unavailable')
    for (const op of [
      () => stub.open({ name: 'a.xlsx', data: new ArrayBuffer(0), locale: 'en' }),
      () => stub.readRange({} as never),
      () => stub.readFormulaCells({} as never),
      () => stub.readMedia({} as never),
      () => stub.readPivotDefinition({} as never),
      () => stub.recalc({} as never),
      () => stub.serialize({} as never),
    ]) {
      const err = await op().catch((e: unknown) => e)
      expect(err).toBeInstanceOf(EngineUnavailableError)
      expect((err as EngineUnavailableError).code).toBe(ENGINE_UNAVAILABLE)
    }
    await expect(stub.close('x')).resolves.toBeUndefined()
    expect(isEngineUnavailable({ code: ENGINE_UNAVAILABLE })).toBe(true)
    expect(isEngineUnavailable(new Error(`${ENGINE_UNAVAILABLE}: x`))).toBe(true)
    expect(isEngineUnavailable(new Error('other'))).toBe(false)
  })

  it('the open fails with the typed code and the host hears about it once (non-fatal)', async () => {
    const t = setup({ transport: createUnavailableTransport() })
    expect(t.caps.xlsxEngine).toBe(false)
    t.mock.init({ documentId: t.file.fileId, capabilities: ALL_GRANTS })
    await flush()
    const err = await t.desktop.selectWorkbook().catch((e: unknown) => e)
    expect(isEngineUnavailable(err)).toBe(true)
    const reported = t.mock.errors.filter(
      (e) => (e.error as { code?: string }).code === 'unsupported',
    )
    expect(reported).toHaveLength(1)
    expect(reported[0]!.fatal).toBe(false)
  })
})

describe('hidden and browser features', () => {
  let t: ReturnType<typeof setup>
  it('recalc fallback and pivot refresh reject while hidden', async () => {
    t = setup()
    await t.boot()
    await expect(t.desktop.recalcWorkbook({} as never)).rejects.toThrow(/not available/i)
    await expect(t.desktop.readPivotDefinition({} as never)).rejects.toThrow(/not available/i)
    expect(t.transport.recalc).not.toHaveBeenCalled()
  })

  it('pivot refresh reaches the engine once it supports it', async () => {
    t = setup({ features: { pivotRefresh: true } })
    await t.boot()
    await t.desktop.readPivotDefinition({} as never)
    expect(t.transport.readPivotDefinition).toHaveBeenCalledOnce()
  })

  it('CSV export downloads UTF-8 with a BOM; print and PDF go through the print dialog', async () => {
    t = setup()
    await t.boot()
    const csv = await t.desktop.exportCsv({
      fileName: 'Budget.xlsx',
      content: 'a,b',
      hasFormulas: false,
    })
    expect(csv).toEqual({ canceled: false, path: 'Budget.csv' })
    const [name, blob] = t.download.mock.calls[0] as [string, Blob]
    expect(name).toBe('Budget.csv')
    expect(new Uint8Array(await blob.arrayBuffer()).slice(0, 3)).toEqual(
      new Uint8Array([0xef, 0xbb, 0xbf]),
    )
    const req = { fileName: 'Budget.xlsx', html: '<p>x</p>' } as never
    expect(await t.desktop.printWorkbook(req)).toEqual({ ok: true })
    expect(await t.desktop.exportPdf(req)).toEqual({
      canceled: false,
      path: 'Budget.pdf (print dialog)',
    })
    expect(t.print).toHaveBeenCalledTimes(2)
  })

  it('merge and AI-only entries answer typed no-ops; the desktop recovery dialog never opens', async () => {
    t = setup()
    await t.boot()
    const prompts: unknown[] = []
    const recovery = t.desktop as unknown as Pick<
      DesktopApi,
      'onRecoveryPrompt' | 'replyRecoveryPrompt'
    >
    recovery.onRecoveryPrompt((p) => prompts.push(p))
    recovery.replyRecoveryPrompt(true)
    expect(prompts).toEqual([])
    expect(await t.desktop.selectWorkbooksForMerge()).toBeNull()
    expect(await t.desktop.autoRenameWorkbook('s', 'x')).toEqual({ renamed: false })
    expect(await t.desktop.consumeAiPreset()).toBeNull()
    expect(t.desktop.getPathForFile({} as File)).toBe('')
    expect(withExt('A.xlsm', '.csv')).toBe('A.csv')
  })

  it('a renamed file reaches the renderer by its new name', async () => {
    t = setup()
    await t.boot()
    const names: string[] = []
    t.desktop.onWorkbookRenamed((n) => names.push(n))
    t.mock.rename(t.file.fileId, 'Renamed.xlsx')
    expect(names).toEqual(['Renamed.xlsx'])
  })

  it('close-check reports the dirty flag and never autosave', async () => {
    t = setup()
    await t.boot()
    t.desktop.notifyPendingEdits(1)
    expect(await t.mock.host['doc.closeCheck']({})).toEqual({ dirty: true, autoSave: false })
  })
})

describe('draft recovery (C18)', () => {
  const SCOPE_DOC = 'f1'

  async function draftSetup(answer: DraftChoice = 'restore', grants?: Record<string, boolean>) {
    const fake = createFakeIdb()
    const store = createIdbDraftStore(fake.idb)
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ])
    const grant = { key, scope: `u1:${SCOPE_DOC}` }
    const prompt = vi.fn(async () => answer)
    const t = setup({
      ...(grants ? { grants } : {}),
      drafts: (host) =>
        createDraftRecovery({
          module: 'sheets',
          host,
          prompt,
          store,
          recovery: () => grant,
          intervalMs: 3_600_000,
          target: new EventTarget() as unknown as Window,
        }),
    })
    expect(t.file.fileId).toBe(SCOPE_DOC)
    const records = () =>
      (fake.store(DRAFTS_DB, DRAFTS_STORE) ?? new Map<string, unknown>()) as Map<
        string,
        DraftRecord
      >
    const decrypted = async () => {
      const out: string[] = []
      for (const [k, r] of records()) out.push(dec((await decryptDraft(key, k, r)) ?? undefined))
      return out
    }
    return { t, prompt, records, decrypted, key, store }
  }

  /** a dirty session whose recovery tick stored the draft "v1|0:0=5" */
  async function writeDraft(d: Awaited<ReturnType<typeof draftSetup>>) {
    const wb = await d.t.boot()
    d.t.desktop.notifyPendingEdits(1)
    expect(await d.t.desktop.writeWorkbookRecovery(saveRequest(wb.sessionId, [[0, 0, 5]]))).toEqual(
      { ok: true },
    )
    return wb
  }

  it('the recovery tick stores an encrypted xlsx draft without any save', async () => {
    const d = await draftSetup()
    const wb = await writeDraft(d)
    expect(d.prompt).not.toHaveBeenCalled() // nothing stored at boot
    expect(d.t.fake.serialized).toHaveLength(1)
    expect(d.t.mock.calls.some((c) => c.type === 'api.save' || c.type === 'api.saveAs')).toBe(false)
    expect(d.t.mock.saved).toHaveLength(0)
    // the session was not swapped
    expect(d.t.fake.sessions.get(wb.sessionId)).toBe('v1')
    const [[recordKey, record]] = [...d.records()]
    expect(recordKey).toMatch(new RegExp(`^u1:${SCOPE_DOC}:${d.t.file.etag}:[0-9a-f]{16}$`))
    expect(record!.module).toBe('sheets')
    expect(dec(record!.ciphertext)).not.toContain('0:0=5')
    expect(await d.decrypted()).toEqual(['v1|0:0=5'])
  })

  it('a clean, view-only or other document writes nothing', async () => {
    const d = await draftSetup()
    const wb = await d.t.boot()
    // not dirty
    expect(await d.t.desktop.writeWorkbookRecovery(saveRequest(wb.sessionId, [[0, 0, 1]]))).toEqual(
      { ok: false },
    )
    expect(d.records().size).toBe(0)

    const v = await draftSetup('restore', { filePick: true })
    const vw = await v.t.boot()
    v.t.desktop.notifyPendingEdits(1)
    expect(await v.t.desktop.writeWorkbookRecovery(saveRequest(vw.sessionId, [[0, 0, 1]]))).toEqual(
      { ok: false },
    )
    expect(v.t.fake.serialized).toHaveLength(0)
  })

  it('Restore opens the draft bytes as restoredFromRecovery and keeps the workbook dirty', async () => {
    const first = await draftSetup()
    await writeDraft(first)
    // a new frame (the tab crashed) over the same browser store and session key
    const prompt = vi.fn(async () => 'restore' as DraftChoice)
    const t = setup({
      drafts: (host) =>
        createDraftRecovery({
          module: 'sheets',
          host,
          prompt,
          store: first.store,
          recovery: () => ({ key: first.key, scope: `u1:${SCOPE_DOC}` }),
          intervalMs: 3_600_000,
          target: new EventTarget() as unknown as Window,
        }),
    })
    const wb = await t.boot()
    expect(prompt).toHaveBeenCalledOnce()
    expect(dec(t.fake.opened.at(-1)!.data)).toBe('v1|0:0=5')
    expect(wb.restoredFromRecovery).toBe(true)
    expect(t.api.state.isDirty()).toBe(true)
    expect(t.mock.dirty.at(-1)).toBe(true)
    // the restored journal is empty: the renderer's 0 must not clear dirty
    t.desktop.notifyPendingEdits(0)
    expect(t.api.state.isDirty()).toBe(true)
    expect(await t.mock.host['doc.closeCheck']({})).toEqual({ dirty: true, autoSave: false })

    // Save (restoreWriteBack, no edits) goes to the same file with the current etag
    const result = await t.desktop.saveWorkbookEdits({
      ...saveRequest(wb.sessionId, []),
      restoreWriteBack: true,
    } as WorkbookSaveRequest)
    const save = t.mock.calls.find((c) => c.type === 'api.save')!
    expect(save.payload).toMatchObject({ fileId: t.file.fileId, etag: t.file.etag })
    expect(dec(t.mock.bytesOf(t.file.fileId))).toBe('v1|0:0=5|')
    expect(result.canceled).toBe(false)
    if (!result.canceled) expect(result.file.restoredFromRecovery).not.toBe(true)
    expect(t.api.state.isDirty()).toBe(false)
    t.desktop.notifyPendingEdits(0)
    expect(t.api.state.isDirty()).toBe(false)
    await flush()
    await new Promise((r) => setTimeout(r, 0))
    expect(first.records().size).toBe(0)
  })

  it('Discard opens the server bytes and deletes the draft', async () => {
    const first = await draftSetup()
    await writeDraft(first)
    const prompt = vi.fn(async () => 'discard' as DraftChoice)
    const t = setup({
      drafts: (host) =>
        createDraftRecovery({
          module: 'sheets',
          host,
          prompt,
          store: first.store,
          recovery: () => ({ key: first.key, scope: `u1:${SCOPE_DOC}` }),
          intervalMs: 3_600_000,
          target: new EventTarget() as unknown as Window,
        }),
    })
    const wb = await t.boot()
    expect(prompt).toHaveBeenCalledOnce()
    expect(dec(t.fake.opened.at(-1)!.data)).toBe('v1')
    expect(wb.restoredFromRecovery).not.toBe(true)
    expect(t.api.state.isDirty()).toBe(false)
    expect(first.records().size).toBe(0)
  })

  it('a successful save deletes the draft', async () => {
    const d = await draftSetup()
    const wb = await writeDraft(d)
    expect(d.records().size).toBe(1)
    await d.t.desktop.saveWorkbookEdits(saveRequest(wb.sessionId, [[0, 0, 5]]))
    await flush()
    await new Promise((r) => setTimeout(r, 0))
    expect(d.records().size).toBe(0)
  })
})

export type { MockPort }
