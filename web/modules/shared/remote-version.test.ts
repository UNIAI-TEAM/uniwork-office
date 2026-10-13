// "A new version is on UniWork" for the web frame (G5-03w, S6): when the open copy is replaced, when
// the bar warns instead, what the bar says, and how revoke / delete / 401 / 403 / 410 lock or mark it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { format } from '@genoffice/i18n'
import { webLanguage } from '../../docs/bridge/browser'
import {
  DocsProtocolError,
  type OpenPayload,
  type RemoteVersionPayload,
} from '../../docs/protocol/types'
import { createAiRunTracker } from './ai-run'
import type { ConflictIo, ConflictOutcome } from './conflict-dialog'
import { webText, type WebStringKey } from './i18n/strings-web'
import { createRemoteBar } from './remote-bar'
import { createRemoteVersion, type RemoteVersion, type RemoteVersionHost } from './remote-version'

const t = (key: WebStringKey, params?: Record<string, string>) =>
  webText(webLanguage(), key, params)
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

const SAVED_AT = Date.UTC(2026, 9, 12, 8, 0)
const time = (ms: number) =>
  new Intl.DateTimeFormat(webLanguage(), { dateStyle: 'medium', timeStyle: 'short' }).format(ms)

function head(revision: string | undefined, versionId = `v${revision}`): OpenPayload {
  return {
    file: {
      fileId: 'd1',
      name: 'a.docx',
      etag: revision ? `"${revision}"` : '"?"',
      versionId,
      modifiedAt: SAVED_AT,
      ...(revision ? { revision } : {}),
    },
    source: { kind: 'bytes', data: new ArrayBuffer(1) },
  }
}

function event(revision: string, over: Partial<RemoteVersionPayload> = {}): RemoteVersionPayload {
  return {
    document_id: 'd1',
    revision,
    version_id: `v${revision}`,
    saved_at: new Date(SAVED_AT).toISOString(),
    author_name: 'Trần An',
    ...over,
  }
}

const bar = () => document.querySelector<HTMLElement>('.uw-remote-bar')
const barText = () => bar()?.querySelector('.uw-remote-bar-text')?.textContent ?? null
const actions = () =>
  [...(bar()?.querySelectorAll<HTMLButtonElement>('[data-action]') ?? [])].map(
    (b) => b.dataset.action,
  )
const click = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!.click()
const tone = () => bar()?.className.match(/uw-remote-bar--(\w+)/)?.[1] ?? null

interface Rig {
  rv: RemoteVersion
  emit(p: RemoteVersionPayload): void
  request: ReturnType<typeof vi.fn>
  apply: ReturnType<typeof vi.fn>
  dialog: ReturnType<typeof vi.fn>
  state: { revision: string | null; dirty: boolean; fileId: string }
  ai: ReturnType<typeof createAiRunTracker>
  onLock: ReturnType<typeof vi.fn>
  confirmStop: ReturnType<typeof vi.fn>
}

function rig(
  over: {
    reply?: (payload: { fileId: string; versionId?: string }) => OpenPayload | Promise<OpenPayload>
    host?: Partial<RemoteVersionHost>
  } = {},
): Rig {
  const state = { revision: '10' as string | null, dirty: false, fileId: 'd1' }
  let listener: (p: RemoteVersionPayload) => void = () => {}
  const request = vi.fn(async (_type: string, payload: { fileId: string; versionId?: string }) =>
    (over.reply ?? (() => head('12')))(payload),
  )
  const apply = vi.fn(async (reply: OpenPayload) => {
    state.revision = reply.file.revision ?? null
  })
  const dialog = vi.fn(async (io: ConflictIo): Promise<ConflictOutcome> => {
    await io.reload()
    return { kind: 'reloaded' }
  })
  const ai = createAiRunTracker({ graceMs: 0 })
  const onLock = vi.fn()
  const confirmStop = vi.fn(async () => true)
  const root = document.createElement('div')
  root.id = 'root'
  document.body.append(root)
  const rv = createRemoteVersion({
    port: {
      onRemoteVersion: (l) => {
        listener = l
        return () => {}
      },
      request: request as never,
    },
    current: () => ({ fileId: state.fileId, revision: state.revision }),
    isDirty: () => state.dirty,
    canEdit: () => true,
    apply,
    onLock,
    bar: createRemoteBar(),
    aiRun: ai,
    dialog: dialog as never,
    confirmStop,
    ...over.host,
  })
  return { rv, emit: (p) => listener(p), request, apply, dialog, state, ai, onLock, confirmStop }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
  document.documentElement.classList.remove('uw-remote-bar-on')
})

