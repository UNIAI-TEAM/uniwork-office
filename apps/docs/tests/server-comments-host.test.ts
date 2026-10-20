/**
 * G8-12 (UNI-1407): the Docs server-comment panel against a fake `window.uniworkComments` host.
 * Card test lines: create / reply / edit / delete / resolve / reopen through the host; edit the
 * paragraph then Save -> the new anchor goes out with the new version id; delete the paragraph -> lost;
 * reveal -> the anchor range is selected and the thread focused; an AI tool on a bound document ->
 * zero `comments.create` before Send.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { COLLAB_LIVE_REGION_ID, COMMENTS_REVEAL_WAIT_MS, collabStrings } from '@genoffice/ui/collab'
import { editorExtensions } from '../src/renderer/editor/extensions'
import { encodeDocxAnchor } from '../src/renderer/server-comments/anchor-codec'
import { SERVER_COMMENT_CLASS } from '../src/renderer/server-comments/anchor-tracker'
import {
  ServerCommentsHost,
  type ServerCommentsHandle,
} from '../src/renderer/server-comments/ServerCommentsHost'
import type { ServerMode } from '../src/renderer/server-comments/mode'
import type { ServerCommentsApi } from '../src/renderer/server-comments/seam'

const EN = collabStrings('en')
const PATH = '/w/Plan.docx'
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
  anchor_version_id?: string | null
  anchor_version_no?: number | null
  resolved_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
  display_name: string
}

/** an in-memory UniWork server behind the editor API shape (camelCase in, reply envelopes out) */
function fakeServer() {
  const rows: Row[] = []
  let seq = 0
  let token = 0
  const savedHandlers: Array<(p: { path: string; versionId: string }) => void> = []
  const revealHandlers: Array<(p: { path: string; commentId: string; last?: boolean }) => unknown> =
    []
  const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value })
  const stamp = () => `2026-10-13T10:00:${String(++seq).padStart(2, '0')}Z`
  const find = (id: string) => rows.find((r) => r.id === id)!
  const touch = (r: Row) => {
    r.updated_at = stamp()
    token++
  }
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
    update: vi.fn((i: { commentId: string; body: string }) => {
      const r = find(i.commentId)
      r.body = i.body
      r.revision++
      touch(r)
      return ok({ comment: { ...r } })
    }),
    remove: vi.fn((i: { commentId: string }) => {
      const at = rows.findIndex((r) => r.id === i.commentId)
      rows.splice(at, 1)
      token++
      return ok({ outcome: 'removed' })
    }),
    resolve: vi.fn((i: { commentId: string }) => {
      const r = find(i.commentId)
      r.resolved_at = stamp()
      touch(r)
      return ok({ comment: { ...r } })
    }),
    reopen: vi.fn((i: { commentId: string }) => {
      const r = find(i.commentId)
      r.resolved_at = null
      touch(r)
      return ok({ comment: { ...r } })
    }),
    revisions: vi.fn(() => ok({ revisions: [] })),
    anchors: vi.fn(
      (i: {
        versionId: string
        anchors: Array<{ commentId: string; anchor: Record<string, unknown>; state: string }>
      }) => {
        for (const a of i.anchors) {
          const r = find(a.commentId)
          r.anchor = a.anchor
          r.anchor_state = a.state
          touch(r)
        }
        return ok({ updated: i.anchors.map((a) => a.commentId), skipped: [], list_token: 'x' })
      },
    ),
    searchMentions: vi.fn(() => ok({ candidates: [] })),
    openVersion: vi.fn((_i: { path: string; commentId: string; versionNo: number }) =>
      Promise.resolve({ opened: true }),
    ),
    context: vi.fn(() =>
      ok({ documentId: 'doc1', versionId: 'v1', level: 'edit', myUserId: 'me' }),
    ),
    onSaved: vi.fn((h: (p: { path: string; versionId: string }) => void) => {
      savedHandlers.push(h)
      return () => savedHandlers.splice(savedHandlers.indexOf(h), 1)
    }),
    onReveal: vi.fn((h: (p: { path: string; commentId: string; last?: boolean }) => unknown) => {
      revealHandlers.push(h)
      return () => revealHandlers.splice(revealHandlers.indexOf(h), 1)
    }),
  }
  return {
    api: api as unknown as ServerCommentsApi,
    calls: api,
    rows,
    add,
    saved: (versionId: string) => savedHandlers.forEach((h) => h({ path: PATH, versionId })),
    /** `last`: the web frame router's flag (set on the frame, never on desktop) */
    reveal: (commentId: string, last?: boolean) =>
      revealHandlers.map((h) =>
        h({ path: PATH, commentId, ...(last !== undefined ? { last } : {}) }),
      ),
  }
}

