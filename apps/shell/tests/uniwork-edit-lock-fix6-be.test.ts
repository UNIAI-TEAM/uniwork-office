import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkDocStatus, UniworkQueuePopoverRequest } from '../src/shared/home-api'
import type { DocumentDetail } from '../src/main/uniwork-docs/parse'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import type { UniworkDocsClient } from '../src/main/uniwork-docs/client'
import { UniworkDocError } from '../src/main/uniwork-docs/errors'
import type {
  EditLockState,
  EditLockTenure,
  UniworkEditLockClient,
} from '../src/main/uniwork-edit-lock/client'
import {
  EditLockSession,
  type EditLockSessionView,
  type EditLockTransport,
} from '../src/main/uniwork-edit-lock/session'
import * as docsPolicyMod from '../../docs/src/main/uniwork-policy'
import * as sheetsPolicyMod from '../../sheets/src/main/uniwork-policy'
import * as slidesPolicyMod from '../../slides/src/main/uniwork-policy'
import * as pdfPolicyMod from '../../pdf/src/main/uniwork-policy'
import * as markdownPolicyMod from '../../markdown/src/main/uniwork-policy'
import * as htmlPolicyMod from '../../html/src/main/uniwork-policy'
const setters = vi.hoisted(() => {
  const policies: unknown[] = []
  const hooks: unknown[] = []
  const recordingMain = () => ({
    setUniworkDocumentPolicy: (policy: unknown) => void policies.push(policy),
  })
  return { policies, hooks, recordingMain }
})

vi.mock('../../docs/src/main/docs-main', () => ({
  ...setters.recordingMain(),
  setDocsUserSaveHook: (hook: unknown) => void setters.hooks.push(hook),
}))
vi.mock('../../sheets/src/main/sheets-main', () => ({
  ...setters.recordingMain(),
  setSheetsUserSaveHook: (hook: unknown) => void setters.hooks.push(hook),
}))
vi.mock('../../slides/src/main/slides-main', () => ({
  ...setters.recordingMain(),
  setSlidesUserSaveHook: (hook: unknown) => void setters.hooks.push(hook),
}))
vi.mock('../../pdf/src/main/pdf-main', () => ({
  ...setters.recordingMain(),
  setPdfUserSaveHook: (hook: unknown) => void setters.hooks.push(hook),
}))
vi.mock('../../markdown/src/main/markdown-main', () => ({
  ...setters.recordingMain(),
  setMarkdownUserSaveHook: (hook: unknown) => void setters.hooks.push(hook),
}))
vi.mock('../../html/src/main/html-main', () => ({
  ...setters.recordingMain(),
  setHtmlUserSaveHook: (hook: unknown) => void setters.hooks.push(hook),
}))

import * as modulesMod from '../src/main/uniwork-docs/modules'

/**
 * EL-1(b) fix6 BE (UNI-1645 c):
 * - Item 1 (VEL-2): `UNIWORK_DOC_STATE_CHANGED_CHANNEL` broadcast on lock phase
 *   transitions and access changes; no broadcast storm on heartbeats that change nothing.
 * - Item 2 (VEL-2 / VEL-1): all six module preloads expose `onUniworkStateChanged`
 *   (subscribing to channel 1 with cleanup) and `uniworkReadOnlySave(path?)`, plus
 *   `sheets` preload exposing `uniworkState()`.
 * - Item 3 (VEL-1): module policy `readOnlySave` -> seam `onReadOnlySave` ->
 *   `service.onReadOnlySave(path)`: read-only by lock or view access pushes the
 *   explain popover for that path; editable does nothing; never writes or fires
 *   the user-save hook.
 * - Item 4 (VEL-3): explicit `editHere` whose R2 fails by 500 or network/timeout
 *   keeps the session's previous phase (`other` / `free` / `self_elsewhere` / `lost`)
 *   and makes `service.editHere(path)` resolve `null`; 423/403/404 keep today's
 *   mapping; open / automatic acquire still goes `'unreachable'`.
 */

