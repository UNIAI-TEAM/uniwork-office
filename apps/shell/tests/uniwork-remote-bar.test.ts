/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, UniworkDocStatus, UniworkRemoteBar } from '../src/shared/home-api'
import { LocaleProvider, type StringKey } from '../src/renderer/src/locale'
import { UniworkRemoteBar as RemoteBar } from '../src/renderer/src/UniworkChrome'
import { REMOTE_BAR_AUTO_HIDE_MS, remoteBarModelOf } from '../src/renderer/src/uniwork-docs-model'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const PATH = 'C:\\ud\\uniwork-documents\\d1\\Plan.docx'

function status(
  remote?: UniworkRemoteBar,
  partial: Partial<UniworkDocStatus> = {},
): UniworkDocStatus {
  return {
    path: PATH,
    documentId: 'd1',
    workspaceId: 'w1',
    title: 'Plan',
    format: 'docx',
    access: 'edit',
    state: 'dirty',
    ...(remote ? { remote } : {}),
    ...partial,
  }
}

const text = (lang: 'en' | 'vi', key: StringKey, params: Record<string, string | number> = {}) =>
  (({ ...syncStrings[lang], ...uniworkDocumentStrings[lang] }) as Record<string, string>)[
    key
  ]!.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))

// ── model ───────────────────────────────────────────────

describe('remoteBarModelOf', () => {
  it('has no bar without a remote', () => {
    expect(remoteBarModelOf(status())).toBeNull()
  })

  it('updated: the no-revision sentence until author and time exist, then the full one', () => {
    const noRev = remoteBarModelOf(status({ kind: 'updated', version: null }))!
    expect(noRev).toMatchObject({
      tone: 'info',
      regionKey: 'uwRemoteRegion',
      messageKey: 'uwRemoteUpdatedNoRev',
    })
    expect(noRev.actions).toEqual([{ kind: 'close', labelKey: 'uwRemoteClose' }])
    expect(noRev.autoHideMs).toBe(REMOTE_BAR_AUTO_HIDE_MS)
    // a version but no author source yet: still no sentence with a hole in it
    expect(remoteBarModelOf(status({ kind: 'updated', version: 7 }))!.messageKey).toBe(
      'uwRemoteUpdatedNoRev',
    )
    expect(
      remoteBarModelOf(status({ kind: 'updated', version: 7 }), { author: 'An', time: '10:00' }),
    ).toMatchObject({
      messageKey: 'uwRemoteUpdated',
      params: { n: 7, author: 'An', time: '10:00' },
    })
    expect(
      remoteBarModelOf(status({ kind: 'updated', version: null }), { author: 'An', time: '10:00' })!
        .messageKey,
    ).toBe('uwRemoteUpdatedNoRev')
  })

  it('newer-dirty: Reload + Later; a save in flight or a stuck one disables Reload with its reason', () => {
    const plain = remoteBarModelOf(status({ kind: 'newer-dirty', version: 4 }))!
    expect(plain).toMatchObject({
      tone: 'warn',
      regionKey: 'uwRemoteRegion',
      messageKey: 'uwRemoteNewerDirty',
      params: { n: 4 },
    })
    expect(plain.actions).toEqual([
      { kind: 'reload', labelKey: 'uwRemoteReload' },
      { kind: 'later', labelKey: 'uwRemoteLater' },
    ])
    expect(plain.autoHideMs).toBeUndefined()
    const commit = remoteBarModelOf(status({ kind: 'newer-dirty', version: 4, wait: 'commit' }))!
    expect(commit.actions[0]!.disabledReasonKey).toBe('uwRemoteWaitCommit')
    const stuck = remoteBarModelOf(status({ kind: 'newer-dirty', version: 4, wait: 'stuck' }))!
    expect(stuck.actions[0]!.disabledReasonKey).toBe('uwRemoteWaitStuck')
    expect(stuck.actions[1]!.disabledReasonKey).toBeUndefined()
  })

  it('newer-ai: Reload is disabled until a stop channel exists (D3)', () => {
    const model = remoteBarModelOf(status({ kind: 'newer-ai', version: 9 }))!
    expect(model).toMatchObject({ tone: 'warn', messageKey: 'uwRemoteNewerAi', params: { n: 9 } })
    expect(model.actions[0]).toMatchObject({ kind: 'reload', disabledReasonKey: 'uwRemoteNewerAi' })
    expect(model.actions[1]).toEqual({ kind: 'later', labelKey: 'uwRemoteLater' })
  })

  it('now-clean, reload-failed, revoked and deleted', () => {
    expect(remoteBarModelOf(status({ kind: 'now-clean', version: 5 }))).toMatchObject({
      tone: 'info',
      regionKey: 'uwRemoteRegion',
      messageKey: 'uwRemoteNowClean',
      params: { n: 5 },
      actions: [{ kind: 'reload-now', labelKey: 'uwConflictReloadGo' }],
    })
    expect(remoteBarModelOf(status({ kind: 'reload-failed', version: 5 }))).toMatchObject({
      tone: 'error',
      regionKey: 'uwLockRegion',
      messageKey: 'uwRemoteReloadFailed',
      params: { n: 5 },
      actions: [{ kind: 'retry', labelKey: 'uwActRetry' }],
    })
    for (const [kind, key] of [
      ['revoked', 'uwRemoteRevoked'],
      ['deleted', 'uwRemoteDeleted'],
    ] as const) {
      expect(remoteBarModelOf(status({ kind }))).toMatchObject({
        tone: 'error',
        regionKey: 'uwLockRegion',
        messageKey: key,
        actions: [{ kind: 'close', labelKey: 'uwRemoteClose' }],
      })
    }
  })

  it('every key the bar uses has a vi and an en sentence', () => {
    const bars: UniworkRemoteBar[] = [
      { kind: 'updated', version: null },
      { kind: 'newer-dirty', version: 1, wait: 'stuck' },
      { kind: 'newer-dirty', version: 1, wait: 'commit' },
      { kind: 'newer-ai', version: 1 },
      { kind: 'now-clean', version: 1 },
      { kind: 'reload-failed', version: 1 },
      { kind: 'revoked' },
      { kind: 'deleted' },
    ]
    for (const bar of bars) {
      const model = remoteBarModelOf(status(bar))!
      const keys = [
        model.regionKey,
        model.messageKey,
        ...model.actions.flatMap((a) => [
          a.labelKey,
          ...(a.disabledReasonKey ? [a.disabledReasonKey] : []),
        ]),
      ]
      for (const lang of ['vi', 'en'] as const) {
        for (const key of keys) expect(text(lang, key, model.params), `${lang} ${key}`).toBeTruthy()
      }
    }
  })
})

