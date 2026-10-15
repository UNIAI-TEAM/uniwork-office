// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { UniworkConflictHost } from '../src/renderer/src/UniworkConflictDialog'
import {
  UniworkLiveHost,
  announce,
  ensureLiveHost,
  resetLiveForTests,
} from '../src/renderer/src/uniwork-live'
import type { UniworkConflictView } from '../src/shared/uniwork-conflict'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const here = path.dirname(fileURLToPath(import.meta.url))

function nodes() {
  const host = document.getElementById('uw-live-host') as HTMLElement
  return {
    host,
    polite: host.querySelector('[role="status"]') as HTMLElement,
    alert: host.querySelector('[role="alert"]') as HTMLElement,
  }
}

describe('uniwork-live window live host (G5-06u T6)', () => {
  let mount: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
    resetLiveForTests()
    ensureLiveHost()
    mount = document.createElement('div')
    document.body.appendChild(mount)
    root = createRoot(mount)
    act(() => root.render(createElement(UniworkLiveHost)))
  })

  afterEach(() => {
    act(() => root.unmount())
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('creates one body-level host with a polite status node and an alert node from the start', () => {
    const { host, polite, alert } = nodes()
    expect(host.parentElement).toBe(document.body)
    expect(host.hasAttribute('data-uw-live')).toBe(true)
    expect(polite).not.toBeNull()
    expect(alert).not.toBeNull()
    expect(polite.classList.contains('uw-sr-only')).toBe(true)
    expect(alert.classList.contains('uw-sr-only')).toBe(true)
    expect(polite.textContent).toBe('')
    expect(alert.textContent).toBe('')
    // ensureLiveHost is idempotent: a second call never creates a second host
    expect(ensureLiveHost()).toBe(host)
    expect(document.querySelectorAll('#uw-live-host')).toHaveLength(1)
  })

  it('never re-creates the nodes nor changes their role / aria-live across announcements', () => {
    const before = nodes()
    act(() => announce('first'))
    act(() => announce('second', { assertive: true }))
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    act(() => announce('third'))
    const after = nodes()
    expect(after.polite).toBe(before.polite)
    expect(after.alert).toBe(before.alert)
    expect(after.polite.getAttribute('role')).toBe('status')
    expect(after.alert.getAttribute('role')).toBe('alert')
    expect(after.polite.hasAttribute('aria-live')).toBe(false)
    expect(after.alert.hasAttribute('aria-live')).toBe(false)
  })

  it('polite announcements replace the text, and the same sentence twice is written again', () => {
    const { polite } = nodes()
    act(() => announce('Plan: Saved'))
    expect(polite.textContent).toBe('Plan: Saved')
    const firstSpan = polite.firstElementChild
    act(() => announce('Plan: Saved'))
    expect(polite.textContent).toBe('Plan: Saved')
    expect(polite.firstElementChild).not.toBe(firstSpan)
    act(() => announce('Plan: Queued'))
    expect(polite.textContent).toBe('Plan: Queued')
    expect(polite.children).toHaveLength(1)
  })

  it('assertive text is cleared after about one second', () => {
    const { alert, polite } = nodes()
    act(() => announce('Plan: Conflict', { assertive: true }))
    expect(alert.textContent).toBe('Plan: Conflict')
    expect(polite.textContent).toBe('')
    act(() => {
      vi.advanceTimersByTime(900)
    })
    expect(alert.textContent).toBe('Plan: Conflict')
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(alert.textContent).toBe('')
  })

  it('a second assertive within one second waits for the clear instead of overwriting', () => {
    const { alert } = nodes()
    act(() => announce('first alert', { assertive: true }))
    act(() => {
      vi.advanceTimersByTime(300)
    })
    act(() => announce('second alert', { assertive: true }))
    expect(alert.textContent).toBe('first alert')
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(alert.textContent).toBe('second alert')
    act(() => {
      vi.advanceTimersByTime(1100)
    })
    expect(alert.textContent).toBe('')
  })

  it('ignores empty text', () => {
    const { polite, alert } = nodes()
    act(() => announce(''))
    act(() => announce('', { assertive: true }))
    expect(polite.textContent).toBe('')
    expect(alert.textContent).toBe('')
  })

  it('wires the host in main.tsx before React renders', () => {
    const main = readFileSync(path.join(here, '../src/renderer/src/main.tsx'), 'utf8')
    expect(main).toContain("from './uniwork-live'")
    expect(main).toContain('ensureLiveHost()')
    expect(main).toContain('<UniworkLiveHost />')
    expect(main.indexOf('ensureLiveHost()')).toBeLessThan(main.indexOf('createRoot('))
  })

  it('the conflict dialog keeps the live host out of its inert sweep (one condition, Q2)', () => {
    const src = readFileSync(
      path.join(here, '../src/renderer/src/UniworkConflictDialog.tsx'),
      'utf8',
    )
    expect(src).toContain("child.hasAttribute('data-uw-live')")
  })
})

