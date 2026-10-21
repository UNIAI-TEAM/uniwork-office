import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { planFolderUpload } from '../src/main/uniwork-docs/folder-upload/plan'
import {
  filesEntries,
  mergeScanSkips,
  scanFolder,
  type ScanLimits,
} from '../src/main/uniwork-docs/folder-upload/scan'
import type { FolderUploadLimits } from '../src/main/uniwork-docs/folder-upload/types'

const LIMITS: ScanLimits = { maxFiles: 500, maxDepth: 20 }
const PLAN_LIMITS: FolderUploadLimits = {
  maxFiles: 500,
  maxTotalBytes: 2 * 1024 ** 3,
  maxDepth: 20,
  perFileMaxBytes: 200 * 1024 * 1024,
}
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0
const canSymlink = process.platform !== 'win32'

let tmp: string

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'folder-upload-scan-'))
})

afterEach(async () => {
  // a test may leave a chmod 000 directory behind
  await chmod(join(tmp, 'Root', 'locked'), 0o755).catch(() => undefined)
  await rm(tmp, { recursive: true, force: true })
})

async function put(rel: string, content = 'x'): Promise<void> {
  const full = join(tmp, ...rel.split('/'))
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, content)
}

const root = (): string => join(tmp, 'Root')

describe('scanFolder', () => {
  it('lists nested files as POSIX paths whose first segment is the root folder name', async () => {
    await put('Root/a.docx', 'abc')
    await put('Root/sub/b.pdf', '12345')
    await put('Root/sub/deep/c.txt', '')
    const scan = await scanFolder(root(), LIMITS)
    expect(scan.truncated).toBeNull()
    expect(scan.skipped).toEqual([])
    expect([...scan.entries].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'Root/a.docx', size: 3 },
      { path: 'Root/sub/b.pdf', size: 5 },
      { path: 'Root/sub/deep/c.txt', size: 0 },
    ])
  })

  it('returns entries in a stable order whatever the directory order', async () => {
    for (const name of ['b.txt', 'a.txt', 'c/z.txt', 'c/y.txt']) await put(`Root/${name}`)
    const first = await scanFolder(root(), LIMITS)
    const second = await scanFolder(root(), LIMITS)
    expect(second.entries).toEqual(first.entries)
    expect(first.entries.map((e) => e.path)).toEqual([
      'Root/a.txt',
      'Root/b.txt',
      'Root/c/y.txt',
      'Root/c/z.txt',
    ])
  })

  it('gives an empty folder no entries (the planner then refuses nothing_to_upload)', async () => {
    await mkdir(join(root(), 'empty', 'inner'), { recursive: true })
    const scan = await scanFolder(root(), LIMITS)
    expect(scan.entries).toEqual([])
    const plan = planFolderUpload(scan.entries, {
      limits: PLAN_LIMITS,
      parentLevel: 1,
      siblingNames: [],
    })
    expect(plan.refusal).toEqual({ code: 'nothing_to_upload' })
  })

  it('keeps empty sub-folders out of the entry list but not other files beside them', async () => {
    await mkdir(join(root(), 'empty'), { recursive: true })
    await put('Root/a.txt')
    const scan = await scanFolder(root(), LIMITS)
    expect(scan.entries.map((e) => e.path)).toEqual(['Root/a.txt'])
  })

  it('lists hidden files so the planner reports them, but never opens a hidden directory', async () => {
    await put('Root/.hidden-notes.txt')
    await put('Root/.git/objects/aa', 'blob')
    await put('Root/__MACOSX/._a.txt')
    await put('Root/visible.txt')
    const scan = await scanFolder(root(), LIMITS)
    expect(scan.entries.map((e) => e.path)).toEqual(['Root/.hidden-notes.txt', 'Root/visible.txt'])
    const plan = planFolderUpload(scan.entries, {
      limits: PLAN_LIMITS,
      parentLevel: 1,
      siblingNames: [],
    })
    expect(plan.skipped).toEqual([{ path: 'Root/.hidden-notes.txt', reason: 'hidden' }])
    expect(plan.files.map((f) => f.path)).toEqual(['Root/visible.txt'])
  })

  it.skipIf(!canSymlink)('skips a symlink to a file with the reason link', async () => {
    await put('outside.txt', 'secret')
    await put('Root/a.txt')
    await symlink(join(tmp, 'outside.txt'), join(root(), 'alias.txt'))
    const scan = await scanFolder(root(), LIMITS)
    expect(scan.entries.map((e) => e.path)).toEqual(['Root/a.txt'])
    expect(scan.skipped).toEqual([{ path: 'Root/alias.txt', reason: 'link' }])
  })

  it.skipIf(!canSymlink)('does not follow a symlink to a directory', async () => {
    await put('Outside/leak.txt', 'secret')
    await put('Root/a.txt')
    await symlink(join(tmp, 'Outside'), join(root(), 'dirlink'), 'dir')
    const scan = await scanFolder(root(), LIMITS)
    expect(scan.entries.map((e) => e.path)).toEqual(['Root/a.txt'])
    expect(scan.skipped).toEqual([{ path: 'Root/dirlink', reason: 'link' }])
  })

  it.skipIf(!canSymlink)('survives a symlink loop without descending', async () => {
    await put('Root/sub/a.txt')
    await symlink(root(), join(root(), 'sub', 'loop'), 'dir')
    const scan = await scanFolder(root(), LIMITS)
    expect(scan.truncated).toBeNull()
    expect(scan.entries.map((e) => e.path)).toEqual(['Root/sub/a.txt'])
    expect(scan.skipped).toEqual([{ path: 'Root/sub/loop', reason: 'link' }])
  })

  it.skipIf(!canSymlink)('skips the picked folder itself when it is a link', async () => {
    await put('Real/a.txt')
    await symlink(join(tmp, 'Real'), root(), 'dir')
    const scan = await scanFolder(root(), LIMITS)
    expect(scan.entries).toEqual([])
    expect(scan.skipped).toEqual([{ path: 'Root', reason: 'link' }])
  })

  it.skipIf(isRoot || process.platform === 'win32')(
    'skips an unreadable directory with the reason unreadable and keeps scanning',
    async () => {
      await put('Root/a.txt')
      await put('Root/locked/secret.txt')
      await chmod(join(root(), 'locked'), 0o000)
      const scan = await scanFolder(root(), LIMITS)
      expect(scan.entries.map((e) => e.path)).toEqual(['Root/a.txt'])
      expect(scan.skipped).toEqual([{ path: 'Root/locked', reason: 'unreadable' }])
    },
  )

  it('skips the picked folder with the reason unreadable when it does not exist', async () => {
    const scan = await scanFolder(join(tmp, 'Missing'), LIMITS)
    expect(scan.entries).toEqual([])
    expect(scan.skipped).toEqual([{ path: 'Missing', reason: 'unreadable' }])
  })

  describe('depth limit', () => {
    // root is depth 0; a directory deeper than maxDepth + 1 is never opened
    it('opens directories down to maxDepth + 1 and is not truncated there', async () => {
      await put('Root/a/b/c/leaf.txt') // c is depth 3 = maxDepth + 1
      const scan = await scanFolder(root(), { maxFiles: 500, maxDepth: 2 })
      expect(scan.truncated).toBeNull()
      expect(scan.entries.map((e) => e.path)).toEqual(['Root/a/b/c/leaf.txt'])
    })

    it('flags truncated depth when a directory lies below maxDepth + 1', async () => {
      await put('Root/top.txt')
      await put('Root/a/b/c/d/leaf.txt') // d is depth 4 > maxDepth + 1
      const scan = await scanFolder(root(), { maxFiles: 500, maxDepth: 2 })
      expect(scan.truncated).toBe('depth')
      expect(scan.entries.map((e) => e.path)).not.toContain('Root/a/b/c/d/leaf.txt')
    })

    it('does not flag an empty directory below the limit when nothing was cut off', async () => {
      await mkdir(join(root(), 'a', 'b', 'c'), { recursive: true })
      const scan = await scanFolder(root(), { maxFiles: 500, maxDepth: 2 })
      expect(scan.truncated).toBeNull()
    })
  })

  describe('early stop', () => {
    it('stops past maxFiles * 2 uploadable files and flags truncated entries', async () => {
      for (let i = 0; i < 12; i += 1) await put(`Root/f${String(i).padStart(2, '0')}.txt`)
      const scan = await scanFolder(root(), { maxFiles: 5, maxDepth: 20 })
      expect(scan.truncated).toBe('entries')
      // bound is 10 uploadable files: it stops at bound + 1
      expect(scan.entries.length).toBe(11)
    })

    it('does not stop at exactly maxFiles * 2 files', async () => {
      for (let i = 0; i < 10; i += 1) await put(`Root/f${i}.txt`)
      const scan = await scanFolder(root(), { maxFiles: 5, maxDepth: 20 })
      expect(scan.truncated).toBeNull()
      expect(scan.entries.length).toBe(10)
    })

    it('counts only files the planner would upload toward the bound', async () => {
      for (let i = 0; i < 30; i += 1) await put(`Root/junk${i}.exe`)
      for (let i = 0; i < 3; i += 1) await put(`Root/ok${i}.txt`)
      const scan = await scanFolder(root(), { maxFiles: 5, maxDepth: 20 })
      expect(scan.truncated).toBeNull()
      expect(scan.entries.length).toBe(33)
    })

    it('honours the server extension list when counting', async () => {
      for (let i = 0; i < 30; i += 1) await put(`Root/f${i}.txt`)
      const scan = await scanFolder(root(), {
        maxFiles: 5,
        maxDepth: 20,
        uploadExtensions: ['pdf'],
      })
      expect(scan.truncated).toBeNull()
    })

    it('stops on a flood of entries the planner would skip (hard ceiling)', async () => {
      for (let i = 0; i < 25; i += 1) await put(`Root/junk${String(i).padStart(2, '0')}.exe`)
      const scan = await scanFolder(root(), { maxFiles: 1, maxDepth: 20 })
      expect(scan.truncated).toBe('entries')
      expect(scan.entries.length).toBeLessThan(25)
    })

    it('lets a truncated scan force a refusal even when the planner saw too few files', async () => {
      for (let i = 0; i < 12; i += 1) await put(`Root/f${String(i).padStart(2, '0')}.txt`)
      const limits = { ...PLAN_LIMITS, maxFiles: 5 }
      const scan = await scanFolder(root(), { maxFiles: 5, maxDepth: 20 })
      const merged = mergeScanSkips(
        planFolderUpload(scan.entries, { limits, parentLevel: 1, siblingNames: [] }),
        scan,
        limits,
      )
      expect(merged.refusal).toEqual({ code: 'too_many_files', limit: 5, actual: 11 })
    })
  })
})

