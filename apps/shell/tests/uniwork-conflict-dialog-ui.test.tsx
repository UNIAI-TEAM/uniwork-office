// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../src/renderer/src/locale'
import { en } from '../src/renderer/src/i18n/sync/en'
import { vi as viStrings } from '../src/renderer/src/i18n/sync/vi'
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
      pushConflict?.(makeView())
    })

    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    const alertEl = dialog.querySelector('[role="alert"]') as HTMLElement
    const overwriteBtn = dialog.querySelector(
      '[data-conflict-action="overwrite"]',
    ) as HTMLButtonElement
    await act(async () => {
      overwriteBtn.click()
    })

    const overwriteGo = dialog.querySelector(
      '[data-conflict-action="overwrite-go"]',
    ) as HTMLButtonElement
    nextReply = {
      kind: 'view',
      view: makeView({ notice: 'overwrite_failed' }),
    }
    await act(async () => {
      overwriteGo.click()
    })
    expect(alertEl.textContent).toBe(en.uwConflictOverwriteFailed)

    nextReply = {
      kind: 'view',
      view: makeView({ notice: 'overwrite_failed' }),
    }
    await act(async () => {
      overwriteGo.click()
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

  it('G5-12 AC3: with an AI turn running, Save as a copy asks to stop it first and sends save-copy with stopAi: true', async () => {
    await act(async () => {
      pushConflict?.(makeView({ aiRunning: true }))
    })
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    await act(async () => {
      ;(dialog.querySelector('[data-conflict-action="save-copy"]') as HTMLButtonElement).click()
    })
    expect(dialog.textContent).toContain(en.uwRemoteStopAiConfirm)
    expect(dialog.querySelector('[data-conflict-action="save-copy-go"]')).toBeNull()
    await act(async () => {
      ;(dialog.querySelector('[data-conflict-action="stop-ai-go"]') as HTMLButtonElement).click()
    })
    nextReply = { kind: 'view', view: makeView({ aiRunning: false }) }
    await act(async () => {
      ;(dialog.querySelector('[data-conflict-action="save-copy-go"]') as HTMLButtonElement).click()
    })
    expect(actCalls).toEqual([
      { sessionId: 'sess-ui-1', action: { kind: 'save-copy', stopAi: true } },
    ])
  })

  it('G5-12 AC1: a save_copy_done reply returns to step 1 with the copy title in the alert and keeps Reload / Overwrite available', async () => {
    await act(async () => {
      pushConflict?.(makeView())
    })
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    await act(async () => {
      ;(dialog.querySelector('[data-conflict-action="save-copy"]') as HTMLButtonElement).click()
    })
    nextReply = {
      kind: 'view',
      view: makeView({ notice: 'save_copy_done', noticeArg: 'Contract (my version).docx' }),
    }
    await act(async () => {
      ;(dialog.querySelector('[data-conflict-action="save-copy-go"]') as HTMLButtonElement).click()
    })
    expect(actCalls).toEqual([
      { sessionId: 'sess-ui-1', action: { kind: 'save-copy', stopAi: false } },
    ])
    expect(dialog.querySelector('[data-conflict-action="save-copy-go"]')).toBeNull()
    const alertEl = dialog.querySelector('[role="alert"]') as HTMLElement
    expect(alertEl.textContent).toContain('Contract (my version).docx')
    expect(alertEl.className).toContain('uw-conflict-alert--ok')
    for (const id of ['reload', 'overwrite', 'save-copy']) {
      const btn = dialog.querySelector(`[data-conflict-action="${id}"]`) as HTMLButtonElement
      expect(btn.getAttribute('aria-disabled')).not.toBe('true')
    }
  })

  describe('G5-12 W-F2: no seat -> Download my version', () => {
    const openStep2 = async () => {
      await act(async () => {
        pushConflict?.(makeView())
      })
      const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
      await act(async () => {
        ;(dialog.querySelector('[data-conflict-action="save-copy"]') as HTMLButtonElement).click()
      })
      return dialog
    }

    it('a save_copy_no_seat reply keeps step 2: one alert with the reason, Download my version as the primary (in place of Create copy), Back stays, focus stays on the primary', async () => {
      const dialog = await openStep2()
      nextReply = { kind: 'view', view: makeView({ notice: 'save_copy_no_seat' }) }
      const primaryBefore = dialog.querySelector(
        '[data-conflict-action="save-copy-go"]',
      ) as HTMLButtonElement
      primaryBefore.focus()
      await act(async () => {
        primaryBefore.click()
      })
      expect(actCalls).toEqual([
        { sessionId: 'sess-ui-1', action: { kind: 'save-copy', stopAi: false } },
      ])
      expect(dialog.querySelectorAll('[role="alert"]')).toHaveLength(1)
      const alertEl = dialog.querySelector('[role="alert"]') as HTMLElement
      expect(alertEl.textContent).toBe(en.uwConflictSaveCopyNoSeat)
      expect(alertEl.className).not.toContain('uw-conflict-alert--ok')
      expect(dialog.querySelector('[data-conflict-action="save-copy-go"]')).toBeNull()
      const primary = dialog.querySelector('[data-conflict-action="download-go"]') as HTMLElement
      expect(primary.textContent).toBe(en.uwActDownloadMine)
      expect(primary.className).toContain('uw-conflict-btn--primary')
      expect(primary.getAttribute('aria-disabled')).toBeNull()
      // the same element: focus did not jump
      expect(primary).toBe(primaryBefore)
      expect(document.activeElement).toBe(primary)
      const back = dialog.querySelector('[data-conflict-action="back"]') as HTMLElement
      expect(back.textContent).toBe(en.uwConflictBack)
      expect(dialog.textContent).not.toMatch(/\b(git|GitHub|UNI-\d+|GO-\d+)\b/)
    })

    it.each([
      ['en', 'save_copy_no_seat'],
      ['en', 'download_failed'],
      ['vi', 'save_copy_no_seat'],
      ['vi', 'download_failed'],
    ] as const)(
      'in the no-seat Download state (%s, %s) the heading is "Download my version", the confirm body is not rendered and the dialog ids are not dangling',
      async (lang, notice) => {
        const strings = lang === 'vi' ? viStrings : en
        // remount under the wanted language (the provider keeps its initial lang in state)
        await act(async () => {
          root.render(
            React.createElement(
              LocaleProvider,
              { initial: lang, key: lang },
              React.createElement(UniworkConflictHost),
            ),
          )
        })
        const dialog = await openStep2()
        // normal step 2 first: the Save-copy heading and its confirm body
        expect(dialog.querySelector('h2')?.textContent).toBe(strings.uwConflictSaveCopyTitle)
        nextReply = { kind: 'view', view: makeView({ notice: 'save_copy_no_seat' }) }
        await act(async () => {
          ;(
            dialog.querySelector('[data-conflict-action="save-copy-go"]') as HTMLButtonElement
          ).click()
        })
        if (notice === 'download_failed') {
          nextReply = { kind: 'view', view: makeView({ notice: 'download_failed' }) }
          await act(async () => {
            ;(
              dialog.querySelector('[data-conflict-action="download-go"]') as HTMLButtonElement
            ).click()
          })
        }
        const heading = dialog.querySelector('h2') as HTMLElement
        expect(heading.textContent).toBe(strings.uwActDownloadMine)
        expect(dialog.querySelector('.uw-conflict-body')).toBeNull()
        expect(dialog.textContent).not.toContain(strings.uwConflictSaveCopyConfirm.slice(0, 20))
        expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id)
        // no dangling id: the description (if any) points at an element that exists
        const describedBy = dialog.getAttribute('aria-describedby')
        if (describedBy) {
          for (const id of describedBy.split(/\s+/)) {
            expect(document.getElementById(id)).not.toBeNull()
          }
        }
        expect(dialog.querySelectorAll('[role="alert"]')).toHaveLength(1)
      },
    )

    it('the Download primary sends download-mine (with stopAi from the stop-AI step)', async () => {
      const dialog = await openStep2()
      nextReply = { kind: 'view', view: makeView({ notice: 'save_copy_no_seat' }) }
      await act(async () => {
        ;(
          dialog.querySelector('[data-conflict-action="save-copy-go"]') as HTMLButtonElement
        ).click()
      })
      actCalls.length = 0
      // the person cancels the OS dialog: main answers with the same notice, still step 2
      await act(async () => {
        ;(dialog.querySelector('[data-conflict-action="download-go"]') as HTMLButtonElement).click()
      })
      expect(actCalls).toEqual([
        { sessionId: 'sess-ui-1', action: { kind: 'download-mine', stopAi: false } },
      ])
      expect(dialog.querySelector('[data-conflict-action="download-go"]')).not.toBeNull()
      expect(dialog.querySelectorAll('[role="alert"]')).toHaveLength(1)
      expect((dialog.querySelector('[role="alert"]') as HTMLElement).textContent).toBe(
        en.uwConflictSaveCopyNoSeat,
      )
    })

    it('FE-12-01 / FE-12-04: Back from the Download step returns to step 1 without the no-seat notice, and re-entering Save as a copy shows the create-copy step again', async () => {
      const dialog = await openStep2()
      nextReply = { kind: 'view', view: makeView({ notice: 'save_copy_no_seat' }) }
      await act(async () => {
        ;(
          dialog.querySelector('[data-conflict-action="save-copy-go"]') as HTMLButtonElement
        ).click()
      })
      expect(dialog.querySelector('[data-conflict-action="download-go"]')).not.toBeNull()

      await act(async () => {
        ;(dialog.querySelector('[data-conflict-action="back"]') as HTMLButtonElement).click()
      })
      // step 1, and the alert no longer says "you can download your version" (step 1 has no
      // Download button)
      expect(dialog.querySelector('[data-conflict-action="reload"]')).not.toBeNull()
      expect(dialog.querySelector('[data-conflict-action="download-go"]')).toBeNull()
      expect(dialog.querySelector('[role="alert"]')?.textContent ?? '').toBe('')
      expect(dialog.textContent).not.toContain(en.uwConflictSaveCopyNoSeat)
      expect(document.activeElement).toBe(
        dialog.querySelector('[data-conflict-action="save-copy"]') as HTMLElement,
      )

      await act(async () => {
        ;(dialog.querySelector('[data-conflict-action="save-copy"]') as HTMLButtonElement).click()
      })
      const heading = dialog.querySelector('h2') as HTMLElement
      expect(heading.textContent).toBe(en.uwConflictSaveCopyTitle)
      const primary = dialog.querySelector('[data-conflict-action="save-copy-go"]') as HTMLElement
      expect(primary).not.toBeNull()
      expect(dialog.querySelector('[data-conflict-action="download-go"]')).toBeNull()
      expect(dialog.querySelector('[role="alert"]')?.textContent ?? '').toBe('')
      // Back is local: no request reached main beyond the one refused copy
      expect(actCalls).toEqual([
        { sessionId: 'sess-ui-1', action: { kind: 'save-copy', stopAi: false } },
      ])
    })

    it('BE-12-304: a save_copy_folder_refused reply keeps step 2 with the folder reason, Download my version as the primary; Back clears the notice and starts step 1 clean', async () => {
      const dialog = await openStep2()
      nextReply = { kind: 'view', view: makeView({ notice: 'save_copy_folder_refused' }) }
      await act(async () => {
        ;(
          dialog.querySelector('[data-conflict-action="save-copy-go"]') as HTMLButtonElement
        ).click()
      })
      expect(dialog.querySelectorAll('[role="alert"]')).toHaveLength(1)
      expect((dialog.querySelector('[role="alert"]') as HTMLElement).textContent).toBe(
        en.uwConflictSaveCopyFolderRefused,
      )
      expect(en.uwConflictSaveCopyFolderRefused).toBe(
        'You can’t create documents in this folder. Download your version instead.',
      )
      expect((dialog.querySelector('h2') as HTMLElement).textContent).toBe(en.uwActDownloadMine)
      expect(dialog.querySelector('[data-conflict-action="save-copy-go"]')).toBeNull()
      const primary = dialog.querySelector('[data-conflict-action="download-go"]') as HTMLElement
      expect(primary.textContent).toBe(en.uwActDownloadMine)
      expect(dialog.querySelector('[data-conflict-action="back"]')).not.toBeNull()

      // the primary sends the same download-mine action as after a no-seat refusal
      actCalls.length = 0
      await act(async () => {
        primary.click()
      })
      expect(actCalls).toEqual([
        { sessionId: 'sess-ui-1', action: { kind: 'download-mine', stopAi: false } },
      ])

      // Back: step 1 without the reason, and a re-entered Save as a copy starts clean
      await act(async () => {
        ;(dialog.querySelector('[data-conflict-action="back"]') as HTMLButtonElement).click()
      })
      expect(dialog.querySelector('[data-conflict-action="reload"]')).not.toBeNull()
      expect(dialog.querySelector('[data-conflict-action="download-go"]')).toBeNull()
      expect(dialog.querySelector('[role="alert"]')?.textContent ?? '').toBe('')
      await act(async () => {
        ;(dialog.querySelector('[data-conflict-action="save-copy"]') as HTMLButtonElement).click()
      })
      expect(dialog.querySelector('[data-conflict-action="save-copy-go"]')).not.toBeNull()
      expect(dialog.querySelector('[role="alert"]')?.textContent ?? '').toBe('')
    })

    it('FE-12-22: Back from the Download step after a download_failed reply also returns to step 1 without the notice, and re-entering Save as a copy shows the create-copy step', async () => {
      const dialog = await openStep2()
      nextReply = { kind: 'view', view: makeView({ notice: 'save_copy_no_seat' }) }
      await act(async () => {
        ;(
          dialog.querySelector('[data-conflict-action="save-copy-go"]') as HTMLButtonElement
        ).click()
      })
      nextReply = { kind: 'view', view: makeView({ notice: 'download_failed' }) }
      await act(async () => {
        ;(dialog.querySelector('[data-conflict-action="download-go"]') as HTMLButtonElement).click()
      })
      expect((dialog.querySelector('[role="alert"]') as HTMLElement).textContent).toBe(
        en.uwConflictDownloadFailedDesktop,
      )

      await act(async () => {
        ;(dialog.querySelector('[data-conflict-action="back"]') as HTMLButtonElement).click()
      })
      expect(dialog.querySelector('[data-conflict-action="reload"]')).not.toBeNull()
      expect(dialog.querySelector('[data-conflict-action="download-go"]')).toBeNull()
      expect(dialog.querySelector('[role="alert"]')?.textContent ?? '').toBe('')
      expect(dialog.textContent).not.toContain(en.uwConflictDownloadFailedDesktop)

      await act(async () => {
        ;(dialog.querySelector('[data-conflict-action="save-copy"]') as HTMLButtonElement).click()
      })
      expect((dialog.querySelector('h2') as HTMLElement).textContent).toBe(
        en.uwConflictSaveCopyTitle,
      )
      expect(dialog.querySelector('[data-conflict-action="save-copy-go"]')).not.toBeNull()
      expect(dialog.querySelector('[data-conflict-action="download-go"]')).toBeNull()
      expect(dialog.querySelector('[role="alert"]')?.textContent ?? '').toBe('')
      // Back is local: only the refused copy and the failed download reached main
      expect(actCalls.map((c) => c.action.kind)).toEqual(['save-copy', 'download-mine'])
    })

    it('FE-12-22: Back from the create-copy step (no Download notice) leaves the view untouched: an unrelated step-1 notice survives and no view change is pushed', async () => {
      await act(async () => {
        pushConflict?.(makeView({ notice: 'head_moved' }))
      })
      const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
      const noticeBefore = dialog.querySelector('[role="alert"]')?.textContent ?? ''
      expect(noticeBefore).not.toBe('')
      await act(async () => {
        ;(dialog.querySelector('[data-conflict-action="save-copy"]') as HTMLButtonElement).click()
      })
      expect(dialog.querySelector('[data-conflict-action="save-copy-go"]')).not.toBeNull()
      await act(async () => {
        ;(dialog.querySelector('[data-conflict-action="back"]') as HTMLButtonElement).click()
      })
      expect(dialog.querySelector('[data-conflict-action="reload"]')).not.toBeNull()
      expect(dialog.querySelector('[role="alert"]')?.textContent ?? '').toBe(noticeBefore)
      // Back is local and clears nothing here
      expect(actCalls).toEqual([])
    })

    describe('FE-12-21: Back is busy-guarded like the other step-2 controls', () => {
      /** the next uniworkConflictAct call stays pending until `release()` */
      const deferNextAct = () => {
        let release: (() => void) | null = null
        const bridge = (window as unknown as { api: { uniworkConflictAct: unknown } }).api
        const original = bridge.uniworkConflictAct as (
          s: string,
          a: UniworkConflictAction,
        ) => Promise<UniworkConflictReply>
        bridge.uniworkConflictAct = (s: string, a: UniworkConflictAction) =>
          new Promise<UniworkConflictReply>((resolve) => {
            release = () => {
              bridge.uniworkConflictAct = original
              resolve(original(s, a))
            }
          })
        return () => release?.()
      }

      it('a late no-seat reply to Download my version (picker cancelled) never lands on step 1: Back is inert while the request is in flight', async () => {
        const dialog = await openStep2()
        nextReply = { kind: 'view', view: makeView({ notice: 'save_copy_no_seat' }) }
        await act(async () => {
          ;(
            dialog.querySelector('[data-conflict-action="save-copy-go"]') as HTMLButtonElement
          ).click()
        })
        const release = deferNextAct()
        await act(async () => {
          ;(
            dialog.querySelector('[data-conflict-action="download-go"]') as HTMLButtonElement
          ).click()
        })
        const back = dialog.querySelector('[data-conflict-action="back"]') as HTMLButtonElement
        expect(back.getAttribute('aria-disabled')).toBe('true')
        await act(async () => {
          back.click()
        })
        // still the Download step, notice intact: the click did nothing
        expect(dialog.querySelector('[data-conflict-action="download-go"]')).not.toBeNull()
        expect(dialog.querySelector('[data-conflict-action="reload"]')).toBeNull()
        expect((dialog.querySelector('[role="alert"]') as HTMLElement).textContent).toBe(
          en.uwConflictSaveCopyNoSeat,
        )

        // the picker was cancelled: main answers with the same notice, still step 2
        nextReply = { kind: 'view', view: makeView({ notice: 'save_copy_no_seat' }) }
        await act(async () => {
          release()
        })
        // the same notice again is re-announced: the text is cleared for one frame
        await act(async () => {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        })
        expect(dialog.querySelector('[data-conflict-action="download-go"]')).not.toBeNull()
        expect(dialog.querySelector('[data-conflict-action="reload"]')).toBeNull()
        expect((dialog.querySelector('[role="alert"]') as HTMLElement).textContent).toBe(
          en.uwConflictSaveCopyNoSeat,
        )
        expect(
          (dialog.querySelector('[data-conflict-action="back"]') as HTMLElement).getAttribute(
            'aria-disabled',
          ),
        ).not.toBe('true')

        // once the reply landed Back works again and starts step 1 clean
        await act(async () => {
          ;(dialog.querySelector('[data-conflict-action="back"]') as HTMLButtonElement).click()
        })
        expect(dialog.querySelector('[data-conflict-action="reload"]')).not.toBeNull()
        expect(dialog.querySelector('[role="alert"]')?.textContent ?? '').toBe('')
      })

      it('a late download_failed reply never lands on step 1 either', async () => {
        const dialog = await openStep2()
        nextReply = { kind: 'view', view: makeView({ notice: 'save_copy_no_seat' }) }
        await act(async () => {
          ;(
            dialog.querySelector('[data-conflict-action="save-copy-go"]') as HTMLButtonElement
          ).click()
        })
        const release = deferNextAct()
        await act(async () => {
          ;(
            dialog.querySelector('[data-conflict-action="download-go"]') as HTMLButtonElement
          ).click()
        })
        await act(async () => {
          ;(dialog.querySelector('[data-conflict-action="back"]') as HTMLButtonElement).click()
        })
        nextReply = { kind: 'view', view: makeView({ notice: 'download_failed' }) }
        await act(async () => {
          release()
        })
        expect(dialog.querySelector('[data-conflict-action="download-go"]')).not.toBeNull()
        expect(dialog.querySelector('[data-conflict-action="reload"]')).toBeNull()
        expect((dialog.querySelector('[role="alert"]') as HTMLElement).textContent).toBe(
          en.uwConflictDownloadFailedDesktop,
        )
      })

      it('a late no-seat reply to Create copy never lands on step 1: Back is inert while the copy is in flight', async () => {
        const dialog = await openStep2()
        const release = deferNextAct()
        await act(async () => {
          ;(
            dialog.querySelector('[data-conflict-action="save-copy-go"]') as HTMLButtonElement
          ).click()
        })
        const back = dialog.querySelector('[data-conflict-action="back"]') as HTMLButtonElement
        expect(back.getAttribute('aria-disabled')).toBe('true')
        await act(async () => {
          back.click()
        })
        expect(dialog.querySelector('[data-conflict-action="save-copy-go"]')).not.toBeNull()
        expect(dialog.querySelector('[data-conflict-action="reload"]')).toBeNull()

        nextReply = { kind: 'view', view: makeView({ notice: 'save_copy_no_seat' }) }
        await act(async () => {
          release()
        })
        // the reply turns step 2 into the Download step, not a stray step-1 alert
        expect(dialog.querySelector('[data-conflict-action="download-go"]')).not.toBeNull()
        expect(dialog.querySelector('[data-conflict-action="reload"]')).toBeNull()
        expect((dialog.querySelector('[role="alert"]') as HTMLElement).textContent).toBe(
          en.uwConflictSaveCopyNoSeat,
        )
      })
    })

    it('a download_done reply returns to step 1 with the file name in an ok alert; Reload / Overwrite / Save as a copy stay available', async () => {
      const dialog = await openStep2()
      nextReply = { kind: 'view', view: makeView({ notice: 'save_copy_no_seat' }) }
      await act(async () => {
        ;(
          dialog.querySelector('[data-conflict-action="save-copy-go"]') as HTMLButtonElement
        ).click()
      })
      nextReply = {
        kind: 'view',
        view: makeView({ notice: 'download_done', noticeArg: 'Contract (my version).docx' }),
      }
      await act(async () => {
        ;(dialog.querySelector('[data-conflict-action="download-go"]') as HTMLButtonElement).click()
      })
      expect(dialog.querySelector('[data-conflict-action="download-go"]')).toBeNull()
      expect(dialog.querySelectorAll('[role="alert"]')).toHaveLength(1)
      const alertEl = dialog.querySelector('[role="alert"]') as HTMLElement
      expect(alertEl.textContent).toBe(
        en.uwConflictDownloadDone.replace('{file}', 'Contract (my version).docx'),
      )
      expect(alertEl.className).toContain('uw-conflict-alert--ok')
      for (const id of ['reload', 'overwrite', 'save-copy']) {
        const btn = dialog.querySelector(`[data-conflict-action="${id}"]`) as HTMLButtonElement
        expect(btn.getAttribute('aria-disabled')).not.toBe('true')
      }
      expect(document.activeElement).toBe(
        dialog.querySelector('[data-conflict-action="cancel"]') as HTMLElement,
      )
    })

    it('a download_failed reply stays on step 2 with the failure alert and the Download primary; a rejected IPC call falls back to the same', async () => {
      const dialog = await openStep2()
      nextReply = { kind: 'view', view: makeView({ notice: 'save_copy_no_seat' }) }
      await act(async () => {
        ;(
          dialog.querySelector('[data-conflict-action="save-copy-go"]') as HTMLButtonElement
        ).click()
      })
      nextReply = { kind: 'view', view: makeView({ notice: 'download_failed' }) }
      await act(async () => {
        ;(dialog.querySelector('[data-conflict-action="download-go"]') as HTMLButtonElement).click()
      })
      expect(dialog.querySelectorAll('[role="alert"]')).toHaveLength(1)
      expect((dialog.querySelector('[role="alert"]') as HTMLElement).textContent).toBe(
        en.uwConflictDownloadFailedDesktop,
      )
      expect(dialog.querySelector('[data-conflict-action="download-go"]')).not.toBeNull()
      expect(dialog.querySelector('[data-conflict-action="back"]')).not.toBeNull()

      // the IPC call itself rejects: the same failure notice, never a closed dialog
      nextReject = new Error('ipc down')
      await act(async () => {
        ;(dialog.querySelector('[data-conflict-action="download-go"]') as HTMLButtonElement).click()
      })
      expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
      // the same notice again is re-announced: the text is cleared for one frame
      await act(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      })
      expect((dialog.querySelector('[role="alert"]') as HTMLElement).textContent).toBe(
        en.uwConflictDownloadFailedDesktop,
      )
    })

    it('the primary is aria-disabled while busy (rules unchanged) and the vi/en strings are the agreed copy', async () => {
      expect(viStrings.uwConflictSaveCopyNoSeat).toBe(
        'Không tạo được bản sao vì bạn không phải thành viên của không gian làm việc chứa tài liệu này. Thay đổi của bạn vẫn an toàn; bạn có thể tải bản của mình về máy.',
      )
      expect(viStrings.uwConflictDownloadDone).toBe(
        'Đã lưu bản của bạn vào máy: {file}. Tài liệu này chưa đổi; bạn vẫn chọn được Tải lại bản mới nhất hoặc Ghi đè.',
      )
      expect(viStrings.uwConflictDownloadFailedDesktop).toBe(
        'Chưa lưu được tệp. Thay đổi của bạn vẫn an toàn; hãy thử lại.',
      )
      expect(viStrings.uwConflictSaveCopyFolderRefused).toBe(
        'Bạn không thể tạo tài liệu trong thư mục này. Hãy tải bản của bạn về.',
      )
      expect(en.uwConflictSaveCopyNoSeat).toContain('not a member of the workspace')
      const dialog = await openStep2()
      nextReply = { kind: 'view', view: makeView({ notice: 'save_copy_no_seat' }) }
      await act(async () => {
        ;(
          dialog.querySelector('[data-conflict-action="save-copy-go"]') as HTMLButtonElement
        ).click()
      })
      let release: (() => void) | null = null
      const bridge = (window as unknown as { api: { uniworkConflictAct: unknown } }).api
      const original = bridge.uniworkConflictAct as (
        s: string,
        a: UniworkConflictAction,
      ) => Promise<UniworkConflictReply>
      bridge.uniworkConflictAct = (s: string, a: UniworkConflictAction) =>
        new Promise<UniworkConflictReply>((resolve) => {
          release = () => resolve(original(s, a))
        })
      await act(async () => {
        ;(dialog.querySelector('[data-conflict-action="download-go"]') as HTMLButtonElement).click()
      })
      expect(
        (dialog.querySelector('[data-conflict-action="download-go"]') as HTMLElement).getAttribute(
          'aria-disabled',
        ),
      ).toBe('true')
      await act(async () => {
        release?.()
      })
    })
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

  it('FE-203: re-announces a notice only when it comes from this reply (repeated failure), not on a pushed view that still carries the same notice', async () => {
    await act(async () => {
      pushConflict?.(makeView())
    })

    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    const alertEl = dialog.querySelector('[role="alert"]') as HTMLElement

    const overwriteBtn = dialog.querySelector(
      '[data-conflict-action="overwrite"]',
    ) as HTMLButtonElement
    await act(async () => {
      overwriteBtn.click()
    })

    const overwriteGo = dialog.querySelector(
      '[data-conflict-action="overwrite-go"]',
    ) as HTMLButtonElement

    // First failure reply sets notice='overwrite_failed'
    nextReply = {
      kind: 'view',
      view: makeView({ notice: 'overwrite_failed' }),
    }
    await act(async () => {
      overwriteGo.click()
    })
    expect(alertEl.textContent).toBe(en.uwConflictOverwriteFailed)

    // Pushed view update (e.g. intent change) still carrying the same notice does NOT clear/re-announce
    await act(async () => {
      pushConflict?.(makeView({ notice: 'overwrite_failed', intent: 'committing' }))
    })
    expect(alertEl.textContent).toBe(en.uwConflictOverwriteFailed)

    // Repeated failure from THIS reply DOES clear and re-fill on the next frame
    nextReply = {
      kind: 'view',
      view: makeView({ notice: 'overwrite_failed', intent: 'committing' }),
    }
    await act(async () => {
      overwriteGo.click()
    })
    expect(alertEl.textContent).toBe('')

    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    })
    expect(alertEl.textContent).toBe(en.uwConflictOverwriteFailed)
  })

  it('FE-204: busy ref guard ensures two synchronous clicks in the same frame send only one uniworkConflictAct call', async () => {
    await act(async () => {
      pushConflict?.(makeView())
    })

    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    const overwriteBtn = dialog.querySelector(
      '[data-conflict-action="overwrite"]',
    ) as HTMLButtonElement
    await act(async () => {
      overwriteBtn.click()
    })

    const overwriteGo = dialog.querySelector(
      '[data-conflict-action="overwrite-go"]',
    ) as HTMLButtonElement

    await act(async () => {
      overwriteGo.click()
      overwriteGo.click()
    })

    expect(actCalls).toHaveLength(1)
    expect(actCalls[0]).toEqual({
      sessionId: 'sess-ui-1',
      action: { kind: 'overwrite', stopAi: false },
    })
  })

  it('V-01: the initially focused control carries a data-conflict-initial-focus marker (cleared on blur and pointer interaction)', async () => {
    await act(async () => {
      pushConflict?.(makeView({ sessionId: 'sess-v01' }))
    })
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    const cancelBtn = dialog.querySelector('[data-conflict-action="cancel"]') as HTMLButtonElement
    expect(document.activeElement).toBe(cancelBtn)
    expect(cancelBtn.hasAttribute('data-conflict-initial-focus')).toBe(true)

    // Blur (focus moves on) clears the marker so a later focus-visible ring is the only ring.
    const closeX = dialog.querySelector('[data-conflict-action="close-x"]') as HTMLButtonElement
    await act(async () => {
      closeX.focus()
    })
    expect(cancelBtn.hasAttribute('data-conflict-initial-focus')).toBe(false)

    // A pointer press on the marked control also clears it (mouse users get the native :focus-visible behaviour).
    await act(async () => {
      cancelBtn.focus()
    })
    // focus() outside the effect is not "initial": the marker is only set by the dialog's own focus management
    expect(cancelBtn.hasAttribute('data-conflict-initial-focus')).toBe(false)

    const reloadBtn = dialog.querySelector('[data-conflict-action="reload"]') as HTMLButtonElement
    await act(async () => {
      reloadBtn.click()
    })
    const backBtn = dialog.querySelector('[data-conflict-action="back"]') as HTMLButtonElement
    expect(document.activeElement).toBe(backBtn)
    expect(backBtn.hasAttribute('data-conflict-initial-focus')).toBe(true)
    await act(async () => {
      backBtn.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(backBtn.hasAttribute('data-conflict-initial-focus')).toBe(false)
  })

  it('V-04: Reload step 2 hides the kept-draft helper when Keep is unavailable (store_full / keystore_locked / drafts_full) and keeps it when Keep is available', async () => {
    for (const keepDraft of ['store_full', 'keystore_locked', 'drafts_full'] as const) {
      await act(async () => {
        pushConflict?.(makeView({ sessionId: `sess-v04-${keepDraft}`, keepDraft }))
      })
      const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
      await act(async () => {
        ;(dialog.querySelector('[data-conflict-action="reload"]') as HTMLButtonElement).click()
      })
      expect(dialog.textContent).not.toContain(en.uwConflictKeepDraftHint)
      const keepRadio = dialog.querySelector('input[value="draft"]') as HTMLInputElement
      for (const id of (keepRadio.getAttribute('aria-describedby') ?? '').split(' ')) {
        expect(document.getElementById(id)).not.toBeNull()
      }
      await act(async () => {
        pushConflictClosed?.(`sess-v04-${keepDraft}`)
      })
    }

    await act(async () => {
      pushConflict?.(makeView({ sessionId: 'sess-v04-ok', keepDraft: 'ok' }))
    })
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    await act(async () => {
      ;(dialog.querySelector('[data-conflict-action="reload"]') as HTMLButtonElement).click()
    })
    expect(dialog.textContent).toContain(en.uwConflictKeepDraftHint)
    const keepRadio = dialog.querySelector('input[value="draft"]') as HTMLInputElement
    const hintId = keepRadio.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(hintId)?.textContent).toBe(en.uwConflictKeepDraftHint)
  })

  it('FE-303: the detached-opener fallback does not leave a persistent tabindex on TabBar markup (removed on blur)', async () => {
    const activeTab = document.createElement('div')
    activeTab.className = 'tab-item active'
    appSiblingEl.appendChild(activeTab)

    const openerEl = document.getElementById('opener-trigger')!
    openerEl.focus()
    await act(async () => {
      pushConflict?.(makeView({ sessionId: 'sess-fe-303' }))
    })
    openerEl.remove()
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.activeElement).toBe(activeTab)

    const other = document.createElement('button')
    appSiblingEl.appendChild(other)
    other.focus()
    expect(activeTab.hasAttribute('tabindex')).toBe(false)
  })

  it('FE-303: an already focusable active tab is focused without any attribute mutation', async () => {
    const activeTab = document.createElement('button')
    activeTab.className = 'tab-item active'
    appSiblingEl.appendChild(activeTab)

    const openerEl = document.getElementById('opener-trigger')!
    openerEl.focus()
    await act(async () => {
      pushConflict?.(makeView({ sessionId: 'sess-fe-303b' }))
    })
    openerEl.remove()
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.activeElement).toBe(activeTab)
    expect(activeTab.hasAttribute('tabindex')).toBe(false)
  })
})

