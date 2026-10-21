import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFolderUploadService } from '../src/main/uniwork-docs/folder-upload/service'
import type {
  FolderUploadRunOptions,
  FolderUploadRunnerPort,
} from '../src/main/uniwork-docs/folder-upload/runner-port'
import type { FolderUploadLimits } from '../src/main/uniwork-docs/folder-upload/types'
import type { UniworkFolderNode } from '../src/shared/home-api'
import type { BatchUploadProgress } from '../src/shared/folder-upload-api'

/**
 * UNI-2052 FU-C: the folder-upload IPC service. Main resolves the destination,
 * reads the disk, plans with the shared planner and hands the plan to a runner
 * port; the renderer sees relative paths only. Every collaborator is a fake
 * here, the disk is a real temp directory.
 */

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'uw-fu-service-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const LIMITS: FolderUploadLimits = {
  maxFiles: 100,
  maxFolders: 50,
  maxTotalBytes: 10_000_000,
  maxDepth: 5,
  perFileMaxBytes: 1_000_000,
}

const node = (
  id: string,
  title: string,
  children: UniworkFolderNode[] = [],
  systemKind?: 'my_folder',
): UniworkFolderNode => ({
  id,
  parentId: null,
  title,
  position: 0,
  children,
  ...(systemKind ? { systemKind } : {}),
})

function file(rel: string, bytes = 10): string {
  const abs = join(root, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, Buffer.alloc(bytes, 1))
  return abs
}

function fakePort() {
  const started: Array<{ plan: unknown; opts: FolderUploadRunOptions }> = []
  const calls: string[] = []
  const port: FolderUploadRunnerPort = {
    start: (plan, opts) => {
      started.push({ plan, opts })
      return { runId: opts.runId }
    },
    cancel: (runId) => void calls.push(`cancel:${runId}`),
    retry: (runId) => void calls.push(`retry:${runId}`),
    dismiss: (runId) => void calls.push(`dismiss:${runId}`),
  }
  return { port, started, calls }
}

function setup(
  over: {
    limits?: FolderUploadLimits | null
    tree?: UniworkFolderNode[]
    picked?: { dir?: string | null; files?: string[] }
    treeFails?: boolean
  } = {},
) {
  const batch = fakePort()
  const sequential = fakePort()
  const dialogs = { directory: 0, files: [] as Array<readonly string[]> }
  const ensureMyFolder = vi.fn(async () => ({ id: 'my1', title: 'My Folder' }))
  let now = 1_000
  let seq = 0
  const service = createFolderUploadService({
    pickDirectory: async () => {
      dialogs.directory += 1
      return over.picked?.dir ?? null
    },
    pickFiles: async (extensions) => {
      dialogs.files.push(extensions)
      return over.picked?.files ?? []
    },
    folderTree: async () => {
      if (over.treeFails) throw new Error('offline')
      return over.tree ?? [node('my1', 'My Folder', [], 'my_folder'), node('f1', 'Contracts')]
    },
    ensureMyFolder,
    getFolderUploadLimits: () => (over.limits === undefined ? LIMITS : over.limits),
    sequentialLimits: async () => ({ ...LIMITS, maxFolders: undefined }),
    runner: batch.port,
    sequential: sequential.port,
    now: () => now,
    newId: () => `id${++seq}`,
  })
  return {
    service,
    batch,
    sequential,
    dialogs,
    ensureMyFolder,
    advance: (ms: number) => void (now += ms),
  }
}

describe('input validation at the boundary', () => {
  it('answers null / [] / invalid_input for input that is not shaped right', async () => {
    const { service } = setup()
    for (const bad of [undefined, null, 7, 'x', [], {}, { workspaceId: '' }]) {
      expect(await service.pick(bad)).toBeNull()
      expect(await service.preflight(bad)).toEqual([])
      expect(service.start(bad, () => undefined)).toEqual({ ok: false, error: 'invalid_input' })
    }
    expect(await service.pick({ workspaceId: 'w', folderId: 3, mode: 'folder' })).toBeNull()
    expect(await service.pick({ workspaceId: 'w', folderId: null, mode: 'tree' })).toBeNull()
    expect(await service.preflight({ workspaceId: 'w', folderId: null, paths: 'x' })).toEqual([])
    expect(service.start({ preflightId: 'p', shareWithWorkspace: 'yes' }, () => undefined)).toEqual(
      { ok: false, error: 'invalid_input' },
    )
  })

  it('drops paths that are not absolute strings before anything is read', async () => {
    const { service } = setup()
    const out = await service.preflight({
      workspaceId: 'w',
      folderId: null,
      paths: ['relative/a.docx', '', 4, '../up.docx'],
    })
    expect(out).toEqual([])
  })

  it('ignores a cancel, retry or dismiss for an id that is not a run', () => {
    const { service, batch, sequential } = setup()
    for (const bad of [undefined, null, 4, '', 'nope']) {
      service.cancel(bad)
      service.retry(bad)
      service.dismiss(bad)
    }
    expect(batch.calls).toEqual([])
    expect(sequential.calls).toEqual([])
  })
})

