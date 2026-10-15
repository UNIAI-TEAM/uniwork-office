import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from './locale'
import type {
  UniworkConflictAction,
  UniworkConflictReply,
  UniworkConflictView,
} from '../../shared/uniwork-conflict'
import {
  applyConflictBack,
  applyConflictSelectKeep,
  applyConflictStep1Click,
  applyConflictStopAiConfirm,
  applyConflictViewUpdate,
  buildConfirmPayload,
  createInitialConflictState,
  getActionFailureNotice,
  getReloadStepModel,
  getStep1Model,
  isSaveCopyDownloadStep,
  resolveConflictNotice,
  type ConflictDialogState,
  type ConflictStep1ActionId,
} from './uniwork-conflict-model'
import './uniwork-conflict-dialog.css'

export interface UniworkConflictBridge {
  onUniworkConflict?: (cb: (view: UniworkConflictView) => void) => () => void
  onUniworkConflictClosed?: (cb: (sessionId: string) => void) => () => void
  uniworkConflictAct?: (
    sessionId: string,
    action: UniworkConflictAction,
  ) => Promise<UniworkConflictReply>
  uniworkSyncQueueOpen?: () => Promise<unknown>
}

function getConflictBridges(): UniworkConflictBridge[] {
  if (typeof window === 'undefined') return []
  const w = window as unknown as {
    api?: UniworkConflictBridge
    aiOffice?: UniworkConflictBridge
  }
  const bridges: UniworkConflictBridge[] = []
  if (w.api) bridges.push(w.api)
  if (w.aiOffice && w.aiOffice !== w.api) bridges.push(w.aiOffice)
  return bridges
}

function fmt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '')
}

function formatSavedAt(savedAt: string | null): string {
  if (!savedAt) return '—'
  const d = new Date(savedAt)
  if (Number.isNaN(d.getTime())) return savedAt
  try {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return savedAt
  }
}

function getDialogTabbables(dialog: HTMLElement, active: HTMLElement | null): HTMLElement[] {
  const raw = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input[type="radio"]:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    ),
  )
  const radiosByName = new Map<string, HTMLInputElement[]>()
  for (const el of raw) {
    if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
      const group = radiosByName.get(el.name) ?? []
      group.push(el)
      radiosByName.set(el.name, group)
    }
  }
  const winnerByName = new Map<string, HTMLInputElement>()
  for (const [name, group] of radiosByName.entries()) {
    const activeRadio = group.find((r) => r === active)
    const checkedRadio = group.find((r) => r.checked)
    winnerByName.set(name, activeRadio ?? checkedRadio ?? group[0])
  }
  return raw.filter((el) => {
    if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
      return winnerByName.get(el.name) === el
    }
    return true
  })
}

export interface UniworkConflictDialogProps {
  view: UniworkConflictView
  onAct: (sessionId: string, action: UniworkConflictAction) => Promise<UniworkConflictReply>
  onOpenSyncCenter?: () => void | Promise<unknown>
  onClosed: () => void
  onViewChange: (nextView: UniworkConflictView) => void
  onViewDiff?: (view: UniworkConflictView) => void
}