// ── component ───────────────────────────────────────────

let host: HTMLDivElement
let root: Root
let remoteAction: ReturnType<typeof vi.fn>
let setBarInset: ReturnType<typeof vi.fn>
let onStatus: ReturnType<typeof vi.fn>
let barHeight: number

function install(): void {
  remoteAction = vi.fn(async (): Promise<UniworkDocStatus | null> => null)
  setBarInset = vi.fn(async () => undefined)
  onStatus = vi.fn()
  window.aiOffice = {
    uniworkRemoteAction: remoteAction,
    uniworkSetBarInset: setBarInset,
  } as unknown as HomeApi
}

async function mount(s: UniworkDocStatus | null, lang: 'en' | 'vi' = 'en'): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: lang },
        createElement(RemoteBar, { status: s, onStatus }),
      ),
    )
  })
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

const bars = () => host.querySelectorAll<HTMLElement>('.uw-remote-bar')
const bar = () => host.querySelector<HTMLElement>('.uw-remote-bar')
const button = (action: string) =>
  host.querySelector<HTMLButtonElement>(`.uw-remote-action[data-action="${action}"]`)

/** counts the sentences the live nodes were given (each announcement mounts a fresh child) */
function watchAnnouncements(): { count: () => number; stop: () => void } {
  let added = 0
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (!(record.target instanceof HTMLElement)) continue
      if (!record.target.classList.contains('uw-sr-only')) continue
      added += Array.from(record.addedNodes).filter((n) => n instanceof HTMLElement).length
    }
  })
  observer.observe(host, { childList: true, subtree: true })
  return { count: () => added, stop: () => observer.disconnect() }
}

async function click(el: HTMLElement | null): Promise<void> {
  expect(el, 'element to click').toBeTruthy()
  await act(async () => {
    el!.click()
  })
  await flush()
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  barHeight = 52
  install()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const h = this.classList.contains('uw-remote-bar') ? barHeight : 0
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: h,
      width: 0,
      height: h,
      toJSON: () => ({}),
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  act(() => root.unmount())
  host.remove()
})

