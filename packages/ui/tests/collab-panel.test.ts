/** @vitest-environment jsdom */
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CollabPanel, type CollabPanelProps } from '../src/collab/CollabPanel'
import type { CollabComposerSlot } from '../src/collab/CollabThread'
import {
  useCollabThreads,
  type CollabController,
  type CollabControllerOptions,
} from '../src/collab/use-collab-threads'
import type { CollabAnchorAdapter, CollabHostState, CollabSource } from '../src/collab/types'
import { COLLAB_LIVE_REGION_ID } from '../src/collab/live-region'
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
})

describe('focus', () => {
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
