/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { format } from '@genoffice/i18n'
import { CollabComposer } from '../src/collab/CollabComposer'
import { CollabPanel } from '../src/collab/CollabPanel'
import { formatCollabTime } from '../src/collab/CollabThread'
import { useCollabThreads, type CollabController } from '../src/collab/use-collab-threads'
import type { CollabHostState, CollabSource } from '../src/collab/types'
import { COLLAB_LIVE_REGION_ID } from '../src/collab/live-region'
import { COMPOSER_STRINGS } from './collab-composer-fixtures'
import { EN, cm, err, fakeSource, flush, host, list, type FakeSource } from './collab-kit'

let el: HTMLDivElement
let root: ReturnType<typeof createRoot>
let ctl: CollabController
let writeText: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
})

afterEach(() => {
  act(() => root.unmount())
  el.remove()
  document.getElementById(COLLAB_LIVE_REGION_ID)?.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function Harness(p: { source: CollabSource; host: CollabHostState }) {
  ctl = useCollabThreads(p.source, p.host, { strings: EN })
  return createElement(CollabPanel, {
    controller: ctl,
    strings: EN,
    renderComposer: (s) =>
      createElement('textarea', { 'data-composer': s.mode, 'aria-label': s.mode }),
  })
}

async function mount(source: FakeSource, h = host()) {
  await act(async () => {
    root.render(createElement(Harness, { source, host: h }))
    await flush()
  })
}

const $ = <T extends Element = HTMLElement>(sel: string, from: ParentNode = el) =>
  from.querySelector<T>(sel)
const btn = (label: string, from: ParentNode = document.body) =>
  [...from.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label || b.getAttribute('aria-label') === label,
  )
async function click(b: Element | undefined | null) {
  expect(b).toBeTruthy()
  await act(async () => {
    ;(b as HTMLElement).click()
    await flush()
  })
}
async function key(target: Element, k: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }))
    await flush()
  })
}
async function type(area: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    set.call(area, value)
    area.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function openMenu(threadOrComment: string) {
  const scope = $(`[data-comment-id="${threadOrComment}"]`)!
  await click($('button[aria-haspopup="menu"]', scope))
  return $('[role="menu"]', scope)!
}

describe('tombstone', () => {
  it('frame replaces body + author, no actions on it, replies stay', async () => {
    const src = fakeSource(
      list([
        cm({ id: 't', body: '', deleted_at: '2026-10-12T10:00:00Z', author_id: 'me' }),
        cm({ id: 'r', parent_id: 't', body: 'still here', display_name: 'Bo' }),
      ]),
    )
    await mount(src, host({ level: 'manage' }))
    const rootCm = $('[data-comment-id="t"]')!
    expect($('.collab-tomb', rootCm)!.textContent).toBe(EN.collabDeleted)
    expect(rootCm.querySelectorAll('button')).toHaveLength(0)
    expect($('[data-comment-id="r"]')!.textContent).toContain('still here')
    // no Reply anywhere in a deleted thread
    expect(btn(EN.collabReply, el)).toBeUndefined()
  })
})

describe('actions menu', () => {
  it('opens with focus on the first item; Esc closes and returns focus', async () => {
    const src = fakeSource(list([cm({ id: 'a', author_id: 'me', revision: 2 })]))
    await mount(src)
    const menu = await openMenu('a')
    const items = [...menu.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)
    expect(items).toEqual([EN.collabEdit, EN.collabDelete, EN.collabCopyText, EN.collabHistory])
    expect(document.activeElement?.textContent).toBe(EN.collabEdit)
    await key(document.activeElement!, 'ArrowDown')
    expect(document.activeElement?.textContent).toBe(EN.collabDelete)
    await key(document.activeElement!, 'Escape')
    expect($('[role="menu"]')).toBeNull()
    expect(document.activeElement?.getAttribute('aria-haspopup')).toBe('menu')
  })

  it('view only keeps copy, hides edit/delete/reply/resolve and history on an unedited post', async () => {
    const src = fakeSource(list([cm({ id: 'a', author_id: 'me' })]))
    await mount(src, host({ level: 'view' }))
    const menu = await openMenu('a')
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toEqual([
      EN.collabCopyText,
    ])
    expect(btn(EN.collabReply, el)).toBeUndefined()
    expect(btn(EN.collabResolve, el)).toBeUndefined()
  })

  it('copy content writes the body', async () => {
    const src = fakeSource(list([cm({ id: 'a', body: 'copy me' })]))
    await mount(src)
    const menu = await openMenu('a')
    await click(btn(EN.collabCopyText, menu))
    expect(writeText).toHaveBeenCalledWith('copy me')
  })
})

describe('delete', () => {
  it('one-step dialog; cancel restores focus; confirm removes', async () => {
    const src = fakeSource(list([cm({ id: 'a', author_id: 'me' })]))
    await mount(src)
    let menu = await openMenu('a')
    await click(btn(EN.collabDelete, menu))
    const dlg = $('[role="alertdialog"]')!
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dlg.getAttribute('aria-labelledby')!)!.textContent).toBe(
      EN.collabDeleteTitle,
    )
    expect(document.getElementById(dlg.getAttribute('aria-describedby')!)!.textContent).toBe(
      EN.collabDeleteBody,
    )
    expect(document.activeElement?.textContent).toBe(EN.collabCancel)
    await key(dlg, 'Escape')
    expect($('[role="alertdialog"]')).toBeNull()
    expect(document.activeElement?.getAttribute('aria-haspopup')).toBe('menu')
    menu = await openMenu('a')
    await click(btn(EN.collabDelete, menu))
    await click(btn(EN.collabDeleteConfirm))
    expect(src.remove).toHaveBeenCalledWith({ comment_id: 'a' })
  })

  it('a failed delete shows the action-failed line', async () => {
    const src = fakeSource(list([cm({ id: 'a', author_id: 'me' })]))
    src.remove.mockRejectedValueOnce(err('malformed'))
    await mount(src)
    await click(btn(EN.collabDelete, await openMenu('a')))
    await click(btn(EN.collabDeleteConfirm))
    expect(el.textContent).toContain(EN.collabActionFailed)
  })
})

