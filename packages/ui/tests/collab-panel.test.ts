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

describe('DOC-05 comment level + G8-18 post-send inline notice', () => {
  it('comment level: allows writing/replying and resolving own root thread, but hides resolve on someone else’s root thread even when author of a reply', async () => {
    const src = fakeSource(
      list([
        cm({ id: 'mine-root', author_id: 'me' }),
        cm({ id: 'other-root', author_id: 'other' }),
        cm({ id: 'my-reply', parent_id: 'other-root', author_id: 'me' }),
      ]),
    )
    await mount(src, host({ level: 'comment', myUserId: 'me' }))
    expect(ctl.can.canWrite).toBe(true)
    expect($('[data-thread-id="mine-root"] [data-resolve-for="mine-root"]')).not.toBeNull()
    expect($('[data-thread-id="other-root"] [data-resolve-for="other-root"]')).toBeNull()
  })

  const WITHOUT_ACCESS = [
    { user_id: 'u-a', display_name: 'Minh Anh', can_share: true },
    { user_id: 'u-b', display_name: 'Mai Hương', can_share: false },
  ]
  const sentComment = (over = {}) =>
    cm({ id: 'c-post', author_id: 'me', body: 'cc @Minh Anh @Mai Hương', ...over })

  /** a Discussion panel; a send goes through the composer slot, the way a real composer submits */
  async function mountDiscussion(src: FakeSource, h = host({ kind: 'discussion' })) {
    await mount(src, h)
    const slot = () => slots.find((s) => s.mode === 'discussion')!
    const send = async (text = 'hello') => {
      await act(async () => {
        await slot().onSubmit(text)
        await flush()
      })
    }
    return { send }
  }

  it('F3: the notice comes from the controller write result, with no patched or inspected source', async () => {
    const src = Object.assign(fakeSource(list([])), { shareView: vi.fn() })
    const created = sentComment({ mentions_without_access: WITHOUT_ACCESS })
    src.create.mockResolvedValue({ comment: created })
    const originalCreate = src.create
    const { send } = await mountDiscussion(src)
    await send()
    expect(src.create).toBe(originalCreate)
    expect(Object.getOwnPropertySymbols(src)).toEqual([])
    expect($('[data-post-send-for="c-post"]')).not.toBeNull()
    // the controller hands the answer back to its caller
    let returned: unknown
    await act(async () => {
      returned = await ctl.actions.create('again')
    })
    expect(returned).toMatchObject({ id: 'c-post' })
  })

  it('N2: the notice is announced once, through the shared live region and not as a live region itself', async () => {
    vi.useFakeTimers()
    const src = Object.assign(fakeSource(list([])), { shareView: vi.fn() })
    src.create.mockResolvedValue({
      comment: sentComment({ mentions_without_access: WITHOUT_ACCESS }),
    })
    const { send } = await mountDiscussion(src)
    await send()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    const notice = $('[data-post-send-for="c-post"]')!
    expect(notice.getAttribute('role')).toBeNull()
    expect(notice.getAttribute('aria-live')).toBeNull()
    expect(notice.closest('[role="status"], [aria-live]')).toBeNull()
    expect(document.getElementById(COLLAB_LIVE_REGION_ID)?.textContent).toBe(
      "Minh Anh and Mai Hương can't view this document, so they weren't notified.",
    )
  })

  it('renders the post-send notice for the sent comment and shares view access from it (G8-18)', async () => {
    const shareView = vi.fn(async () => ({ ok: true as const }))
    const src = Object.assign(fakeSource(list([])), { shareView })
    src.create.mockResolvedValue({
      comment: sentComment({ mentions_without_access: WITHOUT_ACCESS }),
    })
    src.list.mockResolvedValue(list([sentComment({ mentions_without_access: WITHOUT_ACCESS })]))
    const { send } = await mountDiscussion(src)
    await send()

    const notice = $('[data-post-send-for="c-post"]')!
    expect(notice).not.toBeNull()
    expect(notice.textContent).toContain(
      "Minh Anh and Mai Hương can't view this document, so they weren't notified.",
    )
    expect(notice.textContent).toContain("Can't share with Mai Hương; they won't be notified.")
    expect(notice.textContent).toContain(
      "Sharing now won't notify them about this comment; mention them in a new comment to notify.",
    )
    const shareBtn = notice.querySelector<HTMLButtonElement>('.collab-post-send-share')!
    expect(shareBtn.textContent).toBe('Share view access')

    await act(async () => {
      shareBtn.click()
      await flush()
    })
    expect(shareView).toHaveBeenCalledTimes(1)
    expect(shareView).toHaveBeenCalledWith({ user_id: 'u-a' })
    // u-a is shared; only u-b (not shareable) remains and the share button is gone
    expect(notice.textContent).toContain(
      "Mai Hương can't view this document, so they weren't notified.",
    )
    expect(notice.querySelector('.collab-post-send-share')).toBeNull()
  })

  it('F4: a comment that merely lists mentions_without_access (another author, a later load) shows no notice', async () => {
    const src = Object.assign(
      fakeSource(
        list([cm({ id: 'theirs', author_id: 'other', mentions_without_access: WITHOUT_ACCESS })]),
      ),
      { shareView: vi.fn() },
    )
    await mountDiscussion(src)
    expect($('.collab-post-send-notice')).toBeNull()
  })

  it('F4: the notice belongs to the last send only: the next send drops it, and × dismisses it', async () => {
    const src = Object.assign(fakeSource(list([])), { shareView: vi.fn() })
    src.create.mockResolvedValueOnce({
      comment: sentComment({ mentions_without_access: WITHOUT_ACCESS }),
    })
    const { send } = await mountDiscussion(src)
    await send('first')
    expect($('.collab-post-send-notice')).not.toBeNull()

    // dismiss: the × is a named button; focus moves to the panel title when it was inside the notice
    const close = $<HTMLButtonElement>('.collab-post-send-close')!
    expect(close.getAttribute('aria-label')).toBe('Dismiss')
    act(() => close.focus())
    await act(async () => {
      close.click()
      await flush()
    })
    expect($('.collab-post-send-notice')).toBeNull()
    expect(document.activeElement).toBe($('h2.collab-title'))

    // a new notice, then a send without unreachable mentions clears it
    src.create.mockResolvedValueOnce({
      comment: sentComment({ id: 'c-2', mentions_without_access: WITHOUT_ACCESS }),
    })
    await send('second')
    expect($('[data-post-send-for="c-2"]')).not.toBeNull()
    src.create.mockResolvedValueOnce({ comment: cm({ id: 'c-3', author_id: 'me' }) })
    await send('third')
    expect($('.collab-post-send-notice')).toBeNull()
  })

  it('F7: a failed share is said in the notice and announced; the people stay for another try', async () => {
    const shareView = vi.fn(async () => {
      throw err('network')
    })
    const src = Object.assign(fakeSource(list([])), { shareView })
    src.create.mockResolvedValue({
      comment: sentComment({
        mentions_without_access: [{ user_id: 'u-a', display_name: 'Minh Anh', can_share: true }],
      }),
    })
    const { send } = await mountDiscussion(src)
    await send()
    vi.useFakeTimers()
    await act(async () => {
      $<HTMLButtonElement>('.collab-post-send-share')!.click()
      await flush()
    })
    const failure =
      "Couldn't share view access with Minh Anh. You can try again or send without notifying."
    expect($('.collab-post-send-error')?.textContent).toBe(failure)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(document.getElementById(COLLAB_LIVE_REGION_ID)?.textContent).toBe(failure)
    expect($('.collab-post-send-share')).not.toBeNull()
  })
})

