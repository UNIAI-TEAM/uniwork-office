import { describe, expect, it, vi } from 'vitest'
import type {
  RecentEntry,
  UniworkDocStatus,
  UniworkDocSummary,
  UniworkSaveState,
} from '../src/shared/home-api'
import {
  PICKER_SEARCH_DEBOUNCE_MS,
  chipCopy,
  chipModelOf,
  docExtension,
  errorActionOf,
  formatWhen,
  initialPickerState,
  isOpenable,
  launchNoticeOf,
  moveActive,
  openCardOf,
  pathKey,
  pickerBodyOf,
  pickerReducer,
  pickerRowMeta,
  recentRowPolicy,
  retryActionOf,
  type PickerAction,
  type PickerState,
} from '../src/renderer/src/uniwork-docs-model'
import { openRecentEntry } from '../src/renderer/src/uniwork-open'
import { uniworkDocumentStrings } from '../src/renderer/src/i18n/strings-uniwork-documents'
import { accountStrings } from '../src/renderer/src/i18n/strings-account'
import type { StringKey, TFunc } from '../src/renderer/src/locale'

const copy = { ...accountStrings.en, ...uniworkDocumentStrings.en } as Record<string, string>
/** English translator with the same {placeholder} rule as the real one */
const t: TFunc = (key: StringKey, params) =>
  (copy[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))

function status(partial: Partial<UniworkDocStatus> = {}): UniworkDocStatus {
  return {
    path: 'C:\\data\\uniwork-documents\\d1\\Plan.docx',
    documentId: 'd1',
    workspaceId: 'w1',
    title: 'Plan',
    format: 'docx',
    access: 'edit',
    state: 'saved',
    ...partial,
  }
}

function doc(id: string, title: string, format: UniworkDocSummary['format']): UniworkDocSummary {
  return { id, workspaceId: 'w1', title, format, updatedAt: '2026-05-01T10:00:00Z' }
}

describe('chipModelOf: save state -> chip', () => {
  const labelOf = (s: Partial<UniworkDocStatus>, signedIn = false) => {
    const model = chipModelOf(status(s), { needsSignIn: !signedIn })
    return { ...model, ...chipCopy(model, t, 'en-US') }
  }

  it.each<[UniworkSaveState, string, string, string | undefined]>([
    ['ready', 'Saved to UniWork', 'ok', undefined],
    ['saved', 'Saved to UniWork', 'ok', undefined],
    ['dirty', 'Unsaved changes', 'neutral', undefined],
    ['saving', 'Saving…', 'busy', undefined],
    ['offline', 'Not saved: offline', 'warn', 'retry'],
    ['signed-out', 'Sign in again to save', 'warn', 'sign-in'],
    ['conflict', 'Conflict', 'warn', 'resolve'],
    ['error', 'Couldn’t save', 'error', 'retry'],
  ])('%s -> "%s" (%s, action %s)', (state, label, tone, action) => {
    const chip = labelOf({ state })
    expect(chip.label).toBe(label)
    expect(chip.tone).toBe(tone)
    expect(chip.action?.kind).toBe(action)
  })

  it('shows View only for a read-only document that is idle, never "Saved"', () => {
    for (const state of ['ready', 'saved', 'dirty', 'saving'] as const) {
      const chip = labelOf({ access: 'view', state })
      expect(chip.label).toBe('View only')
      expect(chip.action).toBeUndefined()
    }
  })

  it('lets a failure state win over View only (a downgraded document that was refused)', () => {
    expect(labelOf({ access: 'view', state: 'blocked', error: 'forbidden' }).label).toBe(
      'Blocked: no permission',
    )
  })

  it.each([
    ['forbidden', 'Blocked: no permission'],
    ['not_found', 'Blocked: document missing'],
    ['deleted', 'Blocked: document deleted'],
    ['quota_exceeded', 'Blocked: storage full'],
    ['too_large', 'Blocked: file too large'],
    ['server_error', 'Blocked: unavailable'],
  ] as const)('blocked with %s reads "%s" and keeps the local copy promise', (error, label) => {
    const chip = labelOf({ state: 'blocked', error })
    expect(chip.label).toBe(label)
    expect(chip.tone).toBe('error')
    expect(chip.action).toBeUndefined()
    expect(chip.tip).toContain('Your changes are kept on this computer.')
  })

  it('offers a browser sign-in while signed out, and Retry once the account is signed in again', () => {
    expect(labelOf({ state: 'signed-out' }, false).action).toEqual({
      kind: 'sign-in',
      labelKey: 'acctSignIn',
    })
    expect(labelOf({ state: 'signed-out' }, true).action?.kind).toBe('retry')
  })

  it('leads the error tooltip with the sentence for the code', () => {
    const chip = labelOf({ state: 'error', error: 'network' })
    expect(chip.tip.startsWith('Can’t reach UniWork.')).toBe(true)
    expect(chip.action?.kind).toBe('retry')
  })

  it('puts the last save time into the saved tooltip only when there is one', () => {
    expect(labelOf({ state: 'saved' }).tip).toBe('All changes are saved to UniWork.')
    const when = labelOf({ state: 'saved', lastSavedAt: '2026-05-01T10:00:00Z' }).tip
    expect(when).toMatch(/^All changes are saved to UniWork\. Last saved .+\.$/)
    expect(when).not.toContain('{time}')
  })

  it('never shows an internal code or a bare state name', () => {
    for (const state of [
      'ready',
      'dirty',
      'saving',
      'saved',
      'conflict',
      'blocked',
      'offline',
      'signed-out',
      'error',
    ] as const) {
      const chip = labelOf({ state, error: state === 'error' ? 'timeout' : undefined })
      expect(chip.label).not.toMatch(/_|signed-out|conflict_|\{|\}/)
      expect(chip.tip).not.toMatch(/\{|\}/)
    }
  })
})