describe('edit', () => {
  it('textarea labelled Edit; Esc or Cancel without changes closes and restores focus to the comment menu trigger', async () => {
    const src = fakeSource(list([cm({ id: 'a', author_id: 'me', body: 'old' })]))
    await mount(src)
    await click(btn(EN.collabEdit, await openMenu('a')))
    const area = $<HTMLTextAreaElement>('.collab-edit textarea')!
    expect(document.getElementById(area.getAttribute('aria-labelledby')!)!.textContent).toBe(
      EN.collabEdit,
    )
    expect(area.value).toBe('old')
    expect(document.activeElement).toBe(area)
    await key(area, 'Escape')
    expect($('.collab-edit')).toBeNull()
    expect(document.activeElement).toBe($('[data-comment-id="a"] button[aria-haspopup="menu"]'))

    await click(btn(EN.collabEdit, await openMenu('a')))
    await click(btn(EN.collabCancel, $('.collab-edit')!))
    expect($('.collab-edit')).toBeNull()
    expect(document.activeElement).toBe($('[data-comment-id="a"] button[aria-haspopup="menu"]'))
  })

  it('Esc with changes asks; Keep writing is the default and returns to the box; Discard closes and restores focus to the comment menu trigger', async () => {
    const src = fakeSource(list([cm({ id: 'a', author_id: 'me', body: 'old' })]))
    await mount(src)
    await click(btn(EN.collabEdit, await openMenu('a')))
    const area = $<HTMLTextAreaElement>('.collab-edit textarea')!
    await type(area, 'new text')
    await key(area, 'Escape')
    const dlg = $('[role="alertdialog"]')!
    expect(dlg.textContent).toContain(EN.collabDiscardTitle)
    expect(document.activeElement?.textContent).toBe(EN.collabKeepWriting)
    await click(btn(EN.collabKeepWriting))
    expect(document.activeElement).toBe(area)
    expect(area.value).toBe('new text')
    await key(area, 'Escape')
    await click(btn(EN.collabDiscard))
    expect($('.collab-edit')).toBeNull()
    expect(src.update).not.toHaveBeenCalled()
    expect(document.activeElement).toBe($('[data-comment-id="a"] button[aria-haspopup="menu"]'))
  })

  it('Save (button and Ctrl+Enter) sends the update and restores focus to the comment menu trigger', async () => {
    const src = fakeSource(list([cm({ id: 'a', author_id: 'me', body: 'old' })]))
    await mount(src)
    await click(btn(EN.collabEdit, await openMenu('a')))
    await type($<HTMLTextAreaElement>('.collab-edit textarea')!, 'new')
    await click(btn(EN.collabSave))
    expect(src.update).toHaveBeenCalledWith({ comment_id: 'a', body: 'new' })
    expect($('.collab-edit')).toBeNull()
    expect(document.activeElement).toBe($('[data-comment-id="a"] button[aria-haspopup="menu"]'))

    await click(btn(EN.collabEdit, await openMenu('a')))
    const area2 = $<HTMLTextAreaElement>('.collab-edit textarea')!
    await type(area2, 'newer')
    await key(area2, 'Enter', { ctrlKey: true })
    expect(src.update).toHaveBeenLastCalledWith({ comment_id: 'a', body: 'newer' })
    expect($('.collab-edit')).toBeNull()
    expect(document.activeElement).toBe($('[data-comment-id="a"] button[aria-haspopup="menu"]'))
  })

  it('auto-grows the edit textarea to fit multi-line content up to max-height with scroll (V14-11)', async () => {
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLTextAreaElement) {
        return Math.max(56, this.value.split('\n').length * 22 + 12)
      },
    })
    const src = fakeSource(
      list([cm({ id: 'a', author_id: 'me', body: 'line 1\nline 2\nline 3\nline 4\nline 5' })]),
    )
    await mount(src)
    await click(btn(EN.collabEdit, await openMenu('a')))
    const area = $<HTMLTextAreaElement>('.collab-edit textarea')!
    expect(Number.parseInt(area.style.height, 10)).toBeGreaterThanOrEqual(120)
    await type(area, Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join('\n'))
    expect(area.style.height).toBe('200px')
    const css = readFileSync(`${__dirname}/../src/collab/collab.css`, 'utf8')
    const taAt = css.indexOf('.collab-textarea {')
    const ta = css.slice(taAt, css.indexOf('}', taAt))
    expect(ta).toMatch(/max-height:\s*200px/)
    expect(ta).toMatch(/overflow-y:\s*auto/)
  })
})