describe('pick', () => {
  it('answers null when the folder dialog is cancelled', async () => {
    const { service, dialogs } = setup()
    expect(await service.pick({ workspaceId: 'w', folderId: null, mode: 'folder' })).toBeNull()
    expect(dialogs.directory).toBe(1)
  })

  it('answers null when the files dialog is cancelled (no paths)', async () => {
    const { service } = setup({ picked: { files: [] } })
    expect(await service.pick({ workspaceId: 'w', folderId: null, mode: 'files' })).toBeNull()
  })

  it('filters the files dialog by the server list when it sent one, else by the app list', async () => {
    const withList = setup({ limits: { ...LIMITS, uploadExtensions: ['docx', 'pdf'] } })
    await withList.service.pick({ workspaceId: 'w', folderId: null, mode: 'files' })
    expect(withList.dialogs.files[0]).toEqual(['docx', 'pdf'])

    const without = setup()
    await without.service.pick({ workspaceId: 'w', folderId: null, mode: 'files' })
    expect(without.dialogs.files[0]).toContain('docx')
    expect(without.dialogs.files[0]).toContain('xlsx')
  })

  it('a picked folder becomes one folder-mode preflight with relative paths only', async () => {
    file('Case/a.docx', 100)
    file('Case/sub/b.xlsx', 200)
    file('Case/.hidden.docx')
    const { service } = setup({ picked: { dir: join(root, 'Case') } })
    const sdo = await service.pick({ workspaceId: 'w', folderId: 'f1', mode: 'folder' })
    expect(sdo).not.toBeNull()
    expect(sdo).toMatchObject({
      mode: 'folder',
      rootName: 'Case',
      target: { workspaceId: 'w', folderId: 'f1', label: 'Contracts' },
      totals: { files: 2, bytes: 300 },
      refusal: null,
      shareAvailable: true,
      // a folder is never a workspace-shared parent (the web's isParentWorkspaceShared, UNI-1974)
      parentShared: false,
    })
    expect(sdo!.skipped).toEqual([{ path: 'Case/.hidden.docx', reason: 'hidden' }])
    expect(sdo!.rootNamePreview).toBeUndefined()
    // the renderer never learns where the folder is on disk
    expect(JSON.stringify(sdo)).not.toContain(root)
  })

  it('a picked set of files becomes one files-mode preflight', async () => {
    const a = file('x/a.docx', 5)
    const b = file('y/b.pdf', 7)
    const { service } = setup({ picked: { files: [a, b] } })
    const sdo = await service.pick({ workspaceId: 'w', folderId: 'f1', mode: 'files' })
    expect(sdo).toMatchObject({
      mode: 'files',
      totals: { files: 2, bytes: 12 },
      refusal: null,
    })
    expect(sdo!.rootName).toBeUndefined()
    expect(JSON.stringify(sdo)).not.toContain(root)
  })

  it('refuses folder mode with a clear code, without opening a dialog, when the server has no folder_upload block', async () => {
    const { service, dialogs } = setup({ limits: null, picked: { dir: join(root, 'Case') } })
    const sdo = await service.pick({ workspaceId: 'w', folderId: null, mode: 'folder' })
    expect(sdo?.refusal).toEqual({ code: 'folder_upload_unavailable' })
    expect(dialogs.directory).toBe(0)
  })
})