const para = (t: string) => ({
  type: 'docParagraph',
  attrs: { docxIndex: null },
  content: [{ type: 'text', text: t }],
})

let el: HTMLDivElement
let root: Root
let editor: Editor
const handle: { current: ServerCommentsHandle | null } = { current: null }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  sessionStorage.clear()
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  editor = new Editor({
    element: document.createElement('div'),
    extensions: editorExtensions,
    content: {
      type: 'doc',
      content: [
        para('Intro paragraph.'),
        para('Revenue grew in the third quarter.'),
        para('Closing words.'),
      ],
    },
  })
})

afterEach(() => {
  act(() => root.unmount())
  editor.destroy()
  el.remove()
  document.getElementById(COLLAB_LIVE_REGION_ID)?.remove()
  vi.unstubAllGlobals()
})

async function flush(n = 3) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      for (let k = 0; k < 5; k++) await Promise.resolve()
    })
  }
}

function rangeOf(needle: string): { from: number; to: number } {
  let out: { from: number; to: number } | null = null
  editor.state.doc.descendants((node, pos) => {
    if (out || !node.isTextblock) return
    const at = node.textContent.indexOf(needle)
    if (at !== -1) out = { from: pos + 1 + at, to: pos + 1 + at + needle.length }
  })
  if (!out) throw new Error(`no ${needle}`)
  return out
}

function mode(api: ServerCommentsApi, versionId: string | null = 'v1'): ServerMode {
  return { api, path: PATH, documentId: 'doc1', versionId, level: 'edit', myUserId: 'me' }
}

async function mount(
  server: ReturnType<typeof fakeServer>,
  panelOpen = true,
  versionId: string | null = 'v1',
  over: Partial<ServerMode> = {},
) {
  const status = vi.fn()
  const closes = vi.fn()
  const render = (open: boolean) =>
    root.render(
      createElement(ServerCommentsHost, {
        mode: { ...mode(server.api, versionId), ...over },
        editor,
        lang: 'en',
        panelOpen: open,
        onOpenPanel: () => render(true),
        onClosePanel: () => {
          closes()
          render(false)
        },
        onStatus: status,
        selectTextMessage: 'Select text first',
        saveFirstMessage: 'Save first',
        inFileComments: [],
        neutralAuthor: 'User',
        handleRef: handle,
      }),
    )
  await act(async () => render(panelOpen))
  await flush()
  return { status, closes }
}