describe('history', () => {
  const rev = (n: number, body: string, by: string | null = 'u1') => ({
    id: `v${n}`,
    revision: n,
    body,
    created_by_id: by,
    created_at: '2026-10-12T09:00:00Z',
  })

  it('opens from the (edited) mark, newest first after Current version; closing returns focus', async () => {
    const src = fakeSource(list([cm({ id: 'a', revision: 3, body: 'three' })]))
    src.revisions.mockResolvedValueOnce({ revisions: [rev(1, 'one'), rev(2, 'two')] })
    await mount(src, host({ level: 'view' }))
    const edited = btn(EN.collabEditedMark, el)!
    edited.focus()
    await click(edited)
    const hist = $('.collab-hist')!
    expect($('h4', hist)!.textContent).toBe(EN.collabHistoryTitle)
    const rows = [...hist.querySelectorAll('li')].map((li) => li.textContent)
    expect(rows[0]).toContain(EN.collabHistoryCurrent)
    expect(rows[0]).toContain('three')
    expect(rows[1]).toContain('Ann Lee, ')
    expect(rows[1]).toContain('two')
    expect(rows[2]).toContain('one')
    await click(btn('Close Edit history', hist))
    expect($('.collab-hist')).toBeNull()
    expect(document.activeElement).toBe(edited)
  })

  it('empty -> sentence; error -> sentence + retry', async () => {
    const src = fakeSource(list([cm({ id: 'a', revision: 2 })]))
    await mount(src)
    await click(btn(EN.collabHistory, await openMenu('a')))
    expect($('.collab-hist')!.textContent).toContain(EN.collabHistoryEmpty)
    await click(btn('Close Edit history'))
    src.revisions.mockRejectedValueOnce(err('internal'))
    src.revisions.mockResolvedValueOnce({ revisions: [rev(1, 'zero')] })
    await click(btn(EN.collabHistory, await openMenu('a')))
    expect($('.collab-hist')!.textContent).toContain(EN.collabHistoryError)
    await click(btn(EN.collabRetry, $('.collab-hist')!))
    expect(src.revisions).toHaveBeenCalledTimes(3)
  })

  it('tombstone (409 comment_deleted) -> no history, the deleted frame shows', async () => {
    const src = fakeSource(list([cm({ id: 'a', revision: 2 })]))
    src.revisions.mockRejectedValueOnce(err('conflict', 'comment_deleted'))
    await mount(src)
    src.list.mockResolvedValueOnce(
      list([cm({ id: 'a', body: '', deleted_at: 'x' }), cm({ id: 'r', parent_id: 'a' })], 't2'),
    )
    await click(btn(EN.collabHistory, await openMenu('a')))
    expect($('.collab-hist')).toBeNull()
    expect($('[data-comment-id="a"] .collab-tomb')!.textContent).toBe(EN.collabDeleted)
  })
})

