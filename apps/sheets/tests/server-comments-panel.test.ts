// @vitest-environment jsdom
/**
 * G8-13 (UNI-1408): the Sheets comment panel in server mode against a fake `window.uniworkComments`.
 * Card test lines: a new root carries the selection's `{sheet, range}` + base version; insert a row
 * above a commented cell then Save -> the moved anchor goes out with the new version id; delete the
 * row -> `lost`; reveal -> cell B7 of sheet 2 selected; the file's threaded comments stay read-only
 * and untouched (no thread-store edit, so the save writes no threadedComments / persons / notes);
 * a local file -> today's pane, no comments call.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COLLAB_LIVE_REGION_ID, collabStrings } from '@genoffice/ui/collab'

import { LocaleProvider } from '../src/renderer/i18n/locale'
import type { SheetsEditorView } from '../src/renderer/server-comments/adapter'
import { serverAnchorStore } from '../src/renderer/server-comments/anchor-store'
import { SheetsCommentsSurface } from '../src/renderer/server-comments/CommentsSurface'
import type { ServerCommentsApi } from '../src/renderer/server-comments/seam'
import { serverComments } from '../src/renderer/server-comments/SheetsServerComments'
import { threadPane, threadStore, type CellRange } from '../src/renderer/threaded-comments'
import type { WorkbookFile } from '../src/shared/desktop-api'

Object.assign(window, { desktopApi: { onLanguageChanged: () => () => undefined } })

const EN = collabStrings('en')
const PATH = '/w/Budget.xlsx'
const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!

interface Row {
  id: string
  document_id: string
  author_id: string
  parent_id: string | null
  body: string
  kind: string
  revision: number
  anchor: Record<string, unknown> | null
  anchor_state: string | null
  resolved_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  display_name: string
}

/** an in-memory UniWork server behind the editor API shape (camelCase in, reply envelopes out) */
function fakeServer(opts: { versionId?: string | null; context?: 'ok' | 'not_found' } = {}) {
  const rows: Row[] = []
  let seq = 0
  let token = 0
  const savedHandlers: Array<(p: { path: string; versionId: string }) => void> = []
  const revealHandlers: Array<(p: { path: string; commentId: string }) => unknown> = []
  const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value })
  const stamp = () => `2026-10-13T10:00:${String(++seq).padStart(2, '0')}Z`
  const find = (id: string) => rows.find((r) => r.id === id)!
  const add = (p: Partial<Row> & { body: string }): Row => {
    const at = stamp()
    const row: Row = {
      id: `c${seq}`,
      document_id: 'doc1',
      author_id: 'me',
      parent_id: null,
      kind: 'comment',
      revision: 1,
      anchor: null,
      anchor_state: null,
      resolved_at: null,
      deleted_at: null,
      created_at: at,
      updated_at: at,
      display_name: 'An Nguyen',
      ...p,
    }
    rows.push(row)
    token++
    return row
  }
  let anchorsReply: 'ok' | 'version_invalid' = 'ok'
  const api = {
    list: vi.fn(() =>
      ok({
        comments: rows.map((r) => ({ ...r })),
        mentions: [],
        list_token: `t${token}`,
        unchanged: false,
      }),
    ),
    create: vi.fn((i: Parameters<ServerCommentsApi['create']>[0]) => {
      const row = add({
        body: i.body,
        parent_id: i.parentId ?? null,
        anchor: i.anchor ?? null,
        anchor_state: i.anchor ? 'exact' : null,
      })
      return ok({ comment: { ...row } })
    }),
    update: vi.fn(() => ok({ comment: {} })),
    remove: vi.fn(() => ok({ outcome: 'removed' })),
    resolve: vi.fn(() => ok({ comment: {} })),
    reopen: vi.fn(() => ok({ comment: {} })),
    revisions: vi.fn(() => ok({ revisions: [] })),
    anchors: vi.fn(
      (i: {
        versionId: string
        anchors: Array<{ commentId: string; anchor: Record<string, unknown>; state: string }>
      }) => {
        if (anchorsReply === 'version_invalid') {
          return Promise.resolve({
            ok: false as const,
            error: { code: 'malformed', details: { code: 'anchor_version_invalid' } },
          })
        }
        for (const a of i.anchors) {
          const r = find(a.commentId)
          r.anchor = a.anchor
          r.anchor_state = a.state
          token++
        }
        return ok({ updated: i.anchors.map((a) => a.commentId), skipped: [], list_token: 'x' })
      },
    ),
    searchMentions: vi.fn(() => ok({ candidates: [] })),
    context: vi.fn(() =>
      opts.context === 'not_found'
        ? Promise.resolve({ ok: false as const, error: { code: 'not_found' } })
        : ok({
            documentId: 'doc1',
            versionId: opts.versionId === undefined ? 'v1' : opts.versionId,
            level: 'edit',
            myUserId: 'me',
          }),
    ),
    onSaved: vi.fn((h: (p: { path: string; versionId: string }) => void) => {
      savedHandlers.push(h)
      return () => void savedHandlers.splice(savedHandlers.indexOf(h), 1)
    }),
    onReveal: vi.fn((h: (p: { path: string; commentId: string }) => unknown) => {
      revealHandlers.push(h)
      return () => void revealHandlers.splice(revealHandlers.indexOf(h), 1)
    }),
  }
  return {
    api: api as unknown as ServerCommentsApi,
    calls: api,
    rows,
    add,
    failAnchors: () => {
      anchorsReply = 'version_invalid'
    },
    saved: async (versionId: string) => {
      await act(async () => savedHandlers.forEach((h) => h({ path: PATH, versionId })))
      await flush()
    },
    reveal: async (commentId: string) => {
      let out: unknown[] = []
      await act(async () => {
        out = await Promise.all(revealHandlers.map((h) => h({ path: PATH, commentId })))
      })
      await flush()
      return out
    },
  }
}

