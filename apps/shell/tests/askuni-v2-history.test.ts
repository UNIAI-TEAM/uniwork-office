// @vitest-environment jsdom
import { createElement as h, act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { en } from '../src/renderer/src/i18n/askuni/en'
import { vi as viStrings } from '../src/renderer/src/i18n/askuni/vi'
import { AskUniHeader } from '../src/renderer/src/askuni-v2/AskUniHeader'
import { useAskUniConversations } from '../src/renderer/src/askuni-v2/AskUniHistory'
import type {
  AskUniConversation,
  AskUniConversationRequest,
  AskUniConversationsResult,
  AskUniOkResult,
  AskUniRenameRequest,
  AskUniWorkspace,
  AskUniWorkspaceRequest,
} from '../src/shared/askuni-api'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CONVS: AskUniConversation[] = [
  {
    id: 'c1',
    title: 'Overdue tasks',
    createdAt: '2026-10-20T01:00:00Z',
    updatedAt: '2026-10-20T02:00:00Z',
  },
  {
    id: 'c2',
    title: 'Budget review',
    createdAt: '2026-10-19T01:00:00Z',
    updatedAt: '2026-10-19T02:00:00Z',
  },
  { id: 'c3', title: '', createdAt: '2026-10-18T01:00:00Z', updatedAt: '2026-10-18T02:00:00Z' },
]

describe('Ask UNI v2 header and history', () => {
  let host: HTMLDivElement
  let root: Root
  let list: ReturnType<
    typeof vi.fn<(req: AskUniWorkspaceRequest) => Promise<AskUniConversationsResult>>
  >
  let rename: ReturnType<typeof vi.fn<(req: AskUniRenameRequest) => Promise<AskUniOkResult>>>
  let remove: ReturnType<typeof vi.fn<(req: AskUniConversationRequest) => Promise<AskUniOkResult>>>
  let onSelect: ReturnType<typeof vi.fn<(id: string | null) => void>>
  let onNew: ReturnType<typeof vi.fn<() => void>>
  let bump: () => void = () => undefined

  function Harness(props: {
    activeId?: string
    workspaces?: AskUniWorkspace[]
    onWorkspaceChange?: (id: string) => void
    workspaceId?: string
  }) {
    const [refreshKey, setRefreshKey] = useState(0)
    bump = () => setRefreshKey((k) => k + 1)
    const workspaceId = props.workspaceId ?? 'ws-1'
    const conversations = useAskUniConversations(workspaceId, refreshKey)
    return h(AskUniHeader, {
      workspaceId,
      workspaces: props.workspaces,
      onWorkspaceChange: props.onWorkspaceChange,
      activeId: props.activeId ?? null,
      conversations,
      onSelect,
      onNew,
    })
  }

  async function flush(): Promise<void> {
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
  }
  async function mount(
    props: Parameters<typeof Harness>[0] = {},
    lang: 'en' | 'vi' = 'en',
  ): Promise<void> {
    await act(async () => {
      root.render(h(LocaleProvider, { initial: lang, children: h(Harness, props) }))
    })
    await flush()
  }
  const trigger = () => host.querySelector('button.askuni2-title-btn') as HTMLButtonElement
  const popover = () => host.querySelector('[data-slot="askuni-history"]') as HTMLElement | null
  const rows = () => [...host.querySelectorAll('[data-slot="askuni-history"] li')] as HTMLElement[]
  const byLabel = (root_: ParentNode, label: string) =>
    root_.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null
  async function open(): Promise<void> {
    await act(async () => trigger().click())
    await flush()
  }
  async function key(el: Element, k: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> {
    const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })
    await act(async () => {
      el.dispatchEvent(ev)
    })
    return ev
  }
  async function typeInto(el: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    list = vi.fn(async () => ({ ok: true as const, conversations: [...CONVS] }))
    rename = vi.fn(async () => ({ ok: true as const }))
    remove = vi.fn(async () => ({ ok: true as const }))
    onSelect = vi.fn()
    onNew = vi.fn()
    ;(window as unknown as { aiOffice: unknown }).aiOffice = {
      askUniConversations: list,
      askUniRename: rename,
      askUniDelete: remove,
      setLanguage: vi.fn(async () => undefined),
    }
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    delete (window as unknown as { aiOffice?: unknown }).aiOffice
  })

  describe('header', () => {
    it('shows the web default title for a new conversation', async () => {
      await mount()
      expect(trigger().textContent).toContain(en.askUniV2Untitled)
      expect(trigger().getAttribute('aria-label')).toBe(
        en.askUniV2HistoryWith.replace('{title}', en.askUniV2Untitled),
      )
    })

    it('shows the title of the open conversation', async () => {
      await mount({ activeId: 'c2' })
      expect(trigger().textContent).toContain('Budget review')
    })

    it('falls back to the default title for a conversation not in the list yet or without a title', async () => {
      await mount({ activeId: 'c3' })
      expect(trigger().textContent).toContain(en.askUniV2Untitled)
      await mount({ activeId: 'brand-new' })
      expect(trigger().textContent).toContain(en.askUniV2Untitled)
    })

    it('has a New conversation button and no full page button', async () => {
      await mount({ activeId: 'c1' })
      const btn = byLabel(host, en.askUniV2NewConversation)
      expect(btn).not.toBeNull()
      await act(async () => btn!.click())
      expect(onNew).toHaveBeenCalledTimes(1)
      const labels = [...host.querySelectorAll('button')].map(
        (b) => b.getAttribute('aria-label') ?? '',
      )
      expect(labels.some((l) => /full/i.test(l) || /toàn trang/i.test(l))).toBe(false)
    })

    it('shows the workspace name, or a select with several workspaces', async () => {
      const a = { id: 'ws-1', name: 'Marketing team' }
      const b = { id: 'ws-2', name: 'Finance team' }
      await mount({ workspaces: [a] })
      expect(host.textContent).toContain('Marketing team')
      expect(host.querySelector('select')).toBeNull()
      const onWorkspaceChange = vi.fn()
      await mount({ workspaces: [a, b], onWorkspaceChange })
      const select = host.querySelector('select') as HTMLSelectElement
      expect([...select.options].map((o) => o.textContent)).toEqual([
        'Marketing team',
        'Finance team',
      ])
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(
          select,
          'ws-2',
        )
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      expect(onWorkspaceChange).toHaveBeenCalledWith('ws-2')
    })

    it('uses the Vietnamese web wording', async () => {
      await mount({}, 'vi')
      expect(trigger().textContent).toContain(viStrings.askUniV2Untitled)
      expect(viStrings.askUniV2Untitled).toBe('Hội thoại mới')
      expect(viStrings.askUniV2History).toBe('Lịch sử hội thoại')
    })
  })

  describe('history list', () => {
    it('loads the workspace conversations from the server and stays closed until asked', async () => {
      await mount()
      expect(list).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
      expect(popover()).toBeNull()
      expect(trigger().getAttribute('aria-expanded')).toBe('false')
      await open()
      expect(popover()).not.toBeNull()
      expect(trigger().getAttribute('aria-expanded')).toBe('true')
      expect(rows()).toHaveLength(3)
      expect(rows().map((r) => r.textContent)).toEqual([
        expect.stringContaining('Overdue tasks'),
        expect.stringContaining('Budget review'),
        expect.stringContaining(en.askUniV2Untitled),
      ])
    })

    it('the title button declares a dialog and the popover is one (it is not a menu)', async () => {
      await mount()
      expect(trigger().getAttribute('aria-haspopup')).toBe('dialog')
      await open()
      expect(popover()?.getAttribute('role')).toBe('dialog')
      expect(popover()?.getAttribute('aria-label')).toBe(en.askUniV2History)
    })

    it('highlights the current conversation', async () => {
      await mount({ activeId: 'c2' })
      await open()
      const current = rows().filter((r) => r.querySelector('[aria-current="true"]'))
      expect(current).toHaveLength(1)
      expect(current[0]!.textContent).toContain('Budget review')
    })

    it('opens a conversation and closes the list', async () => {
      await mount()
      await open()
      const pick = rows()[1]!.querySelector('button') as HTMLButtonElement
      await act(async () => pick.click())
      expect(onSelect).toHaveBeenCalledWith('c2')
      expect(popover()).toBeNull()
    })

    it('shows an empty state', async () => {
      list.mockResolvedValue({ ok: true, conversations: [] })
      await mount()
      await open()
      expect(popover()!.textContent).toContain(en.askUniV2HistoryEmpty)
      expect(rows()).toHaveLength(0)
    })

    it('a rejected list call (refused sender) is the same failed state, with the retry', async () => {
      list.mockRejectedValueOnce(new Error('ipc_sender_refused'))
      await mount()
      await open()
      expect(popover()!.textContent).toContain(en.askUniV2HistoryFailed)
      const retry = popover()!.querySelector('[data-action="retry"]') as HTMLButtonElement
      await act(async () => retry.click())
      await flush()
      expect(rows()).toHaveLength(3)
    })

    it('shows an error with a retry that loads again', async () => {
      list.mockResolvedValueOnce({ ok: false, error: 'offline' })
      await mount()
      await open()
      expect(popover()!.textContent).toContain(en.askUniV2HistoryFailed)
      const retry = [...popover()!.querySelectorAll('button')].find(
        (b) => b.textContent?.includes('Retry') || b.dataset.action === 'retry',
      ) as HTMLButtonElement
      expect(retry).toBeDefined()
      await act(async () => retry.click())
      await flush()
      expect(rows()).toHaveLength(3)
      expect(list).toHaveBeenCalledTimes(2)
    })

    it('shows a loading note while the first answer is on its way', async () => {
      let release: (r: AskUniConversationsResult) => void = () => undefined
      list.mockImplementationOnce(() => new Promise((res) => (release = res)))
      await mount()
      await open()
      expect(popover()!.textContent).toContain(en.askUniLoading)
      await act(async () => release({ ok: true, conversations: [...CONVS] }))
      await flush()
      expect(rows()).toHaveLength(3)
    })

    it('reloads when the panel bumps the refresh key (a turn ended)', async () => {
      await mount()
      expect(list).toHaveBeenCalledTimes(1)
      list.mockResolvedValue({
        ok: true,
        conversations: [
          {
            id: 'c9',
            title: 'Fresh one',
            createdAt: '2026-10-22T01:00:00Z',
            updatedAt: '2026-10-22T01:00:00Z',
          },
          ...CONVS,
        ],
      })
      await act(async () => bump())
      await flush()
      expect(list).toHaveBeenCalledTimes(2)
      await open()
      expect(rows()[0]!.textContent).toContain('Fresh one')
    })

    it('reloads for another workspace', async () => {
      await mount({ workspaceId: 'ws-1' })
      await mount({ workspaceId: 'ws-2' })
      expect(list).toHaveBeenLastCalledWith({ workspaceId: 'ws-2' })
    })

    it('closes on Escape and returns focus to the title button', async () => {
      await mount()
      await open()
      await key(popover()!, 'Escape')
      expect(popover()).toBeNull()
      expect(document.activeElement).toBe(trigger())
    })

    it('closes on a click outside', async () => {
      await mount()
      await open()
      await act(async () => {
        document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      })
      expect(popover()).toBeNull()
    })

    it('is keyboard reachable: every row has real buttons in tab order', async () => {
      await mount()
      await open()
      const buttons = [...rows()[0]!.querySelectorAll('button')]
      expect(buttons).toHaveLength(3)
      expect(buttons.every((b) => b.tabIndex >= 0 && !b.disabled)).toBe(true)
      expect(buttons.slice(1).map((b) => b.getAttribute('aria-label'))).toEqual([
        en.askUniV2RenameConversation,
        en.askUniV2DeleteConversation,
      ])
    })

    it('moves between rows with the arrow keys', async () => {
      await mount()
      await open()
      const picks = rows().map((r) => r.querySelector('button') as HTMLButtonElement)
      picks[0]!.focus()
      await key(picks[0]!, 'ArrowDown')
      expect(document.activeElement).toBe(picks[1])
      await key(picks[1]!, 'ArrowUp')
      expect(document.activeElement).toBe(picks[0])
    })
  })

  describe('rename', () => {
    async function startRename(index = 0): Promise<HTMLInputElement> {
      if (!popover()) await open()
      const btn = byLabel(rows()[index]!, en.askUniV2RenameConversation)!
      await act(async () => btn.click())
      return host.querySelector('[data-slot="askuni-history"] input') as HTMLInputElement
    }

    it('edits inline with the current title selected and an 80 character cap', async () => {
      await mount()
      const input = await startRename()
      expect(input.value).toBe('Overdue tasks')
      expect(input.maxLength).toBe(80)
      expect(input.getAttribute('aria-label')).toBe(en.askUniV2RenameConversation)
      expect(document.activeElement).toBe(input)
    })

    it('Enter saves the trimmed title through the server and shows it', async () => {
      await mount()
      const input = await startRename()
      await typeInto(input, '  Late tasks  ')
      await key(input, 'Enter')
      await flush()
      expect(rename).toHaveBeenCalledWith({ conversationId: 'c1', title: 'Late tasks' })
      expect(host.querySelector('[data-slot="askuni-history"] input')).toBeNull()
      expect(rows()[0]!.textContent).toContain('Late tasks')
    })

    it('updates the header when the open conversation is renamed', async () => {
      await mount({ activeId: 'c1' })
      const input = await startRename()
      await typeInto(input, 'Late tasks')
      await key(input, 'Enter')
      await flush()
      expect(trigger().textContent).toContain('Late tasks')
    })

    it('Escape cancels without saving and keeps the list open', async () => {
      await mount()
      const input = await startRename()
      await typeInto(input, 'Nope')
      await key(input, 'Escape')
      expect(rename).not.toHaveBeenCalled()
      expect(host.querySelector('[data-slot="askuni-history"] input')).toBeNull()
      expect(popover()).not.toBeNull()
      expect(rows()[0]!.textContent).toContain('Overdue tasks')
    })

    it('an unchanged or blank title is not sent', async () => {
      await mount()
      let input = await startRename()
      await key(input, 'Enter')
      expect(rename).not.toHaveBeenCalled()
      input = await startRename()
      await typeInto(input, '   ')
      await key(input, 'Enter')
      expect(rename).not.toHaveBeenCalled()
    })

    it('Enter while an IME is composing does not save', async () => {
      await mount()
      const input = await startRename()
      await typeInto(input, 'Công việc')
      await key(input, 'Enter', { isComposing: true })
      await key(input, 'Enter', { keyCode: 229 })
      expect(rename).not.toHaveBeenCalled()
    })

    it('a rejected rename call (refused sender) keeps editing and says so', async () => {
      rename.mockRejectedValueOnce(new Error('ipc_sender_refused'))
      await mount()
      const input = await startRename()
      await typeInto(input, 'Late tasks')
      await key(input, 'Enter')
      await flush()
      expect(host.querySelector('[data-slot="askuni-history"] input')).not.toBeNull()
      expect(popover()!.querySelector('[role="alert"]')?.textContent).toContain(
        en.askUniV2RenameFailed,
      )
    })

    it('keeps editing and says so when the server refuses', async () => {
      rename.mockResolvedValueOnce({ ok: false, error: 'offline' })
      await mount()
      const input = await startRename()
      await typeInto(input, 'Late tasks')
      await key(input, 'Enter')
      await flush()
      expect(host.querySelector('[data-slot="askuni-history"] input')).not.toBeNull()
      expect(popover()!.querySelector('[role="alert"]')?.textContent).toContain(
        en.askUniV2RenameFailed,
      )
      expect(rows()[0]!.textContent).not.toContain('Late tasks')
    })

    it('ignores a second Enter while the first is still saving', async () => {
      let release: (r: AskUniOkResult) => void = () => undefined
      rename.mockImplementationOnce(() => new Promise((res) => (release = res)))
      await mount()
      const input = await startRename()
      await typeInto(input, 'Late tasks')
      await key(input, 'Enter')
      await key(input, 'Enter')
      expect(rename).toHaveBeenCalledTimes(1)
      await act(async () => release({ ok: true }))
      await flush()
    })
  })

  describe('delete', () => {
    async function startDelete(index = 0): Promise<void> {
      await open()
      const btn = byLabel(rows()[index]!, en.askUniV2DeleteConversation)!
      await act(async () => btn.click())
    }
    const dialog = () =>
      host.ownerDocument.querySelector('[role="alertdialog"]') as HTMLElement | null

    it('asks first, with the web wording, and nothing is deleted yet', async () => {
      await mount()
      await startDelete()
      expect(dialog()).not.toBeNull()
      expect(dialog()!.textContent).toContain(en.askUniV2DeleteConfirmTitle)
      expect(dialog()!.textContent).toContain(en.askUniV2DeleteConfirmDescription)
      expect(remove).not.toHaveBeenCalled()
    })

    it('Keep it leaves the conversation alone', async () => {
      await mount()
      await startDelete()
      const keep = [...dialog()!.querySelectorAll('button')].find(
        (b) => b.textContent === en.askUniV2DeleteCancel,
      ) as HTMLButtonElement
      await act(async () => keep.click())
      expect(dialog()).toBeNull()
      expect(remove).not.toHaveBeenCalled()
      expect(rows()).toHaveLength(3)
    })

    it('Escape on the confirmation cancels it and keeps the list open', async () => {
      await mount()
      await startDelete()
      await key(dialog()!, 'Escape')
      expect(dialog()).toBeNull()
      expect(popover()).not.toBeNull()
      expect(remove).not.toHaveBeenCalled()
    })

    it('confirming deletes on the server and drops the row', async () => {
      await mount({ activeId: 'c1' })
      await startDelete(1)
      const yes = [...dialog()!.querySelectorAll('button')].find(
        (b) => b.textContent === en.askUniV2DeleteConfirm,
      ) as HTMLButtonElement
      await act(async () => yes.click())
      await flush()
      expect(remove).toHaveBeenCalledWith({ conversationId: 'c2' })
      expect(dialog()).toBeNull()
      expect(rows().map((r) => r.textContent)).not.toContain(
        expect.stringContaining('Budget review'),
      )
      expect(rows()).toHaveLength(2)
      // another conversation was open: it stays open
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('deleting the open conversation starts a new one', async () => {
      await mount({ activeId: 'c1' })
      await startDelete(0)
      const yes = [...dialog()!.querySelectorAll('button')].find(
        (b) => b.textContent === en.askUniV2DeleteConfirm,
      ) as HTMLButtonElement
      await act(async () => yes.click())
      await flush()
      expect(onSelect).toHaveBeenCalledWith(null)
    })

    it('keeps the row and says so when the server refuses', async () => {
      remove.mockResolvedValueOnce({ ok: false, error: 'offline' })
      await mount()
      await startDelete()
      const yes = [...dialog()!.querySelectorAll('button')].find(
        (b) => b.textContent === en.askUniV2DeleteConfirm,
      ) as HTMLButtonElement
      await act(async () => yes.click())
      await flush()
      expect(rows()).toHaveLength(3)
      expect(popover()!.querySelector('[role="alert"]')?.textContent).toContain(
        en.askUniV2DeleteFailed,
      )
    })
  })
})