describe('resolve / reply / conflict', () => {
  it('resolve keeps focus on the same button after the thread moves group', async () => {
    const src = fakeSource(list([cm({ id: 'a' }), cm({ id: 'b' })], 't1'))
    await mount(src)
    await act(async () => ctl.setResolvedOpen(true))
    src.list.mockResolvedValueOnce(
      list([cm({ id: 'a', resolved_at: '2026-10-12T11:00:00Z' }), cm({ id: 'b' })], 't2'),
    )
    const b = $<HTMLButtonElement>('[data-resolve-for="a"]')!
    b.focus()
    await click(b)
    expect(src.resolve).toHaveBeenCalledWith({ comment_id: 'a' })
    const now = $<HTMLButtonElement>('[data-resolve-for="a"]')!
    expect(now.textContent).toBe(EN.collabReopen)
    expect(document.activeElement).toBe(now)
  })

  it('reply opens the composer slot; conflict keeps it and shows the deleted message + copy', async () => {
    const src = fakeSource(list([cm({ id: 'a' })], 't1'))
    let submit!: (b: string) => Promise<void>
    await act(async () => {
      root.render(
        createElement(function H() {
          ctl = useCollabThreads(src, host(), { strings: EN })
          return createElement(CollabPanel, {
            controller: ctl,
            strings: EN,
            renderComposer: (s) => {
              submit = s.onSubmit
              return createElement('textarea', { 'data-composer': s.mode })
            },
          })
        }),
      )
      await flush()
    })
    await click(btn(EN.collabReply, el))
    expect($('[data-composer="reply"]')).not.toBeNull()
    src.create.mockRejectedValueOnce(err('conflict', 'comment_deleted'))
    src.list.mockResolvedValueOnce(list([], 't2'))
    await act(async () => {
      await submit('keep me').catch(() => {})
      await flush()
    })
    // the composer (and its draft) stays under the deleted thread
    expect($('[data-thread-id="a"] [data-composer="reply"]')).not.toBeNull()
    const box = $('.collab-tdel')!
    expect(box.textContent).toContain(EN.collabCommentDeleted)
    await click(btn(EN.collabCopyText, box))
    expect(writeText).toHaveBeenCalledWith('keep me')
  })

  it('reply composer: Cancel, Discard, and Send (button and Ctrl+Enter) restore focus to the Reply button', async () => {
    const src = fakeSource(list([cm({ id: 'a' })], 't1'))
    await act(async () => {
      root.render(
        createElement(function H() {
          ctl = useCollabThreads(src, host(), { strings: EN })
          return createElement(CollabPanel, {
            controller: ctl,
            strings: EN,
            renderComposer: (slot) =>
              createElement(CollabComposer, {
                ...slot,
                strings: { ...EN, ...COMPOSER_STRINGS },
              }),
          })
        }),
      )
      await flush()
    })

    const replyBtn = () => btn(EN.collabReply, $('[data-thread-id="a"]')!)!

    // 1. Empty reply Cancel (via Escape) -> focus returns to Reply button
    replyBtn().focus()
    await click(replyBtn())
    let replyTa = $<HTMLTextAreaElement>('[data-thread-id="a"] textarea')!
    expect(document.activeElement).toBe(replyTa)
    await key(replyTa, 'Escape')
    expect($('[data-thread-id="a"] textarea')).toBeNull()
    expect(document.activeElement).toBe(replyBtn())

    // 2. Dirty reply Discard -> focus returns to Reply button
    await click(replyBtn())
    replyTa = $<HTMLTextAreaElement>('[data-thread-id="a"] textarea')!
    await type(replyTa, 'draft reply')
    await click(btn(EN.collabCancel, $('[data-thread-id="a"]')!))
    await click(btn(EN.collabDiscard))
    expect($('[data-thread-id="a"] textarea')).toBeNull()
    expect(document.activeElement).toBe(replyBtn())

    // 3. Reply Send via button -> focus returns to Reply button
    await click(replyBtn())
    replyTa = $<HTMLTextAreaElement>('[data-thread-id="a"] textarea')!
    await type(replyTa, 'first reply')
    await click(btn(EN.collabSend, $('[data-thread-id="a"]')!))
    expect(src.create).toHaveBeenCalledWith({
      kind: 'comment',
      parent_id: 'a',
      body: 'first reply',
    })
    expect($('[data-thread-id="a"] textarea')).toBeNull()
    expect(document.activeElement).toBe(replyBtn())

    // 4. Reply Send via Ctrl+Enter -> focus returns to Reply button
    await click(replyBtn())
    replyTa = $<HTMLTextAreaElement>('[data-thread-id="a"] textarea')!
    await type(replyTa, 'second reply')
    await key(replyTa, 'Enter', { ctrlKey: true })
    expect(src.create).toHaveBeenLastCalledWith({
      kind: 'comment',
      parent_id: 'a',
      body: 'second reply',
    })
    expect($('[data-thread-id="a"] textarea')).toBeNull()
    expect(document.activeElement).toBe(replyBtn())
  })
})

