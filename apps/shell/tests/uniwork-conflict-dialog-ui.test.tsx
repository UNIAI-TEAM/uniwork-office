// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { en } from '../src/renderer/src/i18n/sync/en'
import type {
  UniworkConflictAction,
  UniworkConflictReply,
  UniworkConflictView,
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
    ...overrides,
  }
}

describe('UniworkConflictDialog UI (G5-09 S5 desktop)', () => {
  let hostEl: HTMLDivElement
  let appSiblingEl: HTMLDivElement
  let root: Root
  let pushConflict: ((view: UniworkConflictView) => void) | null
  let pushConflictClosed: ((sessionId: string) => void) | null
  let actCalls: Array<{ sessionId: string; action: UniworkConflictAction }>
  let nextReply: UniworkConflictReply
  let nextReject: Error | null
  let openQueueCalls: number

  beforeEach(() => {
    localStorage.setItem('uniwork-ui-lang', 'en')
    pushConflict = null
    pushConflictClosed = null
    actCalls = []
    nextReply = { kind: 'closed' }
    nextReject = null
    openQueueCalls = 0

    const fakeBridge = {
      onUniworkConflict: (cb: (view: UniworkConflictView) => void) => {
        pushConflict = cb
        return () => {
          if (pushConflict === cb) pushConflict = null
        }
      },
      onUniworkConflictClosed: (cb: (sessionId: string) => void) => {
        pushConflictClosed = cb
        return () => {
          if (pushConflictClosed === cb) pushConflictClosed = null
        }
      },
      uniworkConflictAct: vi.fn(
        async (sessionId: string, action: UniworkConflictAction): Promise<UniworkConflictReply> => {
          actCalls.push({ sessionId, action })
          if (nextReject) {
            const err = nextReject
            nextReject = null
            throw err
          }
          return nextReply
        },
      ),
      uniworkSyncQueueOpen: vi.fn(async () => {
        openQueueCalls += 1
        return { opened: true }
      }),
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
          React.createElement(UniworkConflictHost),
        ),
      )
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    hostEl.remove()
    appSiblingEl.remove()
    document.body.innerHTML = ''
  })

  it('AC2 / FE-01 / FE-06: renders role="alertdialog" with aria-labelledby/aria-describedby, hides View differences when Host has no onViewDiff handler, focuses Cancel by default, and restores focus to opener on Esc/Cancel', async () => {
    await act(async () => {
      pushConflict?.(makeView({ module: 'docs', canEdit: true }))
    })

    const dialog = document.querySelector('[role="alertdialog"][aria-modal="true"]') as HTMLElement
    expect(dialog).not.toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(appSiblingEl.hasAttribute('inert')).toBe(true)

    const labelledByEl = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')
    const describedByEl = document.getElementById(dialog.getAttribute('aria-describedby') ?? '')
    expect(labelledByEl?.textContent).toBe(en.uwConflictTitle)
    expect(describedByEl?.textContent).toBe(en.uwConflictBody)

    const actionButtons = Array.from(
      dialog.querySelectorAll('.uw-conflict-actions button'),
    ) as HTMLButtonElement[]
    expect(actionButtons.map((b) => b.textContent)).toEqual([
      en.uwConflictReload,
      en.uwConflictSaveCopy,
      en.uwConflictOverwrite,
      en.uwConflictCancel,
    ])

    const cancelBtn = actionButtons[3]
    expect(document.activeElement).toBe(cancelBtn)

    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(actCalls).toEqual([{ sessionId: 'sess-ui-1', action: { kind: 'cancel' } }])
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(appSiblingEl.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(document.getElementById('opener-trigger'))
  })

  it('FE-06: renders View differences first after the table when Host has an onViewDiff handler (docs only)', async () => {
    const onViewDiff = vi.fn()
    act(() => {
      root.render(
        React.createElement(
          LocaleProvider,
          { initial: 'en' },
          React.createElement(UniworkConflictHost, { onViewDiff }),
        ),
      )
    })

    const view = makeView({ module: 'docs', canEdit: true })
    await act(async () => {
      pushConflict?.(view)
    })

    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    const actionButtons = Array.from(
      dialog.querySelectorAll('.uw-conflict-actions button'),
    ) as HTMLButtonElement[]
    expect(actionButtons.map((b) => b.textContent)).toEqual([
      en.uwConflictViewDiff,
      en.uwConflictReload,
      en.uwConflictSaveCopy,
      en.uwConflictOverwrite,
      en.uwConflictCancel,
    ])

    await act(async () => {
      actionButtons[0].click()
    })
    expect(onViewDiff).toHaveBeenCalledWith(view)
  })

  it('AC5: when !canEdit, hides Overwrite and Save-copy and renders uwConflictNoEdit', async () => {
    await act(async () => {
      pushConflict?.(makeView({ canEdit: false, module: 'sheets' }))
    })

    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    const actionButtons = Array.from(
      dialog.querySelectorAll('.uw-conflict-actions button'),
    ) as HTMLButtonElement[]
    expect(actionButtons.map((b) => b.textContent)).toEqual([
      en.uwConflictReload,
      en.uwConflictCancel,
    ])
    expect(dialog.textContent).toContain(en.uwConflictNoEdit)
  })

  it('AC6 / FE-05: step 2 Reload confirm keeps Keep aria-disabled with reason when store_full/keystore_locked, links disabled reload-go via aria-describedby to the reason line, and only submits after explicit Discard', async () => {
    await act(async () => {
      pushConflict?.(makeView({ keepDraft: 'store_full' }))
    })

    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    const reloadStep1Btn = dialog.querySelector(
      '[data-conflict-action="reload"]',
    ) as HTMLButtonElement
    await act(async () => {
      reloadStep1Btn.click()
    })

    const backBtn = dialog.querySelector('[data-conflict-action="back"]') as HTMLButtonElement
    expect(document.activeElement).toBe(backBtn)

    const keepRadio = dialog.querySelector('input[value="draft"]') as HTMLInputElement
    const discardRadio = dialog.querySelector('input[value="discard"]') as HTMLInputElement
    const reloadGoBtn = dialog.querySelector(
      '[data-conflict-action="reload-go"]',
    ) as HTMLButtonElement

    expect(keepRadio.getAttribute('aria-disabled')).toBe('true')
    expect(keepRadio.checked).toBe(false)
    expect(discardRadio.checked).toBe(false)
    expect(dialog.textContent).toContain(en.uwConflictKeepUnavailable)
    expect(reloadGoBtn.getAttribute('aria-disabled')).toBe('true')

    const reloadGoDescId = reloadGoBtn.getAttribute('aria-describedby')
    expect(reloadGoDescId).toBeTruthy()
    const reloadGoReasonEl = reloadGoDescId ? document.getElementById(reloadGoDescId) : null
    expect(reloadGoReasonEl).not.toBeNull()
    expect(reloadGoReasonEl?.textContent).toContain(en.uwConflictKeepUnavailable)

    await act(async () => {
      reloadGoBtn.click()
    })
    expect(actCalls).toHaveLength(0)

    await act(async () => {
      discardRadio.click()
    })
    expect(discardRadio.checked).toBe(true)
    expect(reloadGoBtn.getAttribute('aria-disabled')).toBeNull()
    expect(reloadGoBtn.getAttribute('aria-describedby')).toBeNull()

    await act(async () => {
      reloadGoBtn.click()
    })
    expect(actCalls).toEqual([
      {
        sessionId: 'sess-ui-1',
        action: { kind: 'reload', keep: 'discard', stopAi: false },
      },
    ])
  })

  it('AC7: offline disables Reload (unless headOffline) with uwConflictOfflineDesktop, disables Save-copy with uwConflictSaveCopyOffline, keeps Overwrite enabled, and Back focuses opener in DOM', async () => {
    await act(async () => {
      pushConflict?.(makeView({ online: false, headOffline: false }))
    })

    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    const reloadBtn = dialog.querySelector('[data-conflict-action="reload"]') as HTMLButtonElement
    const saveCopyBtn = dialog.querySelector(
      '[data-conflict-action="save-copy"]',
    ) as HTMLButtonElement
    const overwriteBtn = dialog.querySelector(
      '[data-conflict-action="overwrite"]',
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
      '[data-conflict-action="overwrite-go"]',
    ) as HTMLButtonElement
    expect(overwriteGoBtn).not.toBeNull()

    const backBtn = dialog.querySelector('[data-conflict-action="back"]') as HTMLButtonElement
    await act(async () => {
      backBtn.click()
    })
    expect(document.activeElement).toBe(dialog.querySelector('[data-conflict-action="overwrite"]'))
  })

  it('AC8: intent committing/reconciling marks Reload/Save-copy/Overwrite aria-disabled with uwRemoteWaitCommit; reconciling-stuck shows uwRemoteWaitStuck + Open sync center', async () => {
    await act(async () => {
      pushConflict?.(makeView({ intent: 'committing' }))
    })

    let dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    for (const id of ['reload', 'save-copy', 'overwrite']) {
      const btn = dialog.querySelector(`[data-conflict-action="${id}"]`) as HTMLButtonElement
      expect(btn.getAttribute('aria-disabled')).toBe('true')
    }
    expect(dialog.textContent).toContain(en.uwRemoteWaitCommit)

    await act(async () => {
      pushConflict?.(makeView({ intent: 'reconciling-stuck' }))
    })
    dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    expect(dialog.textContent).toContain(en.uwRemoteWaitStuck)
    const openCenterBtn = dialog.querySelector(
      '[data-conflict-open-center="true"]',
    ) as HTMLButtonElement
    expect(openCenterBtn).not.toBeNull()
    await act(async () => {
      openCenterBtn.click()
    })
    expect(openQueueCalls).toBe(1)
  })

  it('FE-08: updates the single fixed role=alert region on reply view notices and renders locked state with body + Close only (no X) and focus on h2[tabindex="-1"]', async () => {
    await act(async () => {
      pushConflict?.(makeView())
    })

    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    const alertEl = dialog.querySelector('[role="alert"]') as HTMLElement
    expect(alertEl).not.toBeNull()
    expect(alertEl.textContent).toBe('')

    const saveCopyBtn = dialog.querySelector(
      '[data-conflict-action="save-copy"]',
    ) as HTMLButtonElement
    await act(async () => {
      saveCopyBtn.click()
    })

    nextReply = {
      kind: 'view',
      view: makeView({ notice: 'save_copy_failed' }),
    }
    const saveCopyGo = dialog.querySelector(
      '[data-conflict-action="save-copy-go"]',
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
          noticeArg: '14',
        }),
      )
    })

    expect(alertEl.textContent).toContain(en.uwConflictHeadMoved.replace('{n}', '14'))
    const cancelBtn = dialog.querySelector('[data-conflict-action="cancel"]') as HTMLButtonElement
    expect(document.activeElement).toBe(cancelBtn)

    await act(async () => {
      pushConflict?.(makeView({ locked: 'revoked' }))
    })
    expect(dialog.textContent).toContain(en.uwRemoteRevoked)
    expect(dialog.querySelector('[data-conflict-action="close"]')).not.toBeNull()
    expect(dialog.querySelector('[data-conflict-action="close-x"]')).toBeNull()
    const titleEl = dialog.querySelector('h2[tabindex="-1"]') as HTMLElement
    expect(document.activeElement).toBe(titleEl)
  })

  it('FE-03: rejected uniworkConflictAct shows failure line in role=alert, re-enables buttons without unhandled rejection, and closes on rejected cancel', async () => {
    await act(async () => {
      pushConflict?.(makeView())
    })

    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    const alertEl = dialog.querySelector('[role="alert"]') as HTMLElement

    // 1. Overwrite rejection -> uwConflictOverwriteFailed + button re-enabled
    const overwriteBtn = dialog.querySelector(
      '[data-conflict-action="overwrite"]',
    ) as HTMLButtonElement
    await act(async () => {
      overwriteBtn.click()
    })
    nextReject = new Error('IPC overwrite failed')
    const overwriteGo = dialog.querySelector(
      '[data-conflict-action="overwrite-go"]',
    ) as HTMLButtonElement
    await act(async () => {
      overwriteGo.click()
    })
    expect(alertEl.textContent).toBe(en.uwConflictOverwriteFailed)
    expect(overwriteGo.getAttribute('aria-disabled')).toBeNull()

    // Return to step 1 and test Reload rejection -> uwConflictReloadFailed
    const backFromOverwrite = dialog.querySelector(
      '[data-conflict-action="back"]',
    ) as HTMLButtonElement
    await act(async () => {
      backFromOverwrite.click()
    })
    expect(document.activeElement).toBe(dialog.querySelector('[data-conflict-action="overwrite"]'))

    const reloadBtn = dialog.querySelector('[data-conflict-action="reload"]') as HTMLButtonElement
    await act(async () => {
      reloadBtn.click()
    })
    nextReject = new Error('IPC reload failed')
    const reloadGo = dialog.querySelector('[data-conflict-action="reload-go"]') as HTMLButtonElement
    await act(async () => {
      reloadGo.click()
    })
    expect(alertEl.textContent).toBe(en.uwConflictReloadFailed)
    expect(reloadGo.getAttribute('aria-disabled')).toBeNull()

    // Return to step 1 -> focuses reload opener, then test Save-copy rejection -> uwConflictSaveCopyFailed
    const backFromReload = dialog.querySelector(
      '[data-conflict-action="back"]',
    ) as HTMLButtonElement
    await act(async () => {
      backFromReload.click()
    })
    expect(document.activeElement).toBe(dialog.querySelector('[data-conflict-action="reload"]'))

    const saveCopyBtn = dialog.querySelector(
      '[data-conflict-action="save-copy"]',
    ) as HTMLButtonElement
    await act(async () => {
      saveCopyBtn.click()
    })
    nextReject = new Error('IPC save-copy failed')
    const saveCopyGo = dialog.querySelector(
      '[data-conflict-action="save-copy-go"]',
    ) as HTMLButtonElement
    await act(async () => {
      saveCopyGo.click()
    })
    expect(alertEl.textContent).toBe(en.uwConflictSaveCopyFailed)
    expect(saveCopyGo.getAttribute('aria-disabled')).toBeNull()

    // Cancel rejection -> closes dialog and restores focus
    nextReject = new Error('IPC cancel failed')
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(document.activeElement).toBe(document.getElementById('opener-trigger'))
  })

  it('FE-04: same notice twice in a row empties the role=alert node and re-fills it on the next frame', async () => {
    await act(async () => {
      pushConflict?.(makeView({ notice: 'overwrite_failed' }))
    })

    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    const alertEl = dialog.querySelector('[role="alert"]') as HTMLElement
    expect(alertEl.textContent).toBe(en.uwConflictOverwriteFailed)

    await act(async () => {
      pushConflict?.(makeView({ notice: 'overwrite_failed' }))
    })
    expect(alertEl.textContent).toBe('')

    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    expect(dialog.querySelector('[role="alert"]')).toBe(alertEl)
    expect(alertEl.textContent).toBe(en.uwConflictOverwriteFailed)
  })

  it('FE-07: Reload radio group is a single Tab stop (Tab enters on checked/first radio, arrows move between radios)', async () => {
    await act(async () => {
      pushConflict?.(makeView({ keepDraft: 'ok' }))
    })

    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    const reloadStep1Btn = dialog.querySelector(
      '[data-conflict-action="reload"]',
    ) as HTMLButtonElement
    await act(async () => {
      reloadStep1Btn.click()
    })

    const backBtn = dialog.querySelector('[data-conflict-action="back"]') as HTMLButtonElement
    const closeX = dialog.querySelector('[data-conflict-action="close-x"]') as HTMLButtonElement
    const keepRadio = dialog.querySelector('input[value="draft"]') as HTMLInputElement
    const discardRadio = dialog.querySelector('input[value="discard"]') as HTMLInputElement
    const reloadGoBtn = dialog.querySelector(
      '[data-conflict-action="reload-go"]',
    ) as HTMLButtonElement

    expect(document.activeElement).toBe(backBtn)

    // Tab: Back -> close-x -> keepRadio (checked) -> reloadGoBtn (skips discardRadio!)
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(closeX)

    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(keepRadio)

    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(reloadGoBtn)

    // Shift+Tab from reloadGoBtn returns to keepRadio, then ArrowDown moves to discardRadio
    await act(async () => {
      dialog.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
      )
    })
    expect(document.activeElement).toBe(keepRadio)

    await act(async () => {
      keepRadio.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.activeElement).toBe(discardRadio)
    expect(discardRadio.checked).toBe(true)

    // Tab from discardRadio goes directly to reloadGoBtn, and Shift+Tab comes back to discardRadio
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(reloadGoBtn)

    await act(async () => {
      dialog.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
      )
    })
    expect(document.activeElement).toBe(discardRadio)
  })

  it('shows stop-AI confirmation when aiRunning is true, sends stopAi: true on confirm, and traps Tab focus across aria-disabled controls', async () => {
    await act(async () => {
      pushConflict?.(makeView({ aiRunning: true, online: false, headOffline: false }))
    })

    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    const closeX = dialog.querySelector('[data-conflict-action="close-x"]') as HTMLButtonElement
    const reloadBtn = dialog.querySelector('[data-conflict-action="reload"]') as HTMLButtonElement

    // Cancel has initial focus; Tab moves to Close X, then wraps to aria-disabled Reload (no View differences without handler)
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(closeX)

    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    expect(document.activeElement).toBe(reloadBtn)
    expect(reloadBtn.getAttribute('aria-disabled')).toBe('true')

    // Click Overwrite (enabled when offline) -> opens stop-AI step first
    const overwriteBtn = dialog.querySelector(
      '[data-conflict-action="overwrite"]',
    ) as HTMLButtonElement
    await act(async () => {
      overwriteBtn.click()
    })
    expect(dialog.textContent).toContain(en.uwRemoteStopAiConfirm)

    const stopAiGoBtn = dialog.querySelector(
      '[data-conflict-action="stop-ai-go"]',
    ) as HTMLButtonElement
    await act(async () => {
      stopAiGoBtn.click()
    })

    const overwriteGoBtn = dialog.querySelector(
      '[data-conflict-action="overwrite-go"]',
    ) as HTMLButtonElement
    expect(overwriteGoBtn).not.toBeNull()

    await act(async () => {
      overwriteGoBtn.click()
    })
    expect(actCalls).toEqual([
      {
        sessionId: 'sess-ui-1',
        action: { kind: 'overwrite', stopAi: true },
      },
    ])
    expect(document.activeElement).toBe(document.getElementById('opener-trigger'))
  })

  it('FE-02: onUniworkConflictClosed ignores other sessionIds, clears view + removes inert + restores focus on matching sessionId, and unsubscribes on unmount', async () => {
    expect(pushConflictClosed).toBeTypeOf('function')

    await act(async () => {
      pushConflict?.(makeView({ sessionId: 'sess-open-1' }))
    })
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(appSiblingEl.hasAttribute('inert')).toBe(true)

    // Pushing closed for another sessionId keeps the dialog open
    await act(async () => {
      pushConflictClosed?.('sess-other')
    })
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(appSiblingEl.hasAttribute('inert')).toBe(true)

    // Pushing closed for the open sessionId unmounts dialog, removes inert, restores focus to opener
    await act(async () => {
      pushConflictClosed?.('sess-open-1')
    })
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(appSiblingEl.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(document.getElementById('opener-trigger'))

    // If opener is no longer in DOM, falls back to active tab (.tab-item.active) or document.body
    const tabEl = document.createElement('div')
    tabEl.className = 'tab-item active'
    appSiblingEl.appendChild(tabEl)
    const openerEl = document.getElementById('opener-trigger')!
    openerEl.focus()

    await act(async () => {
      pushConflict?.(makeView({ sessionId: 'sess-open-2' }))
    })
    openerEl.remove()

    await act(async () => {
      pushConflictClosed?.('sess-open-2')
    })
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(document.activeElement).toBe(tabEl)

    // Unmount cleans up subscription
    act(() => root.unmount())
    expect(pushConflictClosed).toBeNull()
  })

  it('FE-201: restores focus to the real active tab (.tab-item.active) when the opener was detached from the DOM before close', async () => {
    const inactiveTab = document.createElement('div')
    inactiveTab.className = 'tab-item'
    appSiblingEl.appendChild(inactiveTab)

    const activeTab = document.createElement('div')
    activeTab.className = 'tab-item active'
    appSiblingEl.appendChild(activeTab)

    const openerEl = document.getElementById('opener-trigger')!
    openerEl.focus()

    await act(async () => {
      pushConflict?.(makeView({ sessionId: 'sess-fe-201' }))
    })

    // Detach the opener while the conflict dialog is open
    openerEl.remove()

    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(document.activeElement).toBe(activeTab)
  })

  it('FE-202: arrow keys in the Reload radio group skip an aria-disabled radio and Home/End move to the first/last enabled radio', async () => {
    // 1. When Keep is aria-disabled, arrow keys and Home/End skip Keep and focus/select Discard
    await act(async () => {
      pushConflict?.(makeView({ keepDraft: 'store_full' }))
    })

    let dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    const reloadBtn = dialog.querySelector('[data-conflict-action="reload"]') as HTMLButtonElement
    await act(async () => {
      reloadBtn.click()
    })

    let keepRadio = dialog.querySelector('input[value="draft"]') as HTMLInputElement
    let discardRadio = dialog.querySelector('input[value="discard"]') as HTMLInputElement
    expect(keepRadio.getAttribute('aria-disabled')).toBe('true')

    discardRadio.focus()
    await act(async () => {
      discardRadio.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    })
    expect(document.activeElement).toBe(discardRadio)
    expect(discardRadio.checked).toBe(true)

    await act(async () => {
      discardRadio.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.activeElement).toBe(discardRadio)

    await act(async () => {
      discardRadio.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })
    expect(document.activeElement).toBe(discardRadio)

    // 2. When both radios are enabled, Home/End move to the first/last enabled radio and select it
    await act(async () => {
      pushConflict?.(makeView({ sessionId: 'sess-fe-202-ok', keepDraft: 'ok' }))
    })
    dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    await act(async () => {
      ;(dialog.querySelector('[data-conflict-action="reload"]') as HTMLButtonElement).click()
    })

    keepRadio = dialog.querySelector('input[value="draft"]') as HTMLInputElement
    discardRadio = dialog.querySelector('input[value="discard"]') as HTMLInputElement
    keepRadio.focus()
    expect(keepRadio.checked).toBe(true)

    await act(async () => {
      keepRadio.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    })
    expect(document.activeElement).toBe(discardRadio)
    expect(discardRadio.checked).toBe(true)

    await act(async () => {
      discardRadio.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    })
    expect(document.activeElement).toBe(keepRadio)
    expect(keepRadio.checked).toBe(true)
  })
})
