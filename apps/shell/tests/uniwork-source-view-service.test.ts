/**
 * UNI-1993 (UW-SOURCE-RO) slice C1: the service owns the registry and the
 * opener and only delegates. The real service runs over a fake HTTP server;
 * what must hold is that a source open reaches the download route and the shell's
 * open router, and never touches a binding, the store or the save queue.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAFT_PREVIEW_DIR } from '@genoffice/electron-utils/draft-preview'
import type { DeploymentProfile } from '../src/main/uniwork-auth/deployment'
import { UniworkDocsService, type ConflictUi } from '../src/main/uniwork-docs/service'
import type { FetchLike } from '../src/main/uniwork-docs/client'
import { SOURCE_VIEW_CLOSE_GRACE_MS } from '../src/main/uniwork-docs/source-view'
import type { OpenSourceInput } from '../src/shared/source-view'

const ORIGIN = 'https://uniwork.example'
const profile: DeploymentProfile = {
  deploymentId: 'default',
  apiOrigin: ORIGIN,
  clientId: 'uniwork-office',
  channel: 'stable',
}
const BYTES = new Uint8Array([80, 75, 3, 4, 9, 9])

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'uw-source-view-service-'))
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

const input = (over: Partial<OpenSourceInput> = {}): OpenSourceInput => ({
  workspaceId: 'ws_1',
  sourceId: 'chat:msg-1',
  name: 'Plan.docx',
  extension: 'docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  sizeBytes: BYTES.length,
  updatedAt: '2026-10-20T00:00:00Z',
  origin: 'chat',
  parent: { kind: 'chat', title: 'Launch' },
  ...over,
})

function setup(
  over: {
    identity?: boolean
    startupSweep?: Promise<unknown>
    openTabs?: Set<string>
    openPath?: (path: string) => boolean
  } = {},
) {
  const requests: string[] = []
  const fetch = vi.fn(async (url: string, _init: RequestInit): Promise<Response> => {
    const u = new URL(url)
    requests.push(`${u.pathname}`)
    if (/\/documents\/sources\/[^/]+\/download$/.test(u.pathname)) {
      return new Response(BYTES, { status: 200 })
    }
    return new Response(JSON.stringify({ error: { code: 'not_found' } }), { status: 404 })
  })
  const openTabs = over.openTabs ?? new Set<string>()
  const opened: string[] = []
  const closedNow: string[] = []
  const ui: ConflictUi = {
    chooseConflict: vi.fn(async () => 'later' as const),
    confirmDiscard: vi.fn(async () => false),
    pickCopyPath: vi.fn(async () => null),
    showOpenLatestFailed: vi.fn(),
    showCopyFailed: vi.fn(),
    chooseUnsavedClose: vi.fn(async () => 'cancel' as const),
  }
  const service = new UniworkDocsService({
    userDataDir: dir,
    profile: () => profile,
    channel: () => 'stable',
    applyProfile: async () => 'unchanged',
    identity: () =>
      over.identity === false
        ? null
        : { accountId: 'acc_1', deviceSessionId: 'dev_1', deploymentId: 'default' },
    keystoreLocked: () => false,
    selectedOrg: () => ({ id: 'org_a', slug: 'acme' }),
    authorized: <T>(call: (token: string) => Promise<T>) => call('tok'),
    fetch: fetch as unknown as FetchLike,
    openPath: (path) => {
      opened.push(path)
      const ok = over.openPath ? over.openPath(path) : true
      if (ok) openTabs.add(path)
      return ok
    },
    isPathOpen: (path) => openTabs.has(path),
    closePathNow: (path) => {
      closedNow.push(path)
      openTabs.delete(path)
    },
    requestModuleSave: () => false,
    reloadPath: () => undefined,
    activePath: () => undefined,
    ui,
    pushStatus: () => undefined,
    pushLaunch: () => undefined,
    reveal: () => undefined,
    ...(over.startupSweep ? { sourceViewStartupSweep: over.startupSweep } : {}),
  })
  return { service, requests, opened, closedNow, openTabs, fetch }
}

const previewRoot = () => join(dir, DRAFT_PREVIEW_DIR)

describe('UniworkDocsService.openSource / sourceViewState (thin delegates)', () => {
  it('downloads through the real client route and opens the temp copy through the shell router', async () => {
    const ctx = setup()
    const res = await ctx.service.openSource(input())
    if (!res.ok) throw new Error(res.error)
    expect(ctx.requests).toEqual([
      '/api/v1/workspaces/ws_1/documents/sources/chat%3Amsg-1/download',
    ])
    expect(ctx.opened).toEqual([res.value.path])
    expect(res.value.path.startsWith(join(previewRoot(), 'sources-'))).toBe(true)
    // the service exposes the registry the module seams merge (index.ts passes it)
    expect(ctx.service.sourceViews.has(res.value.path)).toBe(true)
    expect(ctx.service.sourceViewState(res.value.path)).toEqual({
      name: 'Plan.docx',
      origin: 'chat',
      parentTitle: 'Launch',
    })
    expect(ctx.service.sourceViewState(join(dir, 'other.docx'))).toBeNull()
  })

  it('never touches a binding, the working-copy store, the save queue or a document route', async () => {
    const ctx = setup()
    const res = await ctx.service.openSource(input())
    if (!res.ok) throw new Error(res.error)
    // no document/limits request, only the one download
    expect(ctx.fetch).toHaveBeenCalledTimes(1)
    // a view-only source is NOT a UniWork document: no binding, no store entry
    expect(ctx.service.isBound(res.value.path)).toBe(false)
    expect(ctx.service.store.classify(res.value.path).kind).not.toBe('bound')
    expect(existsSync(join(dir, 'uniwork-documents'))).toBe(false)
    expect(ctx.service.store.isInside(res.value.path)).toBe(false)
  })

  it('refuses a row over the max from the limits cache before any request', async () => {
    const ctx = setup()
    const max = ctx.service.limitsCache.peek().max_bytes
    const res = await ctx.service.openSource(input({ sizeBytes: max + 1 }))
    expect(res).toEqual({ ok: false, error: 'too_large' })
    expect(ctx.fetch).not.toHaveBeenCalled()
  })

  it('answers not_signed_in without a session and sends nothing', async () => {
    const ctx = setup({ identity: false })
    expect(await ctx.service.openSource(input())).toEqual({ ok: false, error: 'not_signed_in' })
    expect(ctx.fetch).not.toHaveBeenCalled()
  })

  it('writes nothing before the shared startup sweep settles', async () => {
    let release: () => void = () => undefined
    const sweep = new Promise<void>((resolve) => {
      release = resolve
    })
    const ctx = setup({ startupSweep: sweep })
    const pending = ctx.service.openSource(input())
    await vi.waitFor(() => expect(ctx.fetch).toHaveBeenCalledTimes(1))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(ctx.opened).toEqual([])
    expect(existsSync(previewRoot())).toBe(false)
    release()
    expect((await pending).ok).toBe(true)
    expect(ctx.opened).toHaveLength(1)
  })
})

describe('sweep, account boundary and quit', () => {
  it('sweepSourceViews keeps a path a tab OR a detached window shows (the shell isPathOpen) and removes it 30 s after the last open sighting', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-20T00:00:00Z'))
    const ctx = setup()
    const res = await ctx.service.openSource(input())
    if (!res.ok) throw new Error(res.error)
    // the fake isPathOpen stands for index.ts webContentsForPath(path) !== undefined (tab or detached)
    vi.setSystemTime(Date.now() + 5 * SOURCE_VIEW_CLOSE_GRACE_MS)
    await ctx.service.sweepSourceViews()
    expect(existsSync(res.value.path)).toBe(true)
    ctx.openTabs.delete(res.value.path)
    vi.setSystemTime(Date.now() + SOURCE_VIEW_CLOSE_GRACE_MS / 2)
    await ctx.service.sweepSourceViews()
    expect(existsSync(res.value.path)).toBe(true)
    vi.setSystemTime(Date.now() + SOURCE_VIEW_CLOSE_GRACE_MS)
    await ctx.service.sweepSourceViews()
    expect(existsSync(res.value.path)).toBe(false)
    expect(ctx.service.sourceViews.has(res.value.path)).toBe(false)
  })

  it('dropSourceViews closes every source tab through closePathNow and deletes the files', async () => {
    const ctx = setup()
    const a = await ctx.service.openSource(input({ sourceId: 'chat:a', name: 'a.docx' }))
    const b = await ctx.service.openSource(
      input({ sourceId: 'task:b', name: 'b.pdf', extension: 'pdf' }),
    )
    if (!a.ok || !b.ok) throw new Error('open failed')
    await ctx.service.dropSourceViews()
    expect(ctx.closedNow.sort()).toEqual([a.value.path, b.value.path].sort())
    expect(existsSync(a.value.path)).toBe(false)
    expect(ctx.service.sourceViews.paths()).toEqual([])
  })

  it('lockSession (sign-out and account switch) drops the source views too', async () => {
    const ctx = setup()
    const res = await ctx.service.openSource(input())
    if (!res.ok) throw new Error(res.error)
    await ctx.service.lockSession(undefined, undefined, { switch: true })
    expect(ctx.closedNow).toContain(res.value.path)
    expect(existsSync(res.value.path)).toBe(false)
    expect(ctx.service.sourceViews.paths()).toEqual([])
  })

  it('disposeSourceViews (quit) removes the session folder synchronously', async () => {
    const ctx = setup()
    const res = await ctx.service.openSource(input())
    if (!res.ok) throw new Error(res.error)
    ctx.service.disposeSourceViews()
    expect(existsSync(res.value.path)).toBe(false)
    expect(readdirSync(previewRoot()).filter((n) => n.startsWith('sources-'))).toEqual([])
  })

  it('after a boundary the next open starts a fresh session folder', async () => {
    const ctx = setup()
    const first = await ctx.service.openSource(input())
    await ctx.service.dropSourceViews()
    const second = await ctx.service.openSource(input())
    if (!first.ok || !second.ok) throw new Error('open failed')
    expect(second.value.path).not.toBe(first.value.path)
  })
})