describe('visual r1 fixes (panel / thread)', () => {
  const lostAnchor = { format: 'docx', v: 1, start: 1, path: [0], end: 4, quote: 'quote 1' }

  it('a comment_deleted conflict scrolls the deleted frame into view and keeps focus in the composer', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
      writable: true,
    })
    const src = fakeSource(list([cm({ id: 'a' })], 't1'))
    let submit!: (b: string) => Promise<void>
    await act(async () => {
      root.render(
        createElement(function H() {
          ctl = useCollabThreads(src, host(), { strings: EN })
          return createElement(CollabPanel, {
            controller: ctl,
            strings: EN,
            renderComposer: (s) => {
              submit = s.onSubmit
              return createElement('textarea', { 'data-composer': s.mode })
            },
          })
        }),
      )
      await flush()
    })
    await click(btn(EN.collabReply, el))
    const area = $<HTMLTextAreaElement>('[data-composer="reply"]')!
    area.focus()
    scrollIntoView.mockClear()
    src.create.mockRejectedValueOnce(err('conflict', 'comment_deleted'))
    src.list.mockResolvedValueOnce(list([], 't2'))
    await act(async () => {
      await submit('keep me').catch(() => {})
      await flush()
    })
    const tomb = $('[data-thread-id="a"] [data-deleted-for="a"]')!
    expect(tomb).not.toBeNull()
    const targets = scrollIntoView.mock.contexts as Element[]
    expect(targets).toContain(tomb)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    // the composer keeps focus; the frame is only scrolled to
    expect(document.activeElement).toBe($('[data-composer="reply"]'))
    // the conflict line stays next to the composer, after it
    const slot = $('[data-thread-id="a"] .collab-comp-slot')!
    expect(slot.nextElementSibling?.classList.contains('collab-tdel')).toBe(true)
  })

  it('a lost anchor leaves no empty slot in the action row', async () => {
    const src = fakeSource(
      list([cm({ id: 'l', author_id: 'me', anchor: lostAnchor, anchor_state: 'lost' })]),
    )
    await act(async () => {
      root.render(
        createElement(function H() {
          ctl = useCollabThreads(src, host(), {
            strings: EN,
            adapter: { order: (a) => a.start as number, locate: () => true, goTo: vi.fn() },
          })
          return createElement(CollabPanel, {
            controller: ctl,
            strings: EN,
            renderComposer: () => null,
          })
        }),
      )
      await flush()
    })
    const row = $('[data-comment-id="l"] .collab-acts')!
    expect(btn(EN.collabGoToAnchor, row)).toBeUndefined()
    expect(row.children.length).toBeGreaterThan(0)
    for (const child of row.children) {
      expect(
        (child.textContent ?? '').trim() !== '' || child.querySelector('button') !== null,
      ).toBe(true)
    }
  })

  it('under a coarse pointer the Edited link keeps its 44px hit area without growing the row', () => {
    const css = readFileSync(`${__dirname}/../src/collab/collab.css`, 'utf8')
    const coarse = css.slice(css.indexOf('@media (pointer: coarse)'))
    expect(coarse).toMatch(/\.collab-cmh \.collab-link\s*\{[^}]*min-height: 24px/)
    expect(coarse).toMatch(/\.collab-cmh \.collab-link::after\s*\{[^}]*content: ''[^}]*inset:/)
  })

  it('keeps the comment head row (.collab-cmh) on one line at 300px even with the Edited chip (V14-07)', () => {
    const css = readFileSync(`${__dirname}/../src/collab/collab.css`, 'utf8')
    const cmhAt = css.indexOf('.collab-cmh {')
    const cmh = css.slice(cmhAt, css.indexOf('}', cmhAt))
    expect(cmh).toMatch(/flex-wrap:\s*nowrap/)
    expect(css).toMatch(/\.collab-cmh \.collab-link\s*\{[^}]*min-width:\s*0/)
    expect(css).toMatch(/\.collab-cmh \.collab-link\s*\{[^}]*text-overflow:\s*ellipsis/)
    expect(css).toMatch(/\.collab-cmh \.collab-link\s*\{[^}]*white-space:\s*nowrap/)
    const dtAt = css.indexOf('.collab-dt {')
    const dt = css.slice(dtAt, css.indexOf('}', dtAt))
    expect(dt).toMatch(/white-space:\s*nowrap/)
  })

  it('keeps the thread action row (.collab-acts) on one line at 300px without wrapping (V14-08)', () => {
    const css = readFileSync(`${__dirname}/../src/collab/collab.css`, 'utf8')
    const actsAt = css.indexOf('.collab-acts {')
    const acts = css.slice(actsAt, css.indexOf('}', actsAt))
    expect(acts).toMatch(/flex-wrap:\s*nowrap/)
    expect(css).toMatch(/\.collab-acts \.collab-link\s*\{[^}]*min-width:\s*0/)
    expect(css).toMatch(/\.collab-acts \.collab-link\s*\{[^}]*text-overflow:\s*ellipsis/)
    expect(css).toMatch(/\.collab-acts \.collab-link\s*\{[^}]*white-space:\s*nowrap/)
  })
})