describe('a clean frame with no AI turn', () => {
  it('reloads through api.open asking for the event version, and shows the info bar', async () => {
    const r = rig()
    r.emit(event('12'))
    await flush()
    expect(r.request).toHaveBeenCalledWith(
      'api.open',
      { fileId: 'd1', versionId: 'v12' },
      expect.anything(),
    )
    expect(r.apply).toHaveBeenCalledTimes(1)
    expect(tone()).toBe('info')
    expect(barText()).toBe(
      t('uwRemoteUpdated', { n: '12', author: 'Trần An', time: time(SAVED_AT) }),
    )
    expect(actions()).toEqual(['close'])
    expect(bar()!.getAttribute('role')).toBe('region')
    expect(bar()!.getAttribute('aria-label')).toBe(t('uwRemoteRegion'))
    // the visible copy is not a live region: the window's live node reads it once
    expect(bar()!.querySelector('[aria-live],[role=status],[role=alert]')).toBeNull()
    expect(document.querySelector('[role=status]')!.textContent).toBe(barText())
  })

  it('shows the revision of the reply, never the one the event named (a commit slipped in between)', async () => {
    const r = rig({ reply: () => head('13', 'v13') })
    r.emit(event('12'))
    await flush()
    expect(r.apply).toHaveBeenCalledTimes(1)
    expect(barText()).toContain('13')
    expect(barText()).not.toContain('version 12')
    // another version than the event named: its author is not the event's
    expect(barText()).toContain(t('uwAuthorFallback'))
    expect(barText()).not.toContain('Trần An')
  })

  it('an old host (no revision on the reply): the sentence without a number', async () => {
    const r = rig({ reply: () => head(undefined, 'v12') })
    r.emit(event('12'))
    await flush()
    expect(r.apply).toHaveBeenCalledTimes(1)
    expect(barText()).toBe(t('uwRemoteUpdatedNoRev'))
  })

  it('a reply that is not newer than the open copy replaces nothing and shows no bar', async () => {
    const r = rig({ reply: () => head('9') })
    r.emit(event('12'))
    await flush()
    expect(r.apply).not.toHaveBeenCalled()
    expect(bar()).toBeNull()
  })

  it('compares revisions as numbers: 9 is older than 10, 11 newer than 10', async () => {
    const r = rig()
    r.emit(event('9'))
    await flush()
    expect(r.request).not.toHaveBeenCalled()
    r.emit(event('11'))
    await flush()
    expect(r.request).toHaveBeenCalledTimes(1)
  })

  it('ignores another document, a revision at or below the open one, and a malformed revision', async () => {
    const r = rig()
    r.emit(event('12', { document_id: 'other' }))
    r.emit(event('10'))
    r.emit(event('1x'))
    r.emit(event(''))
    await flush()
    expect(r.request).not.toHaveBeenCalled()
    expect(bar()).toBeNull()
  })

  it('a version that is gone (not_found) is replaced by the head, asked without a version', async () => {
    const r = rig({
      reply: ({ versionId }) => {
        if (versionId) throw new DocsProtocolError({ code: 'not_found', message: 'gone' })
        return head('12')
      },
    })
    r.emit(event('12'))
    await flush()
    expect(r.request.mock.calls.map((c) => c[1])).toEqual([
      { fileId: 'd1', versionId: 'v12' },
      { fileId: 'd1' },
    ])
    expect(r.apply).toHaveBeenCalledTimes(1)
    expect(tone()).toBe('info')
  })

  it('a head that is not found either is a deleted document: the deleted lock, not the Retry bar', async () => {
    const r = rig({
      reply: () => {
        throw new DocsProtocolError({ code: 'not_found', message: 'gone' })
      },
    })
    r.emit(event('12'))
    await flush()
    expect(r.request).toHaveBeenCalledTimes(2)
    expect(r.apply).not.toHaveBeenCalled()
    expect(r.rv.locked()).toBe('deleted')
    expect(barText()).toBe(t('uwRemoteDeleted'))
    expect(actions()).toEqual([])
    expect(r.onLock).toHaveBeenCalledWith('deleted')
  })
})