describe('destination', () => {
  it('the workspace root means My Folder: it is ensured and its id is the target', async () => {
    file('Case/a.docx')
    const { service, ensureMyFolder } = setup({ picked: { dir: join(root, 'Case') } })
    const sdo = await service.pick({ workspaceId: 'w', folderId: null, mode: 'folder' })
    expect(ensureMyFolder).toHaveBeenCalledWith('w')
    expect(sdo?.target).toEqual({
      workspaceId: 'w',
      folderId: 'my1',
      label: 'My Folder',
      myFolder: true,
    })
  })

  it('FU-V2: My Folder is marked whether it is the workspace root or opened by id, a plain folder is not', async () => {
    file('Case/a.docx')
    const { service } = setup({
      picked: { dir: join(root, 'Case') },
      tree: [node('my1', 'my-folder-raw', [], 'my_folder'), node('f1', 'Contracts')],
    })
    const byId = await service.pick({ workspaceId: 'w', folderId: 'my1', mode: 'folder' })
    expect(byId?.target.myFolder).toBe(true)
    const root0 = await service.pick({ workspaceId: 'w', folderId: null, mode: 'folder' })
    expect(root0?.target.myFolder).toBe(true)
    const plain = await service.pick({ workspaceId: 'w', folderId: 'f1', mode: 'folder' })
    expect(plain?.target).toEqual({ workspaceId: 'w', folderId: 'f1', label: 'Contracts' })
  })

  it('an open folder is the target as it is: My Folder is not ensured', async () => {
    file('Case/a.docx')
    const { service, ensureMyFolder } = setup({ picked: { dir: join(root, 'Case') } })
    const sdo = await service.pick({ workspaceId: 'w', folderId: 'f1', mode: 'folder' })
    expect(ensureMyFolder).not.toHaveBeenCalled()
    expect(sdo?.target.folderId).toBe('f1')
  })

  it('previews "(n)" when a sibling folder already has the name', async () => {
    file('Case/a.docx')
    const tree = [
      node('my1', 'My Folder', [node('s1', 'Case'), node('s2', 'Case (1)')], 'my_folder'),
    ]
    const { service } = setup({ tree, picked: { dir: join(root, 'Case') } })
    const sdo = await service.pick({ workspaceId: 'w', folderId: null, mode: 'folder' })
    expect(sdo?.rootName).toBe('Case')
    expect(sdo?.rootNamePreview).toBe('Case (2)')
  })

  it('counts the destination depth: a folder too deep below the limit is refused too_deep', async () => {
    // the destination D sits at level 4 and the file is two segments deep (Case/a.docx): 4 + 2 > 5
    file('Case/a.docx')
    const tree = [
      node('l1', 'A', [node('l2', 'B', [node('l3', 'C', [node('l4', 'D')])])]),
      node('my1', 'My Folder', [], 'my_folder'),
    ]
    const { service } = setup({ tree, picked: { dir: join(root, 'Case') } })
    const sdo = await service.pick({ workspaceId: 'w', folderId: 'l4', mode: 'folder' })
    expect(sdo?.refusal).toMatchObject({ code: 'too_deep', limit: 5 })
  })

  it('answers a target_unavailable refusal when the destination cannot be read', async () => {
    file('Case/a.docx')
    const { service } = setup({ treeFails: true, picked: { dir: join(root, 'Case') } })
    const sdo = await service.pick({ workspaceId: 'w', folderId: 'f1', mode: 'folder' })
    expect(sdo?.refusal).toEqual({ code: 'target_unavailable' })
    expect(sdo?.parentShared).toBe(false)
  })

  it('answers target_unavailable for a folder that is not in the tree', async () => {
    file('Case/a.docx')
    const { service } = setup({ picked: { dir: join(root, 'Case') } })
    const sdo = await service.pick({ workspaceId: 'w', folderId: 'gone', mode: 'folder' })
    expect(sdo?.refusal).toEqual({ code: 'target_unavailable' })
  })
})

describe('refusals reach the renderer', () => {
  it('propagates the planner refusal with its numbers', async () => {
    for (let i = 0; i < 4; i += 1) file(`Case/f${i}.docx`)
    const small = { ...LIMITS, maxFiles: 3 }
    const { service } = setup({ limits: small, picked: { dir: join(root, 'Case') } })
    const sdo = await service.pick({ workspaceId: 'w', folderId: 'f1', mode: 'folder' })
    expect(sdo?.refusal).toEqual({ code: 'too_many_files', limit: 3, actual: 4 })
    expect(sdo?.totals.files).toBe(4)
  })

  it('names the app-only skip reasons (link, unreadable)', async () => {
    file('Case/a.docx')
    symlinkSync(join(root, 'Case/a.docx'), join(root, 'Case/ln.docx'))
    const { service } = setup({ picked: { dir: join(root, 'Case') } })
    const sdo = await service.pick({ workspaceId: 'w', folderId: 'f1', mode: 'folder' })
    expect(sdo?.skipped).toContainEqual({ path: 'Case/ln.docx', reason: 'link' })
  })
})