const buttons = (text: string) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === text)
const click = async (b: HTMLElement | undefined) => {
  if (!b) throw new Error('no button')
  await act(async () => b.click())
  await flush()
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
const thread = (id: string) => el.querySelector<HTMLElement>(`[data-thread-id="${id}"]`)!

describe('server mode panel: thread actions through the host', () => {
  it('create carries the selection anchor + base version; reply, edit, delete, resolve, reopen go to the host', async () => {
    const server = fakeServer()
    await mount(server)
    editor.commands.setTextSelection(rangeOf('third quarter'))
    await act(async () => handle.current!.startThread())
    await flush()
    const box = el.querySelector<HTMLTextAreaElement>('.collab-thread--new textarea')!
    expect(box).not.toBeNull()
    await typeAndSend(box, 'Which quarter?')
    expect(server.calls.create).toHaveBeenCalledTimes(1)
    const created = server.calls.create.mock.calls[0]![0]
    expect(created).toMatchObject({
      path: PATH,
      kind: 'comment',
      body: 'Which quarter?',
      baseVersionId: 'v1',
      anchor: { format: 'docx', v: 1, path: [1], quote: 'third quarter' },
    })
    const id = server.rows[0]!.id

    // the located thread is highlighted with a decoration, never the comment mark
    expect(editor.view.dom.querySelector(`.${SERVER_COMMENT_CLASS}`)?.textContent).toBe(
      'third quarter',
    )
    expect(editor.view.dom.querySelector('[data-comment-ids]')).toBeNull()
    expect(JSON.stringify(editor.getJSON())).not.toContain('"comment"')

    await click(buttons(EN.collabReply!).find((b) => thread(id).contains(b)))
    await typeAndSend(thread(id).querySelector('textarea')!, 'Q3, per the report')
    expect(server.calls.create).toHaveBeenLastCalledWith({
      path: PATH,
      kind: 'comment',
      parentId: id,
      body: 'Q3, per the report',
    })
    const replyId = server.rows[1]!.id

    // edit the reply through its actions menu
    const menus = thread(id).querySelectorAll<HTMLButtonElement>(
      `button[aria-label="${EN.collabActions}"]`,
    )
    await click(menus[menus.length - 1])
    await click(el.querySelector<HTMLElement>('[role="menuitem"][data-action="edit"]')!)
    const editBox = thread(id).querySelector<HTMLTextAreaElement>('.collab-edit textarea')!
    await act(async () => {
      nativeValue.call(editBox, 'Q3 2026')
      editBox.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await click(buttons(EN.collabSave!)[0])
    expect(server.calls.update).toHaveBeenCalledWith({
      path: PATH,
      commentId: replyId,
      body: 'Q3 2026',
    })

    // delete the reply (one-step confirm)
    const menus2 = thread(id).querySelectorAll<HTMLButtonElement>(
      `button[aria-label="${EN.collabActions}"]`,
    )
    await click(menus2[menus2.length - 1])
    await click(el.querySelector<HTMLElement>('[role="menuitem"][data-action="delete"]')!)
    await click(buttons(EN.collabDeleteConfirm!)[0])
    expect(server.calls.remove).toHaveBeenCalledWith({ path: PATH, commentId: replyId })

    await click(el.querySelector<HTMLElement>(`[data-resolve-for="${id}"]`)!)
    expect(server.calls.resolve).toHaveBeenCalledWith({ path: PATH, commentId: id })
    // a resolved thread loses its highlight
    expect(editor.view.dom.querySelector(`.${SERVER_COMMENT_CLASS}`)).toBeNull()
    await click(el.querySelector<HTMLElement>('.collab-group-toggle')!)
    await click(el.querySelector<HTMLElement>(`[data-resolve-for="${id}"]`)!)
    expect(server.calls.reopen).toHaveBeenCalledWith({ path: PATH, commentId: id })
  })

  it('an empty selection outside a word asks for a selection and opens no composer', async () => {
    const server = fakeServer()
    const { status } = await mount(server)
    // caret at the end of a paragraph after the full stop: no word under it
    editor.commands.setTextSelection(rangeOf('Intro paragraph.').to)
    await act(async () => handle.current!.startThread())
    await flush()
    expect(status).toHaveBeenCalledWith('Select text first')
    expect(el.querySelector('.collab-thread--new')).toBeNull()
  })
})

describe('server mode: unknown open version', () => {
  it('no new root without a base version; replies still work; a Save receipt unlocks roots', async () => {
    const server = fakeServer()
    const anchor = encodeDocxAnchor(editor.state.doc, rangeOf('Closing'))!
    const row = server.add({ body: 'existing', anchor, anchor_state: 'exact' })
    const { status } = await mount(server, true, null)
    editor.commands.setTextSelection(rangeOf('third quarter'))
    await act(async () => handle.current!.startThread())
    await flush()
    expect(status).toHaveBeenCalledWith('Save first')
    expect(el.querySelector('.collab-thread--new')).toBeNull()
    expect(handle.current!.ai.draftNew(rangeOf('third quarter'), 'x')).toBe(false)
    await click(buttons(EN.collabReply!).find((b) => thread(row.id).contains(b)))
    await typeAndSend(thread(row.id).querySelector('textarea')!, 'still can reply')
    expect(server.calls.create).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: row.id, body: 'still can reply' }),
    )
    await act(async () => server.saved('v2'))
    await flush()
    await act(async () => handle.current!.startThread())
    await flush()
    expect(el.querySelector('.collab-thread--new')).not.toBeNull()
  })
})

