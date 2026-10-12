import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UniworkDocLock, UniworkDocStatus, UniworkLaunchEvent } from '../src/shared/home-api'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import { BINDING_FILE, INTENT_PAYLOAD_FILE } from '../src/main/uniwork-docs/binding-store'

/**
 * G5-04g (AC-1, AC-2): a working copy whose folder holds a binding.json with an
 * integer schema >= 2 belongs to a store this build does not read. Opening it
 * (any route) must not open a module, must record + push the S11 lock, and must
 * not create an intent, write the folder or touch the network for that
 * document. `min_app_version` is never compared (OQ-P4).
 */

const TOKEN = 'secret-access-token-0123456789'
const ORIGIN = 'https://uniwork.example'
const profile: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: ORIGIN,
  clientId: 'uniwork-office',
  channel: 'stable',
}
const DOC = '01J8X4DOC0N1P2Q3R4S5T6U7'
const enc = (text: string) => new TextEncoder().encode(text)
const hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** one call the fake server saw; the guard must keep this empty for its document */
const calls: Array<{ path: string }> = []

function fakeFetch(url: string): Promise<Response> {
  calls.push({ path: new URL(url).pathname })
  return Promise.resolve(
    new Response(
      JSON.stringify({
        document: {
          id: DOC,
          organization_id: 'org_a',
          workspace_id: 'ws_1',
          title: 'Plan.docx',
          kind: 'file',
          revision: '41',
          current_version: 3,
          my_level: 'edit',
          file: {
            filename: 'Plan.docx',
            mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            version: 3,
            checksum_sha256: hex(enc('server bytes')),
            size_bytes: 12,
          },
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  )
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-lock-guard-'))
  calls.length = 0
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** the working-copy folder the service uses for the live account + document */
const docDir = () => join(dir, 'uniwork-documents', 'default', 'acc_1', DOC)
const docPath = () => join(docDir(), 'Plan.docx')

/** a working copy + binding.json in the folder the service will read */
function seedFolder(binding: unknown): void {
  mkdirSync(docDir(), { recursive: true })
  writeFileSync(docPath(), 'working copy bytes')
  writeFileSync(join(docDir(), BINDING_FILE), JSON.stringify(binding, null, 2))
}

function setup() {
  const statuses: UniworkDocStatus[] = []
  const launches: UniworkLaunchEvent[] = []
  const locks: UniworkDocLock[] = []
  const ui: ConflictUi = {
    chooseConflict: vi.fn(async () => 'later'),
    confirmDiscard: vi.fn(async () => false),
    pickCopyPath: vi.fn(async () => null),
    showOpenLatestFailed: vi.fn(),
    showCopyFailed: vi.fn(),
    chooseUnsavedClose: vi.fn(async () => 'cancel'),
  }
  const deps = {
    userDataDir: dir,
    profile: () => profile,
    identity: () => ({ accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' }),
    selectedOrgId: () => 'org_a',
    authorized: <T>(call: (token: string) => Promise<T>) => call(TOKEN),
    fetch: fakeFetch as never,
    openPath: vi.fn(() => true),
    isPathOpen: vi.fn(() => false),
    requestModuleSave: vi.fn(() => false),
    reloadPath: vi.fn(),
    activePath: () => undefined,
    ui,
    pushStatus: (s: UniworkDocStatus) => statuses.push(s),
    pushLaunch: (e: UniworkLaunchEvent) => launches.push(e),
    pushLock: (lock: UniworkDocLock) => locks.push(lock),
    reveal: vi.fn(),
    sleep: async () => undefined,
  }
  const service = new UniworkDocsService(deps)
  return { service, ui, statuses, locks, deps }
}

const bytesOf = (path: string) => readFileSync(path, 'utf8')
const bindingText = () => readFileSync(join(docDir(), BINDING_FILE), 'utf8')
const folderFiles = () => readdirSync(docDir()).sort()

/** the four min_app_version shapes of AC-1 plus a schema-3 store */
const NEWER: Array<[string, unknown]> = [
  ['schema 2, min_app_version lower', { schema: 2, min_app_version: '0.0.1' }],
  ['schema 2, min_app_version higher', { schema: 2, min_app_version: '99.0.0' }],
  ['schema 2, no min_app_version', { schema: 2 }],
  ['schema 2, malformed min_app_version', { schema: 2, min_app_version: { nested: true } }],
  ['schema 3', { schema: 3, min_app_version: '0.1.0' }],
]

describe('a newer store is refused before anything opens (AC-1)', () => {
  it.each(NEWER)(
    '%s: lock pushed, nothing opened, folder untouched, no request',
    (_name, binding) => {
      seedFolder(binding)
      const ctx = setup()
      const before = { binding: bindingText(), copy: bytesOf(docPath()) }

      expect(ctx.service.refuseLockedPath(docPath())).toBe(true)

      expect(ctx.locks).toEqual([{ path: docPath(), reason: 'store_newer', name: 'Plan.docx' }])
      expect(ctx.service.currentLocks()).toEqual(ctx.locks)
      expect(ctx.service.isBound(docPath())).toBe(true)
      expect(ctx.service.isReadOnly(docPath())).toBe(true)
      // never a plain local file in recents: a working copy of ours is enriched,
      // and one whose binding cannot be read stays hidden (as it does today)
      expect(ctx.service.recentSource(docPath())).toBe('hidden')
      expect(calls).toEqual([])
      // not one byte of the folder changed, and no intent was created
      expect(bindingText()).toBe(before.binding)
      expect(bytesOf(docPath())).toBe(before.copy)
      expect(folderFiles()).toEqual(['Plan.docx', BINDING_FILE])
    },
  )

  it('the open route calls no module and pushes the lock again only on a new refusal', () => {
    seedFolder({ schema: 2 })
    const ctx = setup()
    expect(ctx.service.refuseLockedPath(docPath())).toBe(true)
    expect(ctx.locks).toHaveLength(1)
    // the same path again: one entry, but the renderer is told again (a reload may have lost it)
    expect(ctx.service.refuseLockedPath(docPath())).toBe(true)
    expect(ctx.service.currentLocks()).toHaveLength(1)
    expect(ctx.locks).toHaveLength(2)
    // a path that is not a working copy is not ours to refuse
    expect(ctx.service.refuseLockedPath(join(dir, 'plain.docx'))).toBe(false)
    expect(ctx.service.refuseLockedPath(join(tmpdir(), 'elsewhere.docx'))).toBe(false)
  })

  it('dismissLock forgets the lock (Close on the S11 panel); nothing else changes', () => {
    seedFolder({ schema: 2 })
    const ctx = setup()
    expect(ctx.service.refuseLockedPath(docPath())).toBe(true)
    ctx.service.dismissLock(docPath().toUpperCase())
    expect(ctx.service.currentLocks()).toEqual([])
    expect(ctx.service.isLockedPath(docPath())).toBe(false)
    // the folder is still there, untouched: only the panel went away
    expect(folderFiles()).toEqual(['Plan.docx', BINDING_FILE])
  })

  it('schema 1 stays a plain bound document, and garbage stays unbound (regression)', () => {
    seedFolder({
      schema: 1,
      documentId: DOC,
      workspaceId: 'ws_1',
      orgId: 'org_a',
      title: 'Plan.docx',
      filename: 'Plan.docx',
      format: 'docx',
      access: 'edit',
      baseRevision: '41',
      baseVersion: 3,
      baseChecksum: hex(enc('working copy bytes')),
      state: 'ready',
    })
    const ctx = setup()
    expect(ctx.service.refuseLockedPath(docPath())).toBe(false)
    expect(ctx.locks).toEqual([])
    expect(ctx.service.isBound(docPath())).toBe(true)
    expect(ctx.service.isReadOnly(docPath())).toBe(false)
    expect(ctx.service.recentSource(docPath())).toMatchObject({ documentId: DOC })

    rmSync(docDir(), { recursive: true, force: true })
    seedFolder({ schema: 'x' })
    const other = setup()
    expect(other.service.refuseLockedPath(docPath())).toBe(false)
    expect(other.service.isBound(docPath())).toBe(false)
    expect(other.locks).toEqual([])
  })
})

describe('no intent, no module save, no client call for a locked path (AC-2)', () => {
  function locked() {
    seedFolder({ schema: 2, min_app_version: '99.0.0' })
    const ctx = setup()
    expect(ctx.service.refuseLockedPath(docPath())).toBe(true)
    return ctx
  }

  it('save, the chip Retry and a user Save write nothing and send nothing', async () => {
    const ctx = locked()
    const before = { binding: bindingText(), copy: bytesOf(docPath()) }
    expect(await ctx.service.save(docPath())).toBeNull()
    ctx.service.onUserSave(docPath())
    await ctx.service.coordinator.settled(docPath())
    expect(await ctx.service.coordinator.save(docPath())).toBeNull()
    expect(calls).toEqual([])
    expect(bindingText()).toBe(before.binding)
    expect(bytesOf(docPath())).toBe(before.copy)
    // no intent file, no payload, no state file: only the two files we seeded
    expect(folderFiles()).toEqual(['Plan.docx', BINDING_FILE])
    expect(folderFiles()).not.toContain(INTENT_PAYLOAD_FILE)
    expect(ctx.deps.requestModuleSave).not.toHaveBeenCalled()
  })

  it('status, close, conflict and refresh answer without a dialog, a write or a request', async () => {
    const ctx = locked()
    expect(await ctx.service.docStatus(docPath())).toBeNull()
    expect(await ctx.service.activeDocStatus()).toBeNull()
    await expect(ctx.service.refreshPath(docPath())).resolves.toBeUndefined()
    expect(ctx.service.isCloseGuarded(docPath())).toBe(false)
    expect(ctx.service.needsClosePrompt(docPath())).toBe(false)
    expect(await ctx.service.confirmClose(docPath())).toBe(true)
    expect(await ctx.service.resolveConflict(docPath())).toBeNull()
    ctx.service.noteEditorDirty(docPath(), true)
    ctx.service.noteActivePath(docPath())
    expect(ctx.ui.chooseConflict).not.toHaveBeenCalled()
    expect(ctx.ui.chooseUnsavedClose).not.toHaveBeenCalled()
    expect(ctx.statuses).toEqual([])
    expect(calls).toEqual([])
  })

  it('opening the document from UniWork refuses it before the first request', async () => {
    const ctx = locked()
    calls.length = 0
    await expect(ctx.service.openFromServer(DOC)).rejects.toMatchObject({
      code: 'engine_incompatible',
    })
    // zero requests for that document: no metadata read, no download
    expect(calls).toEqual([])
    expect(ctx.locks.at(-1)).toEqual({
      path: docPath(),
      reason: 'store_newer',
      name: 'Plan.docx',
    })
    expect(folderFiles()).toEqual(['Plan.docx', BINDING_FILE])
  })

  it('a launch ticket for such a document also opens nothing and sends nothing', async () => {
    const ctx = locked()
    calls.length = 0
    await expect(
      ctx.service.openFromServer(DOC, {
        receiptId: 'r',
        redeemedAt: '2026-10-12T10:00:00Z',
        id: DOC,
        organizationId: 'org_a',
        workspaceId: 'ws_1',
        title: 'Plan.docx',
        operation: 'edit',
        version: 0,
        revision: '41',
        downloadPath: `/api/v1/documents/${DOC}/download`,
      }),
    ).rejects.toMatchObject({ code: 'engine_incompatible' })
    expect(calls).toEqual([])
    expect(bytesOf(docPath())).toBe('working copy bytes')
  })
})