describe('uniwork-live host while the S5 conflict dialog is mounted (G5-06u T6)', () => {
  let conflictEl: HTMLDivElement
  let siblingEl: HTMLDivElement
  let liveMount: HTMLDivElement
  let conflictRoot: Root
  let liveRoot: Root
  let pushConflict: ((view: UniworkConflictView) => void) | null

  beforeEach(() => {
    document.body.innerHTML = ''
    resetLiveForTests()
    localStorage.setItem('uniwork-ui-lang', 'en')
    pushConflict = null
    const bridge = {
      onUniworkConflict: (cb: (view: UniworkConflictView) => void) => {
        pushConflict = cb
        return () => {
          if (pushConflict === cb) pushConflict = null
        }
      },
      onUniworkConflictClosed: () => () => undefined,
      uniworkConflictAct: vi.fn(async () => ({ kind: 'closed' })),
      uniworkSyncQueueOpen: vi.fn(async () => ({ opened: true })),
    }
    const w = window as unknown as { api: typeof bridge; aiOffice: typeof bridge }
    w.api = bridge
    w.aiOffice = bridge

    siblingEl = document.createElement('div')
    siblingEl.id = 'app-shell-sibling'
    document.body.appendChild(siblingEl)

    ensureLiveHost()
    liveMount = document.createElement('div')
    document.body.appendChild(liveMount)
    liveRoot = createRoot(liveMount)
    act(() => liveRoot.render(createElement(UniworkLiveHost)))

    conflictEl = document.createElement('div')
    document.body.appendChild(conflictEl)
    conflictRoot = createRoot(conflictEl)
    act(() => {
      conflictRoot.render(
        createElement(LocaleProvider, { initial: 'en' }, createElement(UniworkConflictHost)),
      )
    })
  })

  afterEach(() => {
    act(() => conflictRoot.unmount())
    act(() => liveRoot.unmount())
    document.body.innerHTML = ''
  })

  it('inerts the app siblings but not #uw-live-host, and the host still announces', async () => {
    await act(async () => {
      pushConflict?.({
        sessionId: 'sess-live-1',
        path: '/workspace/contract.docx',
        documentId: 'doc-1',
        title: 'Contract.docx',
        module: 'docs',
        mine: { baseVersion: 11 },
        server: { version: 12, savedAt: '2026-10-14T08:00:00Z', by: 'Lan' },
        canEdit: true,
        online: true,
        headOffline: false,
        intent: 'none',
        keepDraft: 'ok',
        draftCap: 3,
        aiRunning: false,
        locked: 'none',
        notice: null,
        noticeArg: null,
      } as UniworkConflictView)
    })

    expect(document.querySelector('[role="alertdialog"][aria-modal="true"]')).not.toBeNull()
    expect(siblingEl.hasAttribute('inert')).toBe(true)
    const host = document.getElementById('uw-live-host') as HTMLElement
    expect(host.hasAttribute('inert')).toBe(false)

    act(() => announce('Contract: Conflict', { assertive: true }))
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Contract: Conflict')
    expect(host.closest('[inert]')).toBeNull()
  })
})
