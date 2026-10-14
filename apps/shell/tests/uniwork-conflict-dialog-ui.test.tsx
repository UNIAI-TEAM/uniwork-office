// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { en } from '../src/renderer/src/i18n/sync/en'
import type {
  UniworkConflictAction,
  UniworkConflictReply,
  UniworkConflictView
} from '../src/shared/uniwork-conflict'
import { UniworkConflictHost } from '../src/renderer/src/UniworkConflictDialog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeView(overrides: Partial<UniworkConflictView> = {}): UniworkConflictView {
  return {
    sessionId: 'sess-ui-1',
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
    ...overrides
  }
}

describe('UniworkConflictDialog UI (G5-09 S5 desktop)', () => {
  let hostEl: HTMLDivElement
  let appSiblingEl: HTMLDivElement
  let root: Root
  let pushConflict: ((view: UniworkConflictView) => void) | null
  let actCalls: Array<{ sessionId: string; action: UniworkConflictAction }>
  let nextReply: UniworkConflictReply
  let openQueueCalls: number

  beforeEach(() => {
    localStorage.setItem('uniwork-ui-lang', 'en')
    pushConflict = null
    actCalls = []
    nextReply = { kind: 'closed' }
    openQueueCalls = 0

    const fakeBridge = {
      onUniworkConflict: (cb: (view: UniworkConflictView) => void) => {
        pushConflict = cb
        return () => {
          if (pushConflict === cb) pushConflict = null
        }
      },
      uniworkConflictAct: vi.fn(
        async (sessionId: string, action: UniworkConflictAction): Promise<UniworkConflictReply> => {
          actCalls.push({ sessionId, action })
          return nextReply
        }
      ),
      uniworkSyncQueueOpen: vi.fn(async () => {
        openQueueCalls += 1
        return { opened: true }
      })
    }

    ;(window as unknown as { api: typeof fakeBridge; aiOffice: typeof fakeBridge }).api = fakeBridge
    ;(window as unknown as { api: typeof fakeBridge; aiOffice: typeof fakeBridge }).aiOffice =
      fakeBridge

    appSiblingEl = document.createElement('div')
    appSiblingEl.id = 'app-shell-sibling'
    const triggerBtn = document.createElement('button')
    triggerBtn.id = 'opener-trigger'
    triggerBtn.textContent = 'Save'
    appSiblingEl.appendChild(triggerBtn)
    document.body.appendChild(appSiblingEl)
    triggerBtn.focus()

    hostEl = document.createElement('div')
    document.body.appendChild(hostEl)
    root = createRoot(hostEl)
    act(() => {
      root.render(
        React.createElement(
          LocaleProvider,
          { initial: 'en' },
          React.createElement(UniworkConflictHost)
        )
      )
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    hostEl.remove()
    appSiblingEl.remove()
    document.body.innerHTML = ''
  })

  it('AC2: renders step 1 with exact button order, default focus on Cancel, background inert, and Esc/Cancel sending cancel action', async () => {
    await act(async () => {
      pushConflict?.(makeView({ module: 'docs', canEdit: true }))
    })

    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]') as HTMLElement
    expect(dialog).not.toBeNull()
    expect(appSiblingEl.hasAttribute('inert')).toBe(true)

    const actionButtons = Array.from(
      dialog.querySelectorAll('.uw-conflict-actions button')
    ) as HTMLButtonElement[]
    expect(actionButtons.map((b) => b.textContent)).toEqual([
      en.uwConflictViewDiff,
      en.uwConflictReload,
      en.uwConflictSaveCopy,
      en.uwConflictOverwrite,
      en.uwConflictCancel
    ])

    const cancelBtn = actionButtons[4]
    expect(document.activeElement).toBe(cancelBtn)

    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(actCalls).toEqual([{ sessionId: 'sess-ui-1', action: { kind: 'cancel' } }])
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(appSiblingEl.hasAttribute('inert')).toBe(false)
  })

  it('AC5: when !canEdit, hides Overwrite and Save-copy and renders uwConflictNoEdit', async () => {
    await act(async () => {
      pushConflict?.(makeView({ canEdit: false, module: 'sheets' }))
    })

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    const actionButtons = Array.from(
      dialog.querySelectorAll('.uw-conflict-actions button')
    ) as HTMLButtonElement[]
    expect(actionButtons.map((b) => b.textContent)).toEqual([
      en.uwConflictReload,
      en.uwConflictCancel
    ])
    expect(dialog.textContent).toContain(en.uwConflictNoEdit)
  })

  it('AC6: step 2 Reload confirm preselects Keep draft when ok, and when store_full/keystore_locked keeps Keep aria-disabled with reason and only submits after explicit Discard', async () => {
    await act(async () => {
      pushConflict?.(makeView({ keepDraft: 'store_full' }))
    })

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    const reloadStep1Btn = dialog.querySelector(
      '[data-conflict-action="reload"]'
    ) as HTMLButtonElement
    await act(async () => {
      reloadStep1Btn.click()
    })

    const backBtn = dialog.querySelector('[data-conflict-action="back"]') as HTMLButtonElement
    expect(document.activeElement).toBe(backBtn)

    const keepRadio = dialog.querySelector('input[value="draft"]') as HTMLInputElement
    const discardRadio = dialog.querySelector('input[value="discard"]') as HTMLInputElement
    const reloadGoBtn = dialog.querySelector(
      '[data-conflict-action="reload-go"]'
    ) as HTMLButtonElement

    expect(keepRadio.getAttribute('aria-disabled')).toBe('true')
    expect(keepRadio.checked).toBe(false)
    expect(discardRadio.checked).toBe(false)
    expect(dialog.textContent).toContain(en.uwConflictKeepUnavailable)
    expect(reloadGoBtn.getAttribute('aria-disabled')).toBe('true')

    await act(async () => {
      reloadGoBtn.click()
    })
    expect(actCalls).toHaveLength(0)

    await act(async () => {
      discardRadio.click()
    })
    expect(discardRadio.checked).toBe(true)
    expect(reloadGoBtn.getAttribute('aria-disabled')).toBeNull()

    await act(async () => {
      reloadGoBtn.click()
    })
    expect(actCalls).toEqual([
      {
        sessionId: 'sess-ui-1',
        action: { kind: 'reload', keep: 'discard', stopAi: false }
      }
    ])
  })

  it('AC7: offline disables Reload (unless headOffline) with uwConflictOfflineDesktop, disables Save-copy with uwConflictSaveCopyOffline, and keeps Overwrite enabled', async () => {
    await act(async () => {
      pushConflict?.(makeView({ online: false, headOffline: false }))
    })

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    const reloadBtn = dialog.querySelector('[data-conflict-action="reload"]') as HTMLButtonElement
    const saveCopyBtn = dialog.querySelector(
      '[data-conflict-action="save-copy"]'
    ) as HTMLButtonElement
    const overwriteBtn = dialog.querySelector(
      '[data-conflict-action="overwrite"]'
    ) as HTMLButtonElement

    expect(reloadBtn.getAttribute('aria-disabled')).toBe('true')
    expect(saveCopyBtn.getAttribute('aria-disabled')).toBe('true')
    expect(overwriteBtn.getAttribute('aria-disabled')).toBeNull()
    expect(dialog.textContent).toContain(en.uwConflictOfflineDesktop)
    expect(dialog.textContent).toContain(en.uwConflictSaveCopyOffline)

    await act(async () => {
      reloadBtn.click()
    })
    expect(dialog.querySelector('[data-conflict-action="overwrite"]')).not.toBeNull()

    await act(async () => {
      overwriteBtn.click()
    })
    const overwriteGoBtn = dialog.querySelector(
      '[data-conflict-action="overwrite-go"]'
    ) as HTMLButtonElement
    expect(overwriteGoBtn).not.toBeNull()

    const backBtn = dialog.querySelector('[data-conflict-action="back"]') as HTMLButtonElement
    await act(async () => {
      backBtn.click()
    })
    expect(document.activeElement).toBe(
      dialog.querySelector('[data-conflict-action="overwrite"]')
    )
  })

  it('AC8: intent committing/reconciling marks Reload/Save-copy/Overwrite aria-disabled with uwRemoteWaitCommit; reconciling-stuck shows uwRemoteWaitStuck + Open sync center', async () => {
    await act(async () => {
      pushConflict?.(makeView({ intent: 'committing' }))
    })

    let dialog = document.querySelector('[role="dialog"]') as HTMLElement
    for (const id of ['reload', 'save-copy', 'overwrite']) {
      const btn = dialog.querySelector(`[data-conflict-action="${id}"]`) as HTMLButtonElement
      expect(btn.getAttribute('aria-disabled')).toBe('true')
    }
    expect(dialog.textContent).toContain(en.uwRemoteWaitCommit)

    await act(async () => {
      pushConflict?.(makeView({ intent: 'reconciling-stuck' }))
    })
    dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.textContent).toContain(en.uwRemoteWaitStuck)
    const openCenterBtn = dialog.querySelector(
      '[data-conflict-open-center="true"]'
    ) as HTMLButtonElement
    expect(openCenterBtn).not.toBeNull()
    await act(async () => {
      openCenterBtn.click()
    })
    expect(openQueueCalls).toBe(1)
  })

  it('updates the single fixed role=alert region on reply view notices (head_moved returns to step 1 + focuses Cancel; save_copy_failed stays on step 2) and handles locked state', async () => {
    await act(async () => {
      pushConflict?.(makeView())
    })

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    const alertEl = dialog.querySelector('[role="alert"]') as HTMLElement
    expect(alertEl).not.toBeNull()
    expect(alertEl.textContent).toBe('')

    const saveCopyBtn = dialog.querySelector(
      '[data-conflict-action="save-copy"]'
    ) as HTMLButtonElement
    await act(async () => {
      saveCopyBtn.click()
    })

    nextReply = {
      kind: 'view',
      view: makeView({ notice: 'save_copy_failed' })
    }
    const saveCopyGo = dialog.querySelector(
      '[data-conflict-action="save-copy-go"]'
    ) as HTMLButtonElement
    await act(async () => {
      saveCopyGo.click()
    })

    expect(dialog.querySelector('[data-conflict-action="save-copy-go"]')).not.toBeNull()
    expect(alertEl.textContent).toContain(en.uwConflictSaveCopyFailed)

    await act(async () => {
      pushConflict?.(
        makeView({
          server: { version: 14, savedAt: '2026-10-14T08:10:00Z', by: 'Minh' },
          notice: 'head_moved',
          noticeArg: '14'
        })
      )
    })

    expect(alertEl.textContent).toContain(en.uwConflictHeadMoved.replace('{n}', '14'))
    const cancelBtn = dialog.querySelector('[data-conflict-action="cancel"]') as HTMLButtonElement
    expect(document.activeElement).toBe(cancelBtn)

    await act(async () => {
      pushConflict?.(makeView({ locked: 'revoked' }))
    })
    expect(dialog.textContent).toContain(en.uwRemoteRevoked)
    const titleEl = dialog.querySelector('h2[tabindex="-1"]') as HTMLElement
    expect(document.activeElement).toBe(titleEl)
  })

  it('shows stop-AI confirmation when aiRunning is true, sends stopAi: true on confirm, and traps Tab focus across aria-disabled controls', async () => {
    await act(async () => {
      pushConflict?.(makeView({ aiRunning: true, online: false, headOffline: false }))
    })

    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    const closeX = dialog.querySelector('[data-conflict-action="close-x"]') as HTMLButtonElement
    const viewDiffBtn = dialog.querySelector(
      '[data-conflict-action="view-diff"]'
    ) as HTMLButtonElement
    const reloadBtn = dialog.querySelector('[data-conflict-action="reload"]') as HTMLButtonElement

    // Cancel has initial focus; Tab moves to Close X, then wraps to View differences, then aria-disabled Reload
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(closeX)

    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(viewDiffBtn)

    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(reloadBtn)
    expect(reloadBtn.getAttribute('aria-disabled')).toBe('true')

    // Click Overwrite (enabled when offline) -> opens stop-AI step first
    const overwriteBtn = dialog.querySelector(
      '[data-conflict-action="overwrite"]'
    ) as HTMLButtonElement
    await act(async () => {
      overwriteBtn.click()
    })
    expect(dialog.textContent).toContain(en.uwRemoteStopAiConfirm)

    const stopAiGoBtn = dialog.querySelector(
      '[data-conflict-action="stop-ai-go"]'
    ) as HTMLButtonElement
    await act(async () => {
      stopAiGoBtn.click()
    })

    const overwriteGoBtn = dialog.querySelector(
      '[data-conflict-action="overwrite-go"]'
    ) as HTMLButtonElement
    expect(overwriteGoBtn).not.toBeNull()

    await act(async () => {
      overwriteGoBtn.click()
    })
    expect(actCalls).toEqual([
      {
        sessionId: 'sess-ui-1',
        action: { kind: 'overwrite', stopAi: true }
      }
    ])
    expect(document.activeElement).toBe(document.getElementById('opener-trigger'))
  })
})