describe('a dirty frame', () => {
  it('never replaces the content: the warn bar with Reload latest… and Later', async () => {
    const r = rig()
    r.state.dirty = true
    r.emit(event('12'))
    await flush()
    expect(r.request).not.toHaveBeenCalled()
    expect(r.apply).not.toHaveBeenCalled()
    expect(tone()).toBe('warn')
    expect(barText()).toBe(t('uwRemoteNewerDirty', { n: '12' }))
    expect(actions()).toEqual(['reload', 'later'])
    expect(bar()!.getAttribute('aria-label')).toBe(t('uwRemoteRegion'))
  })

  it('a newer revision updates the number in the same bar (no stacking)', async () => {
    const r = rig()
    r.state.dirty = true
    r.emit(event('12'))
    r.emit(event('14'))
    await flush()
    expect(document.querySelectorAll('.uw-remote-bar')).toHaveLength(1)
    expect(barText()).toBe(t('uwRemoteNewerDirty', { n: '14' }))
  })

  it('Later hides the bar until a newer revision arrives', async () => {
    const r = rig()
    r.state.dirty = true
    r.emit(event('12'))
    await flush()
    click('later')
    expect(bar()).toBeNull()
    r.emit(event('12'))
    await flush()
    expect(bar()).toBeNull()
    r.emit(event('13'))
    await flush()
    expect(barText()).toBe(t('uwRemoteNewerDirty', { n: '13' }))
  })

  it('undoing every change offers the reload but does not load by itself; typing again goes back to the warning', async () => {
    const r = rig()
    r.state.dirty = true
    r.emit(event('12'))
    await flush()
    r.state.dirty = false
    r.rv.dirtyChanged(false)
    expect(tone()).toBe('info')
    expect(barText()).toBe(t('uwRemoteNowClean', { n: '12' }))
    expect(actions()).toEqual(['reload-now'])
    expect(r.request).not.toHaveBeenCalled()
    r.state.dirty = true
    r.rv.dirtyChanged(true)
    expect(barText()).toBe(t('uwRemoteNewerDirty', { n: '12' }))
    r.state.dirty = false
    r.rv.dirtyChanged(false)
    click('reload-now')
    await flush()
    expect(r.apply).toHaveBeenCalledTimes(1)
    expect(barText()).toContain(
      t('uwRemoteUpdated', { n: '12', author: 'Trần An', time: time(SAVED_AT) }),
    )
  })

  it('an edit that lands while the version is loading drops the result and keeps the content', async () => {
    let release: (p: OpenPayload) => void = () => {}
    const r = rig({ reply: () => new Promise<OpenPayload>((res) => (release = res)) })
    r.emit(event('12'))
    await flush()
    r.state.dirty = true
    release(head('12'))
    await flush()
    expect(r.apply).not.toHaveBeenCalled()
    expect(barText()).toBe(t('uwRemoteNewerDirty', { n: '12' }))
  })
})