const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const LOCK = '01J8X4LOCK0N1P2Q3R4S5T6U7V'
const BYTES = new TextEncoder().encode('working copy')
const BYTES_SHA = createHash('sha256').update(BYTES).digest('hex')

const TENURE: EditLockTenure = {
  lockId: LOCK,
  documentId: DOC,
  holderId: 'u1',
  client: 'desktop',
  acquiredAt: '2026-10-15T03:12:00Z',
  expiresAt: '2026-10-15T03:14:00Z',
  heartbeatIntervalMs: 30_000,
  ttlMs: 120_000,
  serverTime: '2026-10-15T03:12:00Z',
}

function makeDetail(myLevel: 'edit' | 'view' = 'edit'): DocumentDetail {
  return {
    id: DOC,
    organizationId: 'org_a',
    workspaceId: 'ws_1',
    title: 'Plan.docx',
    revision: '9',
    currentVersion: 3,
    myLevel,
    archivedAt: null,
    file: {
      filename: 'Plan.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      version: 3,
      versionId: 'ver_3',
      checksumSha256: BYTES_SHA,
      sizeBytes: BYTES.byteLength,
    },
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-el1b-fix6-'))
})
afterEach(() => {
  vi.useRealTimers()
  for (const mod of [
    docsPolicyMod,
    sheetsPolicyMod,
    slidesPolicyMod,
    pdfPolicyMod,
    markdownPolicyMod,
    htmlPolicyMod,
  ]) {
    mod.setUniworkDocumentPolicy(null)
  }
  rmSync(dir, { recursive: true, force: true })
})

function setupService(opts: {
  myLevel?: 'edit' | 'view'
  getState?: UniworkEditLockClient['getState']
  acquire?: UniworkEditLockClient['acquire']
  heartbeat?: UniworkEditLockClient['heartbeat']
  release?: UniworkEditLockClient['release']
}) {
  const statuses: UniworkDocStatus[] = []
  const popovers: UniworkQueuePopoverRequest[] = []
  const docStatePushes: string[] = []
  const uploads: number[] = []
  const commits: number[] = []
  const ui: ConflictUi = {
    chooseConflict: vi.fn(async () => 'later'),
    confirmDiscard: vi.fn(async () => false),
    pickCopyPath: vi.fn(async () => null),
    showOpenLatestFailed: vi.fn(),
    showCopyFailed: vi.fn(),
    chooseUnsavedClose: vi.fn(async () => 'cancel'),
  }
  const editLockClient: UniworkEditLockClient = {
    async getState(docId) {
      if (opts.getState) return opts.getState(docId)
      return { lock: null, serverTime: 't' }
    },
    async acquire(input) {
      if (opts.acquire) return opts.acquire(input)
      return TENURE
    },
    async heartbeat(input) {
      if (opts.heartbeat) return opts.heartbeat(input)
      return { lockId: LOCK, expiresAt: 't', serverTime: 't' }
    },
    async release(input) {
      if (opts.release) await opts.release(input)
    },
  }
  const client = {
    async getDocument() {
      return makeDetail(opts.myLevel ?? 'edit')
    },
    async download() {
      return { bytes: BYTES }
    },
    async upload() {
      uploads.push(1)
      return { uploadId: 'up_1', checksumSha256: BYTES_SHA, sizeBytes: BYTES.byteLength }
    },
    async commit() {
      commits.push(1)
      return {
        documentId: DOC,
        revision: '10',
        versionId: 'ver_4',
        version: 4,
        checksumSha256: BYTES_SHA,
      }
    },
    async createFile() {
      return { id: DOC, workspaceId: 'ws_1', title: 'Plan.docx' }
    },
    async listWorkspaces() {
      return [{ id: 'ws_1', name: 'Team', orgId: 'org_a', slug: 'team', orgSlug: 'acme' }]
    },
  }
  // client stub implements the subset of UniworkDocsClient used by openDocument / editLock
  const typedClient = client as unknown as UniworkDocsClient
  const deps = {
    userDataDir: dir,
    appVersion: () => '0.11.0',
    profile: () => ({
      deploymentId: 'default',
      apiOrigin: 'https://uniwork.example',
      clientId: 'uniwork-office',
      channel: 'stable' as const,
    }),
    channel: () => 'stable' as const,
    applyProfile: async () => 'unchanged' as const,
    identity: () => ({ accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }),
    selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
    authorized: <T>(call: (token: string) => Promise<T>) => call('tok'),
    openPath: () => true,
    isPathOpen: () => true,
    requestModuleSave: () => false,
    reloadPath: () => undefined,
    activePath: () => undefined,
    client: typedClient,
    editLockClient,
    ui,
    pushStatus: (status: UniworkDocStatus) => statuses.push(status),
    pushQueuePopover: (req: UniworkQueuePopoverRequest) => popovers.push(req),
    pushDocStateChanged: (path: string) => docStatePushes.push(path),
    pushSignOutProgress: () => undefined,
    pushConflict: () => undefined,
    pushConflictClosed: () => undefined,
    pushLaunch: () => undefined,
    pushLock: () => undefined,
    reveal: () => undefined,
    sleep: async () => undefined,
  }
  const service = new UniworkDocsService(deps)
  return { service, statuses, popovers, docStatePushes, uploads, commits }
}

