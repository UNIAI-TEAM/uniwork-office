/**
 * @vitest-environment jsdom
 *
 * EL-1(b) W2 (UNI-1645c): the desktop shell shows the edit-lock session of an open
 * bound document — the info banner per phase ("{name} đang sửa từ {time}",
 * self-elsewhere, free, acquiring, lost), the read-only marker in the Save pill,
 * the "Sửa ở đây" button calling uniworkEditHere(path), the Ctrl/Cmd+S explanation
 * instead of a silent no-op, 'lost' outranking remote / lockWhileOpen, and the
 * 'unreachable' interim rendering nothing (user decision 2026-10-18).
 *
 * Copy: web documents.editLock.* verbatim for vi/en (S = dev-uniwork feature-UNI-923),
 * 21 shards, glossary only — never "khóa"/"khoá".
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type {
  HomeApi,
  UniworkDocStatus,
  UniworkEditLockLostReason,
  UniworkEditLockSessionView,
  UniworkQueuePopoverRequest,
} from '../src/shared/home-api'
import { LocaleProvider, type StringKey, type TFunc } from '../src/renderer/src/locale'
import { UniworkRemoteBar, UniworkStatusChip } from '../src/renderer/src/UniworkChrome'
import { UniworkLiveHost, resetLiveForTests } from '../src/renderer/src/uniwork-live'
import * as docsModel from '../src/renderer/src/uniwork-docs-model'
import * as popModel from '../src/renderer/src/queue-popover-model'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { syncStrings } from '../src/renderer/src/i18n/strings-sync'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

const PATH = 'C:\\ud\\uniwork-documents\\d1\\Plan.docx'
const NOW = new Date('2026-10-18T15:00:00')

function status(
  lock?: UniworkEditLockSessionView | null,
  partial: Partial<UniworkDocStatus> = {},
): UniworkDocStatus {
  return {
    path: PATH,
    documentId: 'd1',
    workspaceId: 'w1',
    title: 'Plan',
    format: 'docx',
    access: 'edit',
    state: 'ready',
    ...(lock ? { lockSession: lock } : {}),
    ...partial,
  }
}

const lock = (
  phase: UniworkEditLockSessionView['phase'],
  over: Partial<UniworkEditLockSessionView> = {},
): UniworkEditLockSessionView => ({
  phase,
  holderName: 'Ngọc Phạm',
  since: '2026-10-18T14:05:00',
  ...over,
})

const copy = (lang: 'en' | 'vi') =>
  ({ ...syncStrings[lang], ...uniworkDocumentStrings[lang] }) as Record<string, string>
const tFor =
  (lang: 'en' | 'vi'): TFunc =>
  (key: StringKey, params) =>
    (copy(lang)[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) =>
      String(params?.[name] ?? ''),
    )

const {
  lockBannerModelOf,
  lostReasonKeyOf,
  formatEditLockTime,
  isEditLockReadOnlyPhase,
  chipModelOf,
  chipCopy,
  remoteBarModelOf,
  miniGlyphOf,
} = docsModel
const { isQueuePopoverState, queuePopoverModelOf } = popModel

// ── banner model ────────────────────────────────────────

describe('lockBannerModelOf', () => {
  it(`'other': "{name} đang sửa từ {time}" + read-only, no button (b3, board card 1)`, () => {
    const model = lockBannerModelOf(status(lock('other')), tFor('en'), 'en-US', NOW)!
    expect(model).not.toBeNull()
    expect(model.tone).toBe('info')
    expect(model.messageKey).toBe('uwLockBannerOther')
    expect(model.params.name).toBe('Ngọc Phạm')
    expect(model.params.time).toBe(
      new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(
        new Date('2026-10-18T14:05:00'),
      ),
    )
    expect(model.editHere).toBe(false)
    expect(model.busy).toBe(false)
  })

  it(`'other' without holderName reads the web's lostSomeone fallback`, () => {
    const model = lockBannerModelOf(
      status(lock('other', { holderName: null })),
      tFor('vi'),
      'vi-VN',
      NOW,
    )!
    expect(model.params.name).toBe('Người khác')
  })

  it(`'self_elsewhere': bannerSelfElsewhere + "Sửa ở đây" (board card 4)`, () => {
    const model = lockBannerModelOf(status(lock('self_elsewhere')), tFor('vi'), 'vi-VN', NOW)!
    expect(model.messageKey).toBe('uwLockBannerSelfElsewhere')
    expect(model.editHere).toBe(true)
    expect(model.tone).toBe('info')
  })

  it(`'free': bannerFree + "Sửa ở đây" (the poll saw it free; c1)`, () => {
    const model = lockBannerModelOf(status(lock('free')), tFor('vi'), 'vi-VN', NOW)!
    expect(model.messageKey).toBe('uwLockBannerFree')
    expect(model.editHere).toBe(true)
    expect(model.tone).toBe('success')
  })

  it(`'acquiring': the busy state of "Sửa ở đây" (uwLockAcquiring + busy button)`, () => {
    const model = lockBannerModelOf(status(lock('acquiring')), tFor('en'), 'en-US', NOW)!
    expect(model.messageKey).toBe('uwLockAcquiring')
    expect(model.editHere).toBe(true)
    expect(model.busy).toBe(true)
  })

  it(`'lost': lostTitle + the reason sentence + "Sửa ở đây" (b4)`, () => {
    const model = lockBannerModelOf(
      status(lock('lost', { lostReason: 'taken_over', byName: 'Tạ Văn Quang' })),
      tFor('en'),
      'en-US',
      NOW,
    )!
    expect(model.tone).toBe('warn')
    expect(model.titleKey).toBe('uwLockLostTitle')
    expect(model.messageKey).toBe('uwLockLostTakenOver')
    expect(model.params.name).toBe('Tạ Văn Quang')
    expect(model.editHere).toBe(true)
  })

  it(`'lost' with byName and unnamed reason (unknown/released/none): strip message names the holder via uwLockLostHeldBy (EL1B-W3-2)`, () => {
    for (const lostReason of ['unknown', 'released', undefined] as const) {
      const model = lockBannerModelOf(
        status(lock('lost', { lostReason, byName: 'Grace Hopper' })),
        tFor('en'),
        'en-US',
        NOW,
      )!
      expect(model.tone).toBe('warn')
      expect(model.titleKey).toBe('uwLockLostTitle')
      expect(model.messageKey).toBe('uwLockLostHeldBy')
      expect(model.params).toEqual({ name: 'Grace Hopper' })
      expect(model.editHere).toBe(true)
    }
    // no byName -> unchanged generic copy
    const generic = lockBannerModelOf(
      status(lock('lost', { lostReason: 'unknown', byName: null })),
      tFor('en'),
      'en-US',
      NOW,
    )!
    expect(generic.titleKey).toBe('uwLockLostTitle')
    expect(generic.messageKey).toBe('uwLockLostGeneric')
    expect(generic.params).toEqual({})
  })

  it.each([
    ['session_revoked'],
    ['member_deactivated'],
    ['organization_suspended'],
    ['document_deleted'],
  ] as const)(
    `'lost' with terminal reason '%s' reads the access-lost sentence and drops "Sửa ở đây" (Amendment A1)`,
    (lostReason) => {
      const model = lockBannerModelOf(
        status(lock('lost', { lostReason, byName: 'Grace Hopper' })),
        tFor('en'),
        'en-US',
        NOW,
      )!
      expect(model.tone).toBe('warn')
      expect(model.titleKey).toBe('uwLockLostTitle')
      expect(model.messageKey).toBe('uwLockLostAccessLost')
      expect(model.params).toEqual({})
      expect(model.editHere).toBe(false)
    },
  )

  it.each([['held'], ['unreachable']] as const)(
    `'unreachable' / '%s' / no session renders nothing (interim until EL-2)`,
    (phase) => {
      expect(lockBannerModelOf(status(lock(phase)), tFor('en'), 'en-US', NOW)).toBeNull()
    },
  )

  it('no lockSession at all renders nothing', () => {
    expect(lockBannerModelOf(status(), tFor('en'), 'en-US', NOW)).toBeNull()
    expect(lockBannerModelOf(status(null), tFor('en'), 'en-US', NOW)).toBeNull()
  })
})

describe('lostReasonKeyOf (web lostCopyKey mapping)', () => {
  const rows: Array<[UniworkEditLockLostReason | undefined, StringKey]> = [
    ['taken_over', 'uwLockLostTakenOver'],
    ['handed_over', 'uwLockLostHandedOver'],
    ['moved_here', 'uwLockLostMovedHere'],
    ['expired', 'uwLockLostExpired'],
    ['access_lost', 'uwLockLostAccessLost'],
    ['released', 'uwLockLostGeneric'],
    ['document_archived', 'uwLockLostGeneric'],
    ['unknown', 'uwLockLostGeneric'],
    // Amendment A1 (B9): the four terminal server end reasons read access-lost
    ['session_revoked', 'uwLockLostAccessLost'],
    ['member_deactivated', 'uwLockLostAccessLost'],
    ['organization_suspended', 'uwLockLostAccessLost'],
    ['document_deleted', 'uwLockLostAccessLost'],
    [undefined, 'uwLockLostGeneric'],
  ]
  it.each(rows)('%s -> %s', (reason, key) => {
    expect(lostReasonKeyOf(reason)).toBe(key)
  })
})

describe('formatEditLockTime (web formatLockTime)', () => {
  it('today reads the time alone, an older day the date and time, garbage empty', () => {
    const today = formatEditLockTime('2026-10-18T14:05:00', 'en-US', NOW)
    expect(today).toBe(
      new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(
        new Date('2026-10-18T14:05:00'),
      ),
    )
    const older = formatEditLockTime('2026-10-01T14:05:00', 'en-US', NOW)
    expect(older).toBe(
      new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date('2026-10-01T14:05:00'),
      ),
    )
    expect(formatEditLockTime('not-a-date', 'en-US', NOW)).toBe('')
    expect(formatEditLockTime(null, 'en-US', NOW)).toBe('')
  })
})

// ── Save pill (chip) ────────────────────────────────────

describe('chipModelOf: edit-lock session', () => {
  const chip = (s: UniworkDocStatus) => chipModelOf(s, { needsSignIn: false })

  it(`'lost': the pill names the lost state and offers "Sửa ở đây"`, () => {
    const model = chip(status(lock('lost', { lostReason: 'taken_over', byName: 'Ngọc Phạm' })))
    expect(model.labelKey).toBe('uwLockLostTitle')
    expect(model.tipKey).toBe('uwLockLostTakenOver')
    expect(model.holderName).toBe('Ngọc Phạm')
    expect(model.tone).toBe('warn')
    expect(model.action).toEqual({ kind: 'edit-here', labelKey: 'uwLockEditHere' })
  })

  it(`'lost' with byName and unnamed reason (unknown/released/none): pill label is uwChipEditLocked with holderName, tip is uwLockLostHeldBy, button stays uwLockEditHere (EL1B-W3-2)`, () => {
    for (const lostReason of ['unknown', 'released', undefined] as const) {
      const model = chip(status(lock('lost', { lostReason, byName: 'Grace Hopper' })))
      expect(model.tone).toBe('warn')
      expect(model.labelKey).toBe('uwChipEditLocked')
      expect(model.holderName).toBe('Grace Hopper')
      expect(model.tipKey).toBe('uwLockLostHeldBy')
      expect(model.action).toEqual({ kind: 'edit-here', labelKey: 'uwLockEditHere' })
      const copyEn = chipCopy(model, tFor('en'), 'en-US', NOW)
      expect(copyEn.label).toBe('Grace Hopper is editing')
      expect(copyEn.tip).toBe('Grace Hopper is editing now. Your unsaved changes are still here.')
      const copyVi = chipCopy(model, tFor('vi'), 'vi-VN', NOW)
      expect(copyVi.label).toBe('Grace Hopper đang sửa')
      expect(copyVi.tip).toBe('Grace Hopper đang sửa. Thay đổi chưa lưu của bạn vẫn ở đây.')
    }
    // no byName -> generic
    const noName = chip(status(lock('lost', { lostReason: 'unknown', byName: null })))
    expect(noName.labelKey).toBe('uwLockLostTitle')
    expect(noName.tipKey).toBe('uwLockLostGeneric')
  })

  it(`'lost' outranks remote / lockWhileOpen (and the conflict state)`, () => {
    const model = chip(
      status(lock('lost', { lostReason: 'expired' }), {
        state: 'conflict',
        remote: { kind: 'newer-dirty', version: 4 },
        lockWhileOpen: { mode: 'store', reason: 'lease_expired' },
      }),
    )
    expect(model.labelKey).toBe('uwLockLostTitle')
    expect(model.tipKey).toBe('uwLockLostExpired')
  })

  it(`'lost' without byName falls back to the web's lostSomeone`, () => {
    const model = chip(status(lock('lost', { lostReason: 'taken_over', byName: null })))
    expect(model.holderName ?? 'uwEditLockSomeone').toBeTruthy()
    const copyEn = chipCopy(model, tFor('en'), 'en-US', NOW)
    expect(copyEn.tip).toBe('Someone took over editing. Your unsaved changes are still here.')
    const copyVi = chipCopy(model, tFor('vi'), 'vi-VN', NOW)
    expect(copyVi.tip).toBe('Người khác đã lấy quyền sửa. Thay đổi chưa lưu của bạn vẫn ở đây.')
    expect(copyVi.label).toBe('Bạn không còn quyền sửa')
  })

  it.each([
    ['session_revoked'],
    ['member_deactivated'],
    ['organization_suspended'],
    ['document_deleted'],
  ] as const)(
    `'lost' with terminal reason '%s': the tip reads access-lost and the pill has no action (Amendment A1)`,
    (lostReason) => {
      const model = chip(status(lock('lost', { lostReason, byName: 'Grace Hopper' })))
      expect(model.tone).toBe('warn')
      expect(model.labelKey).toBe('uwLockLostTitle')
      expect(model.tipKey).toBe('uwLockLostAccessLost')
      expect(model.action).toBeUndefined()
      const copyVi = chipCopy(model, tFor('vi'), 'vi-VN', NOW)
      expect(copyVi.tip).toBe(
        'Bạn không còn quyền sửa tài liệu này. Thay đổi chưa lưu của bạn vẫn ở đây.',
      )
    },
  )

  it.each([['access_lost'], ['taken_over']] as const)(
    `'lost' with non-terminal reason '%s' still offers "Sửa ở đây" (unchanged, Amendment A1)`,
    (lostReason) => {
      const model = chip(status(lock('lost', { lostReason, byName: 'Ngọc Phạm' })))
      expect(model.action).toEqual({ kind: 'edit-here', labelKey: 'uwLockEditHere' })
    },
  )

  it(`'other': visibly read-only, the tip names who edits`, () => {
    const model = chip(status(lock('other')))
    expect(model.labelKey).toBe('uwChipViewOnly')
    expect(model.tipKey).toBe('uwLockBannerOther')
    expect(model.holderName).toBe('Ngọc Phạm')
    expect(model.savedAt).toBe('2026-10-18T14:05:00')
    expect(model.action).toBeUndefined()
    const copyVi = chipCopy(model, tFor('vi'), 'vi-VN', NOW)
    expect(copyVi.label).toBe('Chỉ xem')
    expect(copyVi.tip).toContain('Ngọc Phạm đang sửa từ')
    expect(miniGlyphOf(model, 'ready')).toBe('lock')
  })

  it(`'self_elsewhere' / 'free': read-only marker, the banner explains`, () => {
    const self = chip(status(lock('self_elsewhere')))
    expect(self.labelKey).toBe('uwChipViewOnly')
    expect(self.tipKey).toBe('uwLockBannerSelfElsewhere')
    expect(miniGlyphOf(self, 'ready')).toBe('lock')
    const free = chip(status(lock('free')))
    expect(free.labelKey).toBe('uwChipViewOnly')
    expect(free.tipKey).toBe('uwLockBannerFree')
  })

  it(`'acquiring': a quiet busy pill (uwLockAcquiring)`, () => {
    const model = chip(status(lock('acquiring')))
    expect(model.tone).toBe('busy')
    expect(model.labelKey).toBe('uwLockAcquiring')
    expect(miniGlyphOf(model, 'ready')).toBe('busy')
  })

  it(`'held' changes nothing; 'unreachable' behaves as no session (interim)`, () => {
    const held = chip(status(lock('held'), { state: 'saved', lastSavedAt: '2026-10-18T14:00:00' }))
    expect(held.labelKey).toBe('uwChipSaved')
    const gone = chip(status(lock('unreachable'), { state: 'offline' }))
    expect(gone.labelKey).toBe('uwChipOffline')
    expect(gone.tipKey).toBe('uwTipOffline')
  })
})

// ── the S6 band model: 'lost' suppresses the remote bar ──

describe('remoteBarModelOf: a lost lock session outranks the remote/lock bars', () => {
  const lost = lock('lost', { lostReason: 'taken_over', byName: 'Ngọc Phạm' })
  it('lost + a newer-version notice -> no remote bar model', () => {
    expect(
      remoteBarModelOf(status(lost, { remote: { kind: 'newer-dirty', version: 4 } })),
    ).toBeNull()
  })
  it('lost + lockWhileOpen -> no remote bar model', () => {
    expect(
      remoteBarModelOf(status(lost, { lockWhileOpen: { mode: 'store', reason: 'lease_expired' } })),
    ).toBeNull()
  })
  it('non-lost lock phases leave the remote bar model alone', () => {
    const model = remoteBarModelOf(
      status(lock('other'), { remote: { kind: 'newer-dirty', version: 4 } }),
    )
    expect(model?.messageKey).toBe('uwRemoteNewerDirty')
  })
})

// ── Ctrl/Cmd+S on a read-only-by-lock tab explains ──────

describe('queue popover: the lock read-only explanation', () => {
  it.each([['other'], ['self_elsewhere'], ['free'], ['lost']] as const)(
    "'%s' is a popover state; 'held' / 'acquiring' / 'unreachable' are not",
    (phase) => {
      expect(isEditLockReadOnlyPhase(phase)).toBe(true)
      expect(isQueuePopoverState(status(lock(phase)))).toBe(true)
    },
  )
  it(`'held' / 'acquiring' / 'unreachable' are not popover states`, () => {
    for (const phase of ['held', 'acquiring', 'unreachable'] as const) {
      expect(isEditLockReadOnlyPhase(phase)).toBe(false)
      expect(isQueuePopoverState(status(lock(phase)))).toBe(false)
    }
  })

  it(`'other': line 1 explains, line 2 names the holder, no edit-here`, () => {
    const model = queuePopoverModelOf(status(lock('other')), undefined, 'ctrl-s')
    expect(model.line1.key).toBe('uwLockReadOnlyExplain')
    expect(model.line2?.key).toBe('uwLockBannerOther')
    expect(model.line2?.name).toBe('Ngọc Phạm')
    expect(model.line2?.time).toBe('2026-10-18T14:05:00')
    expect(model.actions.some((a) => a.id === 'edit-here')).toBe(false)
  })

  it(`'self_elsewhere' / 'free' / 'lost' offer "Sửa ở đây"`, () => {
    for (const [phase, line2] of [
      ['self_elsewhere', 'uwLockBannerSelfElsewhere'],
      ['free', 'uwLockBannerFree'],
    ] as const) {
      const model = queuePopoverModelOf(status(lock(phase)), undefined, 'ctrl-s')
      expect(model.line1.key).toBe('uwLockReadOnlyExplain')
      expect(model.line2?.key).toBe(line2)
      expect(model.actions).toContainEqual({ id: 'edit-here', labelKey: 'uwLockEditHere' })
    }
    const lostModel = queuePopoverModelOf(
      status(lock('lost', { lostReason: 'taken_over', byName: 'Ngọc Phạm' })),
      undefined,
      'ctrl-s',
    )
    expect(lostModel.line1.key).toBe('uwLockReadOnlyExplain')
    expect(lostModel.line2?.key).toBe('uwLockLostTakenOver')
    expect(lostModel.line2?.name).toBe('Ngọc Phạm')
    expect(lostModel.actions).toContainEqual({ id: 'edit-here', labelKey: 'uwLockEditHere' })
  })

  it(`'lost' with byName and unnamed reason (unknown/released/none): line 2 is uwLockLostHeldBy with holder name via lostHolderNameOf (EL1B-FE-1)`, () => {
    const { lostHolderNameOf } = docsModel as typeof docsModel & {
      lostHolderNameOf?: (s: UniworkEditLockSessionView | undefined) => string | null
    }
    expect(typeof lostHolderNameOf).toBe('function')
    for (const lostReason of ['unknown', 'released', undefined] as const) {
      const sess = lock('lost', { lostReason, byName: 'Grace Hopper' })
      expect(lostHolderNameOf?.(sess)).toBe('Grace Hopper')
      const model = queuePopoverModelOf(status(sess), undefined, 'ctrl-s')
      expect(model.line1.key).toBe('uwLockReadOnlyExplain')
      expect(model.line2?.key).toBe('uwLockLostHeldBy')
      expect(model.line2?.name).toBe('Grace Hopper')
      expect(model.actions).toContainEqual({ id: 'edit-here', labelKey: 'uwLockEditHere' })
    }
    expect(
      lostHolderNameOf?.(lock('lost', { lostReason: 'taken_over', byName: 'Grace Hopper' })),
    ).toBeNull()
    expect(lostHolderNameOf?.(lock('lost', { lostReason: 'unknown', byName: '  ' }))).toBeNull()
    // Amendment A1: the four named terminal reasons never take the heldBy path
    for (const lostReason of [
      'session_revoked',
      'member_deactivated',
      'organization_suspended',
      'document_deleted',
    ] as const) {
      expect(lostHolderNameOf?.(lock('lost', { lostReason, byName: 'Grace Hopper' }))).toBeNull()
    }
    const generic = queuePopoverModelOf(
      status(lock('lost', { lostReason: 'unknown', byName: null })),
      undefined,
      'ctrl-s',
    )
    expect(generic.line2?.key).toBe('uwLockLostGeneric')
  })

  it.each([
    ['session_revoked'],
    ['member_deactivated'],
    ['organization_suspended'],
    ['document_deleted'],
  ] as const)(
    `'lost' with terminal reason '%s': line 2 reads access-lost and no edit-here action is offered (Amendment A1)`,
    (lostReason) => {
      const model = queuePopoverModelOf(
        status(lock('lost', { lostReason, byName: 'Grace Hopper' })),
        undefined,
        'ctrl-s',
      )
      expect(model.line1.key).toBe('uwLockReadOnlyExplain')
      expect(model.line2?.key).toBe('uwLockLostAccessLost')
      expect(model.line2?.name).toBeUndefined()
      expect(model.actions.some((a) => a.id === 'edit-here')).toBe(false)
    },
  )

  it.each([['access_lost'], ['taken_over']] as const)(
    `'lost' with non-terminal reason '%s' still offers edit-here (unchanged, Amendment A1)`,
    (lostReason) => {
      const model = queuePopoverModelOf(
        status(lock('lost', { lostReason, byName: 'Ngọc Phạm' })),
        undefined,
        'ctrl-s',
      )
      expect(model.actions).toContainEqual({ id: 'edit-here', labelKey: 'uwLockEditHere' })
    },
  )
})

// ── DOM: the banner strip ───────────────────────────────

let host: HTMLDivElement
let root: Root
let editHere: Mock<HomeApi['uniworkEditHere']>
let remoteAction: Mock<HomeApi['uniworkRemoteAction']>
let onStatus: Mock<(status: UniworkDocStatus) => void>
let ctrlSRequest: ((request: UniworkQueuePopoverRequest) => void) | null

async function mountBar(s: UniworkDocStatus | null, lang: 'en' | 'vi' = 'en'): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { key: lang, initial: lang },
        createElement(UniworkRemoteBar, { status: s, onStatus }),
      ),
    )
  })
}

async function mountChip(s: UniworkDocStatus, lang: 'en' | 'vi' = 'en'): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: lang },
        createElement(UniworkLiveHost),
        createElement(UniworkStatusChip, { key: s.path, status: s, onStatus }),
      ),
    )
  })
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

const strip = () => host.querySelector<HTMLElement>('.uw-editlock-strip')
const stripText = () =>
  host.querySelector<HTMLElement>('.uw-editlock-strip .uw-editlock-text')?.textContent ?? ''
const editHereButton = () => host.querySelector<HTMLButtonElement>('[data-lock-action="edit-here"]')
const lockStatusNode = () => host.querySelector<HTMLElement>('[data-lock-status]')

beforeEach(() => {
  // the components format `since` against the real clock: pin only Date so the
  // suite does not depend on the day it runs (timers stay real)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  resetLiveForTests()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  editHere = vi.fn<HomeApi['uniworkEditHere']>(async () => null)
  remoteAction = vi.fn<HomeApi['uniworkRemoteAction']>(async () => null)
  onStatus = vi.fn<(status: UniworkDocStatus) => void>()
  ctrlSRequest = null
  window.aiOffice = {
    uniworkEditHere: editHere,
    uniworkRemoteAction: remoteAction,
    uniworkSetBarInset: vi.fn(async () => undefined),
    onUniworkQueuePopover: vi.fn((cb: (request: UniworkQueuePopoverRequest) => void) => {
      ctrlSRequest = cb
      return () => undefined
    }),
  } as unknown as HomeApi
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('UniworkRemoteBar: edit-lock strip', () => {
  it(`'other' (vi): the banner names the holder and the read-only mode, no button`, async () => {
    await mountBar(status(lock('other')), 'vi')
    const el = strip()
    expect(el).not.toBeNull()
    expect(el!.dataset.tone).toBe('info')
    expect(stripText()).toBe('Ngọc Phạm đang sửa từ 14:05. Bạn đang xem ở chế độ chỉ đọc.')
    expect(el!.querySelectorAll('button')).toHaveLength(0)
    // a11y: the polite status node carries the same sentence
    expect(lockStatusNode()!.getAttribute('role')).toBe('status')
    expect(lockStatusNode()!.textContent).toContain('Ngọc Phạm đang sửa từ')
  })

  it(`'self_elsewhere' (en): bannerSelfElsewhere + "Edit here" calling uniworkEditHere(path) once`, async () => {
    const next = status(lock('held'))
    editHere.mockResolvedValueOnce(next)
    await mountBar(status(lock('self_elsewhere')))
    expect(stripText()).toBe('You’re editing this document in another window.')
    const button = editHereButton()!
    expect(button).not.toBeNull()
    expect(button.textContent).toBe('Edit here')
    await act(async () => {
      button.click()
    })
    expect(editHere).toHaveBeenCalledTimes(1)
    expect(editHere).toHaveBeenCalledWith(PATH)
    expect(onStatus).toHaveBeenCalledWith(next)
  })

  it(`'free': bannerFree + "Sửa ở đây"`, async () => {
    await mountBar(status(lock('free')), 'vi')
    expect(stripText()).toBe('Không còn ai sửa tài liệu này.')
    expect(editHereButton()!.textContent).toBe('Sửa ở đây')
    await act(async () => {
      editHereButton()!.click()
    })
    expect(editHere).toHaveBeenCalledTimes(1)
    expect(editHere).toHaveBeenCalledWith(PATH)
  })

  it(`'acquiring' right after a visible lock keeps the strip with a busy button`, async () => {
    await mountBar(status(lock('self_elsewhere')))
    await mountBar(status(lock('acquiring')))
    const el = strip()!
    expect(el).not.toBeNull()
    const button = editHereButton()!
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    await act(async () => {
      button.click()
    })
    expect(editHere).not.toHaveBeenCalled()
  })

  it(`'acquiring' on first open is a quiet strip, never a remote-bar jump`, async () => {
    await mountBar(status(lock('acquiring')))
    expect(strip()).not.toBeNull()
    expect(stripText()).toBe('Getting editing access…')
    expect(editHereButton()!.getAttribute('aria-busy')).toBe('true')
  })

  it(`'lost' (vi): "Bạn không còn quyền sửa" + who took it + "Sửa ở đây"; the remote bar is gone`, async () => {
    await mountBar(
      status(lock('lost', { lostReason: 'taken_over', byName: 'Ngọc Phạm' }), {
        remote: { kind: 'newer-dirty', version: 4 },
      }),
      'vi',
    )
    const el = strip()!
    expect(el.dataset.tone).toBe('warn')
    expect(stripText()).toContain('Bạn không còn quyền sửa')
    expect(stripText()).toContain(
      'Ngọc Phạm đã lấy quyền sửa. Thay đổi chưa lưu của bạn vẫn ở đây.',
    )
    expect(editHereButton()!.textContent).toBe('Sửa ở đây')
    // the remote-newer bar never stacks over a lost lock
    expect(host.querySelector('.uw-remote-bar')).toBeNull()
    // the alert lane says the lost sentence once
    await act(async () => {
      editHereButton()!.click()
    })
    expect(editHere).toHaveBeenCalledWith(PATH)
  })

  it(`'lost' with a terminal reason (vi): the access-lost sentence and no "Sửa ở đây" button (Amendment A1)`, async () => {
    await mountBar(status(lock('lost', { lostReason: 'document_deleted', byName: null })), 'vi')
    const el = strip()!
    expect(el.dataset.tone).toBe('warn')
    expect(stripText()).toContain('Bạn không còn quyền sửa')
    expect(stripText()).toContain(
      'Bạn không còn quyền sửa tài liệu này. Thay đổi chưa lưu của bạn vẫn ở đây.',
    )
    expect(editHereButton()).toBeNull()
    expect(el.querySelectorAll('button')).toHaveLength(0)
  })

  it.each([['held'], ['unreachable']] as const)(
    `'%s' renders nothing (unreachable = the no-session interim)`,
    async (phase) => {
      await mountBar(status(lock(phase)))
      expect(strip()).toBeNull()
      expect(lockStatusNode()?.textContent ?? '').toBe('')
    },
  )

  it('no lockSession renders nothing new (a plain bound document)', async () => {
    await mountBar(status())
    expect(strip()).toBeNull()
    expect(lockStatusNode()?.textContent ?? '').toBe('')
  })

  it('the strip leaves and its announcement clears when the session is gone', async () => {
    await mountBar(status(lock('other')))
    expect(strip()).not.toBeNull()
    await mountBar(status(null))
    expect(strip()).toBeNull()
    expect(lockStatusNode()?.textContent ?? '').toBe('')
  })

  it('a lock strip stacks with (never replaces) a remote notice for non-lost phases', async () => {
    await mountBar(status(lock('other'), { remote: { kind: 'newer-dirty', version: 4 } }))
    expect(strip()).not.toBeNull()
    expect(host.querySelector('.uw-remote-bar')).not.toBeNull()
  })

  it('the strip button points aria-describedby at the unique strip message id (EL1B-FE-4)', async () => {
    await mountBar(status(lock('self_elsewhere')))
    const button = editHereButton()!
    const msg = host.querySelector<HTMLElement>('.uw-editlock-strip .uw-editlock-message')!
    const descId = button.getAttribute('aria-describedby')
    expect(descId).toBeTruthy()
    expect(msg.id).toBe(descId)
    // unique even when the remote bar is rendered above it
    await mountBar(status(lock('self_elsewhere'), { remote: { kind: 'newer-dirty', version: 4 } }))
    const remoteMsg = host.querySelector<HTMLElement>('.uw-remote-message')!
    const lockMsg = host.querySelector<HTMLElement>('.uw-editlock-strip .uw-editlock-message')!
    expect(lockMsg.id).toBeTruthy()
    expect(lockMsg.id).not.toBe(remoteMsg.id)
    expect(editHereButton()!.getAttribute('aria-describedby')).toBe(lockMsg.id)
  })

  it('the strip button shows the spinner from the click until uniworkEditHere settles (EL1B-FE-5)', async () => {
    let resolveAcquire!: (next: UniworkDocStatus | null) => void
    editHere.mockImplementationOnce(
      () =>
        new Promise<UniworkDocStatus | null>((resolve) => {
          resolveAcquire = resolve
        }),
    )
    await mountBar(status(lock('self_elsewhere')))
    const button = editHereButton()!
    expect(button.querySelector('.uw-spinner')).toBeNull()
    await act(async () => {
      button.click()
    })
    // before main pushes 'acquiring': local busy already renders the spinner
    expect(editHereButton()!.getAttribute('aria-busy')).toBe('true')
    expect(editHereButton()!.querySelector('.uw-spinner')).not.toBeNull()
    await act(async () => {
      resolveAcquire(status(lock('held')))
    })
  })

  it('when uniworkEditHere rejects or resolves null on the strip, shows uwLockAcquireFailed politely unless status is already other (EL1B-FE-3)', async () => {
    editHere.mockRejectedValueOnce(new Error('network'))
    await mountBar(status(lock('self_elsewhere')))
    await act(async () => {
      editHereButton()!.click()
    })
    expect(stripText()).toContain('Couldn’t get editing access. Try again in a few minutes.')
    expect(lockStatusNode()!.getAttribute('aria-live')).toBe('polite')
    expect(lockStatusNode()!.textContent).toBe(
      'Couldn’t get editing access. Try again in a few minutes.',
    )

    // null return while still in free (not 'other') -> also shows acquireFailed
    editHere.mockResolvedValueOnce(null)
    await mountBar(status(lock('free')), 'vi')
    await act(async () => {
      editHereButton()!.click()
    })
    expect(stripText()).toContain('Chưa lấy được quyền sửa. Thử lại sau ít phút.')
    expect(lockStatusNode()!.textContent).toBe('Chưa lấy được quyền sửa. Thử lại sau ít phút.')

    // null return when a fresh status already moved the strip to 'other' -> not a failure
    let finishNull!: (next: UniworkDocStatus | null) => void
    editHere.mockImplementationOnce(
      () =>
        new Promise<UniworkDocStatus | null>((resolve) => {
          finishNull = resolve
        }),
    )
    await mountBar(status(lock('free')))
    await act(async () => {
      editHereButton()!.click()
    })
    await mountBar(status(lock('other', { holderName: 'Ada Lovelace' })))
    await act(async () => {
      finishNull(null)
    })
    expect(stripText()).not.toContain('Couldn’t get editing access')
    expect(stripText()).toContain('Ada Lovelace has been editing')
  })
})

describe('UniworkStatusChip: edit-lock session', () => {
  it(`'lost' label reads "You're no longer editing" and offers Edit here`, async () => {
    await mountChip(status(lock('lost', { lostReason: 'expired' })))
    const label = host.querySelector('.uw-pill-label')!
    expect(label.textContent).toContain('You’re no longer editing')
    const action = host.querySelector<HTMLButtonElement>('.uw-pill-action')!
    expect(action.textContent).toBe('Edit here')
    const next = status(lock('held'))
    editHere.mockResolvedValueOnce(next)
    await act(async () => {
      action.click()
    })
    expect(editHere).toHaveBeenCalledWith(PATH)
    expect(onStatus).toHaveBeenCalledWith(next)
  })

  it(`'other': the pill reads View only`, async () => {
    await mountChip(status(lock('other')))
    expect(host.querySelector('.uw-pill-label')!.textContent).toContain('View only')
    expect(host.querySelector('.uw-pill')!.getAttribute('data-state')).toBe('ready')
  })

  it(`Ctrl/Cmd+S on a read-only-by-lock tab explains instead of a silent no-op`, async () => {
    await mountChip(status(lock('self_elsewhere')))
    await act(async () => {
      ctrlSRequest!({ path: PATH })
    })
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    const pop = host.querySelector<HTMLElement>('.uw-queue-pop')!
    expect(pop).not.toBeNull()
    expect(pop.textContent).toContain('Nothing was saved')
    expect(pop.textContent).toContain('editing this document in another window')
    const go = pop.querySelector<HTMLButtonElement>('[data-popover-action="edit-here"]')!
    const next = status(lock('held'))
    editHere.mockResolvedValueOnce(next)
    await act(async () => {
      go.click()
    })
    expect(editHere).toHaveBeenCalledTimes(1)
    expect(editHere).toHaveBeenCalledWith(PATH)
    expect(host.querySelector('.uw-queue-pop')).toBeNull()
  })

  it(`Ctrl/Cmd+S on 'other' explains and offers no edit-here`, async () => {
    await mountChip(status(lock('other')))
    await act(async () => {
      ctrlSRequest!({ path: PATH })
    })
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    const pop = host.querySelector<HTMLElement>('.uw-queue-pop')!
    expect(pop.textContent).toContain('Nothing was saved')
    expect(pop.textContent).toContain('has been editing since')
    expect(pop.querySelector('[data-popover-action="edit-here"]')).toBeNull()
  })

  it(`Ctrl/Cmd+S on 'lost' explains with the lost sentence`, async () => {
    await mountChip(status(lock('lost', { lostReason: 'taken_over', byName: 'Ngọc Phạm' })))
    await act(async () => {
      ctrlSRequest!({ path: PATH })
    })
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    const pop = host.querySelector<HTMLElement>('.uw-queue-pop')!
    expect(pop.textContent).toContain('Nothing was saved')
    expect(pop.textContent).toContain('Ngọc Phạm took over editing')
    expect(pop.querySelector('[data-popover-action="edit-here"]')).not.toBeNull()
  })

  it(`Ctrl/Cmd+S on 'lost' with byName and unnamed reason shows uwLockLostHeldBy with holder name (EL1B-FE-1)`, async () => {
    await mountChip(status(lock('lost', { lostReason: 'unknown', byName: 'Grace Hopper' })))
    await act(async () => {
      ctrlSRequest!({ path: PATH })
    })
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    const pop = host.querySelector<HTMLElement>('.uw-queue-pop')!
    expect(pop.textContent).toContain('Nothing was saved')
    expect(pop.textContent).toContain(
      'Grace Hopper is editing now. Your unsaved changes are still here.',
    )
  })

  it(`'lost' with a terminal reason: the pill has no action and Ctrl/Cmd+S popover offers no edit-here (Amendment A1)`, async () => {
    await mountChip(status(lock('lost', { lostReason: 'session_revoked' })))
    expect(host.querySelector('.uw-pill-action')).toBeNull()
    await act(async () => {
      ctrlSRequest!({ path: PATH })
    })
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    const pop = host.querySelector<HTMLElement>('.uw-queue-pop')!
    expect(pop.textContent).toContain('Nothing was saved')
    expect(pop.textContent).toContain(
      'You no longer have permission to edit this document. Your unsaved changes are still here.',
    )
    expect(pop.querySelector('[data-popover-action="edit-here"]')).toBeNull()
  })

  it(`a transition into 'lost' is announced in the role=alert (assertive) lane for both generic and heldBy variants (EL1B-FE-2)`, async () => {
    await mountChip(status(lock('held'), { state: 'saved' }))
    expect(document.querySelector<HTMLElement>('#uw-live-host [role="alert"]')!.textContent).toBe(
      '',
    )
    // heldBy variant (labelKey = uwChipEditLocked, not uwLockLostTitle)
    await mountChip(status(lock('lost', { lostReason: 'unknown', byName: 'Grace Hopper' })))
    expect(
      document.querySelector<HTMLElement>('#uw-live-host [role="alert"]')!.textContent,
    ).toContain('Grace Hopper is editing')

    // generic / named-reason variant (labelKey = uwLockLostTitle)
    resetLiveForTests()
    await mountChip(status(lock('held'), { state: 'saved' }))
    await mountChip(status(lock('lost', { lostReason: 'expired', byName: null })))
    expect(
      document.querySelector<HTMLElement>('#uw-live-host [role="alert"]')!.textContent,
    ).toContain('You’re no longer editing')
  })

  it(`when uniworkEditHere rejects or resolves null in the popover, keeps the popover open and shows uwLockAcquireFailed politely unless status is other (EL1B-FE-3)`, async () => {
    await mountChip(status(lock('self_elsewhere')))
    await act(async () => {
      ctrlSRequest!({ path: PATH })
    })
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    editHere.mockRejectedValueOnce(new Error('offline'))
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-popover-action="edit-here"]')!.click()
    })
    const popAfterReject = host.querySelector<HTMLElement>('.uw-queue-pop')
    expect(popAfterReject).not.toBeNull()
    expect(popAfterReject!.querySelector('.uw-queue-pop-error')?.textContent).toBe(
      'Couldn’t get editing access. Try again in a few minutes.',
    )
    expect(document.querySelector<HTMLElement>('#uw-live-host [role="status"]')!.textContent).toBe(
      'Couldn’t get editing access. Try again in a few minutes.',
    )
    expect(document.querySelector<HTMLElement>('#uw-live-host [role="alert"]')!.textContent).toBe(
      '',
    )

    // null return while still self_elsewhere -> also shows acquireFailed
    editHere.mockResolvedValueOnce(null)
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-popover-action="edit-here"]')!.click()
    })
    expect(host.querySelector('.uw-queue-pop-error')?.textContent).toBe(
      'Couldn’t get editing access. Try again in a few minutes.',
    )

    // null return when a fresh status already moved the session to 'other' -> not a failure
    let finishNull!: (next: UniworkDocStatus | null) => void
    editHere.mockImplementationOnce(
      () =>
        new Promise<UniworkDocStatus | null>((resolve) => {
          finishNull = resolve
        }),
    )
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-popover-action="edit-here"]')!.click()
    })
    await mountChip(status(lock('other', { holderName: 'Ada Lovelace' })))
    await act(async () => {
      finishNull(null)
    })
    expect(host.querySelector('.uw-queue-pop-error')).toBeNull()
  })
})

// ── copy: the 21 shards ─────────────────────────────────

const NEW_KEYS = [
  'uwLockBannerOther',
  'uwLockBannerSelfElsewhere',
  'uwLockBannerFree',
  'uwLockEditHere',
  'uwLockAcquiring',
  'uwLockReadOnlyExplain',
  'uwLockLostTitle',
  'uwLockLostTakenOver',
  'uwLockLostExpired',
  'uwLockLostHandedOver',
  'uwLockLostMovedHere',
  'uwLockLostAccessLost',
  'uwLockLostGeneric',
  'uwLockLostHeldBy',
  'uwLockAcquireFailed',
] as const

describe('EL-1(b) copy: uwLock* keys in every shard', () => {
  it('every one of the 21 locale shards defines all 15 keys, non-empty', () => {
    for (const [locale, dict] of Object.entries(uniworkDocumentStrings)) {
      const record = dict as Record<string, string>
      for (const k of NEW_KEYS) {
        expect(record[k], `${locale}.${k}`).toBeTruthy()
      }
    }
  })

  it('vi/en are the web documents.editLock.* strings verbatim', () => {
    const viDict = uniworkDocumentStrings.vi as Record<string, string>
    const enDict = uniworkDocumentStrings.en as Record<string, string>
    // web: packages/core/i18n/locales/vi.json documents.editLock.bannerOther ({{name}} -> {name})
    expect(viDict.uwLockBannerOther).toBe(
      '{name} đang sửa từ {time}. Bạn đang xem ở chế độ chỉ đọc.',
    )
    expect(enDict.uwLockBannerOther).toBe(
      '{name} has been editing since {time}. You’re viewing read‑only.',
    )
    expect(viDict.uwLockBannerSelfElsewhere).toBe('Bạn đang sửa tài liệu này ở cửa sổ khác.')
    expect(enDict.uwLockBannerSelfElsewhere).toBe('You’re editing this document in another window.')
    expect(viDict.uwLockBannerFree).toBe('Không còn ai sửa tài liệu này.')
    expect(enDict.uwLockBannerFree).toBe('No one is editing this document now.')
    expect(viDict.uwLockEditHere).toBe('Sửa ở đây')
    expect(enDict.uwLockEditHere).toBe('Edit here')
    expect(viDict.uwLockAcquiring).toBe('Đang lấy quyền sửa…')
    expect(enDict.uwLockAcquiring).toBe('Getting editing access…')
    expect(viDict.uwLockLostTitle).toBe('Bạn không còn quyền sửa')
    expect(enDict.uwLockLostTitle).toBe('You’re no longer editing')
    expect(viDict.uwLockLostTakenOver).toBe(
      '{name} đã lấy quyền sửa. Thay đổi chưa lưu của bạn vẫn ở đây.',
    )
    expect(enDict.uwLockLostTakenOver).toBe(
      '{name} took over editing. Your unsaved changes are still here.',
    )
    expect(viDict.uwLockLostExpired).toBe(
      'Quyền sửa đã hết hạn vì một lúc lâu không liên lạc được với máy chủ (mất mạng hoặc máy ngủ). Thay đổi chưa lưu của bạn vẫn ở đây.',
    )
    expect(enDict.uwLockLostExpired).toBe(
      'Editing expired because we couldn’t reach the server for a while (no network or the device slept). Your unsaved changes are still here.',
    )
    expect(viDict.uwLockLostHandedOver).toBe(
      'Bạn đã nhường quyền sửa cho {name}. Thay đổi chưa lưu của bạn vẫn ở đây.',
    )
    expect(enDict.uwLockLostHandedOver).toBe(
      'You handed editing to {name}. Your unsaved changes are still here.',
    )
    expect(viDict.uwLockLostMovedHere).toBe(
      'Bạn đang sửa tài liệu này ở cửa sổ khác. Thay đổi chưa lưu ở cửa sổ này vẫn ở đây.',
    )
    expect(enDict.uwLockLostMovedHere).toBe(
      'You’re now editing this document in another window. The unsaved changes in this window are still here.',
    )
    expect(viDict.uwLockLostAccessLost).toBe(
      'Bạn không còn quyền sửa tài liệu này. Thay đổi chưa lưu của bạn vẫn ở đây.',
    )
    expect(enDict.uwLockLostAccessLost).toBe(
      'You no longer have permission to edit this document. Your unsaved changes are still here.',
    )
    expect(viDict.uwLockLostGeneric).toBe(
      'Bạn không còn giữ quyền sửa. Thay đổi chưa lưu của bạn vẫn ở đây.',
    )
    expect(enDict.uwLockLostGeneric).toBe(
      'You’re no longer editing. Your unsaved changes are still here.',
    )
    expect(viDict.uwLockLostHeldBy).toBe('{name} đang sửa. Thay đổi chưa lưu của bạn vẫn ở đây.')
    expect(enDict.uwLockLostHeldBy).toBe(
      '{name} is editing now. Your unsaved changes are still here.',
    )
    expect(viDict.uwLockAcquireFailed).toBe('Chưa lấy được quyền sửa. Thử lại sau ít phút.')
    expect(enDict.uwLockAcquireFailed).toBe(
      'Couldn’t get editing access. Try again in a few minutes.',
    )
  })

  it('the other 19 shards translate the new keys (never an English copy)', () => {
    const enDict = uniworkDocumentStrings.en as Record<string, string>
    for (const [locale, dict] of Object.entries(uniworkDocumentStrings)) {
      if (locale === 'en') continue
      const record = dict as Record<string, string>
      for (const k of NEW_KEYS) {
        expect(record[k], `${locale}.${k} is an untranslated copy of en`).not.toBe(enDict[k])
      }
      // placeholders survive translation
      expect(record.uwLockBannerOther).toContain('{name}')
      expect(record.uwLockBannerOther).toContain('{time}')
      expect(record.uwLockLostTakenOver).toContain('{name}')
      expect(record.uwLockLostHeldBy).toContain('{name}')
    }
  })

  it('the new vi strings use the glossary only — never "khóa"/"khoá"', () => {
    const viDict = uniworkDocumentStrings.vi as Record<string, string>
    for (const k of NEW_KEYS) {
      expect(viDict[k]?.toLowerCase(), `vi.${k}`).not.toContain('khóa')
      expect(viDict[k]?.toLowerCase(), `vi.${k}`).not.toContain('khoá')
    }
  })
})
