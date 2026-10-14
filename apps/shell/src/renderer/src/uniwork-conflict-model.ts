import type {
  UniworkConflictAction,
  UniworkConflictNotice,
  UniworkConflictView,
} from '../../shared/uniwork-conflict'

export type ConflictStep1ActionId = 'view-diff' | 'reload' | 'save-copy' | 'overwrite' | 'cancel'

export type ConflictStep2Kind = 'reload' | 'save-copy' | 'overwrite'

export type ConflictStep = 'step1' | 'stop-ai' | ConflictStep2Kind | 'locked'

export type ConflictFocusTarget = ConflictStep1ActionId | 'back' | 'title' | null

export interface ConflictStep1ActionItem {
  id: ConflictStep1ActionId
  labelKey:
    | 'uwConflictViewDiff'
    | 'uwConflictReload'
    | 'uwConflictSaveCopy'
    | 'uwConflictOverwrite'
    | 'uwConflictCancel'
  style: 'primary' | 'danger' | 'ghost'
  disabled: boolean
  reasonKey:
    | 'uwRemoteWaitCommit'
    | 'uwRemoteWaitStuck'
    | 'uwConflictOfflineDesktop'
    | 'uwConflictSaveCopyOffline'
    | null
  showOpenCenter: boolean
}

export interface ConflictStep1Model {
  actions: ConflictStep1ActionItem[]
  defaultFocus: 'cancel'
  noEditKey: 'uwConflictNoEdit' | null
}

export interface ConflictDialogState {
  sessionId: string
  step: ConflictStep
  opener: ConflictStep2Kind | null
  pendingStep: ConflictStep2Kind | null
  stopAi: boolean
  selectedKeep: 'draft' | 'discard' | null
  focusTarget: ConflictFocusTarget
  focusTick: number
}

export interface ConflictReloadStepModel {
  keepDisabled: boolean
  keepReasonKey: 'uwConflictKeepUnavailable' | 'uwConflictDraftCapReached' | null
  keepReasonArgs: Record<string, string>
  showOpenCenter: boolean
  selectedKeep: 'draft' | 'discard' | null
  canSubmit: boolean
  submitReasonKey: 'uwConflictKeepUnavailable' | 'uwConflictDraftCapReached' | null
}

export interface ConflictResolvedNotice {
  key:
    | 'uwConflictHeadMoved'
    | 'uwConflictReloadFailed'
    | 'uwConflictOverwriteFailed'
    | 'uwConflictSaveCopyDone'
    | 'uwConflictSaveCopyFailed'
  args: Record<string, string>
}

export interface ConflictStep1Options {
  canViewDiff?: boolean
}