describe('Item 1 (VEL-2): UNIWORK_DOC_STATE_CHANGED_CHANNEL and doc-state broadcast', () => {
  const repo = join(__dirname, '..', '..', '..')

  it('exports UNIWORK_DOC_STATE_CHANGED_CHANNEL from modules.ts and wires broadcast in wiring.ts + index.ts', () => {
    const channelExport =
      'UNIWORK_DOC_STATE_CHANGED_CHANNEL' in modulesMod
        ? modulesMod.UNIWORK_DOC_STATE_CHANGED_CHANNEL
        : undefined
    expect(channelExport).toBe('uniwork:doc-state-changed')
    expect(
      readFileSync(join(repo, 'apps/shell/src/main/uniwork-docs/wiring.ts'), 'utf8'),
    ).toContain('pushDocStateChanged')
    expect(readFileSync(join(repo, 'apps/shell/src/main/index.ts'), 'utf8')).toContain(
      'wc.send(UNIWORK_DOC_STATE_CHANGED_CHANNEL, { path })',
    )
  })

  it('broadcasts { path } on phase transitions held -> lost, other -> free -> held (editHere), and release; no broadcast storm on heartbeats that change nothing', async () => {
    vi.useFakeTimers()
    let phaseMode: 'grant' | 'other' | 'free' = 'grant'
    let beatLost = false
    let heartbeatCalls = 0
    const ctx = setupService({
      getState: async () => ({
        lock:
          phaseMode === 'free'
            ? null
            : {
                holderName: 'Lân',
                client: 'web',
                since: '2026-10-15T03:12:00Z',
                expiresAt: '2026-10-15T03:14:00Z',
                heldByMe: false,
                offlineHoldUntil: null,
              },
        serverTime: 't',
      }),
      acquire: async () => {
        if (phaseMode === 'other') {
          throw new UniworkDocError('edit_locked', {
            status: 423,
            serverCode: 'document_locked',
            editLock: {
              holderName: 'Lân',
              since: '2026-10-15T03:12:00Z',
              expiresAt: '2026-10-15T03:14:00Z',
              heldByMe: false,
            },
          })
        }
        return TENURE
      },
      heartbeat: async () => {
        heartbeatCalls += 1
        if (beatLost) {
          throw new UniworkDocError('server_error', {
            status: 409,
            serverCode: 'edit_lock_lost',
            lostReason: 'taken_over',
            byName: 'Bình',
          })
        }
        return { lockId: LOCK, expiresAt: 't', serverTime: 't' }
      },
    })

    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    const path = opened.value.path
    await vi.advanceTimersByTimeAsync(10)
    expect(ctx.statuses.at(-1)?.lockSession?.phase).toBe('held')
    expect(ctx.docStatePushes).toContain(path)

    // Let several 30 s heartbeats succeed that change nothing -> zero extra broadcasts
    const countAfterHeld = ctx.docStatePushes.length
    const beatsBefore = heartbeatCalls
    await vi.advanceTimersByTimeAsync(90_000)
    expect(heartbeatCalls).toBeGreaterThan(beatsBefore)
    expect(ctx.docStatePushes.length).toBe(countAfterHeld)

    // Heartbeat loses lock (held -> lost) -> broadcasts with path
    beatLost = true
    await vi.advanceTimersByTimeAsync(30_000)
    expect(ctx.statuses.at(-1)?.lockSession?.phase).toBe('lost')
    expect(ctx.docStatePushes.length).toBeGreaterThan(countAfterHeld)
    expect(ctx.docStatePushes.at(-1)).toBe(path)

    // Drop and re-open into 'other' -> 'free' -> 'held' (editHere) -> 'release'
    await ctx.service.notePathsDropped([path])
    const afterRelease = ctx.docStatePushes.length

    beatLost = false
    phaseMode = 'other'
    const reopened = await ctx.service.openDocument(DOC)
    if (!reopened.ok) throw new Error(reopened.error)
    await vi.advanceTimersByTimeAsync(10)
    expect(ctx.statuses.at(-1)?.lockSession?.phase).toBe('other')
    expect(ctx.docStatePushes.length).toBeGreaterThan(afterRelease)

    // Poll transitions 'other' -> 'free' -> broadcasts with path
    const beforeFree = ctx.docStatePushes.length
    phaseMode = 'free'
    await vi.advanceTimersByTimeAsync(30_000)
    expect(ctx.statuses.at(-1)?.lockSession?.phase).toBe('free')
    expect(ctx.docStatePushes.length).toBeGreaterThan(beforeFree)

    // EditHere into held (free -> held) -> broadcasts with path
    const beforeEditHere = ctx.docStatePushes.length
    phaseMode = 'grant'
    const edited = await ctx.service.editHere(path)
    expect(edited?.lockSession?.phase).toBe('held')
    expect(ctx.docStatePushes.length).toBeGreaterThan(beforeEditHere)
    expect(ctx.docStatePushes.at(-1)).toBe(path)

    // Release on drop -> broadcasts with path
    const beforeDrop = ctx.docStatePushes.length
    await ctx.service.notePathsDropped([path])
    expect(ctx.docStatePushes.length).toBeGreaterThan(beforeDrop)
    expect(ctx.docStatePushes.at(-1)).toBe(path)
  })
})

