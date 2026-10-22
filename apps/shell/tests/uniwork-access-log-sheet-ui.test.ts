/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import {
  AccessLogSheet,
  type AccessLogSheetTarget,
} from '../src/renderer/src/uniwork-doc-history/AccessLogSheet'
import { uniworkAccessLogStrings } from '../src/renderer/src/i18n/strings-uniwork-access-log'
import type { DocAccessLog } from '../src/shared/doc-history-api'
import {
  accessLogOf,
  createFakeDocHistoryBridge,
  failure,
  type FakeDocHistoryBridge,
} from './doc-history-fake-bridge'

/**
 * UNI-2077 UI-L: the Access log sheet on the fake bridge: manage-only gate, loading / empty / error
 * states, the action filter, actor labels, the break-glass marker and the paging.
 */

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const en = uniworkAccessLogStrings.en as Record<string, string>
const vi_ = uniworkAccessLogStrings.vi as Record<string, string>

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

const target = (partial: Partial<AccessLogSheetTarget> = {}): AccessLogSheetTarget => ({
  id: 'doc-1',
  title: 'Báo cáo.docx',
  myLevel: 'manage',
  ...partial,
})

describe('AccessLogSheet (UNI-2077)', () => {
  let host: HTMLDivElement
  let root: Root
  let onClose: ReturnType<typeof vi.fn>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    onClose = vi.fn()
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    document.body.innerHTML = ''
  })

  async function open(
    bridge: FakeDocHistoryBridge | null,
    row: AccessLogSheetTarget = target(),
    lang: 'en' | 'vi' = 'en',
  ) {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: lang },
          createElement(AccessLogSheet, { open: true, onClose, row, api: bridge }),
        ),
      )
    })
    await flush()
  }
  const q = <E extends Element = HTMLElement>(sel: string) => host.querySelector<E>(sel)
  const rows = () => Array.from(host.querySelectorAll<HTMLElement>('[data-access-log-row]'))
  const button = (label: string) =>
    Array.from(host.querySelectorAll<HTMLElement>('button')).find(
      (b) => b.textContent?.trim() === label,
    )
  async function click(el: Element | null | undefined) {
    expect(el).toBeTruthy()
    await act(async () => {
      el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await flush()
  }
  async function choose(select: HTMLSelectElement, value: string) {
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      set.call(select, value)
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
  }

  it('is a labelled dialog with the title, the description and a Close button', async () => {
    const bridge = createFakeDocHistoryBridge()
    await open(bridge)
    const dialog = q('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const title = document.getElementById(dialog.getAttribute('aria-labelledby')!)!
    expect(title.textContent).toBe(en.algTitle)
    expect(dialog.textContent).toContain(en.algDescription)
    await click(q('[data-access-log-close]'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing while closed', async () => {
    await act(async () => {
      root.render(
        createElement(
          LocaleProvider,
          { initial: 'en' },
          createElement(AccessLogSheet, {
            open: false,
            onClose,
            row: target(),
            api: createFakeDocHistoryBridge(),
          }),
        ),
      )
    })
    expect(q('[role="dialog"]')).toBeNull()
  })

  describe('gate', () => {
    it('a non-manager reads the manage-only note and no request is made', async () => {
      const bridge = createFakeDocHistoryBridge()
      await open(bridge, target({ myLevel: 'edit' }))
      expect(q('[data-access-log-manage-only]')!.textContent).toBe(en.algManageOnly)
      expect(q('select')).toBeNull()
      expect(bridge.accessLogs).not.toHaveBeenCalled()
    })
    it('an admin scope without a level reads the log', async () => {
      const bridge = createFakeDocHistoryBridge()
      await open(bridge, target({ myLevel: undefined, adminScope: true }))
      expect(bridge.accessLogs).toHaveBeenCalledTimes(1)
      expect(rows()).toHaveLength(1)
    })
    it('a 403 from the server degrades to the same note (the level dropped meanwhile)', async () => {
      const bridge = createFakeDocHistoryBridge()
      bridge.accessLogs.mockResolvedValueOnce(failure('forbidden', { status: 403 }))
      await open(bridge)
      expect(q('[data-access-log-manage-only]')).not.toBeNull()
      expect(q('[role="alert"]')).toBeNull()
    })
    it('no bridge (an old main) shows the error, never a crash', async () => {
      await open(null)
      expect(q('[role="alert"]')!.textContent).toBe(en.algError)
    })
  })

  describe('states', () => {
    it('shows a busy skeleton while loading, then the rows', async () => {
      let resolve!: (v: Awaited<ReturnType<FakeDocHistoryBridge['accessLogs']>>) => void
      const bridge = createFakeDocHistoryBridge()
      bridge.accessLogs.mockImplementationOnce(() => new Promise((r) => (resolve = r)))
      await open(bridge)
      expect(q('[data-access-log-loading]')!.getAttribute('aria-busy')).toBe('true')
      expect(rows()).toHaveLength(0)
      await act(async () =>
        resolve({ ok: true, value: { logs: [accessLogOf()], next_cursor: null } }),
      )
      await flush()
      expect(q('[data-access-log-loading]')).toBeNull()
      expect(rows()).toHaveLength(1)
    })
    it('an empty log says so', async () => {
      await open(createFakeDocHistoryBridge({ logs: [] }))
      expect(q('[data-access-log-empty]')!.textContent).toBe(en.algEmpty)
    })
    it('an error shows an alert with Retry, and Retry loads again', async () => {
      const bridge = createFakeDocHistoryBridge()
      bridge.accessLogs.mockResolvedValueOnce(failure('network'))
      await open(bridge)
      expect(q('[role="alert"]')!.textContent).toContain(en.algError)
      await click(button('Retry'))
      expect(bridge.accessLogs).toHaveBeenCalledTimes(2)
      expect(q('[role="alert"]')).toBeNull()
      expect(rows()).toHaveLength(1)
    })
    it('a bridge call that rejects reads as an error with Retry, never a skeleton forever', async () => {
      const bridge = createFakeDocHistoryBridge()
      bridge.accessLogs.mockRejectedValueOnce(new Error('handler missing'))
      await open(bridge)
      expect(q('[role="alert"]')!.textContent).toContain(en.algError)
      expect(q('[aria-busy="true"]')).toBeNull()
      await click(button('Retry'))
      expect(bridge.accessLogs).toHaveBeenCalledTimes(2)
      expect(q('[role="alert"]')).toBeNull()
      expect(rows()).toHaveLength(1)
    })
    it('asks for the first page with the web page size and no action', async () => {
      const bridge = createFakeDocHistoryBridge()
      await open(bridge)
      expect(bridge.accessLogs).toHaveBeenCalledWith({
        documentId: 'doc-1',
        limit: 50,
        action: '',
      })
    })
  })

  describe('filter (UI-Lfilter)', () => {
    const logs: DocAccessLog[] = [
      accessLogOf({ id: 'l1', action: 'view' }),
      accessLogOf({ id: 'l2', action: 'download' }),
      accessLogOf({ id: 'l3', action: 'link_view', via: 'link' }),
    ]
    it('offers all + the four actions under the web labels', async () => {
      await open(createFakeDocHistoryBridge({ logs }))
      const select = q<HTMLSelectElement>('select')!
      expect(select.getAttribute('aria-label')).toBe(en.algFilterLabel)
      expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
        ['', en.algFilterAll],
        ['view', en.algActionView],
        ['download', en.algActionDownload],
        ['export', en.algActionExport],
        ['link_view', en.algActionLinkView],
      ])
    })
    it('choosing an action refetches from the first page with that action', async () => {
      const bridge = createFakeDocHistoryBridge({ logs })
      await open(bridge)
      expect(rows()).toHaveLength(3)
      await choose(q<HTMLSelectElement>('select')!, 'download')
      expect(bridge.accessLogs).toHaveBeenLastCalledWith({
        documentId: 'doc-1',
        limit: 50,
        action: 'download',
      })
      expect(rows()).toHaveLength(1)
      await choose(q<HTMLSelectElement>('select')!, '')
      expect(rows()).toHaveLength(3)
    })
    it('a slow answer of the previous filter never overwrites the new one', async () => {
      const bridge = createFakeDocHistoryBridge({ logs })
      let late!: () => void
      bridge.accessLogs.mockImplementationOnce(
        () =>
          new Promise((r) => {
            late = () => r({ ok: true, value: { logs, next_cursor: null } })
          }),
      )
      await open(bridge)
      await choose(q<HTMLSelectElement>('select')!, 'download')
      expect(rows()).toHaveLength(1)
      await act(async () => late())
      await flush()
      expect(rows()).toHaveLength(1)
    })
    it('the filter stays usable while an error shows (Retry keeps the chosen action)', async () => {
      const bridge = createFakeDocHistoryBridge({ logs })
      await open(bridge)
      bridge.accessLogs.mockResolvedValueOnce(failure('server_error', { status: 500 }))
      await choose(q<HTMLSelectElement>('select')!, 'export')
      expect(q('[role="alert"]')).not.toBeNull()
      await click(button('Retry'))
      expect(bridge.accessLogs).toHaveBeenLastCalledWith({
        documentId: 'doc-1',
        limit: 50,
        action: 'export',
      })
    })
  })

  describe('rows', () => {
    it('shows actor, action, via, version and the time', async () => {
      await open(
        createFakeDocHistoryBridge({
          logs: [accessLogOf({ via: 'share', action: 'download', version: 3 })],
        }),
      )
      const row = rows()[0]!
      expect(row.querySelector('[data-access-log-actor]')!.textContent).toBe('Nguyễn Văn A')
      const meta = row.querySelector('[data-access-log-meta]')!.textContent!
      expect(meta).toBe(`${en.algActionDownload} · direct share · version 3`)
      expect(row.querySelector('time')!.getAttribute('datetime')).toBe('2099-01-02T03:04:05Z')
    })
    it('vi copy', async () => {
      await open(createFakeDocHistoryBridge(), target(), 'vi')
      expect(q('[role="dialog"]')!.textContent).toContain(vi_.algDescription)
      expect(rows()[0]!.textContent).toContain('phiên bản 3')
    })
    it('names anonymous, system and unresolved actors; never prints an actor id', async () => {
      await open(
        createFakeDocHistoryBridge({
          logs: [
            accessLogOf({
              id: 'a',
              actor: null,
              actor_kind: 'anonymous',
              actor_id: null,
              via: 'link',
            }),
            accessLogOf({ id: 's', actor: null, actor_kind: 'system', actor_id: null }),
            accessLogOf({ id: 'u', actor: null, actor_kind: 'human', actor_id: 'user-secret-9' }),
          ],
        }),
      )
      const names = rows().map((r) => r.querySelector('[data-access-log-actor]')!.textContent)
      expect(names).toEqual([en.algActorAnonymous, en.algActorSystem, en.algActorUnknown])
      expect(host.textContent).not.toContain('user-secret-9')
    })
    it('omits an empty via and a missing version', async () => {
      await open(
        createFakeDocHistoryBridge({
          logs: [accessLogOf({ via: '', version: null, action: 'view' })],
        }),
      )
      expect(rows()[0]!.querySelector('[data-access-log-meta]')!.textContent).toBe(en.algActionView)
    })
    it('an unknown action reads Other and an unknown via is printed as sent', async () => {
      await open(
        createFakeDocHistoryBridge({
          logs: [accessLogOf({ action: 'purge', via: 'teleport', version: null })],
        }),
      )
      expect(rows()[0]!.querySelector('[data-access-log-meta]')!.textContent).toBe(
        `${en.algActionUnknown} · teleport`,
      )
    })
    it('a break-glass row says Emergency access once, in its meta line, like the web', async () => {
      await open(
        createFakeDocHistoryBridge({
          logs: [
            accessLogOf({ id: 'bg', via: 'break_glass' }),
            accessLogOf({ id: 'm', via: 'member' }),
          ],
        }),
      )
      const [bg, member] = rows()
      expect(bg!.getAttribute('data-via')).toBe('break_glass')
      expect(bg!.querySelector('[data-access-log-break-glass]')).toBeNull()
      expect(bg!.querySelector('[data-access-log-meta]')!.textContent).toContain('Emergency access')
      expect(bg!.textContent!.split('Emergency access')).toHaveLength(2)
      expect(member!.textContent).not.toContain('Emergency access')
    })
  })

  describe('manage-only note', () => {
    it('reads in the primary text colour so dark mode keeps 4.5:1 (UNI-2077 TV F-1)', () => {
      const css = readFileSync(
        join(__dirname, '../src/renderer/src/uniwork-doc-history/access-log-sheet.css'),
        'utf8',
      )
      const rule = /\.modal\.uw-act \.alg-note \{([^}]*)\}/.exec(css)![1]!
      expect(rule).toMatch(/color:\s*var\(--text\);/)
    })
  })

  describe('paging', () => {
    it('Load more fetches the next cursor and appends; no button on the last page', async () => {
      const bridge = createFakeDocHistoryBridge()
      bridge.accessLogs
        .mockResolvedValueOnce({
          ok: true,
          value: { logs: [accessLogOf({ id: 'p1' })], next_cursor: 'c1' },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: { logs: [accessLogOf({ id: 'p2' })], next_cursor: null },
        })
      await open(bridge)
      expect(rows()).toHaveLength(1)
      await click(button('Load more'))
      expect(bridge.accessLogs).toHaveBeenLastCalledWith({
        documentId: 'doc-1',
        limit: 50,
        action: '',
        cursor: 'c1',
      })
      expect(rows().map((r) => r.getAttribute('data-access-log-row'))).toEqual(['p1', 'p2'])
      expect(button('Load more')).toBeUndefined()
    })
    it('a failed next page keeps the rows and offers the same button again', async () => {
      const bridge = createFakeDocHistoryBridge()
      bridge.accessLogs
        .mockResolvedValueOnce({
          ok: true,
          value: { logs: [accessLogOf({ id: 'p1' })], next_cursor: 'c1' },
        })
        .mockResolvedValueOnce(failure('timeout'))
      await open(bridge)
      await click(button('Load more'))
      expect(rows()).toHaveLength(1)
      expect(q('[role="alert"]')!.textContent).toContain(en.algError)
      expect(button('Load more')).toBeTruthy()
    })
    it('the last page moves the focus to its first row instead of dropping it to the body', async () => {
      const bridge = createFakeDocHistoryBridge()
      bridge.accessLogs
        .mockResolvedValueOnce({
          ok: true,
          value: { logs: [accessLogOf({ id: 'p1' })], next_cursor: 'c1' },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: {
            logs: [accessLogOf({ id: 'p2' }), accessLogOf({ id: 'p3' })],
            next_cursor: null,
          },
        })
      await open(bridge)
      const more = button('Load more') as HTMLButtonElement
      more.focus()
      expect(document.activeElement).toBe(more)
      await click(more)
      expect(button('Load more')).toBeUndefined()
      expect(document.activeElement).toBe(rows()[1])
      expect(rows()[1]!.getAttribute('data-access-log-row')).toBe('p2')
    })
    it('a page that leaves the button in place keeps the focus on it', async () => {
      const bridge = createFakeDocHistoryBridge()
      bridge.accessLogs
        .mockResolvedValueOnce({
          ok: true,
          value: { logs: [accessLogOf({ id: 'p1' })], next_cursor: 'c1' },
        })
        .mockResolvedValueOnce({
          ok: true,
          value: { logs: [accessLogOf({ id: 'p2' })], next_cursor: 'c2' },
        })
      await open(bridge)
      const more = button('Load more') as HTMLButtonElement
      more.focus()
      await click(more)
      expect(document.activeElement).toBe(button('Load more'))
    })
    it('a next page that rejects keeps the rows and Load more usable', async () => {
      const bridge = createFakeDocHistoryBridge()
      bridge.accessLogs
        .mockResolvedValueOnce({
          ok: true,
          value: { logs: [accessLogOf({ id: 'p1' })], next_cursor: 'c1' },
        })
        .mockRejectedValueOnce(new Error('channel closed'))
        .mockResolvedValueOnce({
          ok: true,
          value: { logs: [accessLogOf({ id: 'p2' })], next_cursor: null },
        })
      await open(bridge)
      await click(button('Load more'))
      expect(rows()).toHaveLength(1)
      expect(q('[role="alert"]')!.textContent).toContain(en.algError)
      const more = button('Load more') as HTMLButtonElement
      expect(more.disabled).toBe(false)
      await click(more)
      expect(rows().map((r) => r.getAttribute('data-access-log-row'))).toEqual(['p1', 'p2'])
    })
    it('the button is aria-disabled and busy while the next page loads (keeps focus, no double fetch)', async () => {
      const bridge = createFakeDocHistoryBridge()
      let resolve!: () => void
      bridge.accessLogs
        .mockResolvedValueOnce({
          ok: true,
          value: { logs: [accessLogOf({ id: 'p1' })], next_cursor: 'c1' },
        })
        .mockImplementationOnce(
          () =>
            new Promise((r) => {
              resolve = () => r({ ok: true, value: { logs: [], next_cursor: null } })
            }),
        )
      await open(bridge)
      await click(button('Load more'))
      const more = button('Load more') as HTMLButtonElement
      expect(more.disabled).toBe(false)
      expect(more.getAttribute('aria-disabled')).toBe('true')
      expect(more.getAttribute('aria-busy')).toBe('true')
      await click(more)
      expect(bridge.accessLogs).toHaveBeenCalledTimes(2)
      await act(async () => resolve())
      await flush()
    })
  })

  describe('keyboard', () => {
    it('Escape closes it and the focus starts inside the sheet', async () => {
      await open(createFakeDocHistoryBridge())
      const dialog = q('[role="dialog"]')!
      expect(dialog.contains(document.activeElement)).toBe(true)
      await act(async () => {
        dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
