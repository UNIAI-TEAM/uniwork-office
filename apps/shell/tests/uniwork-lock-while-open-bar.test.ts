/**
 * @vitest-environment jsdom
 *
 * G5-08c: the Lock-while-open bar (EXPERIENCE Component Patterns, S11): a document that was
 * open and dirty when its lock happened keeps its buffer read-only, and the S6 bar says so.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HomeApi,
  UniworkDocStatus,
  UniworkLockWhileOpen,
  UniworkRemoteBar,
} from '../src/shared/home-api'
import { LocaleProvider, type StringKey } from '../src/renderer/src/locale'
import { UniworkRemoteBar as RemoteBar } from '../src/renderer/src/UniworkChrome'
import { remoteBarModelOf } from '../src/renderer/src/uniwork-docs-model'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const PATH = 'C:\\ud\\uniwork-documents\\d1\\Plan.docx'

function status(
  lock?: UniworkLockWhileOpen,
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
    ...(lock ? { lockWhileOpen: lock } : {}),
    ...partial,
  }
}

const text = (lang: 'en' | 'vi', key: StringKey) =>
  (({ ...syncStrings[lang], ...uniworkDocumentStrings[lang] }) as Record<string, string>)[key]!

const STORE: UniworkLockWhileOpen = { mode: 'store', reason: 'lease_expired' }
const RAM: UniworkLockWhileOpen = { mode: 'ram', reason: 'keystore_locked' }

// ── model ───────────────────────────────────────────────

describe('remoteBarModelOf: lock while open', () => {
  it('store mode: an error bar with the uwLockWhileOpen sentence under the document-status landmark', () => {
    const model = remoteBarModelOf(status(STORE))!
    expect(model).toMatchObject({
      tone: 'error',
      regionKey: 'uwLockRegion',
      messageKey: 'uwLockWhileOpen',
      params: {},
    })
    // the spine names no action for this bar, and it never hides on its own
    expect(model.actions).toEqual([])
    expect(model.autoHideMs).toBeUndefined()
  })

  it('ram mode: the uwLockWhileOpenRam sentence', () => {
    expect(remoteBarModelOf(status(RAM))).toMatchObject({
      tone: 'error',
      regionKey: 'uwLockRegion',
      messageKey: 'uwLockWhileOpenRam',
      actions: [],
    })
  })

  it('every reason shows the sentence of its mode', () => {
    const reasons: UniworkLockWhileOpen['reason'][] = [
      'lease_expired',
      'clock_rollback',
      'permission_revoked',
      'document_deleted',
      'keystore_locked',
      'store_full',
      'signed_out',
    ]
    for (const reason of reasons) {
      expect(remoteBarModelOf(status({ mode: 'store', reason }))!.messageKey).toBe(
        'uwLockWhileOpen',
      )
      expect(remoteBarModelOf(status({ mode: 'ram', reason }))!.messageKey).toBe(
        'uwLockWhileOpenRam',
      )
    }
  })

  it('outranks every remote-newer bar', () => {
    const remotes: UniworkRemoteBar[] = [
      { kind: 'updated', version: 3 },
      { kind: 'newer-dirty', version: 4, wait: 'commit' },
      { kind: 'newer-ai', version: 5 },
      { kind: 'now-clean', version: 6 },
      { kind: 'reload-failed', version: 7 },
      { kind: 'revoked' },
      { kind: 'deleted' },
    ]
    for (const remote of remotes) {
      expect(remoteBarModelOf(status(STORE, { remote }))!.messageKey, remote.kind).toBe(
        'uwLockWhileOpen',
      )
      expect(remoteBarModelOf(status(RAM, { remote }))!.messageKey, remote.kind).toBe(
        'uwLockWhileOpenRam',
      )
    }
  })

  it('without the field the previous behaviour is unchanged', () => {
    expect(remoteBarModelOf(status())).toBeNull()
    expect(
      remoteBarModelOf(status(undefined, { remote: { kind: 'newer-dirty', version: 4 } })),
    ).toMatchObject({
      tone: 'warn',
      regionKey: 'uwRemoteRegion',
      messageKey: 'uwRemoteNewerDirty',
      params: { n: 4 },
    })
  })

  it('both sentences and the landmark exist in vi and en', () => {
    for (const lang of ['vi', 'en'] as const) {
      for (const key of ['uwLockRegion', 'uwLockWhileOpen', 'uwLockWhileOpenRam'] as const) {
        expect(text(lang, key), `${lang} ${key}`).toBeTruthy()
      }
    }
  })
})

// ── component ───────────────────────────────────────────

let host: HTMLDivElement
let root: Root
let remoteAction: ReturnType<typeof vi.fn>
let onStatus: ReturnType<typeof vi.fn>

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

const bars = () => host.querySelectorAll<HTMLElement>('.uw-remote-bar')
const bar = () => host.querySelector<HTMLElement>('.uw-remote-bar')
const polite = () => host.querySelector('[role="status"]')!
const alert = () => host.querySelector('[role="alert"]')!

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

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  remoteAction = vi.fn(async (): Promise<UniworkDocStatus | null> => null)
  onStatus = vi.fn()
  window.aiOffice = {
    uniworkRemoteAction: remoteAction,
    uniworkSetBarInset: vi.fn(async () => undefined),
  } as unknown as HomeApi
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  act(() => root.unmount())
  host.remove()
})

describe('UniworkRemoteBar: lock while open', () => {
  for (const lang of ['en', 'vi'] as const) {
    it(`store mode (${lang}): region label, uwLockWhileOpen, no buttons`, async () => {
      await mount(status(STORE), lang)
      expect(bars()).toHaveLength(1)
      const el = bar()!
      expect(el.getAttribute('role')).toBe('region')
      expect(el.getAttribute('aria-label')).toBe(text(lang, 'uwLockRegion'))
      expect(el.dataset.tone).toBe('error')
      expect(el.querySelector('.uw-remote-message')!.textContent).toBe(
        text(lang, 'uwLockWhileOpen'),
      )
      expect(el.querySelectorAll('button')).toHaveLength(0)
    })

    it(`ram mode (${lang}): uwLockWhileOpenRam`, async () => {
      await mount(status(RAM), lang)
      expect(bar()!.querySelector('.uw-remote-message')!.textContent).toBe(
        text(lang, 'uwLockWhileOpenRam'),
      )
    })
  }

  it('outranks a remote-newer bar on the same document: one bar, the lock sentence', async () => {
    await mount(status(STORE, { remote: { kind: 'newer-dirty', version: 4 } }))
    expect(bars()).toHaveLength(1)
    expect(bar()!.dataset.tone).toBe('error')
    expect(bar()!.querySelector('.uw-remote-message')!.textContent).toBe(
      text('en', 'uwLockWhileOpen'),
    )
    expect(bar()!.querySelectorAll('button')).toHaveLength(0)
  })

  it('the bar carries no role=status, role=alert or aria-live; the sentence is not live', async () => {
    await mount(status(STORE))
    const el = bar()!
    expect(el.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull()
    expect(el.hasAttribute('aria-live')).toBe(false)
    expect(el.getAttribute('role')).toBe('region')
  })

  it('writes its sentence once to the window alert node, and says nothing again on a repeat push', async () => {
    const watch = watchAnnouncements()
    await mount(status(STORE))
    expect(watch.count()).toBe(1)
    expect(alert().textContent).toBe(text('en', 'uwLockWhileOpen'))
    expect(polite().textContent).toBe('')
    // a status push that changes nothing about the lock says nothing new
    await mount(status(STORE, { state: 'saved' }))
    await mount(status(STORE, { pendingNext: true }))
    expect(watch.count()).toBe(1)
    watch.stop()
  })

  it('a ram-mode lock replacing a store-mode one is announced again, once', async () => {
    await mount(status(STORE))
    const watch = watchAnnouncements()
    await mount(status(RAM))
    expect(watch.count()).toBe(1)
    expect(alert().textContent).toBe(text('en', 'uwLockWhileOpenRam'))
    watch.stop()
  })

  it('never hides on its own', async () => {
    vi.useFakeTimers()
    await mount(status(STORE))
    await act(async () => {
      vi.advanceTimersByTime(120_000)
    })
    expect(bar()).not.toBeNull()
    expect(remoteAction).not.toHaveBeenCalled()
  })

  it('goes away with the field and the live text is cleared', async () => {
    await mount(status(STORE))
    expect(bar()).not.toBeNull()
    await mount(status())
    expect(bar()).toBeNull()
    expect(alert().textContent).toBe('')
  })

  it('absent field: the remote-newer bar renders exactly as before', async () => {
    await mount(status(undefined, { remote: { kind: 'newer-dirty', version: 4 } }))
    expect(bar()!.dataset.tone).toBe('warn')
    expect(bar()!.getAttribute('aria-label')).toBe(text('en', 'uwRemoteRegion'))
    expect(polite().textContent).toContain('version 4')
    expect(alert().textContent).toBe('')
  })
})
