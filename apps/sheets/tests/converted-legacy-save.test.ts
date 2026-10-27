/**
 * A converted legacy .xls opens as an unsaved .xlsx (unsavedNew + suggestSaveAs). Its explicit
 * Save is a Save As; the shell's flush for the first Save to UniWork is an in-place write of the
 * untouched copy, which has to get through the renderer payload, the preload validator and the
 * main-process schema (R1-2), and once UniWork binds the working copy the session must stop
 * being a never-saved one (R1-3).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleSave, type SaveContext } from '../src/renderer/save-actions'
import { createEditJournal } from '../src/renderer/edit-journal'
import { applySheetsUniworkAnswer, type SheetsUniworkFile } from '../src/renderer/uniwork-state'
import { withoutUnsavedNew, sessionAfterRename } from '../src/main/session-rename'
import { workbookSaveRequestSchema } from '../src/shared/desktop-api'

const SESSION = '3f2b8c1e-5d4a-4e6b-9a7c-1b2d3e4f5a6b'

const bridge = vi.hoisted(() => ({
  api: undefined as Record<string, (...args: unknown[]) => Promise<unknown>> | undefined,
  invoked: [] as unknown[],
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, value: unknown) => {
      if (name === 'desktopApi') bridge.api = value as typeof bridge.api
    },
  },
  ipcRenderer: {
    invoke: async (_channel: string, payload: unknown) => {
      bridge.invoked.push(payload)
      return { canceled: true }
    },
    on: () => undefined,
    send: () => undefined,
    removeListener: () => undefined,
  },
  webUtils: { getPathForFile: () => '' },
}))
vi.mock('@genoffice/electron-utils/drop-open', () => ({ installDropOpenBridge: () => undefined }))

const saveWorkbookEdits = vi.fn()

function ctxFor(file: Record<string, unknown>): SaveContext {
  return {
    univerRef: { current: null },
    stashViewRestore: () => {},
    lazyWorkbookRef: {
      current: {
        editJournal: createEditJournal(),
        recalc: {
          timer: null,
          generation: 0,
          failed: false,
          formulaCells: new Map(),
          overlay: new Map(),
        },
        file: { sessionId: SESSION, ...file },
      },
    } as never,
    setMessage: () => {},
    openLazyWorkbook: () => {},
  }
}

beforeAll(async () => {
  await import('../src/preload/index')
})

beforeEach(() => {
  saveWorkbookEdits.mockReset().mockResolvedValue({ canceled: true })
  bridge.invoked.length = 0
  ;(globalThis as unknown as { window: unknown }).window = { desktopApi: { saveWorkbookEdits } }
})

const converted = { unsavedNew: true, needsSaveAs: true, readOnly: false }

describe('the in-place flush of an untouched converted workbook', () => {
  it('sends an explicit-write request, marked in-place, that the main schema accepts (R1-2)', async () => {
    await handleSave(ctxFor(converted), 'save', false, undefined, true)

    expect(saveWorkbookEdits).toHaveBeenCalledTimes(1)
    const payload = saveWorkbookEdits.mock.calls[0]![0] as Record<string, unknown>
    expect(payload).toMatchObject({ mode: 'save', origin: 'user', forceWrite: true, inPlace: true })
    expect(() => workbookSaveRequestSchema.parse(payload)).not.toThrow()
  })

  it('the preload validator lets that payload through to main, edits-free', async () => {
    await handleSave(ctxFor(converted), 'save', false, undefined, true)
    const payload = saveWorkbookEdits.mock.calls[0]![0]

    await bridge.api!.saveWorkbookEdits!(payload)

    expect(bridge.invoked).toHaveLength(1)
    expect(bridge.invoked[0]).toMatchObject({ forceWrite: true, inPlace: true })
  })

  it('an empty ordinary save is still refused by both validators (no loophole)', async () => {
    await handleSave(ctxFor(converted), 'save', false, undefined, true)
    const {
      forceWrite: _f,
      inPlace: _i,
      ...bare
    } = saveWorkbookEdits.mock.calls[0]![0] as Record<string, unknown>

    expect(() => workbookSaveRequestSchema.parse(bare)).toThrow(/at least one edit/)
    await expect(bridge.api!.saveWorkbookEdits!(bare)).rejects.toThrow()
  })

  it('a non-boolean in-place flag is rejected by the preload', async () => {
    await handleSave(ctxFor(converted), 'save', false, undefined, true)
    const payload = { ...(saveWorkbookEdits.mock.calls[0]![0] as object), inPlace: 'yes' }
    await expect(bridge.api!.saveWorkbookEdits!(payload)).rejects.toThrow()
  })

  it('an ordinary unsaved-new Save stays a Save As: no in-place mark, no forced write', async () => {
    await handleSave(ctxFor(converted), 'save', false)
    const payload = saveWorkbookEdits.mock.calls[0]![0] as Record<string, unknown>
    expect(payload.inPlace).toBeUndefined()
    expect(payload.forceWrite).toBeUndefined()
  })

  it('a bound, ordinary workbook is never flushed in place by a stray flag', async () => {
    await handleSave(
      ctxFor({ uniworkBound: true, readOnly: false }),
      'save',
      false,
      undefined,
      true,
    )
    const payload = saveWorkbookEdits.mock.calls[0]![0] as Record<string, unknown>
    expect(payload.inPlace).toBeUndefined()
    expect(payload.forceWrite).toBe(true)
  })
})

describe('UniWork adopts a converted workbook (R1-3)', () => {
  const file: SheetsUniworkFile = {
    ...converted,
    path: '/tmp/imports/u1/Budget.xlsx',
  }

  it('the renderer drops the never-saved flags when main answers bound', () => {
    const next = applySheetsUniworkAnswer(file, { bound: true, readOnly: false })
    expect(next.uniworkBound).toBe(true)
    expect(next.unsavedNew).toBeUndefined()
    expect(next.needsSaveAs).toBeUndefined()
  })

  it('an unbound answer leaves the never-saved state alone', () => {
    const next = applySheetsUniworkAnswer(file, { bound: false, readOnly: false })
    expect(next.unsavedNew).toBe(true)
  })

  it('the main session loses unsavedNew and suggestSaveAs on adoption', () => {
    const session = {
      path: '/tmp/imports/u1/Budget.xlsx',
      unsavedNew: true,
      suggestSaveAs: '/home/me/Budget.xlsx',
    }
    const moved = sessionAfterRename(session, session.path, '/store/doc1/Budget.xlsx')!
    expect(moved.path).toBe('/store/doc1/Budget.xlsx')
    const adopted = withoutUnsavedNew(moved)
    expect('unsavedNew' in adopted).toBe(false)
    expect('suggestSaveAs' in adopted).toBe(false)
    expect(adopted.path).toBe('/store/doc1/Budget.xlsx')
  })
})