export function getStep1Model(
  view: UniworkConflictView,
  options?: ConflictStep1Options,
): ConflictStep1Model {
  const intentBusy = view.intent === 'committing' || view.intent === 'reconciling'
  const intentStuck = view.intent === 'reconciling-stuck'

  const resolveIntentBlock = (): {
    disabled: boolean
    reasonKey: 'uwRemoteWaitCommit' | 'uwRemoteWaitStuck' | null
    showOpenCenter: boolean
  } | null => {
    if (intentBusy) {
      return { disabled: true, reasonKey: 'uwRemoteWaitCommit', showOpenCenter: false }
    }
    if (intentStuck) {
      return { disabled: true, reasonKey: 'uwRemoteWaitStuck', showOpenCenter: true }
    }
    return null
  }

  const intentBlock = resolveIntentBlock()
  const actions: ConflictStep1ActionItem[] = []

  if (view.module === 'docs' && options?.canViewDiff) {
    actions.push({
      id: 'view-diff',
      labelKey: 'uwConflictViewDiff',
      style: 'ghost',
      disabled: false,
      reasonKey: null,
      showOpenCenter: false,
    })
  }

  // Reload latest (primary)
  if (intentBlock) {
    actions.push({
      id: 'reload',
      labelKey: 'uwConflictReload',
      style: 'primary',
      ...intentBlock,
    })
  } else if (!view.online && !view.headOffline) {
    actions.push({
      id: 'reload',
      labelKey: 'uwConflictReload',
      style: 'primary',
      disabled: true,
      reasonKey: 'uwConflictOfflineDesktop',
      showOpenCenter: false,
    })
  } else {
    actions.push({
      id: 'reload',
      labelKey: 'uwConflictReload',
      style: 'primary',
      disabled: false,
      reasonKey: null,
      showOpenCenter: false,
    })
  }

  // Save as a copy… (canEdit only)
  if (view.canEdit) {
    if (intentBlock) {
      actions.push({
        id: 'save-copy',
        labelKey: 'uwConflictSaveCopy',
        style: 'ghost',
        ...intentBlock,
      })
    } else if (!view.online) {
      actions.push({
        id: 'save-copy',
        labelKey: 'uwConflictSaveCopy',
        style: 'ghost',
        disabled: true,
        reasonKey: 'uwConflictSaveCopyOffline',
        showOpenCenter: false,
      })
    } else {
      actions.push({
        id: 'save-copy',
        labelKey: 'uwConflictSaveCopy',
        style: 'ghost',
        disabled: false,
        reasonKey: null,
        showOpenCenter: false,
      })
    }
  }

  // Overwrite… (danger, canEdit only; stays enabled when offline on desktop)
  if (view.canEdit) {
    if (intentBlock) {
      actions.push({
        id: 'overwrite',
        labelKey: 'uwConflictOverwrite',
        style: 'danger',
        ...intentBlock,
      })
    } else {
      actions.push({
        id: 'overwrite',
        labelKey: 'uwConflictOverwrite',
        style: 'danger',
        disabled: false,
        reasonKey: null,
        showOpenCenter: false,
      })
    }
  }

  // Cancel (always enabled, default focus)
  actions.push({
    id: 'cancel',
    labelKey: 'uwConflictCancel',
    style: 'ghost',
    disabled: false,
    reasonKey: null,
    showOpenCenter: false,
  })

  return {
    actions,
    defaultFocus: 'cancel',
    noEditKey: view.canEdit ? null : 'uwConflictNoEdit',
  }
}

export function createInitialConflictState(view: UniworkConflictView): ConflictDialogState {
  const isLocked = view.locked !== 'none'
  return {
    sessionId: view.sessionId,
    step: isLocked ? 'locked' : 'step1',
    opener: null,
    pendingStep: null,
    stopAi: false,
    selectedKeep: view.keepDraft === 'ok' ? 'draft' : null,
    focusTarget: isLocked ? 'title' : 'cancel',
    focusTick: 1,
  }
}

export function applyConflictStep1Click(
  state: ConflictDialogState,
  view: UniworkConflictView,
  actionId: ConflictStep2Kind,
): ConflictDialogState {
  const step1 = getStep1Model(view)
  const item = step1.actions.find((a) => a.id === actionId)
  if (!item || item.disabled) {
    return state
  }

  if (view.aiRunning) {
    return {
      ...state,
      step: 'stop-ai',
      opener: actionId,
      pendingStep: actionId,
      focusTarget: 'back',
      focusTick: state.focusTick + 1,
    }
  }

  return {
    ...state,
    step: actionId,
    opener: actionId,
    pendingStep: null,
    stopAi: false,
    selectedKeep:
      actionId === 'reload' ? (view.keepDraft === 'ok' ? 'draft' : null) : state.selectedKeep,
    focusTarget: 'back',
    focusTick: state.focusTick + 1,
  }
}

export function applyConflictStopAiConfirm(
  state: ConflictDialogState,
  view: UniworkConflictView,
): ConflictDialogState {
  if (state.step !== 'stop-ai' || !state.pendingStep) {
    return state
  }
  const targetStep = state.pendingStep
  return {
    ...state,
    step: targetStep,
    pendingStep: null,
    stopAi: true,
    selectedKeep:
      targetStep === 'reload' ? (view.keepDraft === 'ok' ? 'draft' : null) : state.selectedKeep,
    focusTarget: 'back',
    focusTick: state.focusTick + 1,
  }
}

export function applyConflictBack(state: ConflictDialogState): ConflictDialogState {
  if (state.step === 'step1' || state.step === 'locked') {
    return state
  }
  return {
    ...state,
    step: 'step1',
    pendingStep: null,
    stopAi: false,
    focusTarget: state.opener ?? 'cancel',
    focusTick: state.focusTick + 1,
  }
}

export function applyConflictSelectKeep(
  state: ConflictDialogState,
  view: UniworkConflictView,
  choice: 'draft' | 'discard',
): ConflictDialogState {
  if (choice === 'draft' && view.keepDraft !== 'ok') {
    return state
  }
  return {
    ...state,
    selectedKeep: choice,
  }
}

