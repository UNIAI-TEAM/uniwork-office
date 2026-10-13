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
import { COLLAB_LIVE_REGION_ID, collabStrings } from '@genoffice/ui/collab'
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
  const revealHandlers: Array<(p: { path: string; commentId: string }) => unknown> = []
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
    context: vi.fn(() => ok({ documentId: 'doc1', versionId: 'v1', level: 'edit', myUserId: 'me' })),
    onSaved: vi.fn((h: (p: { path: string; versionId: string }) => void) => {
      savedHandlers.push(h)
      return () => savedHandlers.splice(savedHandlers.indexOf(h), 1)
    }),
    onReveal: vi.fn((h: (p: { path: string; commentId: string }) => unknown) => {
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
    reveal: (commentId: string) => revealHandlers.map((h) => h({ path: PATH, commentId })),
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
) {
  const status = vi.fn()
  const render = (open: boolean) =>
    root.render(
      createElement(ServerCommentsHost, {
        mode: mode(server.api, versionId),
        editor,
        lang: 'en',
        panelOpen: open,
        onOpenPanel: () => render(true),
        onClosePanel: () => render(false),
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
  return { status }
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
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }),
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
    server.calls.anchors.mockImplementationOnce(() =>
      Promise.resolve({
        ok: false,
        error: { code: 'malformed', details: { code: 'anchor_version_invalid' } },
      }) as never,
    )
    await mount(server, false)
    const lists = server.calls.list.mock.calls.length
    await act(async () => server.saved('v2'))
    await flush()
    expect(server.calls.list.mock.calls.length).toBe(lists)
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

  it('a lost thread only opens: the selection does not move', async () => {
    const server = fakeServer()
    const row = server.add({
      body: 'gone',
      anchor: { format: 'docx', v: 1, path: [7], start: 0, end: 4, quote: 'nope', prefix: '', suffix: '' },
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