describe('an AI turn is running', () => {
  it('no reload, the AI bar; the next idle loads the version', async () => {
    const r = rig()
    r.ai.begin('s1')
    r.emit(event('12'))
    await flush()
    expect(r.request).not.toHaveBeenCalled()
    expect(tone()).toBe('warn')
    expect(barText()).toBe(t('uwRemoteNewerAi', { n: '12' }))
    expect(actions()).toEqual(['reload', 'later'])
    r.ai.end('s1')
    await flush()
    expect(r.request).toHaveBeenCalledTimes(1)
    expect(r.apply).toHaveBeenCalledTimes(1)
    expect(tone()).toBe('info')
  })

  it('after the turn went idle the next event reloads without a warning', async () => {
    const r = rig()
    r.ai.begin('s1')
    r.ai.end('s1')
    r.emit(event('12'))
    await flush()
    expect(r.apply).toHaveBeenCalledTimes(1)
    expect(tone()).toBe('info')
  })

  it('the frame unloads mid-turn: the reloaded clean frame loads the next version without a warning', async () => {
    const before = rig()
    before.ai.begin('s1')
    before.emit(event('12'))
    await flush()
    expect(tone()).toBe('warn')
    // unload: the page goes away without an idle; the reloaded frame starts with its own state
    before.rv.dispose()
    document.body.replaceChildren()
    expect(bar()).toBeNull()
    const after = rig()
    after.emit(event('13'))
    await flush()
    expect(after.request).toHaveBeenCalledTimes(1)
    expect(after.apply).toHaveBeenCalledTimes(1)
    expect(tone()).toBe('info')
    expect(actions()).toEqual(['close'])
  })

  it('idle on a document that became dirty shows the dirty bar instead of loading', async () => {
    const r = rig()
    r.ai.begin('s1')
    r.emit(event('12'))
    await flush()
    r.state.dirty = true
    r.rv.dirtyChanged(true)
    expect(barText()).toBe(t('uwRemoteNewerDirty', { n: '12' }))
    r.ai.end('s1')
    await flush()
    expect(r.apply).not.toHaveBeenCalled()
    expect(barText()).toBe(t('uwRemoteNewerDirty', { n: '12' }))
  })

  it('a turn that starts while the version is loading drops the result: the AI bar, content kept', async () => {
    let release: (p: OpenPayload) => void = () => {}
    const r = rig({ reply: () => new Promise<OpenPayload>((res) => (release = res)) })
    r.emit(event('12'))
    await flush()
    r.ai.begin('s1')
    release(head('12'))
    await flush()
    expect(r.apply).not.toHaveBeenCalled()
    expect(barText()).toBe(t('uwRemoteNewerAi', { n: '12' }))
  })

  it('Reload latest… with a turn running asks to stop it, stops it, then opens the Reload confirm', async () => {
    const r = rig()
    r.ai.begin('s1', () => queueMicrotask(() => r.ai.end('s1')))
    const stop = vi.spyOn(r.ai, 'stop')
    r.emit(event('12'))
    await flush()
    click('reload')
    await flush()
    expect(r.confirmStop).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(r.dialog).toHaveBeenCalledTimes(1)
    expect(r.dialog.mock.calls[0]![0].start).toBe('reload')
    // the dialog's Reload ran the load: the open copy was replaced
    expect(r.apply).toHaveBeenCalledTimes(1)
  })

  it('declining the stop leaves the turn and the bar alone', async () => {
    const r = rig()
    r.confirmStop.mockResolvedValue(false)
    r.ai.begin('s1')
    r.emit(event('12'))
    await flush()
    click('reload')
    await flush()
    expect(r.dialog).not.toHaveBeenCalled()
    expect(r.ai.running()).toBe(true)
    expect(barText()).toBe(t('uwRemoteNewerAi', { n: '12' }))
  })
})

describe('Reload latest… on a dirty frame', () => {
  it('opens the Reload confirm; the user choosing Reload replaces the content (the user asked)', async () => {
    const r = rig()
    r.state.dirty = true
    r.emit(event('12'))
    await flush()
    click('reload')
    await flush()
    expect(r.dialog).toHaveBeenCalledTimes(1)
    const io: ConflictIo = r.dialog.mock.calls[0]![0]
    expect(io.start).toBe('reload')
    expect(io.canEdit()).toBe(true)
    expect(r.apply).toHaveBeenCalledTimes(1)
    expect(tone()).toBe('info')
  })

  it('cancelling the dialog keeps the content and the warning', async () => {
    const r = rig()
    r.dialog.mockResolvedValue({ kind: 'cancelled' })
    r.state.dirty = true
    r.emit(event('12'))
    await flush()
    click('reload')
    await flush()
    expect(r.apply).not.toHaveBeenCalled()
    expect(barText()).toBe(t('uwRemoteNewerDirty', { n: '12' }))
  })

  it('passes the module download choice to the dialog', async () => {
    const download = { bytes: async () => new ArrayBuffer(1), send: async () => {} }
    const r = rig({ host: { download: () => download } })
    r.state.dirty = true
    r.emit(event('12'))
    await flush()
    click('reload')
    await flush()
    expect(r.dialog.mock.calls[0]![0].download).toBe(download)
  })
})

describe('a reload that fails', () => {
  it('keeps the open content, shows the error bar with Retry; Retry loads', async () => {
    let fail = true
    const r = rig({
      reply: () => {
        if (fail) throw new DocsProtocolError({ code: 'network', message: 'offline' })
        return head('12')
      },
    })
    r.emit(event('12'))
    await flush()
    expect(r.apply).not.toHaveBeenCalled()
    expect(tone()).toBe('error')
    expect(barText()).toBe(t('uwRemoteReloadFailed', { n: '12' }))
    expect(actions()).toEqual(['retry'])
    expect(bar()!.getAttribute('aria-label')).toBe(t('uwLockRegion'))
    expect(r.rv.locked()).toBeNull()
    fail = false
    click('retry')
    await flush()
    expect(r.apply).toHaveBeenCalledTimes(1)
    expect(tone()).toBe('info')
  })

  it('a host that cannot apply it (the editor rejects) is the same error bar', async () => {
    const r = rig()
    r.apply.mockRejectedValue(new Error('cannot open'))
    r.emit(event('12'))
    await flush()
    expect(barText()).toBe(t('uwRemoteReloadFailed', { n: '12' }))
  })
})