describe('preflight from a drop', () => {
  it('groups loose files into one files preflight first, then one folder preflight per directory', async () => {
    const f1 = file('loose/one.docx', 1)
    file('DirA/a.docx', 2)
    file('DirB/b.docx', 3)
    const f2 = file('loose/two.pdf', 4)
    const out = await setup().service.preflight({
      workspaceId: 'w',
      folderId: 'f1',
      paths: [f1, join(root, 'DirA'), f2, join(root, 'DirB')],
    })
    expect(out.map((s) => [s.mode, s.rootName])).toEqual([
      ['files', undefined],
      ['folder', 'DirA'],
      ['folder', 'DirB'],
    ])
    expect(out[0].totals).toEqual({ files: 2, bytes: 5 })
    expect(out[1].totals).toEqual({ files: 1, bytes: 2 })
    // each preflight has its own id
    expect(new Set(out.map((s) => s.preflightId)).size).toBe(3)
  })

  it('a drop of one folder gives one preflight; of files only gives one files preflight', async () => {
    file('DirA/a.docx')
    const lone = file('z.docx')
    const s = setup().service
    expect(
      (await s.preflight({ workspaceId: 'w', folderId: 'f1', paths: [join(root, 'DirA')] })).length,
    ).toBe(1)
    const files = await s.preflight({ workspaceId: 'w', folderId: 'f1', paths: [lone] })
    expect(files.map((x) => x.mode)).toEqual(['files'])
  })

  it('lists a path that is gone as unreadable instead of throwing', async () => {
    const real = file('ok.docx')
    const { service } = setup()
    const out = await service.preflight({
      workspaceId: 'w',
      folderId: 'f1',
      paths: [real, join(root, 'vanished.docx')],
    })
    expect(out).toHaveLength(1)
    expect(out[0].skipped).toContainEqual({ path: 'vanished.docx', reason: 'unreadable' })
    expect(out[0].totals.files).toBe(1)
  })

  it('refuses every dropped folder when the server has no folder_upload block, files still plan', async () => {
    file('DirA/a.docx')
    const loose = file('one.docx')
    const { service } = setup({ limits: null })
    const out = await service.preflight({
      workspaceId: 'w',
      folderId: 'f1',
      paths: [loose, join(root, 'DirA')],
    })
    expect(out[0]).toMatchObject({
      mode: 'files',
      refusal: null,
      shareAvailable: false,
      parentShared: false,
    })
    expect(out[1]).toMatchObject({
      mode: 'folder',
      refusal: { code: 'folder_upload_unavailable' },
    })
  })
})

