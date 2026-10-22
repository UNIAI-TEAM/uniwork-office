// @vitest-environment jsdom
import { createElement as h, act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { en } from '../src/renderer/src/i18n/askuni/en'
import { vi as viStrings } from '../src/renderer/src/i18n/askuni/vi'
import {
  ASKUNI_MODEL_KEY,
  effectiveModel,
  readModelChoice,
  writeModelChoice,
  type AskUniModelSelection,
} from '../src/renderer/src/askuni-v2/model-choice'
import { AskUniModelPicker } from '../src/renderer/src/askuni-v2/AskUniModelPicker'
import { AskUniScopePicker } from '../src/renderer/src/askuni-v2/AskUniScopePicker'
import { AskUniMentionPicker } from '../src/renderer/src/askuni-v2/AskUniMentionPicker'
import type {
  AskUniLookupItem,
  AskUniLookupRequest,
  AskUniLookupResult,
  AskUniModelOption,
  AskUniObjectKind,
} from '../src/shared/askuni-api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const MODELS: AskUniModelOption[] = [
  { key: 'haiku', speed: 5, intelligence: 2, cost: 1, enabled: true },
  { key: 'sonnet', speed: 4, intelligence: 4, cost: 3, enabled: true },
  { key: 'opus', speed: 2, intelligence: 5, cost: 5, enabled: false },
]

function selection(over: Partial<AskUniModelSelection> = {}): AskUniModelSelection {
  return {
    status: 'ready',
    enabled: MODELS.filter((m) => m.enabled),
    autoModel: 'sonnet',
    model: '',
    effort: '',
    setModel: vi.fn(),
    setEffort: vi.fn(),
    ...over,
  }
}

const DATA: Record<AskUniObjectKind, AskUniLookupItem[]> = {
  task: [{ kind: 'task', id: 't1', title: 'Fix invoice export' }],
  meeting: [
    { kind: 'meeting', id: 'm1', title: 'Weekly sync' },
    { kind: 'meeting', id: 'm2', title: 'Kế hoạch Q3' },
  ],
  document: [{ kind: 'document', id: 'd1', title: 'Budget 2026.docx', subtitle: 'Finance' }],
  project: [{ kind: 'project', id: 'p1', title: 'Website relaunch' }],
  room: [{ kind: 'room', id: 'r1', title: 'ops-alerts' }],
  member: [
    { kind: 'member', id: 'u1', title: 'Lan Nguyen' },
    { kind: 'member', id: 'u2', title: 'Minh Tran' },
  ],
  email_thread: [],
}

