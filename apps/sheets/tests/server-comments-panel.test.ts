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
import { COLLAB_LIVE_REGION_ID, COMMENTS_REVEAL_WAIT_MS, collabStrings } from '@genoffice/ui/collab'

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
function fakeServer(
  opts: { versionId?: string | null; context?: 'ok' | 'not_found'; frame?: boolean } = {},
) {
  const rows: Row[] = []
  let seq = 0
  let token = 0
  const savedHandlers: Array<(p: { path: string; versionId: string }) => void> = []
  const revealHandlers: Array<(p: { path: string; commentId: string; last?: boolean }) => unknown> =
    []
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
            ...(opts.frame ? { frame: true } : {}),
          }),
    ),
    onSaved: vi.fn((h: (p: { path: string; versionId: string }) => void) => {
      savedHandlers.push(h)
      return () => void savedHandlers.splice(savedHandlers.indexOf(h), 1)
    }),
    onReveal: vi.fn((h: (p: { path: string; commentId: string; last?: boolean }) => unknown) => {
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
    /** `last`: the web frame router's flag (set on the frame, never on desktop) */
    reveal: async (commentId: string, last?: boolean) => {
      let out: unknown[] = []
      await act(async () => {
        out = await Promise.all(
          revealHandlers.map((h) =>
            h({ path: PATH, commentId, ...(last !== undefined ? { last } : {}) }),
          ),
        )
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
    selection: { sheetId: 'sheet-1', range: cell(0, 0) } as {
      sheetId: string
      range: CellRange
    } | null,
    selected: [] as Array<[string, CellRange]>,
    sheets: SHEETS.map((s) => ({ ...s })) as Array<{ id: string; name: string; stableId?: string }>,
  }
  const view: SheetsEditorView = {
    sheets: () => state.sheets,
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
    // the one list is the receipt's own refresh (G819-A02b); the refused PUT adds no reload after it
    expect(server.calls.list.mock.calls.length).toBe(lists + 1)
  })

  it('a comment made on the server after the first list is in the PUT after the receipt, panel closed (G819-A02b)', async () => {
    const server = fakeServer()
    const first = server.add({
      body: 'first',
      anchor: { format: 'xlsx', v: 1, sheet: 'sheet-1', range: 'A1' },
      anchor_state: 'exact',
    })
    await mount(server)
    // the other host comments after this editor listed; nothing here lists again while closed
    const later = server.add({
      body: 'from the other host',
      anchor: { format: 'xlsx', v: 1, sheet: 'sheet-2', range: 'B7' },
      anchor_state: 'exact',
    })
    await server.saved('v2')
    expect(server.calls.anchors).toHaveBeenCalledTimes(1)
    const sent = server.calls.anchors.mock.calls[0]![0]
    expect(sent.versionId).toBe('v2')
    expect(sent.anchors.map((a) => a.commentId).sort()).toEqual([first.id, later.id].sort())
    expect(sent.anchors.every((a) => a.state === 'exact')).toBe(true)
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

describe('reveal in the frame and on desktop (lane contract §3.5, V13-5)', () => {
  it('web frame: a miss shows the S15 line and opens the panel only when last is true', async () => {
    const server = fakeServer({ frame: true })
    await mount(server)
    // another owner is still asked after this one: stay silent and closed
    expect(await server.reveal('gone', false)).toEqual([false])
    expect(threadPane.getState().open).toBe(false)
    expect(el.textContent).not.toContain(EN.collabCommentDeleted!)
    expect(await server.reveal('gone', true)).toEqual([false])
    expect(threadPane.getState().open).toBe(true)
    expect(el.querySelector('.collab-panel')).not.toBeNull()
    expect(el.textContent).toContain(EN.collabCommentDeleted!)
  })

  it('desktop (no last): a miss is silent; a failed first list answers false, no throw', async () => {
    const server = fakeServer()
    await mount(server)
    expect(await server.reveal('gone')).toEqual([false])
    expect(threadPane.getState().open).toBe(false)

    act(() => root.unmount())
    root = createRoot(el)
    const failing = fakeServer()
    failing.calls.list.mockImplementation(
      () => Promise.resolve({ ok: false, error: { code: 'internal' } }) as never,
    )
    await mount(failing)
    expect(await failing.reveal('x')).toEqual([false])
  })

  it('frame (last set): a late first list is the typed not_ready the router maps', async () => {
    const server = fakeServer({ frame: true })
    server.calls.list.mockImplementation(() => new Promise(() => undefined) as never)
    const handlers: Array<(p: { path: string; commentId: string; last?: boolean }) => unknown> = []
    server.calls.onReveal.mockImplementation((h) => {
      handlers.push(h)
      return () => undefined
    })
    vi.useFakeTimers()
    try {
      await mount(server)
      const caught = Promise.resolve(handlers[0]!({ path: PATH, commentId: 'x', last: true })).then(
        () => null,
        (e: unknown) => e,
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COMMENTS_REVEAL_WAIT_MS + 50)
      })
      expect(await caught).toMatchObject({ code: 'not_ready', retryable: true })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('one side panel at a time in the frame (lane contract §3.5)', () => {
  const EVENT = 'uniwork:frame-side-panel'
  const seen: Array<{ owner: string; open: boolean }> = []
  const listener = (e: Event) => seen.push((e as CustomEvent).detail)
  beforeEach(() => {
    seen.length = 0
    window.addEventListener(EVENT, listener)
  })
  afterEach(() => window.removeEventListener(EVENT, listener))

  it('announces its own open and close as the editor owner, nothing for the closed mount', async () => {
    await mount(fakeServer({ frame: true }))
    expect(seen).toEqual([])
    act(() => threadPane.show())
    await flush()
    expect(seen).toEqual([{ owner: 'editor', open: true }])
    act(() => threadPane.close())
    await flush()
    expect(seen).toEqual([
      { owner: 'editor', open: true },
      { owner: 'editor', open: false },
    ])
  })

  it('closes itself when another owner opens, and ignores its own and close events', async () => {
    await mount(fakeServer({ frame: true }))
    act(() => threadPane.show())
    await flush()
    await act(async () => {
      window.dispatchEvent(new CustomEvent(EVENT, { detail: { owner: 'editor', open: true } }))
      window.dispatchEvent(new CustomEvent(EVENT, { detail: { owner: 'discussion', open: false } }))
    })
    expect(threadPane.getState().open).toBe(true)
    await act(async () => {
      window.dispatchEvent(new CustomEvent(EVENT, { detail: { owner: 'discussion', open: true } }))
    })
    await flush()
    expect(threadPane.getState().open).toBe(false)
    expect(el.querySelector('.collab-panel')).toBeNull()
    // no ping-pong: closing on another owner's open announces only its own close
    expect(seen.filter((d) => d.owner === 'editor').at(-1)).toEqual({
      owner: 'editor',
      open: false,
    })
  })

  it('the old side-by-side rule beside the Discussion panel is gone (one panel at a time)', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8')
    expect(css).not.toMatch(/html\.uw-disc-open \.collab-panel\.sheets-server-comments/)
  })
})

describe("the desktop poll is not the frame's (lane contract §3.5)", () => {
  it('a window focus reloads the list on desktop and does not in the frame', async () => {
    const desktop = fakeServer()
    await mount(desktop)
    act(() => threadPane.show())
    await flush()
    const before = desktop.calls.list.mock.calls.length
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(desktop.calls.list.mock.calls.length).toBeGreaterThan(before)

    act(() => root.unmount())
    root = createRoot(el)
    const frame = fakeServer({ frame: true })
    await mount(frame)
    act(() => threadPane.show())
    await flush()
    const framed = frame.calls.list.mock.calls.length
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(frame.calls.list.mock.calls.length).toBe(framed)
  })
})

describe('save the workbook first, inside the panel (V13-1)', () => {
  it('shows a warn line near the composer while the version is unknown and announces it politely', async () => {
    vi.useFakeTimers()
    try {
      const server = fakeServer({ versionId: null })
      await mount(server)
      await act(async () => serverComments.handle!.startThread())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      const line = el.querySelector('.sheets-server-comments .sheets-server-save-first')
      expect(line?.textContent).toBe('Save the workbook first to add a comment')
      expect(line?.classList.contains('collab-pnote--warn')).toBe(true)
      expect(document.getElementById(COLLAB_LIVE_REGION_ID)?.textContent).toBe(
        'Save the workbook first to add a comment',
      )
      await server.saved('v2')
      expect(el.querySelector('.sheets-server-save-first')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('no line for a known version', async () => {
    await mount(fakeServer())
    act(() => threadPane.show())
    await flush()
    expect(el.querySelector('.collab-panel')).not.toBeNull()
    expect(el.querySelector('.sheets-server-save-first')).toBeNull()
  })
})

describe('New Comment without a selection (FE13-6)', () => {
  it('gives visible feedback instead of doing nothing', async () => {
    vi.useFakeTimers()
    try {
      const server = fakeServer()
      const { view, state } = fakeView()
      state.selection = null
      const { status } = await mount(server, view)
      await act(async () => serverComments.handle!.startThread())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(status).toHaveBeenCalledWith('Select a cell first.')
      expect(document.getElementById(COLLAB_LIVE_REGION_ID)?.textContent).toBe(
        'Select a cell first.',
      )
      expect(threadPane.getState().open).toBe(true)
      expect(el.querySelector('.collab-thread--new')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('labels follow the workbook (FE13-5, V13-3)', () => {
  it('a sheet rename refreshes the in-file labels', async () => {
    const { view, state } = fakeView()
    await mount(fakeServer(), view)
    act(() => threadPane.show())
    await flush()
    const toggle = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes(EN.collabInFileSection!),
    )
    await act(async () => toggle!.click())
    await flush()
    expect(el.querySelector('.collab-infile')!.textContent).toContain("'Data'!D3")
    state.sheets = state.sheets.map((s) => (s.id === 'sheet-2' ? { ...s, name: 'Costs' } : s))
    act(() => serverAnchorStore.sheetRenamed('sheet-2'))
    await flush()
    expect(el.querySelector('.collab-infile')!.textContent).toContain("'Costs'!D3")
  })

  it('a sheet the workbook does not know: the last known name, else the cell only, never the raw id', async () => {
    const server = fakeServer()
    server.add({
      body: 'Unknown sheet',
      anchor: { format: 'xlsx', v: 1, sheet: 'sheet-9', range: 'A9' },
      anchor_state: 'stale',
    })
    server.add({
      body: 'Removed sheet',
      anchor: { format: 'xlsx', v: 1, sheet: 'sheet-2', range: 'B2' },
      anchor_state: 'exact',
    })
    const { view, state } = fakeView()
    await mount(server, view)
    // the sheet goes away after the list was seen (deleted by someone, kept by the server)
    state.sheets = state.sheets.filter((s) => s.id !== 'sheet-2')
    act(() => serverAnchorStore.sheetRenamed('sheet-2'))
    act(() => threadPane.show())
    await flush()
    const text = el.querySelector('.collab-panel')!.textContent ?? ''
    expect(text).not.toContain('sheet-9')
    expect(text).not.toContain('sheet-2')
    expect(text).toContain('A9')
    expect(text).toContain("'Data'!B2")
  })
})

describe('the anchor store follows a reopen that is not a Save (FE13-4)', () => {
  it('reset re-locates the listed roots without waiting for the next list', async () => {
    const server = fakeServer()
    server.add({
      body: 'Marked',
      anchor: { format: 'xlsx', v: 1, sheet: 'sheet-2', range: 'B7' },
      anchor_state: 'exact',
    })
    await mount(server)
    expect(serverAnchorStore.hasMarker('sheet-2', 6, 1)).toBe(true)
    const lists = server.calls.list.mock.calls.length
    act(() => serverAnchorStore.reset())
    await flush()
    expect(server.calls.list.mock.calls.length).toBe(lists)
    expect(serverAnchorStore.hasMarker('sheet-2', 6, 1)).toBe(true)
  })
})