/* UNI-1970 (web dbc054a69) + UNI-1969 edit box (web d6aa9f82c): thread parity rows */

/** the declarations of a single-selector collab.css rule; the selector must appear exactly once */
const cssRule = (sel: string): string => {
  const text = readFileSync(`${__dirname}/../src/collab/collab.css`, 'utf8')
  const at = text.indexOf(`${sel} {`)
  expect(at, `rule ${sel}`).toBeGreaterThanOrEqual(0)
  return text.slice(at, text.indexOf('}', at))
}

describe('avatars (UNI-1970 A)', () => {
  it('avatar_url renders a hidden img; initials otherwise; replies are smaller', async () => {
    const src = fakeSource(
      list([
        cm({ id: 'a', display_name: 'Ann Lee', avatar_url: 'https://x/ann.png' }),
        cm({ id: 'r', parent_id: 'a', display_name: 'Bo Han' }),
      ]),
    )
    await mount(src)
    const av = $('[data-comment-id="a"] .collab-av')!
    expect(av.getAttribute('aria-hidden')).toBe('true')
    const img = av.querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://x/ann.png')
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
    const replyAv = $('[data-comment-id="r"] .collab-av')!
    expect(replyAv.querySelector('img')).toBeNull()
    expect(replyAv.textContent).toBe('BH')
    // web lg/md sizes: root 32px, reply 24px — only on thread rows (data-comment-id);
    // the base rule keeps the old 22px so in-file lists stay unchanged
    expect(cssRule('.collab-av')).toMatch(/width:\s*22px/)
    expect(cssRule('.collab-av')).toMatch(/height:\s*22px/)
    expect(cssRule('.collab-av')).toMatch(/font-size:\s*10px/)
    expect(cssRule('.collab-cm[data-comment-id] .collab-av')).toMatch(/width:\s*32px/)
    expect(cssRule('.collab-cm[data-comment-id] .collab-av')).toMatch(/height:\s*32px/)
    expect(cssRule('.collab-cm--reply[data-comment-id] .collab-av')).toMatch(/width:\s*24px/)
    expect(cssRule('.collab-cm--reply[data-comment-id] .collab-av')).toMatch(/height:\s*24px/)
    expect(cssRule('.collab-av img')).toMatch(/object-fit:\s*cover/)
  })

  it('a photo that fails to load falls back to initials (CSP blocks remote img-src)', async () => {
    const src = fakeSource(
      list([cm({ id: 'a', display_name: 'Ann Lee', avatar_url: 'https://x/ann.png' })]),
    )
    await mount(src)
    const av = $('[data-comment-id="a"] .collab-av')!
    const img = av.querySelector('img')!
    await act(async () => {
      img.dispatchEvent(new Event('error'))
      await flush()
    })
    expect(av.querySelector('img')).toBeNull()
    expect(av.textContent).toBe('AL')
  })
})