const SHEETS = [
  { id: 'sheet-1', name: 'Summary', stableId: 'sheet-1' },
  { id: 'sheet-2', name: 'Data', stableId: 'sheet-2' },
]

function fakeView() {
  const state = {
    active: 'sheet-1',
    selection: { sheetId: 'sheet-1', range: cell(0, 0) },
    selected: [] as Array<[string, CellRange]>,
  }
  const view: SheetsEditorView = {
    sheets: () => SHEETS,
    activeSheetId: () => state.active,
    selection: () => state.selection,
    select: (sheetId, range) => {
      state.active = sheetId
      state.selection = { sheetId, range }
      state.selected.push([sheetId, range])
    },
  }
  return { view, state }
}

function cell(row: number, column: number): CellRange {
  return { startRow: row, endRow: row, startColumn: column, endColumn: column }
}

const FILE = {
  path: PATH,
  name: 'Budget.xlsx',
  sheets: [
    { id: 'sheet-1', name: 'Summary', comments: [] },
    {
      id: 'sheet-2',
      name: 'Data',
      comments: [
        {
          row: 2,
          column: 3,
          author: 'User',
          text: 'In-file thread',
          thread: {
            id: '{T1}',
            personId: '{P1}',
            author: 'User',
            dT: '2026-10-01T08:00:00.00',
            done: false,
            text: 'In-file thread',
            replies: [],
          },
        },
      ],
    },
  ],
} as unknown as WorkbookFile

let el: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  sessionStorage.clear()
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  serverAnchorStore.reset()
  threadStore.load(FILE)
  threadPane.close()
})

afterEach(() => {
  act(() => root.unmount())
  el.remove()
  document.getElementById(COLLAB_LIVE_REGION_ID)?.remove()
  vi.unstubAllGlobals()
  delete (window as { uniworkComments?: unknown }).uniworkComments
})

async function flush(n = 3) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      for (let k = 0; k < 5; k++) await Promise.resolve()
    })
  }
}

async function mount(server: ReturnType<typeof fakeServer> | null, view = fakeView().view) {
  const status = vi.fn()
  await act(async () =>
    root.render(
      createElement(LocaleProvider, {
        initial: 'en',
        children: createElement(SheetsCommentsSurface, {
          getRuntime: () => null,
          file: FILE,
          onStatus: status,
          ...(server ? { api: server.api } : {}),
          view,
        }),
      }),
    ),
  )
  await flush()
  return { status }
}