describe('errorActionOf', () => {
  it('sign in for an expired session, retry for transport trouble, nothing for a verdict', () => {
    expect(errorActionOf('session_expired')).toBe('sign-in')
    expect(errorActionOf('not_signed_in')).toBe('sign-in')
    for (const e of ['network', 'timeout', 'server_error', 'malformed_response'] as const) {
      expect(errorActionOf(e)).toBe('retry')
    }
    for (const e of [
      'forbidden',
      'not_found',
      'deleted',
      'unsupported_format',
      'ticket_expired',
    ] as const) {
      expect(errorActionOf(e)).toBe('none')
    }
  })
})

describe('launchNoticeOf', () => {
  it('shows progress while opening, with the title when known', () => {
    expect(launchNoticeOf({ phase: 'opening' })).toMatchObject({
      tone: 'busy',
      messageKey: 'uwLaunchOpening',
    })
    expect(launchNoticeOf({ phase: 'opening', title: ' Plan.docx ' })).toMatchObject({
      messageKey: 'uwLaunchOpeningTitle',
      params: { title: 'Plan.docx' },
    })
  })

  it('clears once the document opened', () => {
    expect(launchNoticeOf({ phase: 'opened', path: 'C:\\x.docx', title: 'x' })).toBeNull()
  })

  it('asks to sign in and stays until acted on', () => {
    const notice = launchNoticeOf({ phase: 'needs-sign-in' })
    expect(notice).toMatchObject({ tone: 'warn', signIn: true })
    expect(notice?.autoHideMs).toBeUndefined()
  })

  it('has copy per failure code; the expired link says to open it again from UniWork', () => {
    const expired = launchNoticeOf({ phase: 'failed', error: 'ticket_expired' })
    expect(t(expired!.messageKey)).toBe('This link expired. Open the document again from UniWork.')
    expect(expired).toMatchObject({ tone: 'error', signIn: false })
    expect(expired!.autoHideMs).toBeGreaterThan(0)
    const invalid = launchNoticeOf({ phase: 'failed', error: 'ticket_invalid' })
    expect(t(invalid!.messageKey)).toContain('no longer valid')
    expect(launchNoticeOf({ phase: 'failed', error: 'session_expired' })?.signIn).toBe(true)
    expect(launchNoticeOf({ phase: 'failed', error: 'forbidden' })?.signIn).toBe(false)
  })
})

describe('openCardOf: the card is always there, the call to action follows the account', () => {
  it.each([
    ['signed-in', 'picker', false],
    ['refreshing', 'picker', false],
    ['server-unreachable', 'picker', false],
    ['loading', 'picker', false],
    ['signed-out', 'sign-in', true],
    ['session-expired', 'sign-in', true],
    ['session-revoked', 'sign-in', true],
    ['signing-in', 'none', false],
    ['not-configured', 'settings', true],
    ['wrong-deployment', 'settings', true],
    ['keyring-unavailable', 'settings', true],
  ] as const)('%s -> %s', (view, action, attention) => {
    const card = openCardOf(view)
    expect(card.action).toBe(action)
    expect(card.attention).toBe(attention)
    expect(t(card.subKey)).not.toBe(card.subKey)
  })

  it('says what to do in each unsigned state', () => {
    expect(t(openCardOf('signed-out').subKey)).toBe('Sign in to open')
    expect(t(openCardOf('session-expired').subKey)).toBe('Sign in again to open')
    expect(t(openCardOf('not-configured').subKey)).toBe('UniWork sign-in is not set up here')
  })
})