export const UniworkConflictDialog: React.FC<UniworkConflictDialogProps> = ({
  view,
  onAct,
  onOpenSyncCenter,
  onClosed,
  onViewChange,
  onViewDiff,
}) => {
  const { t } = useI18n()
  const uid = useId()
  const scrimRef = useRef<HTMLDivElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const prevViewRef = useRef<UniworkConflictView>(view)
  const replyViewRef = useRef<UniworkConflictView | null>(null)
  const busyRef = useRef(false)
  const [state, setState] = useState<ConflictDialogState>(() => createInitialConflictState(view))
  const [busy, setBusy] = useState(false)
  const [alertClearing, setAlertClearing] = useState(false)

  useEffect(() => {
    if (prevViewRef.current !== view) {
      const isFromReply = replyViewRef.current === view
      replyViewRef.current = null
      const prevResolved = resolveConflictNotice(prevViewRef.current)
      const nextResolved = resolveConflictNotice(view)
      const isSameNotice =
        isFromReply &&
        prevResolved !== null &&
        nextResolved !== null &&
        prevResolved.key === nextResolved.key &&
        JSON.stringify(prevResolved.args) === JSON.stringify(nextResolved.args)
      prevViewRef.current = view
      setState((prev) => applyConflictViewUpdate(prev, view))
      setAlertClearing(isSameNotice)
    }
  }, [view])

  useEffect(() => {
    if (!alertClearing) return
    const raf = requestAnimationFrame(() => {
      setAlertClearing(false)
    })
    return () => cancelAnimationFrame(raf)
  }, [alertClearing])

  // Apply `inert` to sibling children of document.body while the modal is mounted
  useEffect(() => {
    const scrim = scrimRef.current
    if (!scrim || typeof document === 'undefined') return
    const newlyInerted: Element[] = []
    for (const child of Array.from(document.body.children)) {
      if (child === scrim || child.contains(scrim)) continue
      if (!child.hasAttribute('inert')) {
        child.setAttribute('inert', '')
        newlyInerted.push(child)
      }
    }
    return () => {
      for (const el of newlyInerted) {
        el.removeAttribute('inert')
      }
    }
  }, [])

  // Focus management driven by state.focusTarget and state.focusTick
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !state.focusTarget) return
    // Programmatic focus after a mouse click is not :focus-visible, so mark the control the
    // dialog focused itself; the CSS gives it the same ring (cleared on blur / pointer press).
    const target =
      state.focusTarget === 'title'
        ? titleRef.current
        : dialog.querySelector<HTMLElement>(`[data-conflict-action="${state.focusTarget}"]`)
    for (const marked of dialog.querySelectorAll('[data-conflict-initial-focus]')) {
      marked.removeAttribute('data-conflict-initial-focus')
    }
    if (!target) return
    target.focus()
    if (document.activeElement === target) target.setAttribute('data-conflict-initial-focus', '')
  }, [state.focusTarget, state.focusTick, state.step])

  const clearInitialFocusMark = useCallback(() => {
    for (const marked of dialogRef.current?.querySelectorAll('[data-conflict-initial-focus]') ??
      []) {
      marked.removeAttribute('data-conflict-initial-focus')
    }
  }, [])

  const sendAction = useCallback(
    async (action: UniworkConflictAction) => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      try {
        const reply = await onAct(view.sessionId, action)
        if (!reply || reply.kind === 'closed') {
          onClosed()
        } else if (reply.kind === 'view') {
          replyViewRef.current = reply.view
          onViewChange(reply.view)
        }
      } catch {
        const failureNotice = getActionFailureNotice(action)
        if (!failureNotice) {
          onClosed()
        } else {
          const fallbackView: UniworkConflictView = {
            ...view,
            notice: failureNotice,
            noticeArg: null,
          }
          replyViewRef.current = fallbackView
          onViewChange(fallbackView)
        }
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [onAct, onClosed, onViewChange, view],
  )

  const handleOpenSyncCenter = useCallback(async () => {
    if (onOpenSyncCenter) {
      await onOpenSyncCenter()
      return
    }
    for (const bridge of getConflictBridges()) {
      if (typeof bridge.uniworkSyncQueueOpen === 'function') {
        await bridge.uniworkSyncQueueOpen()
        return
      }
    }
  }, [onOpenSyncCenter])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        void sendAction({ kind: 'cancel' })
        return
      }
      if (
        e.key === 'ArrowDown' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowLeft' ||
        e.key === 'Home' ||
        e.key === 'End'
      ) {
        const dialog = dialogRef.current
        const active = document.activeElement
        if (
          dialog &&
          active instanceof HTMLInputElement &&
          active.type === 'radio' &&
          active.name
        ) {
          const enabledGroup = Array.from(
            dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]:not(:disabled)'),
          ).filter((r) => r.name === active.name && r.getAttribute('aria-disabled') !== 'true')
          if (enabledGroup.length > 0) {
            e.preventDefault()
            const idx = enabledGroup.indexOf(active)
            let nextRadio: HTMLInputElement | undefined
            if (e.key === 'Home') {
              nextRadio = enabledGroup[0]
            } else if (e.key === 'End') {
              nextRadio = enabledGroup[enabledGroup.length - 1]
            } else {
              const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight'
              const nextIdx =
                idx === -1
                  ? forward
                    ? 0
                    : enabledGroup.length - 1
                  : forward
                    ? (idx + 1) % enabledGroup.length
                    : (idx - 1 + enabledGroup.length) % enabledGroup.length
              nextRadio = enabledGroup[nextIdx]
            }
            if (nextRadio) {
              nextRadio.focus()
              if (nextRadio.value === 'draft' || nextRadio.value === 'discard') {
                setState((s) =>
                  applyConflictSelectKeep(s, view, nextRadio.value as 'draft' | 'discard'),
                )
              }
            }
            return
          }
        }
      }
      if (e.key === 'Tab') {
        const dialog = dialogRef.current
        if (!dialog) return
        const active = document.activeElement as HTMLElement | null
        const focusables = getDialogTabbables(dialog, active)
        if (focusables.length === 0) return
        const idx = active ? focusables.indexOf(active) : -1
        e.preventDefault()
        if (e.shiftKey) {
          const nextIdx = idx <= 0 ? focusables.length - 1 : idx - 1
          focusables[nextIdx]?.focus()
        } else {
          const nextIdx = idx < 0 || idx >= focusables.length - 1 ? 0 : idx + 1
          focusables[nextIdx]?.focus()
        }
      }
    },
    [sendAction, view],
  )

  const handleStep1ActionClick = (actionId: ConflictStep1ActionId, disabled: boolean) => {
    if (disabled || busyRef.current) return
    if (actionId === 'cancel') {
      void sendAction({ kind: 'cancel' })
      return
    }
    if (actionId === 'view-diff') {
      onViewDiff?.(view)
      return
    }
    setState((prev) => applyConflictStep1Click(prev, view, actionId))
  }

  const handleConfirmStep2 = () => {
    if (busyRef.current) return
    const payload = buildConfirmPayload(state, view)
    if (!payload) return
    void sendAction(payload)
  }

  const titleId = `${uid}-title`
  const bodyId = `${uid}-body`
  const alertId = `${uid}-alert`
  const serverAuthor =
    view.server.by && view.server.by.trim().length > 0 ? view.server.by : t('uwAuthorFallback')
  const serverVerStr = view.server.version !== null ? String(view.server.version) : '—'
  const nextVerStr = view.server.version !== null ? String(view.server.version + 1) : '—'

  const resolvedNotice = resolveConflictNotice(view)
  const noticeText = resolvedNotice ? fmt(t(resolvedNotice.key), resolvedNotice.args) : ''

  const saveCopyDownload = isSaveCopyDownloadStep(view)
  const step1Model = getStep1Model(view, { canViewDiff: Boolean(onViewDiff) })
  const reloadModel = getReloadStepModel(state, view)

  let headingText = t('uwConflictTitle')
  let bodyText = t('uwConflictBody')
  if (state.step === 'locked') {
    headingText = t('uwConflictTitle')
    bodyText = view.locked === 'deleted' ? t('uwRemoteDeleted') : t('uwRemoteRevoked')
  } else if (state.step === 'stop-ai') {
    headingText = t('uwConflictTitle')
    bodyText = t('uwRemoteStopAiConfirm')
  } else if (state.step === 'reload') {
    headingText = t('uwConflictReloadTitle')
    bodyText = fmt(t('uwConflictReloadDesktopBody'), { n: serverVerStr })
  } else if (state.step === 'overwrite') {
    headingText = t('uwConflictOverwriteTitle')
    bodyText = fmt(t('uwConflictOverwriteConfirm'), {
      next: nextVerStr,
      server: serverVerStr,
      author: serverAuthor,
    })
  } else if (state.step === 'save-copy') {
    headingText = t('uwConflictSaveCopyTitle')
    bodyText = fmt(t('uwConflictSaveCopyConfirm'), {
      server: serverVerStr,
      author: serverAuthor,
    })
  }

  // Deduplicate step 1 disabled reason lines while linking each disabled button via aria-describedby
  const step1Reasons: Array<{
    reasonId: string
    reasonKey: NonNullable<(typeof step1Model.actions)[number]['reasonKey']>
    showOpenCenter: boolean
  }> = []
  const reasonIdByKey = new Map<string, string>()
  for (const actItem of step1Model.actions) {
    if (actItem.disabled && actItem.reasonKey) {
      if (!reasonIdByKey.has(actItem.reasonKey)) {
        const rId = `${uid}-reason-${actItem.reasonKey}`
        reasonIdByKey.set(actItem.reasonKey, rId)
        step1Reasons.push({
          reasonId: rId,
          reasonKey: actItem.reasonKey,
          showOpenCenter: actItem.showOpenCenter,
        })
      }
    }
  }

  const dialogNode = (
    <div ref={scrimRef} className="uw-conflict-scrim">
      <div
        ref={dialogRef}
        className="uw-conflict-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={handleKeyDown}
        onBlur={clearInitialFocusMark}
        onPointerDown={clearInitialFocusMark}
      >
        <div className="uw-conflict-head">
          <h2 ref={titleRef} id={titleId} className="uw-conflict-title" tabIndex={-1}>
            {headingText}
          </h2>
          <p id={bodyId} className="uw-conflict-body">
            {bodyText}
          </p>

          {state.step === 'step1' && (
            <>
              <table className="uw-conflict-compare">
                <thead>
                  <tr>
                    <th scope="col" />
                    <th scope="col">{t('uwConflictColMine')}</th>
                    <th scope="col">{t('uwConflictColServer')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">{t('uwConflictRowVersion')}</th>
                    <td className="uw-conflict-version-num">
                      {view.mine.baseVersion !== null
                        ? fmt(t('uwConflictBasedOn'), {
                            n: String(view.mine.baseVersion),
                          })
                        : '—'}
                    </td>
                    <td className="uw-conflict-version-num">{serverVerStr}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('uwConflictRowTime')}</th>
                    <td>—</td>
                    <td>{formatSavedAt(view.server.savedAt)}</td>
                  </tr>
                  <tr>
                    <th scope="row">{t('uwConflictRowBy')}</th>
                    <td>{t('uwConflictMineUnsaved')}</td>
                    <td>{serverAuthor}</td>
                  </tr>
                </tbody>
              </table>

              {step1Model.noEditKey && (
                <p className="uw-conflict-note">{t(step1Model.noEditKey)}</p>
              )}
            </>
          )}

          {state.step === 'reload' && (
            <>
              <fieldset className="uw-conflict-fieldset">
                <legend className="uw-conflict-sr-only">{t('uwConflictColMine')}</legend>
                <label
                  className="uw-conflict-radio"
                  aria-disabled={reloadModel.keepDisabled ? 'true' : undefined}
                >
                  <input
                    type="radio"
                    name={`${uid}-keep`}
                    value="draft"
                    checked={reloadModel.selectedKeep === 'draft'}
                    aria-disabled={reloadModel.keepDisabled ? 'true' : undefined}
                    aria-describedby={
                      reloadModel.keepDisabled && reloadModel.keepReasonKey
                        ? `${uid}-keep-reason`
                        : `${uid}-keep-hint`
                    }
                    onChange={() => {
                      if (!reloadModel.keepDisabled) {
                        setState((s) => applyConflictSelectKeep(s, view, 'draft'))
                      }
                    }}
                    onClick={(e) => {
                      if (reloadModel.keepDisabled) {
                        e.preventDefault()
                      }
                    }}
                  />
                  <span>{t('uwConflictKeepDraft')}</span>
                </label>
                {reloadModel.keepDisabled && reloadModel.keepReasonKey && (
                  <p id={`${uid}-keep-reason`} className="uw-conflict-reason">
                    <span>{fmt(t(reloadModel.keepReasonKey), reloadModel.keepReasonArgs)}</span>
                    {reloadModel.showOpenCenter && (
                      <button
                        type="button"
                        className="uw-conflict-link"
                        data-conflict-open-center="true"
                        onClick={() => void handleOpenSyncCenter()}
                      >
                        {t('uwQueueOpenCenter')}
                      </button>
                    )}
                  </p>
                )}
                <label className="uw-conflict-radio">
                  <input
                    type="radio"
                    name={`${uid}-keep`}
                    value="discard"
                    checked={reloadModel.selectedKeep === 'discard'}
                    onChange={() => setState((s) => applyConflictSelectKeep(s, view, 'discard'))}
                  />
                  <span>{t('uwConflictDiscard')}</span>
                </label>
              </fieldset>
              {reloadModel.showKeepHint && (
                <p id={`${uid}-keep-hint`} className="uw-conflict-caption">
                  {t('uwConflictKeepDraftHint')}
                </p>
              )}
            </>
          )}

          <p
            id={alertId}
            role="alert"
            className={`uw-conflict-alert${
              view.notice === 'save_copy_done' || view.notice === 'download_done'
                ? ' uw-conflict-alert--ok'
                : ''
            }`}
          >
            {alertClearing ? '' : noticeText}
          </p>
        </div>

        {state.step === 'step1' && (
          <>
            <div className="uw-conflict-actions">
              {step1Model.actions.map((item) => {
                const reasonId = item.reasonKey ? reasonIdByKey.get(item.reasonKey) : undefined
                const styleClass =
                  item.style === 'primary'
                    ? ' uw-conflict-btn--primary'
                    : item.style === 'danger'
                      ? ' uw-conflict-btn--danger'
                      : ''
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`uw-conflict-btn${styleClass}`}
                    data-conflict-action={item.id}
                    aria-disabled={item.disabled ? 'true' : undefined}
                    aria-describedby={item.disabled ? reasonId : undefined}
                    onClick={() => handleStep1ActionClick(item.id, item.disabled)}
                  >
                    {t(item.labelKey)}
                  </button>
                )
              })}
            </div>
            {step1Reasons.map((r) => (
              <p key={r.reasonId} id={r.reasonId} className="uw-conflict-reason">
                <span>{t(r.reasonKey)}</span>
                {r.showOpenCenter && (
                  <button
                    type="button"
                    className="uw-conflict-link"
                    data-conflict-open-center="true"
                    onClick={() => void handleOpenSyncCenter()}
                  >
                    {t('uwQueueOpenCenter')}
                  </button>
                )}
              </p>
            ))}
          </>
        )}

        {state.step === 'stop-ai' && (
          <div className="uw-conflict-actions uw-conflict-actions--row">
            <button
              type="button"
              className="uw-conflict-btn uw-conflict-btn--primary"
              data-conflict-action="stop-ai-go"
              onClick={() => setState((s) => applyConflictStopAiConfirm(s, view))}
            >
              {t('uwActStopAi')}
            </button>
            <button
              type="button"
              className="uw-conflict-btn"
              data-conflict-action="back"
              onClick={() => setState((s) => applyConflictBack(s))}
            >
              {t('uwConflictBack')}
            </button>
          </div>
        )}

        {state.step === 'reload' && (
          <div className="uw-conflict-actions uw-conflict-actions--row">
            <button
              type="button"
              className="uw-conflict-btn uw-conflict-btn--primary"
              data-conflict-action="reload-go"
              aria-disabled={!reloadModel.canSubmit || busy ? 'true' : undefined}
              aria-describedby={
                !reloadModel.canSubmit && reloadModel.submitReasonKey
                  ? `${uid}-keep-reason`
                  : undefined
              }
              onClick={handleConfirmStep2}
            >
              {t('uwConflictReloadGo')}
            </button>
            <button
              type="button"
              className="uw-conflict-btn"
              data-conflict-action="back"
              onClick={() => setState((s) => applyConflictBack(s))}
            >
              {t('uwConflictBack')}
            </button>
          </div>
        )}

        {state.step === 'overwrite' && (
          <div className="uw-conflict-actions uw-conflict-actions--row">
            <button
              type="button"
              className="uw-conflict-btn uw-conflict-btn--danger"
              data-conflict-action="overwrite-go"
              aria-disabled={busy ? 'true' : undefined}
              onClick={handleConfirmStep2}
            >
              {t('uwConflictOverwriteGo')}
            </button>
            <button
              type="button"
              className="uw-conflict-btn"
              data-conflict-action="back"
              onClick={() => setState((s) => applyConflictBack(s))}
            >
              {t('uwConflictBack')}
            </button>
          </div>
        )}

        {state.step === 'save-copy' && (
          <div className="uw-conflict-actions uw-conflict-actions--row">
            <button
              type="button"
              className="uw-conflict-btn uw-conflict-btn--primary"
              data-conflict-action={saveCopyDownload ? 'download-go' : 'save-copy-go'}
              aria-disabled={busy ? 'true' : undefined}
              onClick={handleConfirmStep2}
            >
              {saveCopyDownload ? t('uwActDownloadMine') : t('uwConflictSaveCopyGo')}
            </button>
            <button
              type="button"
              className="uw-conflict-btn"
              data-conflict-action="back"
              onClick={() => setState((s) => applyConflictBack(s))}
            >
              {t('uwConflictBack')}
            </button>
          </div>
        )}

        {state.step === 'locked' && (
          <div className="uw-conflict-actions uw-conflict-actions--row">
            <button
              type="button"
              className="uw-conflict-btn uw-conflict-btn--primary"
              data-conflict-action="close"
              onClick={() => void sendAction({ kind: 'cancel' })}
            >
              {t('uwConflictClose')}
            </button>
          </div>
        )}

        {state.step !== 'locked' && (
          <button
            type="button"
            className="uw-conflict-close"
            data-conflict-action="close-x"
            aria-label={t('uwConflictClose')}
            onClick={() => void sendAction({ kind: 'cancel' })}
          >
            <svg
              viewBox="0 0 14 14"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )

  if (typeof document === 'undefined') {
    return dialogNode
  }
  return createPortal(dialogNode, document.body)
}