async function typeAndSend(box: HTMLTextAreaElement, text: string) {
  await act(async () => {
    nativeValue.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => {
    box.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  await flush()
}

describe('server mode: new root comment', () => {
  it('carries the selection {sheet, range} and the open version as base_version_id', async () => {
    const server = fakeServer()
    const { view, state } = fakeView()
    state.active = 'sheet-2'
    state.selection = {
      sheetId: 'sheet-2',
      range: { startRow: 6, endRow: 8, startColumn: 1, endColumn: 3 },
    }
    await mount(server, view)
    expect(serverComments.handle).not.toBeNull()
    await act(async () => serverComments.handle!.startThread())
    await flush()
    const box = el.querySelector<HTMLTextAreaElement>('.collab-thread--new textarea')
    expect(box).not.toBeNull()
    await typeAndSend(box!, 'Check B7:D9')
    expect(server.calls.create).toHaveBeenCalledTimes(1)
    expect(server.calls.create.mock.calls[0]![0]).toMatchObject({
      path: PATH,
      kind: 'comment',
      body: 'Check B7:D9',
      baseVersionId: 'v1',
      anchor: { format: 'xlsx', v: 1, sheet: 'sheet-2', range: 'B7:D9' },
    })
  })

  it('no open version: no composer, a short reason instead; reading still works', async () => {
    const server = fakeServer({ versionId: null })
    server.add({
      body: 'Existing',
      anchor: { format: 'xlsx', v: 1, sheet: 'sheet-1', range: 'A1' },
    })
    const { status } = await mount(server)
    await act(async () => serverComments.handle!.startThread())
    await flush()
    expect(status).toHaveBeenCalledWith('Save the workbook first to add a comment')
    expect(el.querySelector('.collab-thread--new')).toBeNull()
    expect(server.calls.create).not.toHaveBeenCalled()
    expect(el.textContent).toContain('Existing')
  })
})

describe('server mode: anchors after Save', () => {
  it('insert a row above a commented cell, then Save -> the moved anchor goes out with the new version', async () => {
    const server = fakeServer()
    const c = server.add({
      body: 'Why so high?',
      anchor: { format: 'xlsx', v: 1, sheet: 'sheet-2', range: 'B7' },
      anchor_state: 'exact',
    })
    await mount(server)
    // the App feeds the same structural ops the thread store gets
    act(() =>
      serverAnchorStore.applyStructuralOp('sheet-2', { kind: 'insert-rows', index: 3, count: 1 }),
    )
    await server.saved('v2')
    expect(server.calls.anchors).toHaveBeenCalledWith({
      path: PATH,
      versionId: 'v2',
      anchors: [
        {
          commentId: c.id,
          anchor: { format: 'xlsx', v: 1, sheet: 'sheet-2', range: 'B8' },
          state: 'exact',
        },
      ],
    })
    // the changed row comes back with a full reload
    expect(server.calls.list.mock.calls.length).toBeGreaterThan(1)
  })

  it('delete the commented row, then Save -> lost (the comment stays readable)', async () => {
    const server = fakeServer()
    const anchor = { format: 'xlsx', v: 1, sheet: 'sheet-2', range: 'B7' }
    const c = server.add({ body: 'Gone soon', anchor, anchor_state: 'exact' })
    await mount(server)
    act(() =>
      serverAnchorStore.applyStructuralOp('sheet-2', { kind: 'remove-rows', index: 6, count: 1 }),
    )
    await server.saved('v2')
    expect(server.calls.anchors.mock.calls[0]![0].anchors).toEqual([
      { commentId: c.id, anchor, state: 'lost' },
    ])
    act(() => threadPane.show())
    await flush()
    expect(el.textContent).toContain('Gone soon')
    expect(el.textContent).toContain(EN.collabAnchorLost)
  })

  it('anchor_version_invalid -> retry at the next Save, nothing thrown, no reload', async () => {
    const server = fakeServer()
    server.add({ body: 'x', anchor: { format: 'xlsx', v: 1, sheet: 'sheet-1', range: 'A1' } })
    await mount(server)
    server.failAnchors()
    const lists = server.calls.list.mock.calls.length
    await server.saved('v2')
    expect(server.calls.anchors).toHaveBeenCalledTimes(1)
    expect(server.calls.list.mock.calls.length).toBe(lists)
  })

  it('server comments never touch the thread store (the file parts stay byte-identical)', async () => {
    const server = fakeServer()
    server.add({ body: 'x', anchor: { format: 'xlsx', v: 1, sheet: 'sheet-2', range: 'B7' } })
    const changed = vi.fn()
    threadStore.onChange = changed
    const version = threadStore.getVersion()
    const { view, state } = fakeView()
    state.selection = { sheetId: 'sheet-1', range: cell(1, 1) }
    await mount(server, view)
    await act(async () => serverComments.handle!.startThread())
    await flush()
    await typeAndSend(el.querySelector<HTMLTextAreaElement>('.collab-thread--new textarea')!, 'y')
    act(() =>
      serverAnchorStore.applyStructuralOp('sheet-2', { kind: 'insert-rows', index: 0, count: 1 }),
    )
    await server.saved('v2')
    // no note-dirty mark and no store edit: collectNoteStates has nothing new to write
    expect(changed).not.toHaveBeenCalled()
    expect(threadStore.getVersion()).toBe(version)
    threadStore.onChange = null
  })
})

describe('server mode: the file’s own threads are read-only', () => {
  it('lists them in the "in the file" section with no reply/edit/resolve/delete', async () => {
    const server = fakeServer()
    await mount(server)
    act(() => threadPane.show())
    await flush()
    const toggle = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes(EN.collabInFileSection!),
    )
    expect(toggle).toBeDefined()
    await act(async () => toggle!.click())
    await flush()
    const section = el.querySelector<HTMLElement>('.collab-infile')!
    expect(section.textContent).toContain('In-file thread')
    expect(section.textContent).toContain("'Data'!D3")
    expect(section.querySelector('button, textarea')).toBeNull()
  })
})

describe('server mode: comments.reveal', () => {
  it('reveal -> cell B7 of sheet 2 selected and the thread focused', async () => {
    const server = fakeServer()
    const c = server.add({
      body: 'Look here',
      anchor: { format: 'xlsx', v: 1, sheet: 'sheet-2', range: 'B7' },
      anchor_state: 'exact',
    })
    const { view, state } = fakeView()
    await mount(server, view)
    expect(await server.reveal(c.id)).toEqual([true])
    expect(state.selected).toEqual([['sheet-2', cell(6, 1)]])
    expect(threadPane.getState().open).toBe(true)
    const heading = el.querySelector<HTMLElement>(
      `[data-thread-id="${c.id}"] [data-thread-heading]`,
    )
    expect(document.activeElement).toBe(heading)
  })

  it('lost -> the thread only; unknown id -> false', async () => {
    const server = fakeServer()
    const c = server.add({
      body: 'Lost one',
      anchor: { format: 'xlsx', v: 1, sheet: 'sheet-2', range: 'B7' },
      anchor_state: 'lost',
    })
    const { view, state } = fakeView()
    await mount(server, view)
    expect(await server.reveal(c.id)).toEqual([true])
    expect(state.selected).toEqual([])
    expect(await server.reveal('nope')).toEqual([false])
  })
})

describe('local file -> old behaviour', () => {
  it('no window.uniworkComments: today’s threaded-comments pane, no comments call', async () => {
    await mount(null)
    expect(serverComments.handle).toBeNull()
    act(() => threadPane.show())
    await flush()
    expect(el.querySelector('.threaded-comments-pane')).not.toBeNull()
    expect(el.querySelector('.collab-panel, .sheets-server-comments')).toBeNull()
  })

  it('an unbound file (context not_found): today’s pane, no list', async () => {
    const server = fakeServer({ context: 'not_found' })
    await mount(server)
    expect(server.calls.context).toHaveBeenCalledWith({ path: PATH })
    expect(server.calls.list).not.toHaveBeenCalled()
    expect(serverComments.handle).toBeNull()
  })
})

describe('AI (lane decision D5)', () => {
  it('set_note writes a legacy note only: no AI-reachable code calls comments.*', () => {
    const src = (p: string) => readFileSync(resolve(process.cwd(), 'src/renderer', p), 'utf8')
    const executor = src('op-executor.ts')
    const setNote = executor.slice(executor.indexOf("op.op === 'set_note'"))
    expect(setNote).toContain('createOrUpdateNote')
    for (const file of ['op-executor.ts', 'plan-operations.ts']) {
      expect(src(file)).not.toMatch(/uniworkComments|server-comments/)
    }
  })
})

describe('21-locale parity of the new key', () => {
  it('appCommentSaveFirst is translated in every locale, and nowhere left in English', async () => {
    const { strings } = await import('../src/renderer/i18n/strings')
    const langs = Object.keys(strings) as Array<keyof typeof strings>
    expect(langs).toHaveLength(21)
    for (const lang of langs) {
      const text = strings[lang].appCommentSaveFirst
      expect(text, lang).toBeTruthy()
      if (lang !== 'en') expect(text, lang).not.toBe(strings.en.appCommentSaveFirst)
    }
  })
})