describe('start / cancel / retry / dismiss', () => {
  async function ready(over: Parameters<typeof setup>[0] = {}) {
    const abs = file('Case/a.docx', 11)
    file('Case/sub/b.docx', 22)
    const ctx = setup({ picked: { dir: join(root, 'Case') }, ...over })
    const sdo = (await ctx.service.pick({ workspaceId: 'w', folderId: null, mode: 'folder' }))!
    return { ...ctx, sdo, abs }
  }

  it('answers unknown_preflight for an id main does not hold, and for a spent one', async () => {
    const { service, sdo } = await ready()
    expect(
      service.start({ preflightId: 'nope', shareWithWorkspace: false }, () => undefined),
    ).toEqual({ ok: false, error: 'unknown_preflight' })
    const first = service.start(
      { preflightId: sdo.preflightId, shareWithWorkspace: false },
      () => undefined,
    )
    expect(first.ok).toBe(true)
    expect(
      service.start({ preflightId: sdo.preflightId, shareWithWorkspace: false }, () => undefined),
    ).toEqual({ ok: false, error: 'unknown_preflight' })
  })

  it('expires a preflight after its time to live', async () => {
    const { service, sdo, advance } = await ready()
    advance(31 * 60 * 1000)
    expect(
      service.start({ preflightId: sdo.preflightId, shareWithWorkspace: false }, () => undefined),
    ).toEqual({ ok: false, error: 'unknown_preflight' })
  })

  it('refuses to start a preflight that carries a refusal', async () => {
    for (let i = 0; i < 3; i += 1) file(`Big/f${i}.docx`)
    const { service } = setup({
      limits: { ...LIMITS, maxFiles: 2 },
      picked: { dir: join(root, 'Big') },
    })
    const sdo = (await service.pick({ workspaceId: 'w', folderId: 'f1', mode: 'folder' }))!
    expect(sdo.refusal?.code).toBe('too_many_files')
    expect(
      service.start({ preflightId: sdo.preflightId, shareWithWorkspace: false }, () => undefined),
    ).toEqual({ ok: false, error: 'refused' })
  })

  it('hands the plan to the batch runner with the target, the share flag and a path lookup that stays in main', async () => {
    const { service, batch, sdo, abs } = await ready()
    const result = service.start(
      { preflightId: sdo.preflightId, shareWithWorkspace: true },
      () => undefined,
    )
    expect(result.ok).toBe(true)
    expect(batch.started).toHaveLength(1)
    const { plan, opts } = batch.started[0]
    expect(opts).toMatchObject({
      workspaceId: 'w',
      parentId: 'my1',
      shareWithWorkspace: true,
    })
    expect(result).toEqual({ ok: true, runId: opts.runId })
    const planned = (plan as { files: Array<{ path: string; index: number }> }).files
    expect(planned.map((f) => f.path)).toEqual(['Case/a.docx', 'Case/sub/b.docx'])
    expect(opts.filePath(planned[0].index)).toBe(abs)
    expect(opts.filePath(planned[1].index)).toBe(join(root, 'Case/sub/b.docx'))
    // the plan itself holds relative paths only
    expect(JSON.stringify(plan)).not.toContain(root)
  })

  it('forwards the share flag as false by default', async () => {
    const { service, batch, sdo } = await ready()
    service.start({ preflightId: sdo.preflightId, shareWithWorkspace: false }, () => undefined)
    expect(batch.started[0].opts.shareWithWorkspace).toBe(false)
  })

  it('forwards progress to the sink with the run id, and a first planning event with the totals', async () => {
    const { service, batch, sdo } = await ready()
    const events: BatchUploadProgress[] = []
    const result = service.start({ preflightId: sdo.preflightId, shareWithWorkspace: false }, (e) =>
      events.push(e),
    )
    if (!result.ok) throw new Error('start failed')
    expect(events[0]).toMatchObject({
      runId: result.runId,
      phase: 'planning',
      done: 0,
      failed: 0,
      total: 2,
      totalBytes: 33,
    })
    batch.started[0].opts.onProgress({
      phase: 'uploading',
      done: 1,
      failed: 0,
      total: 2,
      sentBytes: 11,
      totalBytes: 33,
      rootFolderId: 'r1',
    })
    expect(events[1]).toEqual({
      runId: result.runId,
      phase: 'uploading',
      done: 1,
      failed: 0,
      total: 2,
      sentBytes: 11,
      totalBytes: 33,
      rootTitle: 'Case',
      rootFolderId: 'r1',
    })
  })

  it('keeps a finished run with failures for retry / dismiss, and lets a clean one go', async () => {
    const { service, batch, sdo } = await ready()
    const events: BatchUploadProgress[] = []
    const result = service.start({ preflightId: sdo.preflightId, shareWithWorkspace: false }, (e) =>
      events.push(e),
    )
    if (!result.ok) throw new Error('start failed')
    batch.started[0].opts.onProgress({
      phase: 'done',
      done: 1,
      failed: 1,
      total: 2,
      sentBytes: 11,
      totalBytes: 33,
      failures: [{ path: 'Case/sub/b.docx', code: 'network', retryable: true }],
    })
    service.retry(result.runId)
    expect(batch.calls).toEqual([`retry:${result.runId}`])
    service.dismiss(result.runId)
    expect(batch.calls).toEqual([`retry:${result.runId}`, `dismiss:${result.runId}`])
    // dismissed: a second dismiss reaches nobody
    service.dismiss(result.runId)
    expect(batch.calls).toHaveLength(2)
  })

  it('forwards cancel to the runner that owns the run', async () => {
    const { service, batch, sequential, sdo } = await ready()
    const result = service.start(
      { preflightId: sdo.preflightId, shareWithWorkspace: false },
      () => undefined,
    )
    if (!result.ok) throw new Error('start failed')
    service.cancel(result.runId)
    expect(batch.calls).toEqual([`cancel:${result.runId}`])
    expect(sequential.calls).toEqual([])
  })

  it('a runner that throws on start ends the run as failed instead of throwing across IPC', async () => {
    const { service, batch, sdo } = await ready()
    batch.port.start = () => {
      throw new Error('boom')
    }
    const events: BatchUploadProgress[] = []
    const result = service.start({ preflightId: sdo.preflightId, shareWithWorkspace: false }, (e) =>
      events.push(e),
    )
    expect(result.ok).toBe(true)
    expect(events.at(-1)).toMatchObject({ phase: 'failed', error: { code: 'start_failed' } })
  })
})