describe('UniworkRemoteBar: what each bar shows', () => {
  const cases: Array<{
    name: string
    remote: UniworkRemoteBar
    region: StringKey
    message: StringKey
    params: Record<string, number>
    buttons: Array<[string, StringKey]>
    tone: string
  }> = [
    {
      name: 'updated',
      remote: { kind: 'updated', version: null },
      region: 'uwRemoteRegion',
      message: 'uwRemoteUpdatedNoRev',
      params: {},
      buttons: [['close', 'uwRemoteClose']],
      tone: 'info',
    },
    {
      name: 'newer-dirty',
      remote: { kind: 'newer-dirty', version: 4 },
      region: 'uwRemoteRegion',
      message: 'uwRemoteNewerDirty',
      params: { n: 4 },
      buttons: [
        ['reload', 'uwRemoteReload'],
        ['later', 'uwRemoteLater'],
      ],
      tone: 'warn',
    },
    {
      name: 'newer-ai',
      remote: { kind: 'newer-ai', version: 6 },
      region: 'uwRemoteRegion',
      message: 'uwRemoteNewerAi',
      params: { n: 6 },
      buttons: [
        ['reload', 'uwRemoteReload'],
        ['later', 'uwRemoteLater'],
      ],
      tone: 'warn',
    },
    {
      name: 'now-clean',
      remote: { kind: 'now-clean', version: 8 },
      region: 'uwRemoteRegion',
      message: 'uwRemoteNowClean',
      params: { n: 8 },
      buttons: [['reload-now', 'uwConflictReloadGo']],
      tone: 'info',
    },
    {
      name: 'reload-failed',
      remote: { kind: 'reload-failed', version: 3 },
      region: 'uwLockRegion',
      message: 'uwRemoteReloadFailed',
      params: { n: 3 },
      buttons: [['retry', 'uwActRetry']],
      tone: 'error',
    },
    {
      name: 'revoked',
      remote: { kind: 'revoked' },
      region: 'uwLockRegion',
      message: 'uwRemoteRevoked',
      params: {},
      buttons: [['close', 'uwRemoteClose']],
      tone: 'error',
    },
    {
      name: 'deleted',
      remote: { kind: 'deleted' },
      region: 'uwLockRegion',
      message: 'uwRemoteDeleted',
      params: {},
      buttons: [['close', 'uwRemoteClose']],
      tone: 'error',
    },
  ]

  for (const lang of ['en', 'vi'] as const) {
    for (const c of cases) {
      it(`${c.name} (${lang}): region label, sentence, buttons`, async () => {
        await mount(status(c.remote), lang)
        expect(bars()).toHaveLength(1)
        const el = bar()!
        expect(el.getAttribute('role')).toBe('region')
        expect(el.getAttribute('aria-label')).toBe(text(lang, c.region))
        expect(el.dataset.tone).toBe(c.tone)
        expect(el.querySelector('.uw-remote-message')!.textContent).toBe(
          text(lang, c.message, c.params),
        )
        expect(el.textContent).not.toMatch(/[{}]/)
        // the visible sentence is not live
        expect(el.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull()
        const labels = Array.from(el.querySelectorAll('.uw-remote-action')).map((b) => [
          (b as HTMLElement).dataset.action,
          b.textContent,
        ])
        expect(labels).toEqual(c.buttons.map(([a, k]) => [a, text(lang, k)]))
        for (const b of el.querySelectorAll('button')) {
          expect(b.getAttribute('type')).toBe('button')
          expect(b.hasAttribute('disabled')).toBe(false)
        }
      })
    }
  }

  it('shows no bar for a status without a remote, or no status', async () => {
    await mount(status())
    expect(bar()).toBeNull()
    await mount(null)
    expect(bar()).toBeNull()
  })

  it('one bar only: a newer notice replaces the version, another kind replaces the bar', async () => {
    await mount(status({ kind: 'newer-dirty', version: 4 }))
    await mount(status({ kind: 'newer-dirty', version: 5 }))
    expect(bars()).toHaveLength(1)
    expect(bar()!.querySelector('.uw-remote-message')!.textContent).toContain('version 5')
    await mount(status({ kind: 'revoked' }))
    expect(bars()).toHaveLength(1)
    expect(bar()!.dataset.kind).toBe('revoked')
  })
})

describe('UniworkRemoteBar: disabled actions', () => {
  it.each<[UniworkRemoteBar, StringKey]>([
    [{ kind: 'newer-dirty', version: 2, wait: 'commit' }, 'uwRemoteWaitCommit'],
    [{ kind: 'newer-dirty', version: 2, wait: 'stuck' }, 'uwRemoteWaitStuck'],
  ])(
    '%j: Reload is aria-disabled, focusable, and the reason is its description',
    async (remote, reason) => {
      await mount(status(remote))
      const reload = button('reload')!
      expect(reload.getAttribute('aria-disabled')).toBe('true')
      expect(reload.hasAttribute('disabled')).toBe(false)
      const described = document.getElementById(reload.getAttribute('aria-describedby')!)
      expect(described!.textContent).toBe(text('en', reason))
      expect(button('later')!.hasAttribute('aria-disabled')).toBe(false)
      reload.focus()
      expect(document.activeElement).toBe(reload)
      await click(reload)
      expect(remoteAction).not.toHaveBeenCalled()
    },
  )

  it('newer-ai: Reload is aria-disabled and described by the sentence of the bar', async () => {
    await mount(status({ kind: 'newer-ai', version: 2 }))
    const reload = button('reload')!
    expect(reload.getAttribute('aria-disabled')).toBe('true')
    const described = document.getElementById(reload.getAttribute('aria-describedby')!)
    expect(described).toBe(bar()!.querySelector('.uw-remote-message'))
    await click(reload)
    expect(remoteAction).not.toHaveBeenCalled()
  })

  it('an enabled Reload (dirty, nothing in flight) calls the bridge', async () => {
    await mount(status({ kind: 'newer-dirty', version: 2 }))
    expect(button('reload')!.hasAttribute('aria-disabled')).toBe(false)
    await click(button('reload'))
    expect(remoteAction).toHaveBeenCalledWith(PATH, 'reload')
  })
})

describe('UniworkRemoteBar: actions', () => {
  it('Later calls the bridge, hides the bar at once and takes the status main answers with', async () => {
    const next = status({ kind: 'newer-dirty', version: 4 })
    remoteAction.mockResolvedValueOnce(next)
    await mount(status({ kind: 'newer-dirty', version: 4 }))
    await click(button('later'))
    expect(remoteAction).toHaveBeenCalledWith(PATH, 'later')
    expect(onStatus).toHaveBeenCalledWith(next)
    // main keeps the remote (the pill stays), the bar stays hidden for the same version
    await mount(next)
    expect(bar()).toBeNull()
    // a newer revision brings it back, one bar
    await mount(status({ kind: 'newer-dirty', version: 5 }))
    expect(bars()).toHaveLength(1)
    expect(bar()!.querySelector('.uw-remote-message')!.textContent).toContain('version 5')
  })

  it('Later holds for the notice, not for its wait: a settled commit keeps the bar hidden, a newer version brings it back', async () => {
    await mount(status({ kind: 'newer-dirty', version: 4, wait: 'commit' }))
    expect(button('later')!.hasAttribute('aria-disabled')).toBe(false)
    await click(button('later'))
    expect(bar()).toBeNull()
    const watch = watchAnnouncements()
    // the commit settled: main drops `wait`, same version, same notice
    await mount(status({ kind: 'newer-dirty', version: 4 }))
    expect(bar()).toBeNull()
    // the same version as an AI notice is still the put-off notice
    await mount(status({ kind: 'newer-ai', version: 4 }))
    expect(bar()).toBeNull()
    expect(watch.count()).toBe(0)
    // a newer revision shows it again, once, announced
    await mount(status({ kind: 'newer-dirty', version: 5 }))
    expect(bars()).toHaveLength(1)
    expect(bar()!.querySelector('.uw-remote-message')!.textContent).toContain('version 5')
    expect(watch.count()).toBe(1)
    expect(host.querySelector('[role="status"]')!.textContent).toBe(
      text('en', 'uwRemoteNewerDirty', { n: 5 }),
    )
    watch.stop()
  })

  it('Close (updated, revoked) calls the bridge and hides the bar', async () => {
    await mount(status({ kind: 'updated', version: null }))
    await click(button('close'))
    expect(remoteAction).toHaveBeenCalledWith(PATH, 'close')
    expect(bar()).toBeNull()

    await mount(status({ kind: 'revoked' }))
    await click(button('close'))
    expect(remoteAction).toHaveBeenLastCalledWith(PATH, 'close')
    expect(bar()).toBeNull()
  })

  it('a closed bar shows again when the same kind comes back after the bar was gone', async () => {
    await mount(status({ kind: 'updated', version: null }))
    await click(button('close'))
    expect(bar()).toBeNull()
    await mount(status())
    await mount(status({ kind: 'updated', version: null }))
    expect(bar()).not.toBeNull()
  })

  it('Retry (reload failed) and Reload (now clean) call the bridge and keep the bar until main answers', async () => {
    await mount(status({ kind: 'reload-failed', version: 3 }))
    await click(button('retry'))
    expect(remoteAction).toHaveBeenCalledWith(PATH, 'retry')
    expect(bar()).not.toBeNull()

    await mount(status({ kind: 'now-clean', version: 3 }))
    await click(button('reload-now'))
    expect(remoteAction).toHaveBeenLastCalledWith(PATH, 'reload-now')
  })

  it('a bridge that rejects leaves the bar as it was', async () => {
    remoteAction.mockRejectedValueOnce(new Error('gone'))
    await mount(status({ kind: 'reload-failed', version: 3 }))
    await click(button('retry'))
    expect(bar()).not.toBeNull()
    expect(button('retry')!.hasAttribute('aria-disabled')).toBe(false)
  })
})

describe('UniworkRemoteBar: announcements', () => {
  const polite = () => host.querySelector('[role="status"]')!
  const alert = () => host.querySelector('[role="alert"]')!

  it('a newer version is announced once, politely', async () => {
    await mount(status({ kind: 'newer-dirty', version: 4 }))
    expect(polite().getAttribute('aria-live')).toBe('polite')
    expect(polite().textContent).toBe(text('en', 'uwRemoteNewerDirty', { n: 4 }))
    expect(alert().textContent).toBe('')
    // the same bar again (a status push that changes nothing about it) says nothing new
    const spoken = polite().firstElementChild
    await mount(status({ kind: 'newer-dirty', version: 4 }, { state: 'saved' }))
    expect(polite().firstElementChild).toBe(spoken)
  })

  it('switching tabs away and back does not announce the same bar again', async () => {
    const other = 'C:\\ud\\uniwork-documents\\d2\\Other.docx'
    await mount(status({ kind: 'newer-dirty', version: 4 }))
    const watch = watchAnnouncements()
    await mount(status(undefined, { path: other }))
    await mount(status({ kind: 'newer-dirty', version: 4 }))
    expect(bar()).not.toBeNull()
    expect(watch.count()).toBe(0)
    // another tab with a notice of its own is announced, once
    await mount(status({ kind: 'newer-dirty', version: 4 }, { path: other }))
    expect(watch.count()).toBe(1)
    await mount(status({ kind: 'newer-dirty', version: 4 }))
    expect(watch.count()).toBe(1)
    watch.stop()
  })

  it('a newer version of the same notice is announced again, and the live text is cleared when the bar hides', async () => {
    await mount(status({ kind: 'newer-dirty', version: 4 }))
    expect(polite().textContent).not.toBe('')
    await mount(status({ kind: 'newer-dirty', version: 5 }))
    expect(polite().textContent).toBe(text('en', 'uwRemoteNewerDirty', { n: 5 }))
    await click(button('later'))
    expect(bar()).toBeNull()
    expect(polite().textContent).toBe('')
    expect(alert().textContent).toBe('')
  })

  it('an error kind is announced as an alert', async () => {
    await mount(status({ kind: 'deleted' }))
    expect(alert().textContent).toBe(text('en', 'uwRemoteDeleted'))
    expect(polite().textContent).toBe('')
  })

  it('the live nodes are in the DOM before any bar shows', async () => {
    await mount(status())
    expect(host.querySelector('[role="status"]')).not.toBeNull()
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
  })
})

describe('UniworkRemoteBar: auto-hide of the information bar', () => {
  const clean = () => status({ kind: 'updated', version: null })

  it('hides after 8 s and tells main it was closed', async () => {
    vi.useFakeTimers()
    await mount(clean())
    expect(bar()).not.toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(REMOTE_BAR_AUTO_HIDE_MS - 1)
    })
    expect(bar()).not.toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(bar()).toBeNull()
    expect(remoteAction).toHaveBeenCalledWith(PATH, 'close')
  })

  it('hover holds the bar; leaving restarts the full 8 s', async () => {
    vi.useFakeTimers()
    await mount(clean())
    await act(async () => {
      vi.advanceTimersByTime(5000)
      bar()!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      bar()!.dispatchEvent(new MouseEvent('mouseenter'))
    })
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(bar()).not.toBeNull()
    await act(async () => {
      bar()!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
      bar()!.dispatchEvent(new MouseEvent('mouseleave'))
    })
    await act(async () => {
      vi.advanceTimersByTime(REMOTE_BAR_AUTO_HIDE_MS - 1)
    })
    expect(bar()).not.toBeNull()
    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(bar()).toBeNull()
  })

  it('focus inside the bar holds it; moving the focus out restarts the timer', async () => {
    vi.useFakeTimers()
    await mount(clean())
    const close = button('close')!
    await act(async () => {
      close.focus()
    })
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(bar()).not.toBeNull()
    await act(async () => {
      close.blur()
    })
    await act(async () => {
      vi.advanceTimersByTime(REMOTE_BAR_AUTO_HIDE_MS)
    })
    expect(bar()).toBeNull()
  })

  it('warn, error and now-clean bars never hide on their own', async () => {
    vi.useFakeTimers()
    for (const remote of [
      { kind: 'newer-dirty', version: 2 },
      { kind: 'newer-ai', version: 2 },
      { kind: 'now-clean', version: 2 },
      { kind: 'reload-failed', version: 2 },
      { kind: 'revoked' },
    ] as UniworkRemoteBar[]) {
      await mount(status(remote))
      await act(async () => {
        vi.advanceTimersByTime(120_000)
      })
      expect(bar(), remote.kind).not.toBeNull()
    }
    expect(remoteAction).not.toHaveBeenCalled()
  })
})