describe('Ask UNI v2 pickers', () => {
  let host: HTMLDivElement
  let root: Root
  let lookup: ReturnType<typeof vi.fn<(req: AskUniLookupRequest) => Promise<AskUniLookupResult>>>

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
  }
  async function render(node: ReturnType<typeof h>, lang: 'en' | 'vi' = 'en'): Promise<void> {
    await act(async () => {
      root.render(h(LocaleProvider, { initial: lang, children: node }))
    })
    await flush()
  }
  async function advance(ms: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }
  async function key(el: Element, k: string, init: KeyboardEventInit = {}): Promise<void> {
    await act(async () => {
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
      )
    })
  }
  async function typeInto(
    el: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ): Promise<void> {
    await act(async () => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
      Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const byLabel = (label: string) => host.querySelector(`[aria-label="${label}"]`) as HTMLElement
  const options = () => [...host.querySelectorAll('[role="option"]')] as HTMLElement[]

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    localStorage.clear()
    lookup = vi.fn(async (req) => ({ ok: true as const, items: DATA[req.kind] }))
    ;(window as unknown as { aiOffice: unknown }).aiOffice = {
      askUniLookup: lookup,
      setLanguage: vi.fn(async () => undefined),
    }
  })

  afterEach(async () => {
    vi.useRealTimers()
    await act(async () => root.unmount())
    host.remove()
    delete (window as unknown as { aiOffice?: unknown }).aiOffice
  })

  describe('model choice (per account, Workbench store)', () => {
    it('defaults to Auto with no effort', () => {
      expect(readModelChoice()).toEqual({ model: '', effort: '' })
    })

    it('persists under uniwork.ai.askuni-model and reads it back', () => {
      writeModelChoice({ model: 'sonnet', effort: 'high' })
      expect(ASKUNI_MODEL_KEY).toBe('uniwork.ai.askuni-model')
      expect(JSON.parse(localStorage.getItem(ASKUNI_MODEL_KEY) ?? 'null')).toEqual({
        model: 'sonnet',
        effort: 'high',
      })
      expect(readModelChoice()).toEqual({ model: 'sonnet', effort: 'high' })
    })

    it('ignores a stored value it does not know', () => {
      localStorage.setItem(ASKUNI_MODEL_KEY, JSON.stringify({ model: 'gpt-9', effort: 'extreme' }))
      expect(readModelChoice()).toEqual({ model: '', effort: '' })
      localStorage.setItem(ASKUNI_MODEL_KEY, '{not json')
      expect(readModelChoice()).toEqual({ model: '', effort: '' })
    })

    it('reads a model the organization switched off as Auto', () => {
      expect(
        effectiveModel(
          'opus',
          MODELS.filter((m) => m.enabled),
        ),
      ).toBe('')
      expect(
        effectiveModel(
          'haiku',
          MODELS.filter((m) => m.enabled),
        ),
      ).toBe('haiku')
      expect(effectiveModel('', MODELS)).toBe('')
    })
  })

  describe('model picker', () => {
    async function open(sel = selection(), lang: 'en' | 'vi' = 'en'): Promise<HTMLButtonElement> {
      await render(h(AskUniModelPicker, { selection: sel }), lang)
      const trigger = host.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
      await act(async () => trigger.click())
      return trigger
    }

    it('names the current choice on its trigger', async () => {
      await render(h(AskUniModelPicker, { selection: selection() }))
      const trigger = host.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
      expect(trigger.getAttribute('aria-label')).toBe(
        en.askUniV2ModelLabelWith.replace('{model}', en.askUniV2ModelAuto),
      )
      expect(host.querySelector('[role="menu"]')).toBeNull()
    })

    it('shows the model and the effort on the trigger when both are set', async () => {
      await render(
        h(AskUniModelPicker, { selection: selection({ model: 'haiku', effort: 'high' }) }),
      )
      const trigger = host.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
      expect(trigger.textContent).toContain(`${en.askUniV2ModelHaiku} · ${en.askUniV2EffortHigh}`)
    })

    it('lists Auto and the enabled models only, with the Auto model named', async () => {
      await open()
      const radios = [...host.querySelectorAll('[role="menuitemradio"]')]
      const names = radios.map((r) => r.textContent ?? '')
      expect(names[0]).toContain(
        en.askUniV2ModelAutoCurrent.replace('{model}', en.askUniV2ModelSonnet),
      )
      expect(names.some((n) => n.includes(en.askUniV2ModelHaiku))).toBe(true)
      expect(names.some((n) => n.includes(en.askUniV2ModelSonnet))).toBe(true)
      expect(names.some((n) => n.includes(en.askUniV2ModelOpus))).toBe(false)
    })

    it('marks the chosen model and effort with aria-checked', async () => {
      await open(selection({ model: 'haiku', effort: 'low' }))
      const checked = [...host.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')].map(
        (r) => r.textContent ?? '',
      )
      expect(checked.some((t) => t.includes(en.askUniV2ModelHaiku))).toBe(true)
      expect(checked.some((t) => t.includes(en.askUniV2EffortLow))).toBe(true)
      expect(checked).toHaveLength(2)
    })

    it('shows speed, intelligence and cost hints as labelled bars', async () => {
      await open()
      const bar = host.querySelector(
        `[role="img"][aria-label="${en.askUniV2ModelBar.replace('{label}', en.askUniV2ModelSpeed).replace('{value}', '5')}"]`,
      )
      expect(bar).not.toBeNull()
      expect(host.textContent).toContain(en.askUniV2ModelIntelligence)
      expect(host.textContent).toContain(en.askUniV2ModelCost)
    })

    it('picks a model and an effort, closing the menu on a model pick', async () => {
      const sel = selection()
      await open(sel)
      const haiku = [...host.querySelectorAll('[role="menuitemradio"]')].find((r) =>
        r.textContent?.includes(en.askUniV2ModelHaiku),
      ) as HTMLElement
      await act(async () => haiku.click())
      expect(sel.setModel).toHaveBeenCalledWith('haiku')
      expect(host.querySelector('[role="menu"]')).toBeNull()
      await act(async () =>
        (host.querySelector('button[aria-haspopup="menu"]') as HTMLElement).click(),
      )
      const medium = [...host.querySelectorAll('[role="menuitemradio"]')].find(
        (r) => r.textContent?.trim() === en.askUniV2EffortMedium,
      ) as HTMLElement
      await act(async () => medium.click())
      expect(sel.setEffort).toHaveBeenCalledWith('medium')
    })

    it('says Opus uses more quota when it is the chosen model', async () => {
      await open(
        selection({
          enabled: MODELS.map((m) => ({ ...m, enabled: true })),
          model: 'opus',
        }),
      )
      expect(host.textContent).toContain(en.askUniV2ModelOpusNote)
    })

    it('moves with the arrow keys, closes on Escape and returns focus to the trigger', async () => {
      const trigger = await open()
      const items = [...host.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[]
      expect(document.activeElement).toBe(items[0])
      await key(items[0]!, 'ArrowDown')
      expect(document.activeElement).toBe(items[1])
      await key(items[1]!, 'ArrowUp')
      expect(document.activeElement).toBe(items[0])
      await key(items[0]!, 'Escape')
      expect(host.querySelector('[role="menu"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)
    })

    it('is inert when disabled', async () => {
      await render(h(AskUniModelPicker, { selection: selection(), disabled: true }))
      expect(
        (host.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement).disabled,
      ).toBe(true)
    })

    it('still offers Auto when the model list failed to load', async () => {
      await open(selection({ status: 'failed', enabled: [], autoModel: '' }))
      const radios = [...host.querySelectorAll('[role="menuitemradio"]')]
      expect(radios[0]?.textContent).toContain(en.askUniV2ModelAuto)
    })

    it('uses the Vietnamese wording of the web panel', async () => {
      await render(h(AskUniModelPicker, { selection: selection() }), 'vi')
      expect(host.querySelector('button[aria-haspopup="menu"]')?.textContent).toContain(
        viStrings.askUniV2ModelAuto,
      )
      expect(viStrings.askUniV2ModelAuto).toBe('Tự động')
    })
  })

  describe('scope picker (+)', () => {
    async function openScope(onPick = vi.fn()) {
      const finalFocus = { current: null as HTMLElement | null }
      await render(h(AskUniScopePicker, { workspaceId: 'ws-1', onPick, finalFocus }))
      const trigger = byLabel(en.askUniV2ScopeAdd) as HTMLButtonElement
      await act(async () => trigger.click())
      await flush()
      return { onPick, trigger }
    }
    const search = () => host.querySelector('input[role="combobox"]') as HTMLInputElement

    it('opens a search box with a listbox and looks up the five scope kinds', async () => {
      await openScope()
      expect(search()).not.toBeNull()
      expect(host.querySelector('[role="listbox"]')).not.toBeNull()
      const kinds = lookup.mock.calls.map((c) => c[0].kind).sort()
      expect(kinds).toEqual(['document', 'meeting', 'project', 'room', 'task'])
      expect(lookup.mock.calls.every((c) => c[0].workspaceId === 'ws-1' && c[0].query === '')).toBe(
        true,
      )
      expect(options().map((o) => o.textContent)).toContain('Weekly sync')
    })

    it('groups results by kind with a heading each', async () => {
      await openScope()
      const groups = [...host.querySelectorAll('[role="group"]')]
      expect(groups.length).toBe(5)
      expect(host.textContent).toContain(en.askUniV2GroupProjects)
      expect(host.textContent).toContain(en.askUniV2GroupRooms)
    })

    it('filters accent-insensitively on the client', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await openScope()
      await typeInto(search(), 'ke hoach')
      await advance(250)
      const names = options().map((o) => o.textContent ?? '')
      expect(names.some((n) => n.includes('Kế hoạch Q3'))).toBe(true)
      expect(names.some((n) => n.includes('Weekly sync'))).toBe(false)
      expect(lookup.mock.calls.at(-1)![0].query).toBe('ke hoach')
    })

    it('waits for the typing to settle before asking the server again', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await openScope()
      const before = lookup.mock.calls.length
      await typeInto(search(), 'b')
      await typeInto(search(), 'bu')
      await advance(100)
      expect(lookup.mock.calls.length).toBe(before)
      await advance(200)
      expect(lookup.mock.calls.length).toBe(before + 5)
    })

    it('drives the listbox from the input: arrows move, Enter picks, aria-activedescendant follows', async () => {
      const { onPick } = await openScope()
      const input = search()
      const first = input.getAttribute('aria-activedescendant')
      expect(first).toBe(options()[0]!.id)
      await key(input, 'ArrowDown')
      expect(input.getAttribute('aria-activedescendant')).toBe(options()[1]!.id)
      expect(options()[1]!.getAttribute('aria-selected')).toBe('true')
      await key(input, 'ArrowUp')
      await key(input, 'ArrowUp')
      expect(input.getAttribute('aria-activedescendant')).toBe(options().at(-1)!.id)
      await key(input, 'Enter')
      expect(onPick).toHaveBeenCalledTimes(1)
      expect(onPick.mock.calls[0]![0]).toMatchObject({
        id: expect.any(String),
        title: expect.any(String),
      })
      expect(host.querySelector('[role="listbox"]')).toBeNull()
    })

    it('picks with the pointer too, and the pick carries kind, id and title', async () => {
      const { onPick } = await openScope()
      const doc = options().find((o) => o.textContent?.includes('Budget 2026.docx')) as HTMLElement
      await act(async () => doc.click())
      expect(onPick).toHaveBeenCalledWith({ kind: 'document', id: 'd1', title: 'Budget 2026.docx' })
    })

    it('closes on Escape and gives focus back to the plus button', async () => {
      const { trigger } = await openScope()
      await key(search(), 'Escape')
      expect(host.querySelector('[role="listbox"]')).toBeNull()
      expect(document.activeElement).toBe(trigger)
    })

    it('says so when nothing matches', async () => {
      lookup.mockResolvedValue({ ok: true, items: [] })
      await openScope()
      expect(host.textContent).toContain(en.askUniV2LookupEmpty)
      expect(options()).toHaveLength(0)
    })

    it('says so when every lookup failed', async () => {
      lookup.mockResolvedValue({ ok: false, error: 'offline' })
      await openScope()
      expect(host.textContent).toContain(en.askUniV2LookupFailed)
    })

    it('keeps the groups that did answer when one kind failed', async () => {
      lookup.mockImplementation(async (req) =>
        req.kind === 'room' ? { ok: false, error: 'error' } : { ok: true, items: DATA[req.kind] },
      )
      await openScope()
      expect(options().map((o) => o.textContent)).toContain('Weekly sync')
      expect(host.textContent).not.toContain(en.askUniV2LookupFailed)
    })

    it('drops an answer that arrives after a newer query', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      let releaseOld: (r: AskUniLookupResult) => void = () => undefined
      lookup.mockImplementationOnce(
        () => new Promise<AskUniLookupResult>((res) => (releaseOld = res)),
      )
      await openScope()
      await typeInto(search(), 'budget')
      await advance(250)
      await act(async () =>
        releaseOld({ ok: true, items: [{ kind: 'task', id: 'old', title: 'STALE ROW' }] }),
      )
      expect(host.textContent).not.toContain('STALE ROW')
    })

    it('is inert while a question streams', async () => {
      await render(
        h(AskUniScopePicker, {
          workspaceId: 'ws-1',
          onPick: vi.fn(),
          finalFocus: { current: null },
          disabled: true,
        }),
      )
      expect((byLabel(en.askUniV2ScopeAdd) as HTMLButtonElement).disabled).toBe(true)
    })
  })

  describe('mention picker (@)', () => {
    function Harness(props: {
      query: string
      onPick: (p: unknown) => void
      onDismiss: () => void
    }) {
      const ref = useRef<HTMLTextAreaElement>(null)
      return h(
        'div',
        null,
        h('textarea', { ref, 'aria-label': 'box' }),
        h(AskUniMentionPicker, {
          workspaceId: 'ws-1',
          query: props.query,
          listId: 'mention-list',
          inputRef: ref,
          onPick: props.onPick,
          onDismiss: props.onDismiss,
        }),
      )
    }
    const box = () => host.querySelector('textarea') as HTMLTextAreaElement

    it('right after @ it offers members only', async () => {
      await render(h(Harness, { query: '', onPick: vi.fn(), onDismiss: vi.fn() }))
      expect(lookup.mock.calls.map((c) => c[0].kind)).toEqual(['member'])
      expect(options().map((o) => o.textContent)).toEqual(['Lan Nguyen', 'Minh Tran'])
    })

    it('with a query it asks task, meeting, document, project and member', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await render(h(Harness, { query: 'lan', onPick: vi.fn(), onDismiss: vi.fn() }))
      await advance(250)
      const kinds = [...new Set(lookup.mock.calls.map((c) => c[0].kind))].sort()
      expect(kinds).toEqual(['document', 'meeting', 'member', 'project', 'task'])
      expect(lookup.mock.calls.some((c) => c[0].kind === 'room')).toBe(false)
      expect(lookup.mock.calls.some((c) => c[0].kind === 'email_thread')).toBe(false)
    })

    it('never takes focus: keys on the textarea move the highlight and name it', async () => {
      const onPick = vi.fn()
      await render(h(Harness, { query: '', onPick, onDismiss: vi.fn() }))
      box().focus()
      expect(box().getAttribute('aria-activedescendant')).toBe(options()[0]!.id)
      await key(box(), 'ArrowDown')
      expect(box().getAttribute('aria-activedescendant')).toBe(options()[1]!.id)
      expect(document.activeElement).toBe(box())
      await key(box(), 'Enter')
      expect(onPick).toHaveBeenCalledWith({ kind: 'member', id: 'u2', label: 'Minh Tran' })
    })

    it('Tab picks as well, Shift+Enter does not', async () => {
      const onPick = vi.fn()
      await render(h(Harness, { query: '', onPick, onDismiss: vi.fn() }))
      await key(box(), 'Enter', { shiftKey: true })
      expect(onPick).not.toHaveBeenCalled()
      await key(box(), 'Tab')
      expect(onPick).toHaveBeenCalledWith({ kind: 'member', id: 'u1', label: 'Lan Nguyen' })
    })

    it('does not act on Enter while an IME is composing', async () => {
      const onPick = vi.fn()
      await render(h(Harness, { query: '', onPick, onDismiss: vi.fn() }))
      await key(box(), 'Enter', { isComposing: true })
      await key(box(), 'Enter', { keyCode: 229 })
      expect(onPick).not.toHaveBeenCalled()
    })

    it('Escape dismisses without picking', async () => {
      const onPick = vi.fn()
      const onDismiss = vi.fn()
      await render(h(Harness, { query: '', onPick, onDismiss }))
      await key(box(), 'Escape')
      expect(onDismiss).toHaveBeenCalledTimes(1)
      expect(onPick).not.toHaveBeenCalled()
    })

    it('picks with the pointer and keeps the caret in the textarea', async () => {
      const onPick = vi.fn()
      await render(h(Harness, { query: '', onPick, onDismiss: vi.fn() }))
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      await act(async () => {
        options()[0]!.dispatchEvent(down)
      })
      expect(down.defaultPrevented).toBe(true)
      await act(async () => options()[0]!.click())
      expect(onPick).toHaveBeenCalledWith({ kind: 'member', id: 'u1', label: 'Lan Nguyen' })
    })

    it('filters accent-insensitively and announces the count politely', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      lookup.mockImplementation(async (req) => ({
        ok: true,
        items: req.kind === 'member' ? [{ kind: 'member', id: 'u9', title: 'Nguyễn Văn An' }] : [],
      }))
      await render(h(Harness, { query: 'nguyen', onPick: vi.fn(), onDismiss: vi.fn() }))
      await advance(250)
      expect(options().map((o) => o.textContent)).toEqual(['Nguyễn Văn An'])
      const status = host.querySelector('[role="status"]')
      expect(status?.textContent).toBe(en.askUniV2MentionCount.replace('{count}', '1'))
    })

    it('shows an empty note, and no listbox options, when nothing matches', async () => {
      lookup.mockResolvedValue({ ok: true, items: [] })
      await render(h(Harness, { query: '', onPick: vi.fn(), onDismiss: vi.fn() }))
      expect(options()).toHaveLength(0)
      expect(host.textContent).toContain(en.askUniV2LookupEmpty)
      expect(box().hasAttribute('aria-activedescendant')).toBe(false)
    })

    it('labels the listbox and groups with a heading', async () => {
      await render(h(Harness, { query: '', onPick: vi.fn(), onDismiss: vi.fn() }))
      const list = host.querySelector('[role="listbox"]') as HTMLElement
      expect(list.id).toBe('mention-list')
      expect(list.getAttribute('aria-label')).toBe(en.askUniV2MentionList)
      expect(host.textContent).toContain(en.askUniV2GroupPeople)
    })
  })
})