describe('mergeScanSkips', () => {
  const opts = { limits: PLAN_LIMITS, parentLevel: 1, siblingNames: [] as string[] }
  const clean = { entries: [], skipped: [], truncated: null } as const

  it('appends the app-only skips after the planner skips', async () => {
    await put('Root/a.txt')
    await put('Root/x.exe')
    const scan = await scanFolder(root(), LIMITS)
    const plan = planFolderUpload(scan.entries, opts)
    const merged = mergeScanSkips(
      plan,
      {
        ...scan,
        skipped: [
          { path: 'Root/l', reason: 'link' },
          { path: 'Root/d', reason: 'unreadable' },
        ],
      },
      PLAN_LIMITS,
    )
    expect(merged.skipped).toEqual([
      { path: 'Root/x.exe', reason: 'unsupported_format' },
      { path: 'Root/l', reason: 'link' },
      { path: 'Root/d', reason: 'unreadable' },
    ])
    expect(merged.files).toEqual(plan.files)
    expect(merged.refusal).toBeNull()
  })

  it('does not mutate the plan it is given', () => {
    const plan = planFolderUpload([{ path: 'R/a.pdf', size: 1 }], opts)
    mergeScanSkips(plan, { ...clean, skipped: [{ path: 'R/l', reason: 'link' }] }, PLAN_LIMITS)
    expect(plan.skipped).toEqual([])
  })

  it('turns a nothing_to_upload plan of a depth-truncated scan into too_deep', () => {
    const plan = planFolderUpload([], opts)
    const merged = mergeScanSkips(plan, { ...clean, truncated: 'depth' }, PLAN_LIMITS)
    expect(merged.refusal).toEqual({ code: 'too_deep', limit: 20, actual: 21 })
  })

  it('turns a clean plan of an entry-truncated scan into too_many_files', () => {
    const plan = planFolderUpload([{ path: 'R/a.pdf', size: 1 }], opts)
    const merged = mergeScanSkips(plan, { ...clean, truncated: 'entries' }, PLAN_LIMITS)
    expect(merged.refusal).toEqual({ code: 'too_many_files', limit: 500, actual: 501 })
  })

  it('keeps a real refusal the planner already found', () => {
    const plan = planFolderUpload(
      [
        { path: 'R/a.pdf', size: 10 },
        { path: 'S/b.pdf', size: 10 },
      ],
      opts,
    )
    const merged = mergeScanSkips(plan, { ...clean, truncated: 'entries' }, PLAN_LIMITS)
    expect(merged.refusal?.code).toBe('multiple_roots')
  })

  it('leaves a complete scan alone', () => {
    const plan = planFolderUpload([{ path: 'R/a.pdf', size: 1 }], opts)
    expect(mergeScanSkips(plan, clean, PLAN_LIMITS)).toEqual(plan)
  })
})

