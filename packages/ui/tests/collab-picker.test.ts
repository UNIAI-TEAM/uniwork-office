/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MentionPicker,
  mentionOptionId,
  nextSelectableIndex,
  useMentionSearch,
  type MentionRow,
} from '../src/collab/MentionPicker'
import {
  PICKER_STRINGS,
  candidate,
  fakeSource,
  manyCandidates,
  settle,
} from './collab-composer-fixtures'

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const rowsOf = (...rows: MentionRow[]) => rows

describe('MentionPicker (presentational listbox)', () => {
  const rows = rowsOf(
    { kind: 'candidate', key: 'a', candidate: candidate('a', 'Minh Anh', 'minhanh@x.vn') },
    { kind: 'candidate', key: 'b', candidate: candidate('b', 'Mai Hương') },
    { kind: 'message', key: 'm', text: 'Searching…' },
  )

  function render(over: Partial<Parameters<typeof MentionPicker>[0]> = {}) {
    const onPick = vi.fn()
    act(() =>
      root.render(
        createElement(MentionPicker, {
          listboxId: 'lb',
          label: 'Mention someone',
          rows,
          activeIndex: 0,
          onPick,
          ...over,
        }),
      ),
    )
    return onPick
  }

  it('is a listbox named by the label with one role=option per row', () => {
    render()
    const lb = host.querySelector('[role=listbox]')!
    expect(lb.id).toBe('lb')
    expect(lb.getAttribute('aria-label')).toBe('Mention someone')
    expect(lb.querySelectorAll('[role=option]')).toHaveLength(3)
  })

  it('marks the active option aria-selected and gives every option a stable id', () => {
    render({ activeIndex: 1 })
    const opts = [...host.querySelectorAll('[role=option]')]
    expect(opts.map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    expect(opts[1]!.id).toBe(mentionOptionId('lb', 1))
  })

  it('shows avatar, name and — only when the server sent it — the email', () => {
    render()
    const [first, second] = [...host.querySelectorAll('[role=option]')]
    expect(first!.textContent).toContain('Minh Anh')
    expect(first!.textContent).toContain('minhanh@x.vn')
    expect(first!.querySelector('[aria-hidden=true]')).not.toBeNull()
    expect(second!.textContent).toContain('Mai Hương')
    expect(second!.textContent).not.toContain('@')
  })

  it('renders message rows as aria-disabled options that cannot be picked', () => {
    const onPick = render()
    const msg = host.querySelectorAll('[role=option]')[2] as HTMLElement
    expect(msg.getAttribute('aria-disabled')).toBe('true')
    act(() => msg.click())
    expect(onPick).not.toHaveBeenCalled()
  })

  it('picks a candidate row and a retry row on click', () => {
    const onPick = render({
      rows: rowsOf(
        { kind: 'candidate', key: 'a', candidate: candidate('a', 'Minh Anh') },
        { kind: 'retry', key: 'r', text: 'Try again' },
      ),
    })
    const [cand, retry] = [...host.querySelectorAll<HTMLElement>('[role=option]')]
    act(() => cand!.click())
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'candidate' }))
    act(() => retry!.click())
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'retry' }))
    expect(retry!.getAttribute('aria-disabled')).toBeNull()
  })

  it('keeps focus in the textarea: mousedown on an option is default-prevented', () => {
    render()
    const opt = host.querySelector('[role=option]')!
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    act(() => {
      opt.dispatchEvent(ev)
    })
    expect(ev.defaultPrevented).toBe(true)
  })

  it('keeps the name readable and truncates the email to one line with a title (UNI-1972)', () => {
    render()
    const email = host.querySelector('.collab-mention-email')!
    expect(email.getAttribute('title')).toBe('minhanh@x.vn')
    const css = readFileSync(
      resolve(import.meta.dirname, '../src/collab/collab-composer.css'),
      'utf8',
    )
    const body = (sel: string): string =>
      new RegExp(`${sel.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
    const emailRule = body('.collab-mention-email')
    expect(emailRule).toMatch(/white-space:\s*nowrap/)
    expect(emailRule).toMatch(/text-overflow:\s*ellipsis/)
    expect(emailRule).toMatch(/overflow:\s*hidden/)
    const nameRule = body('.collab-mention-name')
    expect(nameRule).not.toMatch(/nowrap|ellipsis/)
  })

  it('shows the lock icon and collabMentionNoAccessBadge on candidates with can_view=false (G8-18)', () => {
    render({
      noAccessBadge: "Can't view",
      rows: rowsOf(
        {
          kind: 'candidate',
          key: 'a',
          candidate: { ...candidate('a', 'Minh Anh'), can_view: true },
        },
        {
          kind: 'candidate',
          key: 'b',
          candidate: { ...candidate('b', 'Mai Hương'), can_view: false },
        },
      ),
    })
    const [first, second] = [...host.querySelectorAll<HTMLElement>('[role=option]')]
    expect(first!.querySelector('.collab-mention-no-access')).toBeNull()
    const badge = second!.querySelector('.collab-mention-no-access')!
    expect(badge).not.toBeNull()
    expect(badge.querySelector('svg.collab-mention-lock')).not.toBeNull()
    expect(badge.textContent).toContain("Can't view")
  })
})

describe('nextSelectableIndex', () => {
  const rows = rowsOf(
    { kind: 'candidate', key: 'a', candidate: candidate('a', 'A') },
    { kind: 'message', key: 'm', text: 'Searching…' },
    { kind: 'candidate', key: 'b', candidate: candidate('b', 'B') },
  )
  it('skips message rows and wraps', () => {
    expect(nextSelectableIndex(rows, 0, 1)).toBe(2)
    expect(nextSelectableIndex(rows, 2, 1)).toBe(0)
    expect(nextSelectableIndex(rows, 0, -1)).toBe(2)
  })
  it('returns -1 when nothing is selectable', () => {
    expect(nextSelectableIndex(rowsOf({ kind: 'message', key: 'm', text: 'x' }), -1, 1)).toBe(-1)
    expect(nextSelectableIndex([], -1, 1)).toBe(-1)
  })
})

describe('useMentionSearch', () => {
  type Search = ReturnType<typeof useMentionSearch>
  let latest: Search

  function Probe(props: {
    source: ReturnType<typeof fakeSource> & { canListMembers?: boolean }
    query: string | null
    announce?: (t: string) => void
    canListMembers?: boolean
  }) {
    latest = useMentionSearch({
      source: props.source,
      query: props.query,
      strings: PICKER_STRINGS,
      announce: props.announce,
      canListMembers: props.canListMembers,
    })
    return null
  }
  const mount = (
    source: ReturnType<typeof fakeSource> & { canListMembers?: boolean },
    query: string | null,
    announce?: (t: string) => void,
    canListMembers?: boolean,
  ) => act(() => root.render(createElement(Probe, { source, query, announce, canListMembers })))
  const texts = () =>
    latest.rows.map((r) => (r.kind === 'candidate' ? r.candidate.display_name : r.text))

  it('does nothing while the picker is closed (query null)', async () => {
    const source = fakeSource([candidate('a', 'A')])
    mount(source, null)
    await settle(act, 500)
    expect(source.searchMentions).not.toHaveBeenCalled()
    expect(latest.rows).toEqual([])
  })

  it('waits 150 ms after the last change, then searches once with the last query and limit 20', async () => {
    const source = fakeSource([candidate('a', 'Minh Anh')])
    mount(source, 'm')
    await settle(act, 100)
    mount(source, 'mi')
    await settle(act, 149)
    expect(source.searchMentions).not.toHaveBeenCalled()
    await settle(act, 1)
    expect(source.searchMentions).toHaveBeenCalledTimes(1)
    expect(source.searchMentions).toHaveBeenCalledWith({ q: 'mi', limit: 20 })
    expect(texts()).toEqual(['Minh Anh'])
  })

  it('passes include: no_access only when the caller may list members (G8-18)', async () => {
    const source = Object.assign(fakeSource([candidate('a', 'Minh Anh')]), {
      canListMembers: true,
    })
    mount(source, 'mi')
    await settle(act, 150)
    expect(source.searchMentions).toHaveBeenCalledWith({
      q: 'mi',
      limit: 20,
      include: 'no_access',
    })
  })

  it('shows one unselectable searching row until the first answer', async () => {
    const source = fakeSource([candidate('a', 'A')])
    mount(source, '')
    expect(latest.rows).toEqual([{ kind: 'message', key: expect.any(String), text: 'Searching…' }])
    await settle(act, 150)
    expect(texts()).toEqual(['A'])
  })

  it('keeps the old results (plus a searching row) while a new query is in flight', async () => {
    let release!: (v: { candidates: ReturnType<typeof candidate>[] }) => void
    const source = fakeSource([], (p) =>
      p.q === 'm'
        ? Promise.resolve({ candidates: [candidate('a', 'Old')] })
        : new Promise((res) => {
            release = res
          }),
    )
    mount(source, 'm')
    await settle(act, 150)
    expect(texts()).toEqual(['Old'])
    mount(source, 'mi')
    await settle(act, 150)
    expect(texts()).toEqual(['Old', 'Searching…'])
    await act(async () => release({ candidates: [candidate('b', 'New')] }))
    expect(texts()).toEqual(['New'])
  })

  it('ignores an answer that arrives after a newer query was asked', async () => {
    const releases: Record<string, (v: { candidates: ReturnType<typeof candidate>[] }) => void> = {}
    const source = fakeSource([], (p) => new Promise((res) => (releases[p.q] = res)))
    mount(source, 'a')
    await settle(act, 150)
    mount(source, 'ab')
    await settle(act, 150)
    await act(async () => releases['ab']!({ candidates: [candidate('2', 'Fresh')] }))
    await act(async () => releases['a']!({ candidates: [candidate('1', 'Stale')] }))
    expect(texts()).toEqual(['Fresh'])
  })

  it('caps the rows at 20 even if the source returns more', async () => {
    const source = fakeSource(manyCandidates(30))
    mount(source, '')
    await settle(act, 150)
    expect(latest.rows.filter((r) => r.kind === 'candidate')).toHaveLength(20)
  })

  it('says no match for a typed query, naming it', async () => {
    mount(fakeSource([]), 'xyz')
    await settle(act, 150)
    expect(texts()).toEqual(['No one with access to this document matches “xyz”.'])
  })

  it('says there are no candidates when the empty query finds nobody', async () => {
    mount(fakeSource([]), '')
    await settle(act, 150)
    expect(texts()).toEqual(['No one else has access to this document yet.'])
  })

  it('on error shows the message and a Retry row; retry asks again without the debounce', async () => {
    const calls: string[] = []
    const source = fakeSource([], async (p) => {
      calls.push(p.q)
      if (calls.length === 1) throw { code: 'network' }
      return { candidates: [candidate('a', 'Back')] }
    })
    mount(source, 'mi')
    await settle(act, 150)
    expect(latest.rows.map((r) => r.kind)).toEqual(['message', 'retry'])
    expect(texts()).toEqual(['Couldn’t load people.', 'Try again'])
    act(() => latest.retry())
    await settle(act, 0)
    expect(calls).toEqual(['mi', 'mi'])
    expect(texts()).toEqual(['Back'])
  })

  it('announces the count exactly once per answer, not per render', async () => {
    const announce = vi.fn()
    const source = fakeSource([candidate('a', 'A'), candidate('b', 'B'), candidate('c', 'C')])
    mount(source, 'm', announce)
    await settle(act, 150)
    expect(announce).toHaveBeenCalledTimes(1)
    expect(announce).toHaveBeenCalledWith('Results: 3')
    mount(source, 'm', announce)
    await settle(act, 500)
    expect(announce).toHaveBeenCalledTimes(1)
  })

  it('announces the message of an empty or failed answer instead of a count', async () => {
    const announce = vi.fn()
    mount(fakeSource([]), 'zz', announce)
    await settle(act, 150)
    expect(announce).toHaveBeenCalledWith('No one with access to this document matches “zz”.')
  })

  it('forgets everything when the picker closes, so a reopen starts at searching', async () => {
    const source = fakeSource([candidate('a', 'A')])
    mount(source, 'm')
    await settle(act, 150)
    mount(source, null)
    expect(latest.rows).toEqual([])
    mount(source, 'm')
    expect(texts()).toEqual(['Searching…'])
  })
})
