/**
 * G8-12 (UNI-1407), lane decision D3: a server comment never reaches the file. A document with a
 * comment stored in the file gets a server comment through the S12 panel; the save plan stays
 * all-original and `word/comments.xml` + `word/document.xml` (with its comment ranges) come out
 * byte-identical. The in-file comment is listed read-only in the panel's "in the file" section.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { Editor } from '@tiptap/core'
import { parseDocx, saveDocx } from '@genoffice/docx-engine'
import { COLLAB_LIVE_REGION_ID, collabStrings } from '@genoffice/ui/collab'
import { buildDocx } from '../../../packages/docx-engine/tests/helpers/build-docx'
import { blocksToPmDoc, pmDocToSavePlan, type PmNode } from '../src/renderer/editor/convert'
import { editorExtensions } from '../src/renderer/editor/extensions'
import {
  ServerCommentsHost,
  type ServerCommentsHandle,
} from '../src/renderer/server-comments/ServerCommentsHost'
import type { ServerCommentsApi } from '../src/renderer/server-comments/seam'

const EN = collabStrings('en')
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
const COMMENTS_XML =
  XML_DECL +
  '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:comment w:id="7" w:author="User" w:date="2026-01-01T00:00:00Z"><w:p><w:r><w:t>file note</w:t></w:r></w:p></w:comment>' +
  '</w:comments>'
const BODY =
  '<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>' +
  '<w:commentRangeStart w:id="7"/><w:r><w:t>marked</w:t></w:r><w:commentRangeEnd w:id="7"/>' +
  '<w:r><w:commentReference w:id="7"/></w:r>' +
  '<w:r><w:t xml:space="preserve"> after the server note target</w:t></w:r></w:p>'

const nativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
let el: HTMLDivElement
let root: Root
const editors: Editor[] = []

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  sessionStorage.clear()
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
})
afterEach(() => {
  act(() => root.unmount())
  for (const e of editors.splice(0)) e.destroy()
  el.remove()
  document.getElementById(COLLAB_LIVE_REGION_ID)?.remove()
  vi.unstubAllGlobals()
})

async function flush() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      for (let k = 0; k < 5; k++) await Promise.resolve()
    })
  }
}

function fakeApi() {
  const rows: Array<Record<string, unknown>> = []
  const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value })
  const api = {
    list: vi.fn(() =>
      ok({ comments: rows.map((r) => ({ ...r })), mentions: [], list_token: `t${rows.length}`, unchanged: false }),
    ),
    create: vi.fn((i: { body: string; anchor?: Record<string, unknown> }) => {
      const row = {
        id: `s${rows.length + 1}`,
        document_id: 'doc1',
        author_id: 'me',
        parent_id: null,
        body: i.body,
        kind: 'comment',
        revision: 1,
        anchor: i.anchor ?? null,
        anchor_state: 'exact',
        created_at: '2026-10-13T10:00:00Z',
        updated_at: '2026-10-13T10:00:00Z',
        display_name: 'An',
      }
      rows.push(row)
      return ok({ comment: row })
    }),
    anchors: vi.fn(() => ok({ updated: [], skipped: [], list_token: 'x' })),
    onSaved: () => () => undefined,
    onReveal: () => () => undefined,
  }
  return api
}

describe('server comments leave the file bytes alone', () => {
  it('comments.xml and document.xml are byte-identical after a Save with a server comment', async () => {
    const bytes = await buildDocx({
      bodyXml: BODY,
      extraParts: [
        {
          path: 'word/comments.xml',
          xml: COMMENTS_XML,
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml',
        },
      ],
    })
    const parsed = await parseDocx(bytes)
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: editorExtensions,
      content: blocksToPmDoc(parsed.blocks) as never,
    })
    editors.push(editor)
    const api = fakeApi()
    const handle: { current: ServerCommentsHandle | null } = { current: null }
    await act(async () =>
      root.render(
        createElement(ServerCommentsHost, {
          mode: {
            api: api as unknown as ServerCommentsApi,
            path: '/w/a.docx',
            documentId: 'doc1',
            versionId: 'v1',
            level: 'edit',
            myUserId: 'me',
          },
          editor,
          lang: 'en',
          panelOpen: true,
          onOpenPanel: () => undefined,
          onClosePanel: () => undefined,
          onStatus: () => undefined,
          selectTextMessage: 'select',
          saveFirstMessage: 'save',
          inFileComments: parsed.comments,
          neutralAuthor: 'User (neutral)',
          handleRef: handle,
        }),
      ),
    )
    await flush()

    const text = editor.state.doc.textContent
    const at = text.indexOf('server note target')
    // +1: the first paragraph's content starts at position 1
    editor.commands.setTextSelection({ from: 1 + at, to: 1 + at + 'server note target'.length })
    await act(async () => handle.current!.startThread())
    await flush()
    const box = el.querySelector<HTMLTextAreaElement>('.collab-thread--new textarea')!
    await act(async () => {
      nativeValue.call(box, 'server only')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      box.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }),
      )
    })
    await flush()
    expect(api.create).toHaveBeenCalledTimes(1)
    expect(editor.view.dom.querySelector('.doc-server-comment')?.textContent).toBe(
      'server note target',
    )

    // the in-file comment is listed read-only (no reply / resolve / actions inside the section)
    const toggle = [...el.querySelectorAll<HTMLButtonElement>('.collab-group-toggle')].find((b) =>
      b.textContent?.includes(EN.collabInFileSection!),
    )!
    await act(async () => toggle.click())
    const inFile = el.querySelector<HTMLElement>('.collab-infile')!
    expect(inFile.textContent).toContain('file note')
    expect(inFile.textContent).toContain('User (neutral)')
    expect(inFile.querySelector('button, textarea')).toBeNull()

    const plan = pmDocToSavePlan(editor.getJSON() as PmNode, parsed.blocks)
    expect(plan.changedCount).toBe(0)
    // the editor writes comments.xml only when commentsDirty; a server comment never sets it
    const saved = await saveDocx(parsed, plan.saveBlocks, { comments: undefined })
    const [a, b] = await Promise.all([JSZip.loadAsync(bytes), JSZip.loadAsync(saved)])
    for (const part of ['word/comments.xml', 'word/document.xml']) {
      const before = await a.file(part)!.async('uint8array')
      const after = await b.file(part)!.async('uint8array')
      expect(Buffer.from(after).equals(Buffer.from(before)), part).toBe(true)
    }
  })
})