describe('filesEntries (files mode)', () => {
  it('maps picked files to their basename and size', async () => {
    await put('Docs/one.pdf', '123')
    await put('Other/two.docx', '12345')
    const result = await filesEntries([
      join(tmp, 'Docs', 'one.pdf'),
      join(tmp, 'Other', 'two.docx'),
    ])
    expect(result.skipped).toEqual([])
    expect(result.entries).toEqual([
      { path: 'one.pdf', size: 3 },
      { path: 'two.docx', size: 5 },
    ])
  })

  it('keeps two files with the same name (the planner never renames them)', async () => {
    await put('A/same.pdf', '1')
    await put('B/same.pdf', '22')
    const result = await filesEntries([join(tmp, 'A', 'same.pdf'), join(tmp, 'B', 'same.pdf')])
    expect(result.entries).toEqual([
      { path: 'same.pdf', size: 1 },
      { path: 'same.pdf', size: 2 },
    ])
  })

  it('rejects a directory with the reason not_a_file', async () => {
    await mkdir(join(tmp, 'Folder'), { recursive: true })
    await put('f.txt')
    const result = await filesEntries([join(tmp, 'Folder'), join(tmp, 'f.txt')])
    expect(result.entries).toEqual([{ path: 'f.txt', size: 1 }])
    expect(result.skipped).toEqual([{ path: 'Folder', reason: 'not_a_file' }])
  })

  it.skipIf(!canSymlink)('rejects a symlink to a file and a symlink to a directory', async () => {
    await put('real.txt', 'abc')
    await mkdir(join(tmp, 'RealDir'), { recursive: true })
    await symlink(join(tmp, 'real.txt'), join(tmp, 'file-link.txt'))
    await symlink(join(tmp, 'RealDir'), join(tmp, 'dir-link'), 'dir')
    const result = await filesEntries([join(tmp, 'file-link.txt'), join(tmp, 'dir-link')])
    expect(result.entries).toEqual([])
    expect(result.skipped).toEqual([
      { path: 'file-link.txt', reason: 'link' },
      { path: 'dir-link', reason: 'link' },
    ])
  })

  it('reports a path that cannot be read as unreadable', async () => {
    const result = await filesEntries([join(tmp, 'gone.pdf')])
    expect(result.entries).toEqual([])
    expect(result.skipped).toEqual([{ path: 'gone.pdf', reason: 'unreadable' }])
  })

  it('feeds the files planner (hidden and unsupported are still the planner’s call)', async () => {
    await put('Docs/ok.pdf')
    await put('Docs/.secret.txt')
    const { planFileUpload } = await import('../src/main/uniwork-docs/folder-upload/plan')
    const { entries } = await filesEntries([
      join(tmp, 'Docs', 'ok.pdf'),
      join(tmp, 'Docs', '.secret.txt'),
    ])
    const plan = planFileUpload(entries, { limits: PLAN_LIMITS })
    expect(plan.files.map((f) => f.filename)).toEqual(['ok.pdf'])
    expect(plan.skipped).toEqual([{ path: '.secret.txt', reason: 'hidden' }])
  })
})