describe('UniworkRemoteBar: the inset under the tab strip', () => {
  it('reports the rendered height, then 0 when the bar goes away', async () => {
    await mount(status({ kind: 'newer-dirty', version: 4 }))
    expect(setBarInset).toHaveBeenLastCalledWith(52)
    await mount(status())
    expect(setBarInset).toHaveBeenLastCalledWith(0)
  })

  it('reports 0 for no document tab (Home) and again for every tab switch', async () => {
    await mount(null)
    expect(setBarInset).toHaveBeenLastCalledWith(0)
    await mount(status({ kind: 'revoked' }))
    expect(setBarInset).toHaveBeenLastCalledWith(52)
    const before = setBarInset.mock.calls.length
    await mount(status({ kind: 'revoked' }, { path: 'C:\\ud\\uniwork-documents\\d2\\Other.docx' }))
    expect(setBarInset.mock.calls.length).toBeGreaterThan(before)
    expect(setBarInset).toHaveBeenLastCalledWith(52)
    await mount(status(undefined, { path: 'C:\\ud\\uniwork-documents\\d3\\Third.docx' }))
    expect(setBarInset).toHaveBeenLastCalledWith(0)
  })

  it('follows a resize of the bar (wrapping at a narrow width) and rounds up', async () => {
    let observed: (() => void) | null = null
    class FakeObserver {
      constructor(cb: () => void) {
        observed = cb
      }
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', FakeObserver)
    try {
      await mount(status({ kind: 'newer-dirty', version: 4 }))
      expect(setBarInset).toHaveBeenLastCalledWith(52)
      barHeight = 96.4
      await act(async () => {
        observed!()
      })
      expect(setBarInset).toHaveBeenLastCalledWith(97)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports 0 when the bar is closed, and on unmount', async () => {
    await mount(status({ kind: 'updated', version: null }))
    await click(button('close'))
    expect(setBarInset).toHaveBeenLastCalledWith(0)
    await mount(status({ kind: 'revoked' }))
    act(() => root.unmount())
    expect(setBarInset).toHaveBeenLastCalledWith(0)
    root = createRoot(host)
  })

  it('survives a host without the inset channel', async () => {
    window.aiOffice = { uniworkRemoteAction: remoteAction } as unknown as HomeApi
    await mount(status({ kind: 'revoked' }))
    expect(bar()).not.toBeNull()
  })
})