export function getReloadStepModel(
  state: ConflictDialogState,
  view: UniworkConflictView,
): ConflictReloadStepModel {
  const keepOk = view.keepDraft === 'ok'
  let keepReasonKey: ConflictReloadStepModel['keepReasonKey'] = null
  let keepReasonArgs: Record<string, string> = {}
  let showOpenCenter = false

  if (view.keepDraft === 'drafts_full') {
    keepReasonKey = 'uwConflictDraftCapReached'
    keepReasonArgs = { cap: String(view.draftCap) }
    showOpenCenter = true
  } else if (view.keepDraft === 'store_full' || view.keepDraft === 'keystore_locked') {
    keepReasonKey = 'uwConflictKeepUnavailable'
  }

  const selectedKeep = !keepOk && state.selectedKeep === 'draft' ? null : state.selectedKeep
  const canSubmit = selectedKeep === 'discard' || (selectedKeep === 'draft' && keepOk)

  return {
    keepDisabled: !keepOk,
    keepReasonKey,
    keepReasonArgs,
    showOpenCenter,
    selectedKeep,
    canSubmit,
    submitReasonKey: !canSubmit ? keepReasonKey : null,
  }
}

export function canSubmitReload(state: ConflictDialogState, view: UniworkConflictView): boolean {
  return getReloadStepModel(state, view).canSubmit
}

export function buildConfirmPayload(
  state: ConflictDialogState,
  view: UniworkConflictView,
): UniworkConflictAction | null {
  if (state.step === 'reload') {
    const model = getReloadStepModel(state, view)
    if (!model.canSubmit || !model.selectedKeep) {
      return null
    }
    return {
      kind: 'reload',
      keep: model.selectedKeep,
      stopAi: state.stopAi,
    }
  }
  if (state.step === 'overwrite') {
    return {
      kind: 'overwrite',
      stopAi: state.stopAi,
    }
  }
  if (state.step === 'save-copy') {
    return {
      kind: 'save-copy',
      stopAi: state.stopAi,
    }
  }
  return null
}

export function getActionFailureNotice(
  action: UniworkConflictAction,
): UniworkConflictNotice | null {
  switch (action.kind) {
    case 'reload':
      return 'reload_failed'
    case 'overwrite':
      return 'overwrite_failed'
    case 'save-copy':
      return 'save_copy_failed'
    case 'cancel':
      return null
  }
}

export function applyConflictViewUpdate(
  state: ConflictDialogState,
  nextView: UniworkConflictView,
): ConflictDialogState {
  if (nextView.sessionId !== state.sessionId) {
    return createInitialConflictState(nextView)
  }

  if (nextView.locked !== 'none') {
    return {
      ...state,
      step: 'locked',
      pendingStep: null,
      focusTarget: 'title',
      focusTick: state.focusTick + 1,
    }
  }

  if (nextView.notice === 'head_moved' || nextView.notice === 'save_copy_done') {
    return {
      ...state,
      step: 'step1',
      pendingStep: null,
      stopAi: false,
      selectedKeep: nextView.keepDraft === 'ok' ? 'draft' : null,
      focusTarget: 'cancel',
      focusTick: state.focusTick + 1,
    }
  }

  const adjustedSelectedKeep =
    nextView.keepDraft !== 'ok' && state.selectedKeep === 'draft' ? null : state.selectedKeep

  return {
    ...state,
    selectedKeep: adjustedSelectedKeep,
  }
}

export function resolveConflictNotice(view: UniworkConflictView): ConflictResolvedNotice | null {
  switch (view.notice) {
    case 'head_moved':
      return {
        key: 'uwConflictHeadMoved',
        args: {
          n: view.noticeArg ?? (view.server.version !== null ? String(view.server.version) : '—'),
        },
      }
    case 'reload_failed':
      return { key: 'uwConflictReloadFailed', args: {} }
    case 'overwrite_failed':
      return { key: 'uwConflictOverwriteFailed', args: {} }
    case 'save_copy_done':
      return {
        key: 'uwConflictSaveCopyDone',
        args: { title: view.noticeArg ?? view.title },
      }
    case 'save_copy_failed':
      return { key: 'uwConflictSaveCopyFailed', args: {} }
    default:
      return null
  }
}