describe('picker reducer', () => {
  const run = (actions: PickerAction[], from: PickerState = initialPickerState()) =>
    actions.reduce(pickerReducer, from)
  const workspaces = [
    { id: 'w1', name: 'Team', orgId: 'o1' },
    { id: 'w2', name: 'Sales', orgId: 'o1' },
  ]
  const loadedWorkspaces: PickerAction = {
    type: 'workspaces-loaded',
    result: { ok: true, value: workspaces },
  }
  const page = (docs: UniworkDocSummary[], nextCursor: string | null = null) => ({
    ok: true as const,
    value: { documents: docs, nextCursor },
  })

  it('starts loading, selects the first workspace and starts the first list fetch', () => {
    const s0 = initialPickerState()
    expect(pickerBodyOf(s0)).toEqual({ kind: 'loading' })
    const s1 = run([loadedWorkspaces])
    expect(s1.workspaceId).toBe('w1')
    expect(s1.list.requestId).toBe(1)
    expect(pickerBodyOf(s1)).toEqual({ kind: 'loading' })
  })

  it('shows the no-workspaces state when the account has none', () => {
    const s = run([{ type: 'workspaces-loaded', result: { ok: true, value: [] } }])
    expect(pickerBodyOf(s)).toEqual({ kind: 'no-workspaces' })
    expect(s.workspaceId).toBeNull()
  })

  it('lists documents and highlights the first one that can be opened', () => {
    const docs = [
      doc('a', 'Photo.png', null),
      doc('b', 'Plan.docx', 'docx'),
      doc('c', 'Sheet.xlsx', 'xlsx'),
    ]
    const s = run([
      loadedWorkspaces,
      { type: 'list-loaded', requestId: 1, append: false, result: page(docs) },
    ])
    expect(pickerBodyOf(s)).toEqual({ kind: 'list' })
    expect(s.activeId).toBe('b')
  })

  it('drops an answer for an older request (workspace switched while loading)', () => {
    const s = run([
      loadedWorkspaces,
      { type: 'select-workspace', id: 'w2' },
      {
        type: 'list-loaded',
        requestId: 1,
        append: false,
        result: page([doc('x', 'Old.docx', 'docx')]),
      },
    ])
    expect(s.list.requestId).toBe(2)
    expect(s.list.docs).toEqual([])
    expect(s.list.status).toBe('loading')
  })

  it('a new search starts a fresh list and distinguishes empty from no results', () => {
    const loaded = run([
      loadedWorkspaces,
      { type: 'list-loaded', requestId: 1, append: false, result: page([]) },
    ])
    expect(pickerBodyOf(loaded)).toEqual({ kind: 'empty' })
    const searching = run([{ type: 'set-query', query: 'plan' }], loaded)
    expect(searching.list.requestId).toBe(2)
    const none = run(
      [{ type: 'list-loaded', requestId: 2, append: false, result: page([]) }],
      searching,
    )
    expect(pickerBodyOf(none)).toEqual({ kind: 'no-results', query: 'plan' })
  })

  it('ignores a search that did not change the committed text', () => {
    const s = run([loadedWorkspaces])
    expect(pickerReducer(s, { type: 'set-query', query: '' })).toBe(s)
  })

  it('appends the next page, keeps the highlight, and clears the cursor at the end', () => {
    const first = [doc('a', 'A.docx', 'docx')]
    const second = [doc('b', 'B.pdf', 'pdf')]
    let s = run([
      loadedWorkspaces,
      { type: 'list-loaded', requestId: 1, append: false, result: page(first, 'cur1') },
      { type: 'load-more' },
    ])
    expect(s.list.loadingMore).toBe(true)
    // a second click while loading does not start another fetch
    expect(pickerReducer(s, { type: 'load-more' })).toBe(s)
    s = run([{ type: 'list-loaded', requestId: 1, append: true, result: page(second) }], s)
    expect(s.list.docs.map((d) => d.id)).toEqual(['a', 'b'])
    expect(s.list.nextCursor).toBeNull()
    expect(s.list.loadingMore).toBe(false)
    expect(s.activeId).toBe('a')
  })

  it('a failed Load more keeps the rows and reports the error under them', () => {
    const s = run([
      loadedWorkspaces,
      {
        type: 'list-loaded',
        requestId: 1,
        append: false,
        result: page([doc('a', 'A.docx', 'docx')], 'c'),
      },
      { type: 'load-more' },
      { type: 'list-loaded', requestId: 1, append: true, result: { ok: false, error: 'network' } },
    ])
    expect(pickerBodyOf(s)).toEqual({ kind: 'list' })
    expect(s.list.moreError).toBe('network')
    expect(s.list.loadingMore).toBe(false)
    expect(s.list.nextCursor).toBe('c')
  })

  it.each([
    ['network', 'retry'],
    ['server_error', 'retry'],
    ['session_expired', 'sign-in'],
    ['forbidden', 'none'],
  ] as const)('a list failure with %s offers %s', (error, action) => {
    const s = run([
      loadedWorkspaces,
      { type: 'list-loaded', requestId: 1, append: false, result: { ok: false, error } },
    ])
    expect(pickerBodyOf(s)).toEqual({ kind: 'error', error, action })
  })

  it('Retry reloads the list; after a workspace-list failure it reloads the workspaces', () => {
    const listFailed = run([
      loadedWorkspaces,
      { type: 'list-loaded', requestId: 1, append: false, result: { ok: false, error: 'timeout' } },
    ])
    expect(retryActionOf(listFailed)).toEqual({ type: 'list-retry' })
    const again = run([{ type: 'list-retry' }], listFailed)
    expect(again.list.requestId).toBe(2)
    expect(pickerBodyOf(again)).toEqual({ kind: 'loading' })

    const wsFailed = run([{ type: 'workspaces-loaded', result: { ok: false, error: 'network' } }])
    expect(pickerBodyOf(wsFailed)).toEqual({ kind: 'error', error: 'network', action: 'retry' })
    expect(retryActionOf(wsFailed)).toEqual({ type: 'workspaces-retry' })
    expect(pickerBodyOf(run([{ type: 'workspaces-retry' }], wsFailed))).toEqual({ kind: 'loading' })
  })

  it('opening is one at a time; a failure is kept inline and can be cleared', () => {
    let s = run([{ type: 'open-start', id: 'a', title: 'A.docx' }])
    expect(s.opening).toEqual({ id: 'a', title: 'A.docx' })
    expect(pickerReducer(s, { type: 'open-start', id: 'b', title: 'B' })).toBe(s)
    s = run([{ type: 'open-failed', error: 'session_expired' }], s)
    expect(s.opening).toBeNull()
    expect(s.openError).toBe('session_expired')
    expect(run([{ type: 'clear-open-error' }], s).openError).toBeNull()
    // a new attempt clears the previous error
    expect(run([{ type: 'open-start', id: 'a', title: 'A' }], s).openError).toBeNull()
  })

  it('keeps the same workspace when the workspace list reloads', () => {
    const s = run([loadedWorkspaces, { type: 'select-workspace', id: 'w2' }, loadedWorkspaces])
    expect(s.workspaceId).toBe('w2')
  })
})

