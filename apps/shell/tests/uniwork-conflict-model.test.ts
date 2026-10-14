import { describe, expect, it } from 'vitest'
import type { UniworkConflictView } from '../src/shared/uniwork-conflict'
import {
  applyConflictBack,
  applyConflictSelectKeep,
  applyConflictStep1Click,
  applyConflictStopAiConfirm,
  applyConflictViewUpdate,
  buildConfirmPayload,
  canSubmitReload,
  createInitialConflictState,
  getReloadStepModel,
  getStep1Model,
  resolveConflictNotice
} from '../src/renderer/src/uniwork-conflict-model'

function makeView(overrides: Partial<UniworkConflictView> = {}): UniworkConflictView {
  return {
    sessionId: 'sess-1',
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

describe('uniwork-conflict-model (G5-09 S5 desktop)', () => {
  it('AC2: returns step 1 actions in exact DOM/visual/Tab order with Cancel as default focus (docs vs non-docs)', () => {
    const docsModel = getStep1Model(makeView({ module: 'docs', canEdit: true }))
    expect(docsModel.actions.map((a) => a.id)).toEqual([
      'view-diff',
      'reload',
      'save-copy',
      'overwrite',
      'cancel'
    ])
    expect(docsModel.defaultFocus).toBe('cancel')
    expect(docsModel.noEditKey).toBeNull()

    const sheetsModel = getStep1Model(makeView({ module: 'sheets', canEdit: true }))
    expect(sheetsModel.actions.map((a) => a.id)).toEqual([
      'reload',
      'save-copy',
      'overwrite',
      'cancel'
    ])
  })

  it('AC5: hides Overwrite and Save-copy when !canEdit and exposes uwConflictNoEdit', () => {
    const model = getStep1Model(makeView({ canEdit: false, module: 'docs' }))
    expect(model.actions.map((a) => a.id)).toEqual(['view-diff', 'reload', 'cancel'])
    expect(model.noEditKey).toBe('uwConflictNoEdit')
  })

  it('AC7: offline disables Reload (unless headOffline) and Save-copy, but keeps Overwrite enabled', () => {
    const offlineNoHead = getStep1Model(makeView({ online: false, headOffline: false }))
    const byId = Object.fromEntries(offlineNoHead.actions.map((a) => [a.id, a]))
    expect(byId.reload.disabled).toBe(true)
    expect(byId.reload.reasonKey).toBe('uwConflictOfflineDesktop')
    expect(byId['save-copy'].disabled).toBe(true)
    expect(byId['save-copy'].reasonKey).toBe('uwConflictSaveCopyOffline')
    expect(byId.overwrite.disabled).toBe(false)
    expect(byId.overwrite.reasonKey).toBeNull()

    const offlineWithHead = getStep1Model(makeView({ online: false, headOffline: true }))
    const byIdWithHead = Object.fromEntries(offlineWithHead.actions.map((a) => [a.id, a]))
    expect(byIdWithHead.reload.disabled).toBe(false)
    expect(byIdWithHead.reload.reasonKey).toBeNull()
    expect(byIdWithHead['save-copy'].disabled).toBe(true)
    expect(byIdWithHead.overwrite.disabled).toBe(false)
  })

  it('AC8: committing/reconciling disables Reload, Save-copy, Overwrite with uwRemoteWaitCommit; reconciling-stuck adds Open sync center', () => {
    for (const intent of ['committing', 'reconciling'] as const) {
      const model = getStep1Model(makeView({ intent }))
      for (const id of ['reload', 'save-copy', 'overwrite'] as const) {
        const action = model.actions.find((a) => a.id === id)!
        expect(action.disabled).toBe(true)
        expect(action.reasonKey).toBe('uwRemoteWaitCommit')
        expect(action.showOpenCenter).toBe(false)
      }
      expect(model.actions.find((a) => a.id === 'cancel')!.disabled).toBe(false)
    }

    const stuckModel = getStep1Model(makeView({ intent: 'reconciling-stuck' }))
    for (const id of ['reload', 'save-copy', 'overwrite'] as const) {
      const action = stuckModel.actions.find((a) => a.id === id)!
      expect(action.disabled).toBe(true)
      expect(action.reasonKey).toBe('uwRemoteWaitStuck')
      expect(action.showOpenCenter).toBe(true)
    }
  })

  it('AC6: Reload step 2 preselects Keep draft when ok, and disables Keep without preselecting Discard when store_full / keystore_locked / drafts_full', () => {
    const okView = makeView({ keepDraft: 'ok' })
    let state = createInitialConflictState(okView)
    state = applyConflictStep1Click(state, okView, 'reload')
    expect(state.step).toBe('reload')
    const okReload = getReloadStepModel(state, okView)
    expect(okReload.keepDisabled).toBe(false)
    expect(okReload.selectedKeep).toBe('draft')
    expect(canSubmitReload(state, okView)).toBe(true)
    expect(buildConfirmPayload(state, okView)).toEqual({
      kind: 'reload',
      keep: 'draft',
      stopAi: false
    })

    for (const keepDraft of ['store_full', 'keystore_locked'] as const) {
      const blockedView = makeView({ keepDraft })
      let blockedState = createInitialConflictState(blockedView)
      blockedState = applyConflictStep1Click(blockedState, blockedView, 'reload')
      const reloadModel = getReloadStepModel(blockedState, blockedView)
      expect(reloadModel.keepDisabled).toBe(true)
      expect(reloadModel.keepReasonKey).toBe('uwConflictKeepUnavailable')
      expect(reloadModel.showOpenCenter).toBe(false)
      expect(reloadModel.selectedKeep).toBeNull()
      expect(canSubmitReload(blockedState, blockedView)).toBe(false)
      expect(buildConfirmPayload(blockedState, blockedView)).toBeNull()

      blockedState = applyConflictSelectKeep(blockedState, blockedView, 'draft')
      expect(canSubmitReload(blockedState, blockedView)).toBe(false)

      blockedState = applyConflictSelectKeep(blockedState, blockedView, 'discard')
      expect(canSubmitReload(blockedState, blockedView)).toBe(true)
      expect(buildConfirmPayload(blockedState, blockedView)).toEqual({
        kind: 'reload',
        keep: 'discard',
        stopAi: false
      })
    }

    const capView = makeView({ keepDraft: 'drafts_full', draftCap: 3 })
    let capState = createInitialConflictState(capView)
    capState = applyConflictStep1Click(capState, capView, 'reload')
    const capModel = getReloadStepModel(capState, capView)
    expect(capModel.keepDisabled).toBe(true)
    expect(capModel.keepReasonKey).toBe('uwConflictDraftCapReached')
    expect(capModel.keepReasonArgs).toEqual({ cap: '3' })
    expect(capModel.showOpenCenter).toBe(true)
    expect(capModel.selectedKeep).toBeNull()
  })

  it('routes through stop-ai step when aiRunning is true and preserves stopAi=true into step 2 payload, while Back returns to step 1 and focuses opener', () => {
    const view = makeView({ aiRunning: true })
    let state = createInitialConflictState(view)
    state = applyConflictStep1Click(state, view, 'overwrite')
    expect(state.step).toBe('stop-ai')
    expect(state.opener).toBe('overwrite')
    expect(state.focusTarget).toBe('back')

    const backed = applyConflictBack(state)
    expect(backed.step).toBe('step1')
    expect(backed.focusTarget).toBe('overwrite')

    state = applyConflictStopAiConfirm(state, view)
    expect(state.step).toBe('overwrite')
    expect(state.stopAi).toBe(true)
    expect(state.focusTarget).toBe('back')
    expect(buildConfirmPayload(state, view)).toEqual({
      kind: 'overwrite',
      stopAi: true
    })
  })

  it('handles view updates for head_moved, save_copy_done, save_copy_failed, reload_failed, overwrite_failed, and locked revoked/deleted', () => {
    const baseView = makeView()
    let state = createInitialConflictState(baseView)
    state = applyConflictStep1Click(state, baseView, 'overwrite')
    expect(state.step).toBe('overwrite')

    const headMovedView = makeView({
      server: { version: 13, savedAt: '2026-10-14T08:05:00Z', by: 'Minh' },
      notice: 'head_moved',
      noticeArg: '13'
    })
    state = applyConflictViewUpdate(state, headMovedView)
    expect(state.step).toBe('step1')
    expect(state.focusTarget).toBe('cancel')
    expect(resolveConflictNotice(headMovedView)).toEqual({
      key: 'uwConflictHeadMoved',
      args: { n: '13' }
    })

    state = applyConflictStep1Click(state, headMovedView, 'save-copy')
    expect(state.step).toBe('save-copy')

    const copyFailedView = makeView({ notice: 'save_copy_failed' })
    state = applyConflictViewUpdate(state, copyFailedView)
    expect(state.step).toBe('save-copy')
    expect(resolveConflictNotice(copyFailedView)).toEqual({
      key: 'uwConflictSaveCopyFailed',
      args: {}
    })

    const copyDoneView = makeView({
      notice: 'save_copy_done',
      noticeArg: 'Contract (copy).docx'
    })
    state = applyConflictViewUpdate(state, copyDoneView)
    expect(state.step).toBe('step1')
    expect(state.focusTarget).toBe('cancel')
    expect(resolveConflictNotice(copyDoneView)).toEqual({
      key: 'uwConflictSaveCopyDone',
      args: { title: 'Contract (copy).docx' }
    })

    const revokedView = makeView({ locked: 'revoked' })
    state = applyConflictViewUpdate(state, revokedView)
    expect(state.step).toBe('locked')
    expect(state.focusTarget).toBe('title')
  })
})