describe('server mode: anchors after Save', () => {
  function seed(server: ReturnType<typeof fakeServer>, needle: string) {
    const anchor = encodeDocxAnchor(editor.state.doc, rangeOf(needle))!
    return server.add({ body: 'note', anchor, anchor_state: 'exact' })
  }

  it('edit the paragraph then Save: the re-encoded anchor goes out with the new version id', async () => {
    const server = fakeServer()
    const row = seed(server, 'third quarter')
    await mount(server, false)
    editor.commands.insertContentAt(rangeOf('Revenue').from, 'Total ')
    await act(async () => server.saved('v2'))
    await flush()
    expect(server.calls.anchors).toHaveBeenCalledTimes(1)
    const sent = server.calls.anchors.mock.calls[0]![0]
    expect(sent.versionId).toBe('v2')
    expect(sent.anchors).toEqual([
      {
        commentId: row.id,
        state: 'exact',
        anchor: expect.objectContaining({
          path: [1],
          start: 'Total Revenue grew in the '.length,
          quote: 'third quarter',
          prefix: 'Total Revenue grew in the ',
        }),
      },
    ])
    // changed rows -> a full reload
    expect(server.calls.list.mock.calls.length).toBeGreaterThanOrEqual(2)
    // the next root comment is based on the saved version
    editor.commands.setTextSelection(rangeOf('Closing'))
    await act(async () => handle.current!.startThread())
    await flush()
    await typeAndSend(
      el.querySelector<HTMLTextAreaElement>('.collab-thread--new textarea')!,
      'later',
    )
    expect(server.calls.create.mock.calls.at(-1)![0]).toMatchObject({ baseVersionId: 'v2' })
  })

  it('delete the paragraph then Save: the comment goes out lost with its last anchor', async () => {
    const server = fakeServer()
    const row = seed(server, 'third quarter')
    const before = row.anchor
    await mount(server, false)
    const block = editor.state.doc.child(0).nodeSize
    editor.commands.deleteRange({ from: block, to: block + editor.state.doc.child(1).nodeSize })
    expect(editor.state.doc.textContent).not.toContain('third quarter')
    await act(async () => server.saved('v2'))
    await flush()
    expect(server.calls.anchors.mock.calls[0]![0].anchors).toEqual([
      { commentId: row.id, state: 'lost', anchor: before },
    ])
  })

  it('anchor_version_invalid keeps the map for the next Save (no throw, no reload)', async () => {
    const server = fakeServer()
    seed(server, 'third quarter')
    server.calls.anchors.mockImplementationOnce(
      () =>
        Promise.resolve({
          ok: false,
          error: { code: 'malformed', details: { code: 'anchor_version_invalid' } },
        }) as never,
    )
    await mount(server, false)
    const lists = server.calls.list.mock.calls.length
    await act(async () => server.saved('v2'))
    await flush()
    // the one list is the receipt's own refresh (G819-A02b); the refused PUT adds no reload after it
    expect(server.calls.list.mock.calls.length).toBe(lists + 1)
    await act(async () => server.saved('v3'))
    await flush()
    expect(server.calls.anchors).toHaveBeenCalledTimes(2)
    expect(server.calls.anchors.mock.calls[1]![0].versionId).toBe('v3')
  })
})