describe('lost thread: View in version N', () => {
  const lostRow = (over: Record<string, unknown> = {}) =>
    cm({
      id: 'l',
      anchor: docx(1),
      anchor_state: 'lost',
      anchor_version_id: 'v-old',
      anchor_version_no: 3,
      ...over,
    })
  const viewBtn = () => $$('button').find((b) => b.textContent === 'View in version 3')
  const goBtn = () => $$('button').find((b) => b.textContent === EN.collabGoToAnchor)

  it('is shown when lost, version number known, handler given and another version is open', async () => {
    const onViewVersion = vi.fn()
    await mount(fakeSource(list([lostRow()])), host(), {
      adapter: ad(),
      openVersionId: 'v-head',
      onViewVersion,
    })
    const b = viewBtn()!
    expect(b).toBeDefined()
    expect(b.tagName).toBe('BUTTON')
    expect(b.getAttribute('type')).toBe('button')
    expect(b.closest('.collab-acts')).not.toBeNull()
    // it replaces the hidden Go to location
    expect(goBtn()).toBeUndefined()
    // the lost label stays words
    expect($('.collab-anchor-state-lost')!.textContent).toBe(EN.collabAnchorLost)
  })

  it('is shown without an open version id too (it cannot equal the anchor version)', async () => {
    await mount(fakeSource(list([lostRow()])), host(), { onViewVersion: vi.fn() })
    expect(viewBtn()).toBeDefined()
  })

  it.each([
    ['anchor_version_no missing', { anchor_version_no: undefined }],
    ['anchor_version_no null', { anchor_version_no: null }],
    ['anchor_version_no 0', { anchor_version_no: 0 }],
    ['anchor_version_no fractional', { anchor_version_no: 2.5 }],
    ['anchor_version_no negative', { anchor_version_no: -1 }],
    ['anchor_version_no a string', { anchor_version_no: '3' }],
  ])('is hidden: %s', async (_n, over) => {
    await mount(fakeSource(list([lostRow(over)])), host(), {
      adapter: ad(),
      openVersionId: 'v-head',
      onViewVersion: vi.fn(),
    })
    expect($$('button').some((b) => /^View in version/.test(b.textContent ?? ''))).toBe(false)
    expect(goBtn()).toBeUndefined()
  })

  it('is hidden without a host handler', async () => {
    await mount(fakeSource(list([lostRow()])), host(), { adapter: ad(), openVersionId: 'v-head' })
    expect(viewBtn()).toBeUndefined()
    expect(goBtn()).toBeUndefined()
  })

  it('is hidden when the open version is the anchor version: Go to location instead', async () => {
    await mount(fakeSource(list([lostRow()])), host(), {
      adapter: ad(),
      openVersionId: 'v-old',
      onViewVersion: vi.fn(),
    })
    expect(viewBtn()).toBeUndefined()
    expect(goBtn()).toBeDefined()
    expect($('.collab-anchor-state-lost')).toBeNull()
  })

  it('is hidden for an exact thread', async () => {
    await mount(fakeSource(list([lostRow({ anchor_state: 'exact' })])), host(), {
      adapter: ad(),
      openVersionId: 'v-head',
      onViewVersion: vi.fn(),
    })
    expect(viewBtn()).toBeUndefined()
    expect(goBtn()).toBeDefined()
  })

  it('is hidden on a reply (only the root row carries the action) and for a discussion', async () => {
    await mount(
      fakeSource(
        list([
          lostRow(),
          cm({ id: 'r', parent_id: 'l', anchor_version_no: 3 }),
          cm({ id: 'd', kind: 'discussion', anchor_version_no: 3 }),
        ]),
      ),
      host(),
      { adapter: ad(), openVersionId: 'v-head', onViewVersion: vi.fn() },
    )
    expect($$('button').filter((b) => b.textContent === 'View in version 3')).toHaveLength(1)
    expect($('[data-comment-id="r"] .collab-acts')?.textContent).not.toContain('View in version')
  })

  it('click calls the handler once with the root comment id and the number', async () => {
    const onViewVersion = vi.fn(() => ({ opened: true }))
    await mount(fakeSource(list([lostRow(), cm({ id: 'r', parent_id: 'l' })])), host(), {
      adapter: ad(),
      openVersionId: 'v-head',
      onViewVersion,
    })
    await act(async () => {
      viewBtn()!.click()
      await flush()
    })
    expect(onViewVersion).toHaveBeenCalledTimes(1)
    expect(onViewVersion).toHaveBeenCalledWith({ commentId: 'l', versionNo: 3 })
    expect($('.collab-why--err')).toBeNull()
  })

  it('is disabled while pending and ignores a second click, then is enabled again', async () => {
    let done!: (v: { opened: boolean }) => void
    const onViewVersion = vi.fn(() => new Promise<{ opened: boolean }>((r) => (done = r)))
    await mount(fakeSource(list([lostRow()])), host(), {
      adapter: ad(),
      openVersionId: 'v-head',
      onViewVersion,
    })
    await act(async () => {
      viewBtn()!.click()
      await flush()
    })
    expect((viewBtn() as HTMLButtonElement).disabled).toBe(true)
    await act(async () => {
      viewBtn()!.click()
      await flush()
    })
    expect(onViewVersion).toHaveBeenCalledTimes(1)
    await act(async () => {
      done({ opened: true })
      await flush()
    })
    expect((viewBtn() as HTMLButtonElement).disabled).toBe(false)
    expect($('.collab-why--err')).toBeNull()
  })

  it('{opened:false} shows the unavailable line as an alert', async () => {
    const onViewVersion = vi.fn(() => Promise.resolve({ opened: false }))
    await mount(fakeSource(list([lostRow()])), host(), {
      adapter: ad(),
      openVersionId: 'v-head',
      onViewVersion,
    })
    await act(async () => {
      viewBtn()!.click()
      await flush()
    })
    const line = $('.collab-why--err')!
    expect(line.getAttribute('role')).toBe('alert')
    expect(line.textContent).toBe(EN.collabVersionViewUnavailable)
    expect((viewBtn() as HTMLButtonElement).disabled).toBe(false)
  })

  it('a throw (sync or async) shows the unavailable line and the next click clears it', async () => {
    const onViewVersion = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('boom')
      })
      .mockRejectedValueOnce(new Error('later'))
      .mockResolvedValueOnce({ opened: true })
    await mount(fakeSource(list([lostRow()])), host(), {
      adapter: ad(),
      openVersionId: 'v-head',
      onViewVersion,
    })
    await act(async () => {
      viewBtn()!.click()
      await flush()
    })
    expect($('.collab-why--err')!.textContent).toBe(EN.collabVersionViewUnavailable)
    await act(async () => {
      viewBtn()!.click()
      await flush()
    })
    expect($('.collab-why--err')!.textContent).toBe(EN.collabVersionViewUnavailable)
    await act(async () => {
      viewBtn()!.click()
      await flush()
    })
    expect($('.collab-why--err')).toBeNull()
  })

  it('a handler that returns nothing is not an error', async () => {
    const onViewVersion = vi.fn()
    await mount(fakeSource(list([lostRow()])), host(), {
      adapter: ad(),
      openVersionId: 'v-head',
      onViewVersion,
    })
    await act(async () => {
      viewBtn()!.click()
      await flush()
    })
    expect(onViewVersion).toHaveBeenCalledTimes(1)
    expect($('.collab-why--err')).toBeNull()
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