describe('keyboard navigation skips documents that cannot be opened', () => {
  const docs = [doc('a', 'A.docx', 'docx'), doc('x', 'Pic.png', null), doc('b', 'B.pdf', 'pdf')]

  it('moves over openable rows only', () => {
    expect(moveActive(docs, 'a', 'next')).toBe('b')
    expect(moveActive(docs, 'b', 'next')).toBe('b')
    expect(moveActive(docs, 'b', 'prev')).toBe('a')
    expect(moveActive(docs, 'a', 'prev')).toBe('a')
    expect(moveActive(docs, null, 'next')).toBe('a')
    expect(moveActive(docs, 'a', 'last')).toBe('b')
    expect(moveActive(docs, 'b', 'first')).toBe('a')
  })

  it('has no highlight when nothing can be opened', () => {
    expect(moveActive([doc('x', 'Pic.png', null)], null, 'next')).toBeNull()
    expect(moveActive([], null, 'first')).toBeNull()
  })

  it('classifies formats: only the six office formats open', () => {
    expect(isOpenable(doc('a', 'A.docx', 'docx'))).toBe(true)
    expect(isOpenable(doc('x', 'Pic.png', null))).toBe(false)
    expect(docExtension(doc('x', 'Pic.PNG', null))).toBe('png')
    expect(docExtension(doc('x', 'README', null))).toBe('')
    expect(docExtension(doc('a', 'Notes', 'md'))).toBe('md')
  })

  it('debounces the search long enough to ride out typing', () => {
    expect(PICKER_SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(200)
  })
})

describe('time and path helpers', () => {
  const now = new Date('2026-05-01T18:00:00')

  it('formats today as a time and other days as a date; empty when unusable', () => {
    expect(formatWhen('2026-05-01T09:30:00', 'en-US', now)).toMatch(/9:30/)
    expect(formatWhen('2026-04-02T09:30:00', 'en-US', now)).toMatch(/Apr/)
    expect(formatWhen('not a date', 'en-US', now)).toBe('')
  })

  it('names who updated a document when the server says', () => {
    const base = { ...doc('a', 'A.docx', 'docx'), updatedAt: '2026-04-02T09:30:00' }
    expect(pickerRowMeta(base, t, 'en-US', now)).toMatch(/^Updated Apr/)
    expect(pickerRowMeta({ ...base, updatedByName: 'Linh' }, t, 'en-US', now)).toMatch(/by Linh$/)
    expect(pickerRowMeta({ ...base, updatedAt: '' }, t, 'en-US', now)).toBe('')
  })

  it('compares Windows paths regardless of slash direction and drive-letter case', () => {
    expect(pathKey('C:\\Users\\a\\X.docx')).toBe(pathKey('c:/Users/a/X.docx'))
    expect(pathKey('/home/a/X.docx')).not.toBe(pathKey('/home/a/x.docx'))
  })
})

describe('openRecentEntry', () => {
  const local: RecentEntry = {
    path: 'C:\\docs\\a.docx',
    name: 'a.docx',
    ext: 'docx',
    mtimeMs: 1,
    sizeBytes: 1,
  } as RecentEntry
  const bound: RecentEntry = {
    ...local,
    path: 'C:\\ud\\uniwork-documents\\dep\\u\\d1\\Plan.docx',
    name: 'Plan.docx',
    uniwork: { documentId: 'd1', workspaceId: 'w1', title: 'Plan', access: 'edit' },
  }

  it('opens a local file by path, exactly as before, with no UniWork call', async () => {
    const api = { openPath: vi.fn(async () => undefined), uniworkOpenDocument: vi.fn() }
    const notify = vi.fn()
    await openRecentEntry(local, api as never, notify)
    expect(api.openPath).toHaveBeenCalledWith(local.path)
    expect(api.uniworkOpenDocument).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })

  it('opens a UniWork recent through UniWork by document id, never by its path', async () => {
    const api = {
      openPath: vi.fn(),
      uniworkOpenDocument: vi.fn(async () => ({ ok: true as const, value: { path: bound.path } })),
    }
    const notify = vi.fn()
    await openRecentEntry(bound, api as never, notify)
    expect(api.uniworkOpenDocument).toHaveBeenCalledWith('d1')
    expect(api.openPath).not.toHaveBeenCalled()
    expect(notify.mock.calls.map((c) => c[0].phase)).toEqual(['opening', 'opened'])
  })

  it('reports a refusal and a rejected call as failures the person can read', async () => {
    const refused = {
      openPath: vi.fn(),
      uniworkOpenDocument: vi.fn(async () => ({ ok: false as const, error: 'not_found' as const })),
    }
    const notify = vi.fn()
    await openRecentEntry(bound, refused as never, notify)
    expect(notify).toHaveBeenLastCalledWith({ phase: 'failed', error: 'not_found' })

    const broken = {
      openPath: vi.fn(),
      uniworkOpenDocument: vi.fn(async () => Promise.reject(new Error('ipc'))),
    }
    const notify2 = vi.fn()
    await openRecentEntry(bound, broken as never, notify2)
    expect(notify2).toHaveBeenLastCalledWith({ phase: 'failed', error: 'network' })
  })
})

describe('recentRowPolicy', () => {
  it('a local row keeps every file action exactly as before', () => {
    expect(recentRowPolicy({})).toEqual({
      badge: false,
      selectable: true,
      draggable: true,
      showLocation: true,
      fileActions: true,
    })
  })

  it('a UniWork row has a badge and none of Show in folder, rename, delete, move, drag or bulk select', () => {
    expect(
      recentRowPolicy({
        uniwork: { documentId: 'd1', workspaceId: 'w1', title: 'Plan', access: 'view' },
      }),
    ).toEqual({
      badge: true,
      selectable: false,
      draggable: false,
      showLocation: false,
      fileActions: false,
    })
  })
})
