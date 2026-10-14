/** @vitest-environment jsdom */
import { act, createElement, useLayoutEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollabComposer } from '../src/collab/CollabComposer'
import { CollabPanel, type CollabPanelProps } from '../src/collab/CollabPanel'
import type { CollabComposerSlot } from '../src/collab/CollabThread'
import {
  useCollabThreads,
  type CollabController,
  type CollabControllerOptions,
} from '../src/collab/use-collab-threads'
import type { CollabAnchorAdapter, CollabHostState, CollabSource } from '../src/collab/types'
import { COLLAB_LIVE_REGION_ID } from '../src/collab/live-region'
import { COMPOSER_STRINGS } from './collab-composer-fixtures'
import {
  EN,
  UNCHANGED,
  cm,
  err,
  fakeSource,
  flush,
  host,
  list,
  type FakeSource,
} from './collab-kit'

let el: HTMLDivElement
let root: ReturnType<typeof createRoot>
let ctl: CollabController
let slots: CollabComposerSlot[]

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  slots = []
})

afterEach(() => {
  act(() => root.unmount())
  el.remove()
  document.getElementById(COLLAB_LIVE_REGION_ID)?.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const renderComposer = (s: CollabComposerSlot): ReactNode => {
  slots.push(s)
  return createElement('textarea', { 'data-composer': s.mode, 'aria-label': s.mode })
}

function Harness(p: {
  source: CollabSource
  host: CollabHostState
  opts?: CollabControllerOptions
  panel?: Partial<CollabPanelProps>
}) {
  ctl = useCollabThreads(p.source, p.host, { strings: EN, ...p.opts })
  return createElement(CollabPanel, {
    controller: ctl,
    strings: EN,
    onClose: () => {},
    renderComposer,
    ...p.panel,
  })
}

async function mount(
  source: FakeSource,
  h = host(),
  opts: CollabControllerOptions = {},
  panel: Partial<CollabPanelProps> = {},
) {
  await act(async () => {
    root.render(createElement(Harness, { source, host: h, opts, panel }))
    await flush()
  })
}

async function reloadWith(src: FakeSource, next: ReturnType<typeof list>) {
  src.list.mockResolvedValueOnce(next)
  await act(async () => {
    await ctl.reload()
    await flush()
  })
}

const $ = <T extends Element = HTMLElement>(sel: string) => el.querySelector<T>(sel)
const $$ = (sel: string) => [...el.querySelectorAll<HTMLElement>(sel)]
const docx = (start: number) => ({
  format: 'docx',
  v: 1,
  start,
  path: [0],
  end: start + 3,
  quote: `quote ${start}`,
})
const ad = (): CollabAnchorAdapter => ({
  order: (a) => a.start as number,
  locate: () => true,
  goTo: vi.fn(),
})

describe('S12 structure and ARIA', () => {
  it('aside labelled by its title; list/listitem labelled by author + anchor ids; close label', async () => {
    const src = fakeSource(list([cm({ id: 'a', anchor: docx(1), display_name: 'Ann Lee' })]))
    await mount(src, host(), { adapter: ad() })
    const aside = $('aside')!
    const title = document.getElementById(aside.getAttribute('aria-labelledby')!)!
    expect(title.textContent).toBe('Comments')
    expect($('button[aria-label="Close Comments"]')).not.toBeNull()
    const ul = $('ul[role="list"]')!
    const item = ul.querySelector('[role="listitem"]')!
    const names = item
      .getAttribute('aria-labelledby')!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
    expect(names).toEqual(['Ann Lee', 'Text: “quote 1”'])
    expect(item.querySelector('h3[tabindex="-1"]')).not.toBeNull()
  })

  it('stale / lost / resolved are words in the accessible name', async () => {
    const src = fakeSource(list([cm({ id: 'l', anchor: docx(1), anchor_state: 'lost' })]))
    await mount(src)
    const item = $('[role="listitem"]')!
    const label = item
      .getAttribute('aria-labelledby')!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
      .join(' | ')
    expect(label).toContain(EN.collabAnchorLost)
    // lost: no Go to location
    expect($$('button').some((b) => b.textContent === EN.collabGoToAnchor)).toBe(false)
  })

  it('resolved group is a disclosure with the count', async () => {
    const src = fakeSource(
      list([cm({ id: 'a' }), cm({ id: 'r', resolved_at: '2026-10-12T10:00:00Z' })]),
    )
    await mount(src)
    const btn = $$('button').find((b) => b.textContent?.includes('Resolved · 1'))!
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    const list2 = document.getElementById(btn.getAttribute('aria-controls')!)!
    expect(list2.hidden).toBe(true)
    await act(async () => btn.click())
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(list2.hidden).toBe(false)
    expect(list2.querySelectorAll('[data-thread-id="r"]')).toHaveLength(1)
  })

  it('in-file section: disclosure + hint, comment kind only', async () => {
    const src = fakeSource(list([]))
    await mount(
      src,
      host(),
      {},
      { inFile: { count: 2, content: createElement('p', null, 'in file') } },
    )
    const btn = $$('button').find((b) => b.textContent?.includes('Comments in the file · 2'))!
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    await act(async () => btn.click())
    expect(el.textContent).toContain(EN.collabInFileHint)
    expect(el.textContent).toContain('in file')
  })

  it('reply-count disclosure controls the replies list', async () => {
    const src = fakeSource(list([cm({ id: 'a' }), cm({ id: 'r1', parent_id: 'a' })]))
    await mount(src)
    const btn = $$('button').find((b) => b.textContent === 'Replies: 1')!
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    await act(async () => btn.click())
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById(btn.getAttribute('aria-controls')!)!.hidden).toBe(true)
  })
})

describe('states', () => {
  it('loading: skeleton + hidden sentence, no composer', async () => {
    const src = fakeSource()
    src.list.mockReturnValueOnce(new Promise(() => {}))
    await mount(src, host({ kind: 'discussion' }))
    expect($('aside')!.getAttribute('aria-busy')).toBe('true')
    expect($('.collab-sr')!.textContent).toBe(EN.collabLoading)
    expect($('[data-composer]')).toBeNull()
  })

  it('load error: message + retry', async () => {
    const src = fakeSource()
    src.list.mockRejectedValueOnce(err('internal'))
    await mount(src)
    expect(el.textContent).toContain(EN.collabLoadError)
    src.list.mockResolvedValueOnce(list([cm({ id: 'a' })]))
    const retry = $$('button').find((b) => b.textContent === EN.collabRetry)!
    await act(async () => {
      retry.click()
      await flush()
    })
    expect($('[data-thread-id="a"]')).not.toBeNull()
  })

  it('no access: message replaces the panel', async () => {
    const src = fakeSource()
    src.list.mockRejectedValueOnce(err('forbidden'))
    await mount(src, host({ kind: 'discussion' }))
    expect(el.textContent).toContain(EN.collabNoAccess)
    expect($('[data-composer]')).toBeNull()
  })

  it('empty: comments invite without composer; discussion invite + composer at the bottom', async () => {
    await mount(fakeSource(list([])))
    expect(el.textContent).toContain(EN.collabEmptyComments)
    expect($('[data-composer]')).toBeNull()
    await mount(fakeSource(list([])), host({ kind: 'discussion', documentId: 'd2' }))
    expect(el.textContent).toContain(EN.collabEmptyDiscussion)
    expect($('[data-composer="discussion"]')).not.toBeNull()
  })

  it('offline after data: status line, Send disabled with a reason pointing at it', async () => {
    const src = fakeSource(list([], 't'))
    await mount(src, host({ kind: 'discussion' }))
    src.list.mockRejectedValueOnce(err('network'))
    slots = []
    await act(async () => {
      await ctl.reload()
    })
    const line = $('.collab-pnote')!
    expect(line.textContent).toBe(EN.collabOffline)
    const last = slots[slots.length - 1]!
    expect(last.disabledReason).toBe('status')
    expect(last.statusLineId).toBe(line.id)
  })

  it('Send describes the connection status, never an S15 notice', async () => {
    const src = fakeSource(list([cm({ id: 'a' })], 't'))
    await mount(src, host({ kind: 'discussion' }))
    await act(async () => {
      await ctl.reveal('zzz')
      await flush()
    })
    src.list.mockRejectedValueOnce(err('network'))
    slots = []
    await act(async () => {
      await ctl.reload()
    })
    const lines = $$('.collab-pnote')
    expect(lines.map((l) => l.textContent)).toEqual([EN.collabDiscussionDeleted, EN.collabOffline])
    expect(new Set(lines.map((l) => l.id)).size).toBe(2)
    const last = slots[slots.length - 1]!
    expect(last.disabledReason).toBe('status')
    expect(last.statusLineId).toBe(lines[1]!.id)
    expect(last.statusLineId).not.toBe(lines[0]!.id)
  })

  it('view only: badge + line, no composer, no write actions (hidden, not aria-disabled)', async () => {
    const src = fakeSource(list([cm({ id: 'a', author_id: 'me', anchor: docx(1) })]))
    await mount(src, host({ level: 'view' }), { adapter: ad() })
    expect($('.collab-badge')!.textContent).toBe(EN.collabViewOnlyBadge)
    expect($('.collab-pnote')!.textContent).toBe(EN.collabViewOnly)
    const labels = $$('button').map((b) => b.textContent)
    expect(labels).not.toContain(EN.collabReply)
    expect(labels).not.toContain(EN.collabResolve)
    expect(labels).toContain(EN.collabGoToAnchor)
    expect($('[aria-disabled]')).toBeNull()
  })

  it('new root thread: composer at its anchor position', async () => {
    const src = fakeSource(
      list([cm({ id: 'a', anchor: docx(1) }), cm({ id: 'b', anchor: docx(9) })]),
    )
    await mount(src, host(), { adapter: ad() })
    await act(async () => ctl.startThread({ anchor: docx(5), base_version_id: 'v1' }))
    const items = $$('ul.collab-list > li')
    expect(items.map((li) => li.dataset.threadId ?? 'new')).toEqual(['a', 'new', 'b'])
    expect(items[1]!.querySelector('[data-composer="root"]')).not.toBeNull()
    const slot = slots.find((s) => s.mode === 'root')!
    await act(async () => {
      await slot.onSubmit('hello')
      await flush()
    })
    expect(src.create).toHaveBeenCalledWith({
      kind: 'comment',
      body: 'hello',
      anchor: docx(5),
      base_version_id: 'v1',
    })
  })

  it('new root thread (real composer): empty Cancel button and first Esc close composer (Esc still reaches the host); second Esc falls through to host', async () => {
    const src = fakeSource(list([cm({ id: 'a', anchor: docx(1) })]))
    await mount(
      src,
      host(),
      { adapter: ad() },
      {
        renderComposer: (slot) =>
          createElement(CollabComposer, { ...slot, strings: { ...EN, ...COMPOSER_STRINGS } }),
      },
    )

    await act(async () => ctl.startThread({ anchor: docx(5), base_version_id: 'v1' }))
    const newCard = $('.collab-thread--new')!
    expect(newCard).not.toBeNull()
    const cancelBtn = [...newCard.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === EN.collabCancel,
    )!
    expect(cancelBtn).toBeTruthy()
    await act(async () => cancelBtn.click())
    expect($('.collab-thread--new')).toBeNull()

    await act(async () => ctl.startThread({ anchor: docx(5), base_version_id: 'v1' }))
    const ta = $<HTMLTextAreaElement>('.collab-thread--new textarea')!
    expect(ta).not.toBeNull()
    const hostEsc = vi.fn()
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) hostEsc()
    })
    const firstEsc = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      ta.dispatchEvent(firstEsc)
    })
    expect(firstEsc.defaultPrevented).toBe(false)
    expect(hostEsc).toHaveBeenCalledTimes(1)
    expect($('.collab-thread--new')).toBeNull()

    const secondEsc = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      $('aside')!.dispatchEvent(secondEsc)
    })
    expect(secondEsc.defaultPrevented).toBe(false)
    expect(hostEsc).toHaveBeenCalledTimes(2)
  })
})

