/**
 * UNI-1993 (UW-SOURCE-RO) contract 3.7 item 2: opening a source file as a
 * view-only tab. The opener runs for real on a temp userData directory; the
 * network client and the shell's open router are fakes. Contract-first: the
 * client's `downloadSource(workspaceId, sourceId)` is UNI-1961's, so the opener
 * takes it as an injected dependency.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAFT_PREVIEW_DIR } from '@genoffice/electron-utils/draft-preview'
import type { OpenSourceInput } from '../src/shared/source-view'
import {
  SOURCE_VIEW_CLOSE_GRACE_MS,
  SourceViewRegistry,
  createSourceViewOpener,
  type SourceViewOpenerDeps,
} from '../src/main/uniwork-docs/source-view'

const BYTES = new Uint8Array([80, 75, 3, 4, 9, 9])
const MAX = 200 * 1024 * 1024

let userData = ''
const cleanups: Array<() => void> = []

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'uw-source-view-'))
})
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
  rmSync(userData, { recursive: true, force: true })
})

const input = (over: Partial<OpenSourceInput> = {}): OpenSourceInput => ({
  workspaceId: 'ws1',
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

function harness(over: Partial<SourceViewOpenerDeps> = {}) {
  const root = join(userData, DRAFT_PREVIEW_DIR)
  const registry = new SourceViewRegistry()
  const order: string[] = []
  const realAdd = registry.add.bind(registry)
  registry.add = (path, meta) => {
    order.push('registry.add')
    realAdd(path, meta)
  }
  // the client is UNI-1961's; the document/binding calls must stay untouched
  const client = {
    downloadSource: vi.fn(async (_ws: string, _id: string) => ({ bytes: BYTES })),
    getDocument: vi.fn(),
    download: vi.fn(),
  }
  const openTabs = new Set<string>()
  const registeredAtOpen: boolean[] = []
  const openPath = vi.fn(async (path: string) => {
    order.push('openPath')
    registeredAtOpen.push(registry.has(path))
    openTabs.add(path)
    return true
  })
  let clock = 1_000_000
  let sessions = 0
  const deps: SourceViewOpenerDeps = {
    previewRoot: root,
    startupSweep: Promise.resolve(),
    registry,
    identity: () => ({ deploymentId: 'dep1' }),
    profile: () => ({ deploymentId: 'dep1' }),
    storeLocked: () => false,
    documentMaxBytes: () => MAX,
    downloadSource: (ws, id) => client.downloadSource(ws, id),
    openPath,
    isPathOpen: (path) => openTabs.has(path),
    now: () => clock,
    newSession: () => `s${++sessions}`,
    ...over,
  }
  const opener = createSourceViewOpener(deps)
  cleanups.push(() => opener.disposeSync())
  return {
    opener,
    registry,
    client,
    openPath,
    openTabs,
    order,
    registeredAtOpen,
    root,
    advance: (ms: number) => {
      clock += ms
    },
  }
}

const sourceDirs = (root: string) =>
  existsSync(root) ? readdirSync(root).filter((name) => name.startsWith('sources-')) : []

describe('openSource: what is downloaded and how', () => {
  it('downloads the one source through the injected client and never touches the document or binding APIs', async () => {
    const h = harness()
    const res = await h.opener.openSource(input())
    expect(res.ok).toBe(true)
    expect(h.client.downloadSource).toHaveBeenCalledTimes(1)
    expect(h.client.downloadSource).toHaveBeenCalledWith('ws1', 'chat:msg-1')
    expect(h.client.getDocument).not.toHaveBeenCalled()
    expect(h.client.download).not.toHaveBeenCalled()
  })

  it('writes the bytes under <userData>/uniwork-drafts-preview/sources-<session>/<hash>/ read-only and keeps the extension', async () => {
    const h = harness()
    const res = await h.opener.openSource(input({ name: 'Plan.docx' }))
    if (!res.ok) throw new Error(`open failed: ${res.error}`)
    const path = res.value.path
    expect(res.value.reused).toBe(false)
    const rel = relative(join(userData, DRAFT_PREVIEW_DIR), path)
    expect(rel.startsWith('..')).toBe(false)
    expect(isAbsolute(rel)).toBe(false)
    const [sessionDir, hashDir, file] = rel.split(/[\\/]/)
    expect(sessionDir).toMatch(/^sources-s1$/)
    expect(hashDir).toMatch(/^[0-9a-f]{8,}$/)
    expect(file).toBe('Plan.docx')
    expect(new Uint8Array(readFileSync(path))).toEqual(BYTES)
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o444)
  })

  it('strips path separators and reserved names from the file name and never leaves the preview root', async () => {
    const h = harness()
    const hostile = [
      '../../evil/Q1: plan?.docx',
      '..\\..\\evil\\Q1|plan*.docx',
      'CON.docx',
      'nul.docx',
      'trailing dot. ',
      `${'x'.repeat(300)}.docx`,
    ]
    for (const [i, name] of hostile.entries()) {
      const res = await h.opener.openSource(input({ sourceId: `chat:m${i}`, name }))
      if (!res.ok) throw new Error(`open failed for ${name}: ${res.error}`)
      const file = basename(res.value.path)
      expect(file).not.toMatch(/[<>:"/\\|?*]/)
      expect([...file].some((char) => char.charCodeAt(0) < 32)).toBe(false)
      expect(file.length).toBeLessThanOrEqual(120)
      expect(file.toLowerCase().endsWith('.docx')).toBe(true)
      expect(file.replace(/\.docx$/i, '')).not.toMatch(/^(con|prn|aux|nul|com\d|lpt\d)$/i)
      const rel = relative(h.root, res.value.path)
      expect(rel.startsWith('..')).toBe(false)
      // exactly <sources-session>/<hash>/<file>: nothing escaped upward or sideways
      expect(rel.split(/[\\/]/)).toHaveLength(3)
    }
  })

  it('appends the extension when the row name has none, so the open router can route it', async () => {
    const h = harness()
    const res = await h.opener.openSource(input({ name: 'Quarterly report', extension: 'xlsx' }))
    if (!res.ok) throw new Error(res.error)
    expect(basename(res.value.path)).toBe('Quarterly report.xlsx')
  })

  it('refuses an extension no editor module reads, before downloading', async () => {
    const h = harness()
    for (const extension of ['exe', 'js', 'docx/../x', '', 'doc']) {
      const res = await h.opener.openSource(input({ name: `a.${extension}`, extension }))
      expect(res).toEqual({ ok: false, error: 'unsupported_format' })
    }
    expect(h.client.downloadSource).not.toHaveBeenCalled()
    expect(sourceDirs(h.root)).toEqual([])
  })

  it('opens every editor format incl. markdown, html and txt', async () => {
    const h = harness()
    for (const extension of [
      'docx',
      'xlsx',
      'pptx',
      'pdf',
      'md',
      'markdown',
      'html',
      'htm',
      'txt',
    ]) {
      const res = await h.opener.openSource(
        input({ sourceId: `chat:${extension}`, name: `f.${extension}`, extension }),
      )
      expect(res.ok, extension).toBe(true)
    }
  })

  it('rejects a malformed input as not_found without any I/O', async () => {
    const h = harness()
    for (const bad of [
      null,
      'x',
      {},
      input({ sourceId: '' }),
      input({ workspaceId: 3 as unknown as string }),
    ]) {
      expect(await h.opener.openSource(bad)).toEqual({ ok: false, error: 'not_found' })
    }
    expect(h.client.downloadSource).not.toHaveBeenCalled()
  })
})

describe('openSource: order of effects', () => {
  it('registers the path BEFORE deps.openPath, so the editor sees view-only from its first question', async () => {
    const h = harness()
    const res = await h.opener.openSource(input())
    if (!res.ok) throw new Error(res.error)
    expect(h.order).toEqual(['registry.add', 'openPath'])
    expect(h.registeredAtOpen).toEqual([true])
    expect(h.registry.meta(res.value.path)).toEqual({
      name: 'Plan.docx',
      origin: 'chat',
      parentTitle: 'Launch',
    })
  })

  it('un-registers and removes the folder when the shell cannot open the path', async () => {
    const h = harness({ openPath: vi.fn(async () => false) })
    expect(await h.opener.openSource(input())).toEqual({ ok: false, error: 'open_failed' })
    expect(h.registry.paths()).toEqual([])
    expect(sourceDirs(h.root).flatMap((d) => readdirSync(join(h.root, d)))).toEqual([])
  })

  it('waits for the startup sweep before it creates the folder (the sweep removes the whole root)', async () => {
    let release!: () => void
    const root = join(userData, DRAFT_PREVIEW_DIR)
    mkdirSync(join(root, 'sources-previous-run', 'ab'), { recursive: true })
    // what the sync center does when it is built: remove the preview root, asynchronously
    const startupSweep = new Promise<void>((resolve) => {
      release = () => {
        void rm(root, { recursive: true, force: true }).then(() => resolve())
      }
    })
    const h = harness({ startupSweep })
    const pending = h.opener.openSource(input())
    await new Promise((r) => setTimeout(r, 20))
    // still sweeping: nothing may be written yet, or the sweep would delete it
    expect(h.openPath).not.toHaveBeenCalled()
    expect(existsSync(join(root, 'sources-s1'))).toBe(false)
    release()
    const res = await pending
    if (!res.ok) throw new Error(res.error)
    expect(existsSync(res.value.path)).toBe(true)
    expect(h.openPath).toHaveBeenCalledWith(res.value.path)
    // and the previous run's leftovers went with the sweep
    expect(existsSync(join(root, 'sources-previous-run'))).toBe(false)
  })
})

describe('openSource: reuse of an open tab', () => {
  it('a second open of the same sourceKey focuses the open tab and does not download again', async () => {
    const h = harness()
    const first = await h.opener.openSource(input())
    const second = await h.opener.openSource(input())
    if (!first.ok || !second.ok) throw new Error('open failed')
    expect(second.value).toEqual({ path: first.value.path, reused: true })
    expect(h.client.downloadSource).toHaveBeenCalledTimes(1)
    expect(h.openPath).toHaveBeenCalledTimes(2)
    expect(h.openPath).toHaveBeenLastCalledWith(first.value.path)
  })

  it('a changed updatedAt (or size) is another key and downloads again', async () => {
    const h = harness()
    const first = await h.opener.openSource(input())
    const second = await h.opener.openSource(input({ updatedAt: '2026-10-21T00:00:00Z' }))
    const third = await h.opener.openSource(input({ sizeBytes: BYTES.length + 1 }))
    if (!first.ok || !second.ok || !third.ok) throw new Error('open failed')
    expect(new Set([first.value.path, second.value.path, third.value.path]).size).toBe(3)
    expect(second.value.reused).toBe(false)
    expect(h.client.downloadSource).toHaveBeenCalledTimes(3)
  })

  it('a closed tab (file still on disk) is downloaded fresh, never served from a stale temp copy', async () => {
    const h = harness()
    const first = await h.opener.openSource(input())
    if (!first.ok) throw new Error(first.error)
    h.openTabs.clear()
    const second = await h.opener.openSource(input())
    if (!second.ok) throw new Error(second.error)
    expect(second.value.reused).toBe(false)
    expect(h.client.downloadSource).toHaveBeenCalledTimes(2)
    expect(existsSync(second.value.path)).toBe(true)
  })

  it('two clicks at once on the same file share one download', async () => {
    const h = harness()
    const [a, b] = await Promise.all([h.opener.openSource(input()), h.opener.openSource(input())])
    if (!a.ok || !b.ok) throw new Error('open failed')
    expect(a.value.path).toBe(b.value.path)
    expect(h.client.downloadSource).toHaveBeenCalledTimes(1)
  })
})

describe('openSource: refusals and error mapping', () => {
  it('refuses before downloading when sizeBytes is over the document max (too_large) and never fetches', async () => {
    const h = harness({ documentMaxBytes: () => 1000 })
    expect(await h.opener.openSource(input({ sizeBytes: 1001 }))).toEqual({
      ok: false,
      error: 'too_large',
    })
    expect(h.client.downloadSource).not.toHaveBeenCalled()
    expect(sourceDirs(h.root)).toEqual([])
    // exactly the max is still fine
    expect((await h.opener.openSource(input({ sizeBytes: 1000 }))).ok).toBe(true)
  })

  it('checks identity, deployment and keystore before any request', async () => {
    const signedOut = harness({ identity: () => null })
    expect(await signedOut.opener.openSource(input())).toEqual({
      ok: false,
      error: 'not_signed_in',
    })
    const locked = harness({ identity: () => null, storeLocked: () => true })
    expect(await locked.opener.openSource(input())).toEqual({ ok: false, error: 'keystore_locked' })
    const other = harness({ profile: () => ({ deploymentId: 'elsewhere' }) })
    expect(await other.opener.openSource(input())).toEqual({ ok: false, error: 'wrong_deployment' })
    const noProfile = harness({ profile: () => null })
    expect(await noProfile.opener.openSource(input())).toEqual({
      ok: false,
      error: 'wrong_deployment',
    })
    for (const h of [signedOut, locked, other, noProfile]) {
      expect(h.client.downloadSource).not.toHaveBeenCalled()
      expect(h.openPath).not.toHaveBeenCalled()
    }
  })

  it.each([
    ['not_found', 'not_found'],
    ['deleted', 'deleted'],
    ['forbidden', 'forbidden'],
    ['network', 'network'],
    ['timeout', 'timeout'],
    ['session_expired', 'session_expired'],
    ['too_large', 'too_large'],
    ['server_error', 'server_error'],
    ['malformed_response', 'server_error'],
    ['quota_exceeded', 'open_failed'],
  ])(
    'maps a download failing with %s to %s, opens no tab and leaves no folder',
    async (code, expected) => {
      const h = harness()
      h.client.downloadSource.mockRejectedValueOnce(Object.assign(new Error('boom'), { code }))
      expect(await h.opener.openSource(input())).toEqual({ ok: false, error: expected })
      expect(h.openPath).not.toHaveBeenCalled()
      expect(h.registry.paths()).toEqual([])
      expect(sourceDirs(h.root).flatMap((d) => readdirSync(join(h.root, d)))).toEqual([])
    },
  )

  it('maps a thrown non-API error to open_failed', async () => {
    const h = harness()
    h.client.downloadSource.mockRejectedValueOnce(new Error('socket hang up'))
    expect(await h.opener.openSource(input())).toEqual({ ok: false, error: 'open_failed' })
  })

  it('removes a half-written folder when the write fails after the folder exists', async () => {
    const h = harness({
      fs: {
        writeFile: async (path) => {
          const { writeFileSync } = await import('node:fs')
          writeFileSync(path, 'par')
          throw new Error('ENOSPC')
        },
      },
    })
    expect(await h.opener.openSource(input())).toEqual({ ok: false, error: 'open_failed' })
    expect(h.registry.paths()).toEqual([])
    expect(h.openPath).not.toHaveBeenCalled()
    const left = sourceDirs(h.root).flatMap((d) => readdirSync(join(h.root, d)))
    expect(left).toEqual([])
  })

  it('does not write when the account changed while the download was running', async () => {
    let finish!: () => void
    const h = harness()
    h.client.downloadSource.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ bytes: BYTES })
        }),
    )
    const pending = h.opener.openSource(input())
    await new Promise((r) => setTimeout(r, 10))
    await h.opener.dropAll()
    finish()
    expect((await pending).ok).toBe(false)
    expect(h.openPath).not.toHaveBeenCalled()
    expect(h.registry.paths()).toEqual([])
    expect(sourceDirs(h.root).flatMap((d) => readdirSync(join(h.root, d)))).toEqual([])
  })
})

describe('cleanup', () => {
  it('sweep keeps a file whose tab is open, however long it has been open', async () => {
    const h = harness()
    const res = await h.opener.openSource(input())
    if (!res.ok) throw new Error(res.error)
    h.advance(10 * SOURCE_VIEW_CLOSE_GRACE_MS)
    await h.opener.sweep()
    expect(existsSync(res.value.path)).toBe(true)
    expect(h.registry.has(res.value.path)).toBe(true)
  })

  it('sweep deletes a closed tab only after the 30 s grace counted from when it was last seen open', async () => {
    const h = harness()
    const res = await h.opener.openSource(input())
    if (!res.ok) throw new Error(res.error)
    // open for a long while ...
    h.advance(10 * 60_000)
    await h.opener.sweep()
    // ... then closed: the grace starts now, not at open time
    h.openTabs.clear()
    h.advance(1_000)
    await h.opener.sweep()
    h.advance(SOURCE_VIEW_CLOSE_GRACE_MS - 5_000)
    await h.opener.sweep()
    expect(existsSync(res.value.path)).toBe(true)
    h.advance(10_000)
    await h.opener.sweep()
    expect(existsSync(res.value.path)).toBe(false)
    expect(existsSync(dirname(res.value.path))).toBe(false)
    expect(h.registry.has(res.value.path)).toBe(false)
    expect(h.registry.paths()).toEqual([])
  })

  it('a tab that is reopened inside the grace restarts it', async () => {
    const h = harness()
    const res = await h.opener.openSource(input())
    if (!res.ok) throw new Error(res.error)
    h.openTabs.clear()
    h.advance(20_000)
    await h.opener.sweep()
    h.openTabs.add(res.value.path)
    h.advance(20_000)
    await h.opener.sweep()
    h.openTabs.clear()
    h.advance(20_000)
    await h.opener.sweep()
    expect(existsSync(res.value.path)).toBe(true)
  })

  it('dropAll (account change / sign-out) closes every registered tab, deletes the files and empties the registry', async () => {
    const h = harness()
    const a = await h.opener.openSource(input({ sourceId: 'chat:a', name: 'a.docx' }))
    const b = await h.opener.openSource(
      input({ sourceId: 'task:b', name: 'b.pdf', extension: 'pdf' }),
    )
    if (!a.ok || !b.ok) throw new Error('open failed')
    const closed: string[] = []
    await h.opener.dropAll((path) => {
      // the file is still there while the tab is asked to close
      expect(existsSync(path)).toBe(true)
      closed.push(path)
    })
    expect(closed.sort()).toEqual([a.value.path, b.value.path].sort())
    expect(existsSync(a.value.path)).toBe(false)
    expect(existsSync(b.value.path)).toBe(false)
    expect(h.registry.paths()).toEqual([])
    // the next open takes a fresh session folder
    const next = await h.opener.openSource(input({ sourceId: 'chat:a', name: 'a.docx' }))
    if (!next.ok) throw new Error(next.error)
    expect(next.value.path).not.toBe(a.value.path)
    expect(next.value.path).toContain('sources-s2')
  })

  it('disposeSync (quit) removes this session folder and the registry entries', async () => {
    const h = harness()
    const res = await h.opener.openSource(input())
    if (!res.ok) throw new Error(res.error)
    h.opener.disposeSync()
    expect(existsSync(res.value.path)).toBe(false)
    expect(h.registry.paths()).toEqual([])
  })

  it('startup: a fresh opener over a root the startup sweep emptied has no leftover, and an earlier run never counts as open', async () => {
    const root = join(userData, DRAFT_PREVIEW_DIR)
    mkdirSync(join(root, 'sources-crashed-run', 'ff'), { recursive: true })
    const startupSweep = rm(root, { recursive: true, force: true })
    const h = harness({ startupSweep })
    expect(await h.opener.openSource(input())).toMatchObject({ ok: true })
    expect(sourceDirs(root)).toEqual(['sources-s1'])
  })

  it('does not touch another session folder nor the draft previews that share the root', async () => {
    const root = join(userData, DRAFT_PREVIEW_DIR)
    const draft = join(root, 'draft-session', 'd1')
    mkdirSync(draft, { recursive: true })
    const h = harness()
    const res = await h.opener.openSource(input())
    if (!res.ok) throw new Error(res.error)
    h.openTabs.clear()
    h.advance(10 * SOURCE_VIEW_CLOSE_GRACE_MS)
    await h.opener.sweep()
    await h.opener.dropAll()
    h.opener.disposeSync()
    expect(existsSync(draft)).toBe(true)
  })
})