describe('foldersAvailable', () => {
  it('is true when the server sent a folder_upload block and false when it did not', async () => {
    expect(await setup().service.foldersAvailable()).toBe(true)
    expect(await setup({ limits: null }).service.foldersAvailable()).toBe(false)
  })
})

describe('the sequential fallback (no folder_upload block)', () => {
  it('runs files mode through the sequential runner, not the batch runner, and says there is no share flag', async () => {
    const a = file('a.docx', 3)
    const b = file('b.docx', 4)
    const { service, batch, sequential } = setup({ limits: null })
    const out = await service.preflight({ workspaceId: 'w', folderId: 'f1', paths: [a, b] })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ mode: 'files', shareAvailable: false, refusal: null })
    const result = service.start(
      { preflightId: out[0].preflightId, shareWithWorkspace: true },
      () => undefined,
    )
    expect(result.ok).toBe(true)
    expect(batch.started).toHaveLength(0)
    expect(sequential.started).toHaveLength(1)
    expect(sequential.started[0].opts).toMatchObject({ workspaceId: 'w', parentId: 'f1' })
    if (!result.ok) return
    service.cancel(result.runId)
    expect(sequential.calls).toEqual([`cancel:${result.runId}`])
    expect(batch.calls).toEqual([])
  })

  it('plans the fallback with the app list of extensions, so a format the app cannot open is skipped up front', async () => {
    const a = file('a.docx')
    const odt = file('b.odt')
    const { service } = setup({ limits: null })
    const out = await service.preflight({ workspaceId: 'w', folderId: 'f1', paths: [a, odt] })
    expect(out[0].totals.files).toBe(1)
    expect(out[0].skipped).toContainEqual({ path: 'b.odt', reason: 'unsupported_format' })
  })
})

describe('FU-FIX1 m1: bounded pre-flights and runs', () => {
  async function startOne(service: ReturnType<typeof setup>['service'], name: string) {
    const path = file(name)
    const out = await service.preflight({ workspaceId: 'w', folderId: 'f1', paths: [path] })
    const result = service.start(
      { preflightId: out[0]?.preflightId, shareWithWorkspace: false },
      () => undefined,
    )
    if (!result.ok) throw new Error('start failed')
    return result.runId
  }

  it('caps the folders of one drop and reports the rest as one refusal, evicting none of the drop', async () => {
    const { service } = setup()
    const dirs: string[] = []
    for (let i = 0; i < 40; i += 1) {
      file(`Drop${i}/a.docx`)
      dirs.push(join(root, `Drop${i}`))
    }
    const out = await service.preflight({ workspaceId: 'w', folderId: 'f1', paths: dirs })

    expect(out).toHaveLength(33)
    expect(out[32]?.refusal).toEqual({ code: 'too_many_folders', limit: 32, actual: 40 })
    // every pre-flight the renderer got still answers its start
    for (const sdo of out.slice(0, 32)) {
      expect(sdo.refusal).toBeNull()
      expect(
        service.start({ preflightId: sdo.preflightId, shareWithWorkspace: false }, () => undefined)
          .ok,
      ).toBe(true)
    }
  })

  it('never evicts a run that is still running', async () => {
    const { service, batch } = setup()
    const first = await startOne(service, 'one0.docx')
    for (let i = 1; i < 34; i += 1) await startOne(service, `one${i}.docx`)
    service.cancel(first)
    expect(batch.calls).toEqual([`cancel:${first}`])
  })

  it('evicts the oldest finished run instead of a running one', async () => {
    const { service, batch } = setup()
    const first = await startOne(service, 'one0.docx')
    const second = await startOne(service, 'one1.docx')
    // finished with failures: kept for retry / dismiss, but the first to go when full
    batch.started[1]?.opts.onProgress({
      phase: 'done',
      done: 0,
      failed: 1,
      total: 1,
      sentBytes: 0,
      totalBytes: 10,
      failures: [{ path: 'one1.docx', code: 'network', retryable: true }],
    })
    for (let i = 2; i < 33; i += 1) await startOne(service, `one${i}.docx`)
    service.cancel(first)
    service.retry(second)
    expect(batch.calls).toEqual([`cancel:${first}`])
  })
})