describe('revoke and delete', () => {
  it('api.open 403: the revoke bar, the frame is locked (inert editor, saves refused)', async () => {
    const r = rig({
      reply: () => {
        throw new DocsProtocolError({ code: 'forbidden', message: 'no', status: 403 })
      },
    })
    r.emit(event('12'))
    await flush()
    expect(tone()).toBe('error')
    expect(barText()).toBe(t('uwRemoteRevokedWeb'))
    expect(actions()).toEqual([])
    expect(bar()!.getAttribute('aria-label')).toBe(t('uwLockRegion'))
    expect(r.rv.locked()).toBe('revoked')
    expect(r.rv.lockText()).toBe(t('uwRemoteRevokedWeb'))
    expect(document.getElementById('root')!.hasAttribute('inert')).toBe(true)
    expect(r.onLock).toHaveBeenCalledWith('revoked')
    // nothing more happens for this document
    r.emit(event('13'))
    await flush()
    expect(r.request).toHaveBeenCalledTimes(1)
  })

  it('api.open 410: the deleted bar and the lock', async () => {
    const r = rig({
      reply: () => {
        throw new DocsProtocolError({ code: 'internal', message: 'gone', status: 410 })
      },
    })
    r.emit(event('12'))
    await flush()
    expect(barText()).toBe(t('uwRemoteDeleted'))
    expect(r.rv.locked()).toBe('deleted')
    expect(document.getElementById('root')!.hasAttribute('inert')).toBe(true)
  })

  it('a save answered 403 (not an organisation reason) locks like a revoke; 410 and not_found like a delete', () => {
    const a = rig()
    a.rv.saveFailed({ code: 'forbidden', status: 403 })
    expect(a.rv.locked()).toBe('revoked')
    expect(barText()).toBe(t('uwRemoteRevokedWeb'))
    a.rv.reset()
    expect(a.rv.locked()).toBeNull()
    a.rv.saveFailed({ code: 'internal', status: 410 })
    expect(a.rv.locked()).toBe('deleted')
    expect(barText()).toBe(t('uwRemoteDeleted'))
    a.rv.reset()
    a.rv.saveFailed({ code: 'not_found' })
    expect(a.rv.locked()).toBe('deleted')
  })

  it('reset (another document opens) lifts the lock and clears the bar', () => {
    const r = rig()
    r.rv.saveFailed({ code: 'forbidden' })
    expect(document.getElementById('root')!.hasAttribute('inert')).toBe(true)
    r.rv.reset()
    expect(r.rv.locked()).toBeNull()
    expect(document.getElementById('root')!.hasAttribute('inert')).toBe(false)
    expect(bar()).toBeNull()
  })
})

describe('web save failures', () => {
  it.each([
    ['organization_suspended', 'uwReasonSuspended'],
    ['member_deactivated', 'uwReasonDeactivated'],
    ['document_archived', 'uwReasonArchived'],
  ] as const)('403 %s: the organisation bar with its reason, no lock', (apiCode, reason) => {
    const r = rig()
    r.rv.saveFailed({ code: 'forbidden', status: 403, details: { apiCode } })
    expect(tone()).toBe('error')
    expect(barText()).toBe(format(t('uwRemoteOrgBlockedWeb'), { reason: t(reason) }))
    expect(r.rv.locked()).toBeNull()
    expect(document.getElementById('root')!.hasAttribute('inert')).toBe(false)
  })

  it('401: the sign-in-again sentence, no lock, dismissable', () => {
    const r = rig()
    r.rv.saveFailed({ code: 'unauthorized', status: 401 })
    expect(tone()).toBe('error')
    expect(barText()).toBe(t('webSaveUnauthorized'))
    expect(actions()).toEqual(['close'])
    expect(r.rv.locked()).toBeNull()
    click('close')
    expect(bar()).toBeNull()
  })

  it('a conflict, a timeout and a 5xx are not this bar (the conflict dialog / the save line own them)', () => {
    const r = rig()
    r.rv.saveFailed({ code: 'conflict', status: 409 })
    r.rv.saveFailed({ code: 'timeout' })
    r.rv.saveFailed({ code: 'internal', status: 500 })
    expect(bar()).toBeNull()
    expect(r.rv.locked()).toBeNull()
  })
})