export interface UniworkConflictHostProps {
  onViewDiff?: (view: UniworkConflictView) => void
}

export const UniworkConflictHost: React.FC<UniworkConflictHostProps> = ({ onViewDiff }) => {
  const [view, setView] = useState<UniworkConflictView | null>(null)
  const viewRef = useRef<UniworkConflictView | null>(null)
  viewRef.current = view
  const openerRef = useRef<HTMLElement | null>(null)

  const restoreOpenerFocus = useCallback(() => {
    const opener = openerRef.current
    openerRef.current = null
    if (opener && typeof opener.focus === 'function' && opener.isConnected) {
      opener.focus()
    } else if (typeof document !== 'undefined') {
      const activeTab = document.querySelector<HTMLElement>(
        '.tab-item.active, [role="tab"][aria-selected="true"]',
      )
      if (activeTab && !activeTab.hasAttribute('tabindex') && activeTab.tabIndex < 0) {
        // TabBar owns this node: make it focusable only until focus leaves it again.
        activeTab.setAttribute('tabindex', '-1')
        activeTab.addEventListener('blur', () => activeTab.removeAttribute('tabindex'), {
          once: true,
        })
      }
      const fallback = activeTab ?? document.body
      fallback?.focus?.()
    }
  }, [])

  const handleClosed = useCallback(() => {
    viewRef.current = null
    setView(null)
    restoreOpenerFocus()
  }, [restoreOpenerFocus])

  useEffect(() => {
    const bridges = getConflictBridges()
    const unsubs: Array<() => void> = []
    for (const bridge of bridges) {
      if (typeof bridge.onUniworkConflict === 'function') {
        const unsub = bridge.onUniworkConflict((incoming) => {
          setView((prev) => {
            if (!prev && typeof document !== 'undefined') {
              openerRef.current = document.activeElement as HTMLElement | null
            }
            viewRef.current = incoming
            return incoming
          })
        })
        if (typeof unsub === 'function') {
          unsubs.push(unsub)
        }
      }
      if (typeof bridge.onUniworkConflictClosed === 'function') {
        const unsubClosed = bridge.onUniworkConflictClosed((sessionId) => {
          if (viewRef.current && viewRef.current.sessionId === sessionId) {
            handleClosed()
          }
        })
        if (typeof unsubClosed === 'function') {
          unsubs.push(unsubClosed)
        }
      }
    }
    return () => {
      for (const unsub of unsubs) {
        unsub()
      }
    }
  }, [handleClosed])

  const handleAct = useCallback(
    async (sessionId: string, action: UniworkConflictAction): Promise<UniworkConflictReply> => {
      for (const bridge of getConflictBridges()) {
        if (typeof bridge.uniworkConflictAct === 'function') {
          return await bridge.uniworkConflictAct(sessionId, action)
        }
      }
      return { kind: 'closed' }
    },
    [],
  )

  if (!view) return null

  return (
    <UniworkConflictDialog
      view={view}
      onAct={handleAct}
      onClosed={handleClosed}
      onViewChange={setView}
      onViewDiff={onViewDiff}
    />
  )
}