describe('Item 2 (VEL-2 / VEL-1): six module preloads + shared typings', () => {
  const repo = join(__dirname, '..', '..', '..')

  it.each([
    ['docs', 'apps/docs/src/preload/index.ts', 'apps/docs/src/shared/ipc.ts'],
    ['sheets', 'apps/sheets/src/preload/index.ts', 'apps/sheets/src/shared/desktop-api.ts'],
    ['slides', 'apps/slides/src/preload/index.ts', 'apps/slides/src/shared/ipc.ts'],
    ['pdf', 'apps/pdf/src/preload/index.ts', 'apps/pdf/src/shared/ipc.ts'],
    ['html', 'apps/html/src/preload/index.ts', 'apps/html/src/shared/ipc.ts'],
    ['markdown', 'apps/markdown/src/preload/index.ts', 'apps/markdown/src/shared/ipc.ts'],
  ])(
    '%s preload subscribes to uniwork:doc-state-changed with removeListener cleanup and exposes uniworkReadOnlySave + shared typing',
    (mod, preloadRel, typingRel) => {
      const preload = readFileSync(join(repo, preloadRel), 'utf8')
      const typing = readFileSync(join(repo, typingRel), 'utf8')
      expect(preload).toContain('onUniworkStateChanged')
      expect(preload).toContain('uniwork:doc-state-changed')
      expect(preload).toContain('removeListener')
      expect(preload).toContain('uniworkReadOnlySave')
      expect(typing).toContain('onUniworkStateChanged')
      expect(typing).toContain('uniworkReadOnlySave')
      if (mod === 'sheets') {
        expect(preload).toContain('uniworkState')
        expect(typing).toContain('uniworkState')
      }
    },
  )
})