describe('server mode: reveal', () => {
  it('selects the anchor range and focuses the thread; an unknown id answers false', async () => {
    const server = fakeServer()
    const anchor = encodeDocxAnchor(editor.state.doc, rangeOf('third quarter'))!
    const row = server.add({ body: 'note', anchor, anchor_state: 'exact' })
    await mount(server, false)
    let answer: unknown
    await act(async () => {
      answer = await server.reveal(row.id)[0]
    })
    await flush()
    expect(answer).toBe(true)
    const { from, to } = editor.state.selection
    expect(editor.state.doc.textBetween(from, to)).toBe('third quarter')
    expect(document.activeElement).toBe(thread(row.id).querySelector('[data-thread-heading]'))

    await act(async () => {
      answer = await server.reveal('not-mine')[0]
    })
    expect(answer).toBe(false)
    expect(el.textContent).not.toContain(EN.collabCommentDeleted!)
  })

  it('web frame: a miss shows the S15 line and opens the panel only when last is true', async () => {
    const server = fakeServer()
    // the real frame: the path is the bridge's file path, never empty
    await mount(server, false)
    let answer: unknown
    await act(async () => {
      answer = await server.reveal('gone', false)[0]
    })
    await flush()
    // another owner is still asked after this one: stay silent and closed
    expect(answer).toBe(false)
    expect(el.textContent).not.toContain(EN.collabCommentDeleted!)
    expect(el.querySelector('.collab-panel')).toBeNull()
    await act(async () => {
      answer = await server.reveal('gone', true)[0]
    })
    await flush()
    expect(answer).toBe(false)
    expect(el.querySelector('.collab-panel')).not.toBeNull()
    expect(el.textContent).toContain(EN.collabCommentDeleted!)
  })

  it('desktop (no last): a miss is silent even with an empty path; a late first list answers false', async () => {
    const server = fakeServer()
    await mount(server, false, 'v1', { path: '' })
    let answer: unknown
    await act(async () => {
      answer = await server.reveal('gone')[0]
    })
    await flush()
    expect(answer).toBe(false)
    expect(el.textContent).not.toContain(EN.collabCommentDeleted!)

    // a failed first list: no throw, no unhandled rejection
    act(() => root.unmount())
    root = createRoot(el)
    const failing = fakeServer()
    failing.calls.list.mockImplementation(
      () => Promise.resolve({ ok: false, error: { code: 'internal' } }) as never,
    )
    await mount(failing, false)
    await act(async () => {
      answer = await failing.reveal('x')[0]
    })
    expect(answer).toBe(false)
  })

  it('frame (last set): a late first list is the typed not_ready the router maps', async () => {
    const server = fakeServer()
    server.calls.list.mockImplementation(() => new Promise(() => undefined) as never)
    vi.useFakeTimers()
    try {
      await mount(server, false)
      const result = server.reveal('x', true)[0] as Promise<unknown>
      const caught = result.then(
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

  it('a lost thread only opens: the selection does not move', async () => {
    const server = fakeServer()
    const row = server.add({
      body: 'gone',
      anchor: {
        format: 'docx',
        v: 1,
        path: [7],
        start: 0,
        end: 4,
        quote: 'nope',
        prefix: '',
        suffix: '',
      },
      anchor_state: 'lost',
    })
    await mount(server, false)
    editor.commands.setTextSelection(1)
    await act(async () => {
      await server.reveal(row.id)[0]
    })
    await flush()
    expect(editor.state.selection.from).toBe(1)
    expect(editor.state.selection.empty).toBe(true)
    expect(thread(row.id).textContent).toContain(EN.collabAnchorLost!)
  })
})

describe('server mode: a lost comment and its older version (UNI-2033)', () => {
  const GONE = {
    format: 'docx',
    v: 1,
    path: [7],
    start: 0,
    end: 4,
    quote: 'nope',
    prefix: '',
    suffix: '',
  }
  const VIEW = 'View in version 2'

  it('offers "View in version N" on a lost thread and asks the shell once, with the path, id and N', async () => {
    const server = fakeServer()
    const row = server.add({
      body: 'gone',
      anchor: GONE,
      anchor_state: 'lost',
      anchor_version_id: 'v0',
      anchor_version_no: 2,
    })
    await mount(server)
    expect(buttons(VIEW)).toHaveLength(1)
    await click(buttons(VIEW)[0])
    expect(server.calls.openVersion.mock.calls).toEqual([
      [{ path: PATH, commentId: row.id, versionNo: 2 }],
    ])
    // the shell opened it: no unavailable line
    expect(el.textContent).not.toContain(EN.collabVersionViewUnavailable!)
  })

  it('shows the unavailable line when the shell could not open the version', async () => {
    const server = fakeServer()
    server.calls.openVersion.mockImplementation(() => Promise.resolve({ opened: false }))
    server.add({
      body: 'gone',
      anchor: GONE,
      anchor_state: 'lost',
      anchor_version_id: 'v0',
      anchor_version_no: 2,
    })
    await mount(server)
    await click(buttons(VIEW)[0])
    expect(el.textContent).toContain(EN.collabVersionViewUnavailable!)
  })

  it('no action without a version number, or on a host that cannot open a version', async () => {
    const server = fakeServer()
    server.add({ body: 'gone', anchor: GONE, anchor_state: 'lost', anchor_version_id: 'v0' })
    await mount(server)
    expect(el.textContent).not.toContain('View in version')

    const bare = fakeServer()
    bare.add({
      body: 'gone',
      anchor: GONE,
      anchor_state: 'lost',
      anchor_version_id: 'v0',
      anchor_version_no: 2,
    })
    delete (bare.api as { openVersion?: unknown }).openVersion
    act(() => root.unmount())
    root = createRoot(el)
    await mount(bare)
    expect(el.textContent).not.toContain('View in version')
  })

  it('in the version the comment was last anchored on, a lost thread reveals at its anchor', async () => {
    const server = fakeServer()
    const anchor = encodeDocxAnchor(editor.state.doc, rangeOf('third quarter'))!
    const row = server.add({
      body: 'note',
      anchor,
      anchor_state: 'lost',
      anchor_version_id: 'ver_2',
      anchor_version_no: 2,
    })
    // this editor shows version ver_2 (the read-only copy of it)
    await mount(server, false, 'ver_2')
    let answer: unknown
    await act(async () => {
      answer = await server.reveal(row.id)[0]
    })
    await flush()
    expect(answer).toBe(true)
    const { from, to } = editor.state.selection
    expect(editor.state.doc.textBetween(from, to)).toBe('third quarter')
    // and no "View in version" action: it is that version
    expect(el.textContent).not.toContain('View in version')
  })

  it('in another version, the same lost thread does not move the selection', async () => {
    const server = fakeServer()
    const anchor = encodeDocxAnchor(editor.state.doc, rangeOf('third quarter'))!
    const row = server.add({
      body: 'note',
      anchor,
      anchor_state: 'lost',
      anchor_version_id: 'ver_2',
      anchor_version_no: 2,
    })
    await mount(server, false, 'ver_5')
    editor.commands.setTextSelection(1)
    await act(async () => {
      await server.reveal(row.id)[0]
    })
    await flush()
    expect(editor.state.selection.from).toBe(1)
    expect(editor.state.selection.empty).toBe(true)
  })
})

describe('server mode: AI tools fill drafts only (invariant 7)', () => {
  it('a new-comment draft and a reply draft send nothing until the user presses Send', async () => {
    const server = fakeServer()
    const anchor = encodeDocxAnchor(editor.state.doc, rangeOf('Closing'))!
    const row = server.add({ body: 'existing', anchor, anchor_state: 'exact' })
    await mount(server, false)
    const ai = handle.current!.ai
    expect(ai.owns(row.id)).toBe(true)
    expect(ai.list()).toEqual([
      expect.objectContaining({ id: row.id, text: 'existing', author: 'An Nguyen' }),
    ])
    await act(async () => {
      expect(ai.draftNew(rangeOf('third quarter'), 'Check this figure')).toBe(true)
      expect(ai.draftReply(row.id, 'Done, updated')).toBe(true)
    })
    await flush()
    expect(server.calls.create).not.toHaveBeenCalled()
    expect(server.calls.update).not.toHaveBeenCalled()
    expect(server.calls.anchors).not.toHaveBeenCalled()
    const box = el.querySelector<HTMLTextAreaElement>('.collab-thread--new textarea')!
    expect(box.value).toBe('Check this figure')
    expect(el.textContent).toContain(EN.collabAiDraftLabel!)
    // the reply draft waits behind the thread's Reply button
    await click(buttons(EN.collabReply!).find((b) => thread(row.id).contains(b)))
    expect(thread(row.id).querySelector('textarea')!.value).toBe('Done, updated')
    expect(server.calls.create).not.toHaveBeenCalled()
    // the person sends: now (and only now) one create with the AI draft's anchor
    await typeAndSend(box, 'Check this figure')
    expect(server.calls.create).toHaveBeenCalledTimes(1)
    expect(server.calls.create.mock.calls[0]![0]).toMatchObject({
      body: 'Check this figure',
      anchor: { quote: 'third quarter' },
      baseVersionId: 'v1',
    })
  })
})

describe('server mode: one side panel at a time in the frame (V12-2)', () => {
  const EVENT = 'uniwork:frame-side-panel'
  const seen: Array<{ owner: string; open: boolean }> = []
  const listener = (e: Event) => seen.push((e as CustomEvent).detail)
  beforeEach(() => {
    seen.length = 0
    window.addEventListener(EVENT, listener)
  })
  afterEach(() => window.removeEventListener(EVENT, listener))

  it('announces its own open and close as the editor owner', async () => {
    const server = fakeServer()
    await mount(server, false)
    expect(seen).toEqual([])
    editor.commands.setTextSelection(rangeOf('Closing'))
    await act(async () => handle.current!.startThread())
    await flush()
    expect(seen).toContainEqual({ owner: 'editor', open: true })
    await click(el.querySelector<HTMLButtonElement>('.collab-close') ?? undefined)
    expect(seen.at(-1)).toEqual({ owner: 'editor', open: false })
  })

  it('closes itself when another owner opens, and ignores its own and close events', async () => {
    const server = fakeServer()
    const { closes } = await mount(server, true)
    await act(async () => {
      window.dispatchEvent(new CustomEvent(EVENT, { detail: { owner: 'editor', open: true } }))
      window.dispatchEvent(new CustomEvent(EVENT, { detail: { owner: 'discussion', open: false } }))
    })
    expect(closes).not.toHaveBeenCalled()
    await act(async () => {
      window.dispatchEvent(new CustomEvent(EVENT, { detail: { owner: 'discussion', open: true } }))
    })
    expect(closes).toHaveBeenCalledTimes(1)
    expect(el.querySelector('.collab-panel')).toBeNull()
  })
})

describe("server mode: the desktop poll is not the frame's (FE12-3)", () => {
  it('a window focus reloads the list on desktop and does not in the frame', async () => {
    const desktop = fakeServer()
    await mount(desktop, true)
    const before = desktop.calls.list.mock.calls.length
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(desktop.calls.list.mock.calls.length).toBeGreaterThan(before)

    act(() => root.unmount())
    root = createRoot(el)
    const frame = fakeServer()
    await mount(frame, true, 'v1', { frame: true })
    const framed = frame.calls.list.mock.calls.length
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(frame.calls.list.mock.calls.length).toBe(framed)
  })
})

describe('server mode: a lost range comes back when its text does (FE12-4)', () => {
  it('delete the paragraph, undo, Save: the comment goes out exact again', async () => {
    const server = fakeServer()
    const anchor = encodeDocxAnchor(editor.state.doc, rangeOf('third quarter'))!
    const row = server.add({ body: 'note', anchor, anchor_state: 'exact' })
    await mount(server, false)
    const block = editor.state.doc.child(0).nodeSize
    editor.commands.deleteRange({ from: block, to: block + editor.state.doc.child(1).nodeSize })
    expect(editor.state.doc.textContent).not.toContain('third quarter')
    editor.commands.undo()
    expect(editor.state.doc.textContent).toContain('third quarter')
    // one more edit elsewhere: recovery runs on a document change
    editor.commands.insertContentAt(1, 'X')
    await act(async () => server.saved('v2'))
    await flush()
    const sent = server.calls.anchors.mock.calls[0]![0].anchors
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ commentId: row.id, state: 'exact' })
    expect(sent[0].anchor).toMatchObject({ quote: 'third quarter' })
    // the highlight is back too
    expect(editor.view.dom.querySelector(`.${SERVER_COMMENT_CLASS}`)?.textContent).toBe(
      'third quarter',
    )
  })

  it('a deleted quote does not jump to another place with the same words', async () => {
    const server = fakeServer()
    const anchor = encodeDocxAnchor(editor.state.doc, rangeOf('Closing'))!
    const row = server.add({ body: 'note', anchor, anchor_state: 'exact' })
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: 'docParagraph',
      attrs: { docxIndex: null },
      content: [{ type: 'text', text: 'Closing the call.' }],
    })
    await mount(server, false)
    const first = rangeOf('Closing')
    editor.commands.deleteRange(first)
    editor.commands.insertContentAt(1, 'Y')
    await act(async () => server.saved('v2'))
    await flush()
    expect(server.calls.anchors.mock.calls[0]![0].anchors).toEqual([
      { commentId: row.id, state: 'lost', anchor },
    ])
  })
})