describe('focus', () => {
  it('a host that closes the pane on the same unconsumed Esc leaves no error and no focus on a detached node', async () => {
    const src = fakeSource(list([cm({ id: 'a', anchor: docx(1) })], 't1'))
    const opener = document.createElement('button')
    document.body.append(opener)
    const errors: unknown[] = []
    const onErr = (ev: ErrorEvent) => errors.push(ev.error)
    window.addEventListener('error', onErr)
    try {
      await mount(
        src,
        host(),
        { adapter: ad() },
        {
          renderComposer: (slot) =>
            createElement(CollabComposer, { ...slot, strings: { ...EN, ...COMPOSER_STRINGS } }),
        },
      )
      opener.focus()
      await act(async () => ctl.startThread({ anchor: docx(5), base_version_id: 'v1' }))
      const ta = $<HTMLTextAreaElement>('.collab-thread--new textarea')!
      // the host closes (unmounts) its pane on an Esc nobody consumed
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) root.render(null)
      })
      await act(async () => {
        ta.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        )
        await flush()
      })
      expect($('aside')).toBeNull()
      expect(errors).toEqual([])
      expect(document.activeElement?.isConnected).toBe(true)
    } finally {
      window.removeEventListener('error', onErr)
      opener.remove()
    }
  })

  it('a reload never moves focus', async () => {
    const src = fakeSource(list([cm({ id: 'a' }), cm({ id: 'b' })], 't1'))
    await mount(src)
    const reply = $('[data-thread-id="b"] .collab-acts button')!
    reply.focus()
    await reloadWith(
      src,
      list([cm({ id: 'a', body: 'changed' }), cm({ id: 'b' }), cm({ id: 'c' })], 't2'),
    )
    expect(document.activeElement).toBe($('[data-thread-id="b"] .collab-acts button'))
  })

  it('reveal focuses the thread heading', async () => {
    const src = fakeSource(
      list([cm({ id: 'a', anchor: docx(1) }), cm({ id: 'b', anchor: docx(2) })]),
    )
    await mount(src, host(), { adapter: ad() })
    await act(async () => {
      await ctl.reveal('b')
      await flush()
    })
    expect(document.activeElement).toBe($('[data-thread-id="b"] [data-thread-heading]'))
  })

  it('reveal scrolls the whole thread into view (centered), not only its header edge', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      const src = fakeSource(
        list([cm({ id: 'a', anchor: docx(1) }), cm({ id: 'b', anchor: docx(2) })]),
      )
      await mount(src, host(), { adapter: ad() })
      scroll.mockClear()
      await act(async () => {
        await ctl.reveal('b')
        await flush()
      })
      expect(scroll).toHaveBeenCalledWith({ block: 'center' })
      expect(scroll).not.toHaveBeenCalledWith({ block: 'nearest' })
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('reveal of a missing comment focuses the notice line', async () => {
    const src = fakeSource(list([cm({ id: 'a' })]))
    await mount(src)
    await act(async () => {
      await ctl.reveal('zzz')
      await flush()
    })
    expect(document.activeElement?.textContent).toBe(EN.collabCommentDeleted)
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1')
  })

  it('the focused thread disappears -> focus moves to the next thread, else the title', async () => {
    const src = fakeSource(list([cm({ id: 'a' }), cm({ id: 'b' }), cm({ id: 'c' })], 't1'))
    await mount(src)
    $('[data-thread-id="b"] .collab-acts button')!.focus()
    await reloadWith(src, list([cm({ id: 'a' }), cm({ id: 'c' })], 't2'))
    expect(document.activeElement).toBe($('[data-thread-id="c"] [data-thread-heading]'))
    await reloadWith(src, list([], 't3'))
    expect(document.activeElement).toBe($('aside h2'))
  })

  it('a changed reload writes one polite sentence', async () => {
    vi.useFakeTimers()
    const src = fakeSource(list([cm({ id: 'a' })], 't1'))
    await mount(src)
    await reloadWith(src, list([cm({ id: 'b' })], 't2'))
    vi.advanceTimersByTime(100)
    expect(document.getElementById(COLLAB_LIVE_REGION_ID)!.textContent).toBe(
      EN.collabUpdatedAnnounce,
    )
    await reloadWith(src, UNCHANGED)
    vi.advanceTimersByTime(100)
    expect(document.getElementById(COLLAB_LIVE_REGION_ID)!.textContent).toBe(
      EN.collabUpdatedAnnounce,
    )
  })

  it('new-thread Send (button and Ctrl+Enter) moves focus to the created thread heading instead of BODY', async () => {
    const src = fakeSource(list([cm({ id: 'a', anchor: docx(1) })], 't1'))
    const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await mount(
      src,
      host(),
      { adapter: ad() },
      {
        renderComposer: (slot) =>
          createElement(CollabComposer, { ...slot, strings: { ...EN, ...COMPOSER_STRINGS } }),
      },
    )

    // 1. Send via Ctrl+Enter -> focuses created thread heading 'n1'
    src.list.mockResolvedValueOnce(
      list([cm({ id: 'a', anchor: docx(1) }), cm({ id: 'n1', anchor: docx(5) })], 't2'),
    )
    await act(async () => ctl.startThread({ anchor: docx(5), base_version_id: 'v1' }))
    let ta = $<HTMLTextAreaElement>('.collab-thread--new textarea')!
    expect(document.activeElement).toBe(ta)
    act(() => {
      nativeSet.call(ta, 'Created by keyboard')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
      await flush()
    })
    expect($('.collab-thread--new')).toBeNull()
    expect(document.activeElement).toBe($('[data-thread-id="n1"] [data-thread-heading]'))

    // 2. Send via Send button -> focuses created thread heading 'n2'
    src.list.mockResolvedValueOnce(
      list(
        [
          cm({ id: 'a', anchor: docx(1) }),
          cm({ id: 'n1', anchor: docx(5) }),
          cm({ id: 'n2', anchor: docx(9) }),
        ],
        't3',
      ),
    )
    await act(async () => ctl.startThread({ anchor: docx(9), base_version_id: 'v1' }))
    ta = $<HTMLTextAreaElement>('.collab-thread--new textarea')!
    act(() => {
      nativeSet.call(ta, 'Created by button')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const sendBtn = $<HTMLButtonElement>('.collab-thread--new .collab-composer-send')!
    await act(async () => {
      sendBtn.click()
      await flush()
    })
    expect($('.collab-thread--new')).toBeNull()
    expect(document.activeElement).toBe($('[data-thread-id="n2"] [data-thread-heading]'))
  })

  it('new-thread Send when created thread is hidden does not steal focus from outside the panel on a later reload (FEK-3)', async () => {
    const src = fakeSource(list([cm({ id: 'a', anchor: docx(1) })], 't1'))
    const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    const outsideEditor = document.createElement('button')
    outsideEditor.textContent = 'Editor Canvas'
    document.body.append(outsideEditor)
    try {
      await mount(
        src,
        host(),
        { adapter: ad() },
        {
          renderComposer: (slot) =>
            createElement(CollabComposer, { ...slot, strings: { ...EN, ...COMPOSER_STRINGS } }),
        },
      )

      // Post-send reload hides the created thread (resolved while resolvedOpen is false)
      src.list.mockResolvedValueOnce(
        list(
          [
            cm({ id: 'a', anchor: docx(1) }),
            cm({ id: 'n-hidden', anchor: docx(5), resolved_at: '2026-10-12T10:00:00Z' }),
          ],
          't2',
        ),
      )
      await act(async () => ctl.startThread({ anchor: docx(5), base_version_id: 'v1' }))
      const ta = $<HTMLTextAreaElement>('.collab-thread--new textarea')!
      act(() => {
        nativeSet.call(ta, 'Resolved right away')
        ta.dispatchEvent(new Event('input', { bubbles: true }))
      })
      const sendBtn = $<HTMLButtonElement>('.collab-thread--new .collab-composer-send')!
      await act(async () => {
        sendBtn.click()
        await flush()
      })
      expect($('.collab-thread--new')).toBeNull()

      // User moves focus outside the panel (into the editor)
      outsideEditor.focus()
      expect(document.activeElement).toBe(outsideEditor)

      // Another user's thread arrives on a later reload -> focus must NOT move from outsideEditor
      await reloadWith(
        src,
        list(
          [
            cm({ id: 'a', anchor: docx(1) }),
            cm({ id: 'n-hidden', anchor: docx(5), resolved_at: '2026-10-12T10:00:00Z' }),
            cm({ id: 'other-user', anchor: docx(9) }),
          ],
          't3',
        ),
      )
      expect(document.activeElement).toBe(outsideEditor)
    } finally {
      outsideEditor.remove()
    }
  })

  it('new-thread Cancel and Discard restore focus to the opener button (or adjacent thread heading when no opener button)', async () => {
    const src = fakeSource(list([cm({ id: 'a', anchor: docx(1) })], 't1'))
    const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    const opener = document.createElement('button')
    opener.textContent = 'New Comment'
    document.body.append(opener)
    const onCancelThread = vi.fn()
    try {
      await mount(
        src,
        host(),
        { adapter: ad() },
        {
          onCancelThread,
          renderComposer: (slot) =>
            createElement(CollabComposer, { ...slot, strings: { ...EN, ...COMPOSER_STRINGS } }),
        },
      )

      // 1. Opened from focused opener button -> Escape on empty restores focus to opener
      opener.focus()
      await act(async () => ctl.startThread({ anchor: docx(5), base_version_id: 'v1' }))
      let ta = $<HTMLTextAreaElement>('.collab-thread--new textarea')!
      expect(document.activeElement).toBe(ta)
      act(() => {
        ta.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        )
      })
      expect($('.collab-thread--new')).toBeNull()
      expect(onCancelThread).toHaveBeenCalledTimes(1)
      expect(document.activeElement).toBe(opener)

      // 2. Opened from focused opener button -> Cancel with draft -> Discard restores focus to opener
      opener.focus()
      await act(async () => ctl.startThread({ anchor: docx(5), base_version_id: 'v1' }))
      ta = $<HTMLTextAreaElement>('.collab-thread--new textarea')!
      act(() => {
        nativeSet.call(ta, 'will discard')
        ta.dispatchEvent(new Event('input', { bubbles: true }))
      })
      const cancelBtn = [...$$('.collab-thread--new button')].find(
        (b) => b.textContent === EN.collabCancel,
      )!
      act(() => cancelBtn.click())
      const discardBtn = [
        ...document.querySelectorAll<HTMLButtonElement>('[role=dialog] button'),
      ].find((b) => b.textContent === EN.collabDiscard)!
      act(() => discardBtn.click())
      expect($('.collab-thread--new')).toBeNull()
      expect(onCancelThread).toHaveBeenCalledTimes(2)
      expect(document.activeElement).toBe(opener)

      // 3. Opened without a focused opener button (e.g. document.body) -> Cancel moves focus to adjacent thread heading
      act(() => (document.activeElement as HTMLElement | null)?.blur())
      await act(async () => ctl.startThread({ anchor: docx(5), base_version_id: 'v1' }))
      const cancelBtn2 = [...$$('.collab-thread--new button')].find(
        (b) => b.textContent === EN.collabCancel,
      )!
      act(() => cancelBtn2.click())
      expect($('.collab-thread--new')).toBeNull()
      expect(document.activeElement).toBe($('[data-thread-id="a"] [data-thread-heading]'))
    } finally {
      opener.remove()
    }
  })

  it('captures newThreadOpenerRef in useLayoutEffect on [ctl.newThread] rather than during render (FEK-4)', async () => {
    const src = fakeSource(list([cm({ id: 'a', anchor: docx(1) })], 't1'))
    const opener = document.createElement('button')
    opener.textContent = 'Toolbar Comment'
    document.body.append(opener)
    try {
      await act(async () => {
        function SiblingFocusOnStart(p: { active: boolean }) {
          useLayoutEffect(() => {
            if (p.active) opener.focus()
          }, [p.active])
          return null
        }
        function HostWithSibling() {
          ctl = useCollabThreads(src, host(), { strings: EN, adapter: ad() })
          return createElement(
            'div',
            null,
            createElement(SiblingFocusOnStart, { active: ctl.newThread !== null }),
            createElement(CollabPanel, {
              controller: ctl,
              strings: EN,
              onClose: () => {},
              renderComposer: (slot) =>
                createElement(CollabComposer, { ...slot, strings: { ...EN, ...COMPOSER_STRINGS } }),
            }),
          )
        }
        root.render(createElement(HostWithSibling))
        await flush()
      })

      act(() => (document.activeElement as HTMLElement | null)?.blur())
      await act(async () => ctl.startThread({ anchor: docx(5), base_version_id: 'v1' }))
      const ta = $<HTMLTextAreaElement>('.collab-thread--new textarea')!
      expect(document.activeElement).toBe(ta)
      act(() => {
        ta.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        )
      })
      expect($('.collab-thread--new')).toBeNull()
      expect(document.activeElement).toBe(opener)
    } finally {
      opener.remove()
    }
  })

  it('calling startThread while a new-thread composer is already open moves focus back into the composer (V14-04)', async () => {
    const src = fakeSource(list([cm({ id: 'a', anchor: docx(1) })], 't1'))
    const nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await mount(
      src,
      host(),
      { adapter: ad() },
      {
        renderComposer: (slot) =>
          createElement(CollabComposer, { ...slot, strings: { ...EN, ...COMPOSER_STRINGS } }),
      },
    )
    await act(async () => ctl.startThread({ anchor: docx(5), base_version_id: 'v1' }))
    const ta = $<HTMLTextAreaElement>('.collab-thread--new textarea')!
    act(() => {
      nativeSet.call(ta, 'keep my draft')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const goBtn = $<HTMLButtonElement>('[data-thread-id="a"] .collab-link')!
    act(() => goBtn.focus())
    expect(document.activeElement).toBe(goBtn)
    await act(async () => ctl.startThread({ anchor: docx(5), base_version_id: 'v1' }))
    expect(document.activeElement).toBe($('.collab-thread--new textarea'))
    expect($<HTMLTextAreaElement>('.collab-thread--new textarea')!.value).toBe('keep my draft')
  })

  it('Close button restores focus to the host opener button (via mount capture or openerRef / onRestoreFocus)', async () => {
    const src = fakeSource(list([cm({ id: 'a' })]))
    const opener = document.createElement('button')
    opener.textContent = 'Comments Pane'
    document.body.append(opener)
    try {
      // 1. Automatic capture of activeElement when CollabPanel mounts, plus unmount on onClose
      opener.focus()
      await act(async () => {
        function HostWithOpen() {
          const [open, setOpen] = useState(true)
          ctl = useCollabThreads(src, host(), { strings: EN })
          if (!open) return null
          return createElement(CollabPanel, {
            controller: ctl,
            strings: EN,
            onClose: () => setOpen(false),
            renderComposer,
          })
        }
        root.render(createElement(HostWithOpen))
        await flush()
      })
      const closeBtn = $<HTMLButtonElement>('button.collab-close')!
      act(() => closeBtn.focus())
      await act(async () => {
        closeBtn.click()
        await flush()
      })
      expect($('aside')).toBeNull()
      expect(document.activeElement).toBe(opener)

      // 2. Explicit openerRef and onRestoreFocus prop on CollabPanelProps
      const explicitOpener = document.createElement('button')
      document.body.append(explicitOpener)
      const onRestoreFocus = vi.fn()
      try {
        act(() => (document.activeElement as HTMLElement | null)?.blur())
        await mount(
          src,
          host(),
          {},
          {
            openerRef: { current: explicitOpener },
            onRestoreFocus,
          },
        )
        const closeBtn2 = $<HTMLButtonElement>('button.collab-close')!
        act(() => closeBtn2.focus())
        await act(async () => {
          closeBtn2.click()
          await flush()
        })
        expect(onRestoreFocus).toHaveBeenCalledTimes(1)
        expect(document.activeElement).toBe(explicitOpener)
      } finally {
        explicitOpener.remove()
      }
    } finally {
      opener.remove()
    }
  })
})

describe('collab.css', () => {
  it('tokens only (no raw colours in rules), 24px targets, 44px under a coarse pointer', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(`${__dirname}/../src/collab/collab.css`, 'utf8')
    const raw = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l: string) => /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/.test(l))
      .filter((l: string) => !/^\s*--[\w-]+:/.test(l))
    expect(raw).toEqual([])
    expect(css).toContain("@import './collab-body.css'")
    expect(css).toMatch(/\.collab-btn,[\s\S]*?min-height: 24px;\s*min-width: 24px;/)
    expect(css).toMatch(/@media \(pointer: coarse\) \{[\s\S]*?min-height: 44px;\s*min-width: 44px;/)
  })
})