describe('UniworkConflictDialog CSS (G5-09 S5 visual-1 fixes)', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const css = readFileSync(
    path.resolve(dir, '../src/renderer/src/uniwork-conflict-dialog.css'),
    'utf8',
  )
  const tokens = readFileSync(path.resolve(dir, '../../../packages/ui/src/tokens.css'), 'utf8')

  function rule(selector: string): string {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(css)
    return m?.[1] ?? ''
  }

  it('V-01: marked initial-focus controls get the same ring as :focus-visible, from tokens', () => {
    const body = rule('.uw-conflict-btn[data-conflict-initial-focus]')
    expect(body).toContain('outline: 2px solid var(--color-border-brand)')
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i)
  })

  it('V-02: the head no longer reserves the close-button gutter for the whole column (only the title does)', () => {
    expect(rule('.uw-conflict-head')).not.toContain('padding-right')
    expect(rule('.uw-conflict-title')).toContain('padding-right')
  })

  it('V12-01: the first step-1 reason line clears the focus ring of the button above it (outline + offset), with no raw colors', () => {
    const ring = rule('.uw-conflict-btn[data-conflict-initial-focus]')
    const width = Number(/outline:\s*(\d+)px/.exec(ring)![1])
    const offset = Number(/outline-offset:\s*(\d+)px/.exec(ring)![1])
    const body = rule('.uw-conflict-actions + .uw-conflict-reason')
    const top = /margin-top:\s*(-?\d+)px/.exec(body)
    expect(top).not.toBeNull()
    // at least 2px of air between the ring's outer edge and the reason text
    expect(Number(top![1])).toBeGreaterThanOrEqual(width + offset + 2)
    expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i)
  })

  it('V-06: Overwrite (danger) hover keeps white-on-red at >= 4.5:1 in light and dark (no opacity fade)', () => {
    const hover = rule(".uw-conflict-btn--danger:hover:not([aria-disabled='true'])")
    expect(hover).not.toContain('opacity')
    expect(hover).toContain('color-mix(')
    const lum = (hex: string) => {
      const c = [1, 3, 5]
        .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }
    const danger = /--danger:\s*(#[0-9a-f]{6})/i.exec(tokens)![1]
    const onDanger = /--on-danger:\s*(#[0-9a-f]{6})/i.exec(tokens)![1]
    const pct = Number(/color-mix\(in srgb, var\(--danger\) (\d+)%/.exec(hover)![1]) / 100
    const mix = (h: string) =>
      '#' +
      [1, 3, 5]
        .map((i) =>
          Math.round(parseInt(h.slice(i, i + 2), 16) * pct)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    for (const bg of [danger, mix(danger)]) {
      const hi = Math.max(lum(bg), lum(onDanger))
      const lo = Math.min(lum(bg), lum(onDanger))
      expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5)
    }
  })
})