describe('edited mark + history gate (UNI-1970 B)', () => {
  it('edited post: muted (edited) mark toggles history, full Edited · time in title', async () => {
    const c = cm({ id: 'a', revision: 2 })
    const src = fakeSource(list([c]))
    await mount(src)
    const item = $('[data-comment-id="a"]')!
    const mark = btn(EN.collabEditedMark, item)!
    expect(mark).toBeTruthy()
    expect(mark.className).toContain('collab-edited')
    // the full stamp is the tooltip/aria, not the text
    expect(mark.getAttribute('title')).toBe(
      format(EN.collabEdited, { time: formatCollabTime(c.updated_at, 'en') }),
    )
    expect(cssRule('.collab-cmh .collab-edited')).toMatch(/color:\s*var\(--text-secondary\)/)
    mark.focus()
    await click(mark)
    expect(mark.getAttribute('aria-expanded')).toBe('true')
    expect($('.collab-hist')).not.toBeNull()
    await click(btn('Close Edit history'))
    expect(document.activeElement).toBe(mark)
    // the menu still offers History for an edited post
    const menu = await openMenu('a')
    expect(btn(EN.collabHistory, menu)).toBeTruthy()
  })

  it('never-edited post: no mark, no History menu item', async () => {
    const src = fakeSource(list([cm({ id: 'a' })]))
    await mount(src, host({ level: 'manage' }))
    expect(btn(EN.collabEditedMark, el)).toBeUndefined()
    const menu = await openMenu('a')
    expect(btn(EN.collabCopyText, menu)).toBeTruthy()
    expect(btn(EN.collabHistory, menu)).toBeUndefined()
  })
})