describe('Item 3 (VEL-1): module readOnlySave -> seam onReadOnlySave -> service explain popover', () => {
  const POLICY_MODULES = [
    ['docs', docsPolicyMod],
    ['sheets', sheetsPolicyMod],
    ['slides', slidesPolicyMod],
    ['pdf', pdfPolicyMod],
    ['markdown', markdownPolicyMod],
    ['html', htmlPolicyMod],
  ] as const

  it.each(POLICY_MODULES)(
    '%s policy helper forwards readOnlySave(path) and swallows missing/throwing policy',
    (_name, mod) => {
      const seen: string[] = []
      const readOnlySave =
        'uniworkReadOnlySave' in mod && typeof mod.uniworkReadOnlySave === 'function'
          ? mod.uniworkReadOnlySave
          : undefined
      expect(typeof readOnlySave).toBe('function')
      if (!readOnlySave) return

      mod.setUniworkDocumentPolicy(null)
      expect(() => readOnlySave('C:/doc')).not.toThrow()
      expect(() => readOnlySave(null)).not.toThrow()
      expect(() => readOnlySave(undefined)).not.toThrow()

      const forwardingPolicy = {
        isBound: () => true,
        isReadOnly: () => true,
        readOnlySave: (p: string) => void seen.push(p),
      }
      mod.setUniworkDocumentPolicy(forwardingPolicy)
      readOnlySave('C:/doc')
      expect(seen).toEqual(['C:/doc'])

      const throwingPolicy = {
        isBound: () => true,
        isReadOnly: () => true,
        readOnlySave: () => {
          throw new Error('boom')
        },
      }
      mod.setUniworkDocumentPolicy(throwingPolicy)
      expect(() => readOnlySave('C:/doc')).not.toThrow()
    },
  )

  it('installUniworkModuleSeams wires onReadOnlySave across all six module policies', () => {
    setters.policies.length = 0
    const seen: string[] = []
    const seamWithReadOnlySave = {
      isBound: () => true,
      isReadOnly: () => true,
      onUserSave: () => undefined,
      refuseLockedPath: () => false,
      onReadOnlySave: (path: string) => void seen.push(path),
    }
    modulesMod.installUniworkModuleSeams(seamWithReadOnlySave)
    expect(setters.policies).toHaveLength(6)
    const names = ['docs', 'sheets', 'slides', 'pdf', 'markdown', 'html']
    for (let i = 0; i < setters.policies.length; i += 1) {
      const policy = setters.policies[i]
      if (
        policy &&
        typeof policy === 'object' &&
        'readOnlySave' in policy &&
        typeof policy.readOnlySave === 'function'
      ) {
        policy.readOnlySave(`C:/${names[i]}`)
      }
    }
    expect(seen).toEqual(['C:/docs', 'C:/sheets', 'C:/slides', 'C:/pdf', 'C:/markdown', 'C:/html'])
  })

  const repo = join(__dirname, '..', '..', '..')
  it.each([
    ['docs', 'apps/docs/src/main/docs-main.ts', 'docs:uniwork-read-only-save', 'canDocWrite'],
    ['sheets', 'apps/sheets/src/main/sheets-main.ts', 'uniworkReadOnlySave', 'sessionDocumentPath'],
    [
      'slides',
      'apps/slides/src/main/slides-main.ts',
      'slides:uniwork-read-only-save',
      'sessions.get',
    ],
    ['pdf', 'apps/pdf/src/main/pdf-main.ts', 'uniworkReadOnlySave', 'allowedByWc'],
    ['html', 'apps/html/src/main/html-main.ts', 'uniworkReadOnlySave', 'savePathByWc'],
    ['markdown', 'apps/markdown/src/main/markdown-main.ts', 'uniworkReadOnlySave', 'savePathByWc'],
  ])(
    '%s main registers read-only-save handler with sender guard',
    (_mod, mainRel, needle, guard) => {
      const src = readFileSync(join(repo, mainRel), 'utf8')
      expect(src).toContain(needle)
      expect(src).toContain(guard)
      expect(src).toContain('uniworkReadOnlySave(')
    },
  )

  it('service.onReadOnlySave: read-only by lock -> pushes explain popover; never writes or fires user-save', async () => {
    vi.useFakeTimers()
    const ctx = setupService({
      acquire: async () => {
        throw new UniworkDocError('edit_locked', {
          status: 423,
          serverCode: 'document_locked',
          editLock: {
            holderName: 'Lân',
            since: '2026-10-15T03:12:00Z',
            expiresAt: '2026-10-15T03:14:00Z',
            heldByMe: false,
          },
        })
      },
    })
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    const path = opened.value.path
    await vi.advanceTimersByTimeAsync(10)
    expect(ctx.service.isReadOnly(path)).toBe(true)

    expect(
      'onReadOnlySave' in ctx.service && typeof ctx.service.onReadOnlySave === 'function',
    ).toBe(true)
    if ('onReadOnlySave' in ctx.service && typeof ctx.service.onReadOnlySave === 'function') {
      ctx.service.onReadOnlySave(path)
    }
    expect(ctx.popovers).toEqual([{ path }])
    expect(ctx.uploads).toHaveLength(0)
    expect(ctx.commits).toHaveLength(0)
  })

  it('service.onReadOnlySave: view access -> pushes explain popover; never writes or fires user-save', async () => {
    vi.useFakeTimers()
    const ctx = setupService({ myLevel: 'view' })
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    const path = opened.value.path
    await vi.advanceTimersByTimeAsync(10)
    expect(ctx.service.isReadOnly(path)).toBe(true)

    expect(
      'onReadOnlySave' in ctx.service && typeof ctx.service.onReadOnlySave === 'function',
    ).toBe(true)
    if ('onReadOnlySave' in ctx.service && typeof ctx.service.onReadOnlySave === 'function') {
      ctx.service.onReadOnlySave(path)
    }
    expect(ctx.popovers).toEqual([{ path }])
    expect(ctx.uploads).toHaveLength(0)
    expect(ctx.commits).toHaveLength(0)
  })

  it('service.onReadOnlySave: not read-only (editable) -> does nothing; never writes or fires user-save', async () => {
    vi.useFakeTimers()
    const ctx = setupService({ myLevel: 'edit' })
    const opened = await ctx.service.openDocument(DOC)
    if (!opened.ok) throw new Error(opened.error)
    const path = opened.value.path
    await vi.advanceTimersByTimeAsync(10)
    expect(ctx.service.isReadOnly(path)).toBe(false)

    expect(
      'onReadOnlySave' in ctx.service && typeof ctx.service.onReadOnlySave === 'function',
    ).toBe(true)
    if ('onReadOnlySave' in ctx.service && typeof ctx.service.onReadOnlySave === 'function') {
      ctx.service.onReadOnlySave(path)
    }
    expect(ctx.popovers).toEqual([])
    expect(ctx.uploads).toHaveLength(0)
    expect(ctx.commits).toHaveLength(0)
  })
})