describe('server mode: save the document first (V12-3)', () => {
  it('shows a warn line in the panel while the version is unknown and announces it politely', async () => {
    vi.useFakeTimers()
    try {
      const server = fakeServer()
      await mount(server, true, null)
      const line = el.querySelector('.docs-server-save-first')
      expect(line?.textContent).toBe('Save first')
      expect(line?.classList.contains('collab-pnote--warn')).toBe(true)
      editor.commands.setTextSelection(rangeOf('third quarter'))
      await act(async () => handle.current!.startThread())
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(document.getElementById(COLLAB_LIVE_REGION_ID)?.textContent).toBe('Save first')
      await act(async () => server.saved('v2'))
      await flush()
      expect(el.querySelector('.docs-server-save-first')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('no line for a known version', async () => {
    await mount(fakeServer(), true, 'v1')
    expect(el.querySelector('.docs-server-save-first')).toBeNull()
  })
})

describe('server mode: the new-comment composer scrolls into view (V12-4)', () => {
  it('scrolls the new thread item so Cancel and Send are visible', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      const server = fakeServer()
      await mount(server, true)
      editor.commands.setTextSelection(rangeOf('Closing'))
      await act(async () => handle.current!.startThread())
      await flush()
      const target = el.querySelector('.collab-thread--new')
      expect(target).not.toBeNull()
      const at = scroll.mock.contexts.findIndex((c) => c === target)
      expect(at).toBeGreaterThanOrEqual(0)
      expect(scroll.mock.calls[at]![0]).toMatchObject({ block: 'nearest' })
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })
})

describe('server mode: anchors survive the reload after a Save (G819-A02a)', () => {
  /** what saveOnce does once the saved bytes are re-parsed: a whole-document setContent */
  const reloadFromSavedBytes = () => {
    const json = editor.getJSON()
    json.content?.forEach((n, i) => {
      n.attrs = { ...n.attrs, docxIndex: i }
    })
    editor.commands.setContent(json)
  }

  it('a comment range that still exists after the reload goes out exact with its range', async () => {
    const server = fakeServer()
    const anchor = encodeDocxAnchor(editor.state.doc, rangeOf('third quarter'))!
    const row = server.add({ body: 'note', anchor, anchor_state: 'exact' })
    await mount(server, false)
    reloadFromSavedBytes()
    await act(async () => server.saved('v2'))
    await flush()
    expect(server.calls.anchors).toHaveBeenCalledTimes(1)
    expect(server.calls.anchors.mock.calls[0]![0].anchors).toEqual([
      {
        commentId: row.id,
        state: 'exact',
        anchor: expect.objectContaining({ path: [1], quote: 'third quarter' }),
      },
    ])
  })

  it('an edit before the Save moves the range; the reload keeps the moved range, not the old anchor', async () => {
    const server = fakeServer()
    const anchor = encodeDocxAnchor(editor.state.doc, rangeOf('third quarter'))!
    const row = server.add({ body: 'note', anchor, anchor_state: 'exact' })
    await mount(server, false)
    editor.commands.insertContentAt(rangeOf('Revenue').from, 'Total ')
    reloadFromSavedBytes()
    await act(async () => server.saved('v2'))
    await flush()
    const sent = server.calls.anchors.mock.calls[0]![0].anchors
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ commentId: row.id, state: 'exact' })
    expect(sent[0].anchor).toMatchObject({
      path: [1],
      start: 'Total Revenue grew in the '.length,
      quote: 'third quarter',
    })
  })

  it('a range whose text is gone after the reload still goes out lost', async () => {
    const server = fakeServer()
    const anchor = encodeDocxAnchor(editor.state.doc, rangeOf('third quarter'))!
    const row = server.add({ body: 'note', anchor, anchor_state: 'exact' })
    await mount(server, false)
    const block = editor.state.doc.child(0).nodeSize
    editor.commands.deleteRange({ from: block, to: block + editor.state.doc.child(1).nodeSize })
    reloadFromSavedBytes()
    await act(async () => server.saved('v2'))
    await flush()
    expect(server.calls.anchors.mock.calls[0]![0].anchors).toEqual([
      { commentId: row.id, state: 'lost', anchor },
    ])
  })
})

describe('server mode: a comment that appears with the panel closed is re-anchored on Save (G819-A02b)', () => {
  it('a thread created on the server after the first list is in the next anchor PUT', async () => {
    const server = fakeServer()
    const first = server.add({
      body: 'first',
      anchor: encodeDocxAnchor(editor.state.doc, rangeOf('Intro'))!,
      anchor_state: 'exact',
    })
    await mount(server, false)
    // the other host comments after this editor listed; nothing here lists again while closed
    const later = server.add({
      body: 'from the other host',
      anchor: encodeDocxAnchor(editor.state.doc, rangeOf('third quarter'))!,
      anchor_state: 'exact',
    })
    await act(async () => server.saved('v2'))
    await flush()
    expect(server.calls.anchors).toHaveBeenCalledTimes(1)
    const sent = server.calls.anchors.mock.calls[0]![0]
    expect(sent.versionId).toBe('v2')
    expect(sent.anchors.map((a) => a.commentId).sort()).toEqual([first.id, later.id].sort())
    expect(sent.anchors.every((a) => a.state === 'exact')).toBe(true)
  })

  it('two receipts while the receipt list is loading send one PUT with the latest version (G819-A02 RF-4)', async () => {
    const server = fakeServer()
    server.add({
      body: 'first',
      anchor: encodeDocxAnchor(editor.state.doc, rangeOf('Intro'))!,
      anchor_state: 'exact',
    })
    await mount(server, false)
    const real = server.calls.list.getMockImplementation()!
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.calls.list.mockImplementationOnce((async (...args: unknown[]) => {
      await gate
      return (real as (...a: unknown[]) => unknown)(...args)
    }) as never)
    await act(async () => server.saved('v2'))
    await act(async () => server.saved('v3'))
    await act(async () => release())
    await flush()
    expect(server.calls.anchors).toHaveBeenCalledTimes(1)
    expect(server.calls.anchors.mock.calls[0]![0].versionId).toBe('v3')
  })
})