describe('reply layout + action row (UNI-1970 C/D)', () => {
  it('replies sit under one left rule; per-reply border/card padding gone; body indents', async () => {
    const src = fakeSource(
      list([cm({ id: 'a' }), cm({ id: 'r', parent_id: 'a' }), cm({ id: 'r2', parent_id: 'a' })]),
    )
    await mount(src)
    // the rule lives on the list, web: ul = ml-7 mr-3 space-y-1 border-l pl-3
    expect(cssRule('.collab-replies')).toMatch(/border-left:\s*1px solid var\(--border\)/)
    const reply = cssRule('.collab-replies .collab-cm--reply')
    expect(reply).toMatch(/border-left:\s*0/)
    expect(reply).toMatch(/margin-left:\s*0/)
    expect(reply).toMatch(/padding:\s*4px 0/)
    // web pl-10 root / pl-8 reply: the body column indents under the author name
    expect(cssRule('.collab-cm-indent')).toMatch(/padding-left:\s*40px/)
    expect(cssRule('.collab-cm--reply .collab-cm-indent')).toMatch(/padding-left:\s*32px/)
    const rc = $('[data-comment-id="r"]')!
    expect(rc.querySelector(':scope > .collab-cm-indent .collab-bd')).not.toBeNull()
    expect(rc.querySelector(':scope > .collab-cm-indent .collab-acts')).not.toBeNull()
  })

  it('in-file rows (no data-comment-id, no .collab-replies) keep the old look', () => {
    // docs/sheets/slides render li.collab-thread > .collab-cm + .collab-cm.collab-cm--reply
    // siblings: the root/reply separator, the reply indent and the right-aligned date
    // come from these rules, so the web-parity overrides must not reach them
    expect(cssRule('.collab-cm + .collab-cm')).toMatch(/border-top:\s*1px solid var\(--border\)/)
    const inFileReply = cssRule('.collab-cm--reply')
    expect(inFileReply).toMatch(/margin-left:\s*14px/)
    expect(inFileReply).toMatch(/padding-left:\s*10px/)
    expect(inFileReply).toMatch(/border-left:\s*2px solid var\(--border\)/)
    expect(cssRule('.collab-dt')).toMatch(/margin-left:\s*auto/)
    // only thread rows (they carry data-comment-id) get the left-hugging time
    expect(cssRule('.collab-cm[data-comment-id] .collab-dt')).toMatch(/margin-left:\s*0/)
  })

  it('the action row matches the web compact spacing (mt-1 -ml-2)', () => {
    const acts = cssRule('.collab-acts')
    expect(acts).toMatch(/margin-top:\s*1px/)
    expect(acts).toMatch(/margin-left:\s*-8px/)
  })
})

describe('edit box mentions (UNI-1969, web d6aa9f82c)', () => {
  const TOKEN = '[@Ann Lee](mention://member/01HF7YAT31JFKSMW2D3JRP4NQA)'

  it('shows @Name, an untouched save is byte-identical, edits keep the id', async () => {
    const body = `ping ${TOKEN} done`
    const src = fakeSource(list([cm({ id: 'a', author_id: 'me', body })]))
    await mount(src)
    await click(btn(EN.collabEdit, await openMenu('a')))
    const area = $<HTMLTextAreaElement>('.collab-edit textarea')!
    expect(area.value).toBe('ping @Ann Lee done')
    // untouched save sends the token body verbatim
    await click(btn(EN.collabSave))
    expect(src.update).toHaveBeenCalledWith({ comment_id: 'a', body })
    // appending text leaves the mention range intact -> same id back on the wire
    await click(btn(EN.collabEdit, await openMenu('a')))
    await type($<HTMLTextAreaElement>('.collab-edit textarea')!, 'ping @Ann Lee done!')
    await click(btn(EN.collabSave))
    expect(src.update).toHaveBeenLastCalledWith({
      comment_id: 'a',
      body: `ping ${TOKEN} done!`,
    })
    // a mention cut short stays plain text (like chat)
    await click(btn(EN.collabEdit, await openMenu('a')))
    await type($<HTMLTextAreaElement>('.collab-edit textarea')!, 'ping @Ann done')
    await click(btn(EN.collabSave))
    expect(src.update).toHaveBeenLastCalledWith({ comment_id: 'a', body: 'ping @Ann done' })
  })
})