describe('Item 4 (VEL-3): explicit editHere failure keeps previous phase and resolves null', () => {
  function makeSessionHarness(opts: {
    getState?: () => Promise<EditLockState>
    acquire?: (input: {
      documentId: string
      editorId: string
      moveFromSelf?: boolean
    }) => Promise<EditLockTenure>
    heartbeat?: () => Promise<{ lockId: string; expiresAt: string; serverTime: string }>
  }) {
    const views: EditLockSessionView[] = []
    const transport: EditLockTransport = {
      getState: async () =>
        opts.getState
          ? opts.getState()
          : {
              lock: null,
              serverTime: 't',
            },
      acquire: async (input) => (opts.acquire ? opts.acquire(input) : TENURE),
      heartbeat: async () =>
        opts.heartbeat ? opts.heartbeat() : { lockId: LOCK, expiresAt: 't', serverTime: 't' },
      release: async () => undefined,
    }
    const session = new EditLockSession({
      documentId: DOC,
      editorId: 'ed_1',
      transport,
      sleep: async () => undefined,
      onChange: (v) => views.push(v),
    })
    return { session, views }
  }

  it.each([
    ['500 server_error', () => new UniworkDocError('server_error', { status: 500, retried: true })],
    ['network / timeout', () => new UniworkDocError('network', { retried: true })],
  ])(
    'session.editHere on %s from other, free, self_elsewhere, and lost keeps the previous phase (never unreachable)',
    async (_label, makeErr) => {
      vi.useFakeTimers()
      // 1) from 'other'
      let mode: 'other' | 'self' | 'grant' | 'fail' = 'other'
      let stateFree = false
      const h1 = makeSessionHarness({
        getState: async () => ({
          lock: stateFree
            ? null
            : {
                holderName: 'Charles Babbage',
                client: 'web',
                since: '2026-10-15T03:12:00Z',
                expiresAt: '2026-10-15T03:14:00Z',
                heldByMe: false,
                offlineHoldUntil: null,
              },
          serverTime: 't',
        }),
        acquire: async () => {
          if (mode === 'other') {
            throw new UniworkDocError('edit_locked', {
              status: 423,
              serverCode: 'document_locked',
              editLock: {
                holderName: 'Charles Babbage',
                since: '2026-10-15T03:12:00Z',
                expiresAt: '2026-10-15T03:14:00Z',
                heldByMe: false,
              },
            })
          }
          if (mode === 'self') {
            throw new UniworkDocError('edit_locked', {
              status: 423,
              serverCode: 'document_locked',
              editLock: {
                holderName: 'Me',
                since: '2026-10-15T03:12:00Z',
                expiresAt: '2026-10-15T03:14:00Z',
                heldByMe: true,
              },
            })
          }
          if (mode === 'fail') throw makeErr()
          return TENURE
        },
        heartbeat: async () => {
          throw new UniworkDocError('server_error', {
            status: 409,
            serverCode: 'edit_lock_lost',
            lostReason: 'taken_over',
            byName: 'Ada',
          })
        },
      })

      await h1.session.acquire()
      expect(h1.session.view().phase).toBe('other')
      mode = 'fail'
      await h1.session.editHere()
      expect(h1.session.view()).toMatchObject({
        phase: 'other',
        holderName: 'Charles Babbage',
        since: '2026-10-15T03:12:00Z',
      })

      // 2) from 'free' (30 s poll sees lock released -> phase 'free', then editHere fails)
      stateFree = true
      await vi.advanceTimersByTimeAsync(30_000)
      expect(h1.session.view().phase).toBe('free')
      await h1.session.editHere()
      expect(h1.session.view().phase).toBe('free')
      h1.session.dispose()

      // 3) from 'self_elsewhere'
      mode = 'self'
      const h2 = makeSessionHarness({
        acquire: async () => {
          if (mode === 'self') {
            throw new UniworkDocError('edit_locked', {
              status: 423,
              serverCode: 'document_locked',
              editLock: {
                holderName: 'Me',
                since: '2026-10-15T03:12:00Z',
                expiresAt: '2026-10-15T03:14:00Z',
                heldByMe: true,
              },
            })
          }
          throw makeErr()
        },
      })
      await h2.session.acquire()
      expect(h2.session.view().phase).toBe('self_elsewhere')
      mode = 'fail'
      await h2.session.editHere()
      expect(h2.session.view()).toMatchObject({
        phase: 'self_elsewhere',
        holderName: 'Me',
      })
      h2.session.dispose()

      // 4) from 'lost' (30 s heartbeat returns 409 -> phase 'lost', then editHere fails)
      let failAcquire = false
      const h3 = makeSessionHarness({
        acquire: async () => {
          if (failAcquire) throw makeErr()
          return TENURE
        },
        heartbeat: async () => {
          throw new UniworkDocError('server_error', {
            status: 409,
            serverCode: 'edit_lock_lost',
            lostReason: 'taken_over',
            byName: 'Ada',
          })
        },
      })
      await h3.session.acquire()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(h3.session.view()).toMatchObject({
        phase: 'lost',
        lostReason: 'taken_over',
        byName: 'Ada',
      })
      failAcquire = true
      await h3.session.editHere()
      expect(h3.session.view()).toMatchObject({
        phase: 'lost',
        lostReason: 'taken_over',
        byName: 'Ada',
      })
      h3.session.dispose()
    },
  )

  it('open / automatic acquire on 500 or network failure still goes unreachable; service.editHere resolves null on 500/network and keeps 423/403 mapping', async () => {
    vi.useFakeTimers()
    // Open path -> 500 -> 'unreachable'
    const openFail = setupService({
      acquire: async () => {
        throw new UniworkDocError('server_error', { status: 500, retried: true })
      },
    })
    const opened1 = await openFail.service.openDocument(DOC)
    if (!opened1.ok) throw new Error(opened1.error)
    await vi.advanceTimersByTimeAsync(10)
    expect(openFail.statuses.at(-1)?.lockSession?.phase).toBe('unreachable')

    // Service editHere from 'other': 500 -> null + phase stays 'other'; 423 -> non-null status
    let mode: 'other1' | '500' | 'net' | 'other2' | 'grant' = 'other1'
    const ctx = setupService({
      acquire: async () => {
        if (mode === 'other1' || mode === 'other2') {
          throw new UniworkDocError('edit_locked', {
            status: 423,
            serverCode: 'document_locked',
            editLock: {
              holderName: mode === 'other1' ? 'Charles Babbage' : 'Grace Hopper',
              since: '2026-10-15T03:12:00Z',
              expiresAt: '2026-10-15T03:14:00Z',
              heldByMe: false,
            },
          })
        }
        if (mode === '500') {
          throw new UniworkDocError('server_error', { status: 500, retried: true })
        }
        if (mode === 'net') {
          throw new UniworkDocError('network', { retried: true })
        }
        return TENURE
      },
    })

    const opened2 = await ctx.service.openDocument(DOC)
    if (!opened2.ok) throw new Error(opened2.error)
    const path = opened2.value.path
    await vi.advanceTimersByTimeAsync(10)
    expect(ctx.statuses.at(-1)?.lockSession?.phase).toBe('other')

    mode = '500'
    expect(await ctx.service.editHere(path)).toBeNull()
    expect(ctx.statuses.at(-1)?.lockSession?.phase).toBe('other')
    expect(ctx.statuses.at(-1)?.lockSession?.holderName).toBe('Charles Babbage')

    mode = 'net'
    expect(await ctx.service.editHere(path)).toBeNull()
    expect(ctx.statuses.at(-1)?.lockSession?.phase).toBe('other')

    // 423 keeps today's mapping (resolves updated status with new holder)
    mode = 'other2'
    const lockedAgain = await ctx.service.editHere(path)
    expect(lockedAgain?.lockSession?.phase).toBe('other')
    expect(lockedAgain?.lockSession?.holderName).toBe('Grace Hopper')

    // Grant succeeds
    mode = 'grant'
    const granted = await ctx.service.editHere(path)
    expect(granted?.lockSession?.phase).toBe('held')
  })
})
