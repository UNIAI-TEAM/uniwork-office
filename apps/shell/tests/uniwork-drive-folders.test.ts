import { describe, expect, it, vi } from 'vitest'
import type { DriveFile } from '../src/shared/home-api'
import {
  deriveDriveFolders,
  driveFolderFileCount,
  driveFolderLabel,
  driveFolderShortLabel,
  attachFolderFiles,
  filterDriveFilesByName,
  serverDriveFolders,
  shortFolderId,
} from '../src/renderer/src/uniwork-home/drive-folders'
import {
  MAX_ACCOUNT_PAGES,
  fetchAllAccountFiles,
  type DriveFetchPage,
} from '../src/renderer/src/uniwork-home/use-drive-account-files'

function file(id: string, driveFolder?: DriveFile['driveFolder'], name = id): DriveFile {
  return { id, name, driveFolder } as DriveFile
}

const keys = (index: ReturnType<typeof deriveDriveFolders>) => index.folders.map((f) => f.key)

describe('deriveDriveFolders (UNI-2223 v2)', () => {
  it('orders named folders A-Z, then unnamed by id; no-folder files are kept apart', () => {
    const index = deriveDriveFolders(
      [
        file('a', null),
        file('b', { id: 'zzzzzz-folder', name: null }),
        file('c', { id: 'f_beta', name: 'Beta' }),
        file('d', { id: 'aaaaaa-folder', name: null }),
        file('e', { id: 'f_alpha', name: 'alpha' }),
        file('f'),
      ],
      'en',
    )
    expect(keys(index)).toEqual(['f_alpha', 'f_beta', 'aaaaaa-folder', 'zzzzzz-folder'])
    // null and absent parents are the same: files without a folder
    expect(index.looseFiles.map((f) => f.id)).toEqual(['a', 'f'])
  })

  it('collates numbers numerically', () => {
    const index = deriveDriveFolders(
      [
        file('a', { id: 'f10', name: 'Quý 10' }),
        file('b', { id: 'f2', name: 'Quý 2' }),
        file('c', { id: 'f1', name: 'Quý 1' }),
      ],
      'vi',
    )
    expect(index.folders.map((f) => f.name)).toEqual(['Quý 1', 'Quý 2', 'Quý 10'])
  })

  it('counts the files of each folder and keeps their arrival order', () => {
    const index = deriveDriveFolders(
      [
        file('a', { id: 'f1', name: 'One' }),
        file('b', { id: 'f2', name: 'Two' }),
        file('c', { id: 'f1', name: 'One' }),
      ],
      'en',
    )
    expect(index.folders.map((f) => [f.key, f.files.map((x) => x.id)])).toEqual([
      ['f1', ['a', 'c']],
      ['f2', ['b']],
    ])
    expect(index.looseFiles).toEqual([])
  })

  it('lets a readable name win when rows of one folder disagree', () => {
    const index = deriveDriveFolders(
      [file('a', { id: 'f1', name: null }), file('b', { id: 'f1', name: ' Hợp đồng ' })],
      'vi',
    )
    expect(index.folders).toHaveLength(1)
    expect(index.folders[0]?.name).toBe('Hợp đồng')
  })

  it('treats a blank name as unnamed and a malformed folder as none', () => {
    const index = deriveDriveFolders(
      [
        file('a', { id: 'f1', name: '   ' }),
        file('b', { id: '', name: 'x' }),
        file('c', 'oops' as unknown as DriveFile['driveFolder']),
      ],
      'en',
    )
    expect(index.folders.map((f) => [f.key, f.name])).toEqual([['f1', null]])
    expect(index.looseFiles.map((f) => f.id)).toEqual(['b', 'c'])
  })

  it('has no folder at all for an old server (no file carries drive_folder)', () => {
    const index = deriveDriveFolders([file('a'), file('b', null)], 'en')
    expect(index.folders).toEqual([])
    expect(index.looseFiles).toHaveLength(2)
  })
})

describe('serverDriveFolders and attachFolderFiles (UNI-2223 v3)', () => {
  it('turns the server list into nodes in the shared order; the no-folder group is not a node', () => {
    const nodes = serverDriveFolders(
      [
        { id: 'zzzzzz-folder', name: null, fileCount: 2 },
        { id: null, name: null, fileCount: 9 },
        { id: 'f10', name: 'Quý 10', fileCount: 1 },
        { id: 'aaaaaa-folder', name: '  ', fileCount: 4 },
        { id: 'f2', name: 'Quý 2', fileCount: 3 },
      ],
      'vi',
    )
    expect(nodes.map((n) => [n.key, n.name, n.count, n.shortId])).toEqual([
      ['f2', 'Quý 2', 3, 'f2'],
      ['f10', 'Quý 10', 1, 'f10'],
      ['aaaaaa-folder', null, 4, 'aaaaaa'],
      ['zzzzzz-folder', null, 2, 'zzzzzz'],
    ])
    // the count is the server's; the files come later from the walk
    expect(nodes.every((n) => n.files.length === 0)).toBe(true)
  })

  it('keeps one node per id and lets a readable name win', () => {
    const nodes = serverDriveFolders(
      [
        { id: 'f1', name: null, fileCount: 2 },
        { id: 'f1', name: 'Hợp đồng', fileCount: 5 },
      ],
      'en',
    )
    expect(nodes.map((n) => [n.key, n.name, n.count])).toEqual([['f1', 'Hợp đồng', 2]])
  })

  it('an empty or all-null list has no node', () => {
    expect(serverDriveFolders([], 'en')).toEqual([])
    expect(serverDriveFolders([{ id: null, name: null, fileCount: 3 }], 'en')).toEqual([])
  })

  it('puts each file in its listed folder and leaves the rest as files without a folder', () => {
    const nodes = serverDriveFolders(
      [
        { id: 'f1', name: 'One', fileCount: 2 },
        { id: 'f2', name: 'Two', fileCount: 0 },
      ],
      'en',
    )
    const out = attachFolderFiles(nodes, [
      file('a', { id: 'f1', name: 'One' }),
      file('b'),
      file('c', { id: 'f_unlisted', name: null }),
      file('d', { id: 'f1', name: 'One' }),
      file('e', null),
    ])
    expect(out.folders.map((f) => [f.key, f.count, f.files.map((x) => x.id)])).toEqual([
      ['f1', 2, ['a', 'd']],
      ['f2', 0, []],
    ])
    // an unlisted parent must not hide the file
    expect(out.looseFiles.map((f) => f.id)).toEqual(['b', 'c', 'e'])
    // the input nodes are not mutated
    expect(nodes.every((n) => n.files.length === 0)).toBe(true)
  })

  it('derived folders carry their file count', () => {
    const index = deriveDriveFolders(
      [file('a', { id: 'f1', name: 'One' }), file('b', { id: 'f1', name: 'One' })],
      'en',
    )
    expect(index.folders[0]?.count).toBe(2)
  })
})

describe('labels and counts', () => {
  const t = ((key: string, params?: Record<string, string | number>) =>
    `${key}:${params ? JSON.stringify(params) : ''}`) as Parameters<typeof driveFolderLabel>[1]

  it('a named folder reads its name, an unnamed one the short id', () => {
    expect(driveFolderLabel({ name: 'Báo giá', shortId: 'abcdef' }, t)).toBe('Báo giá')
    expect(driveFolderLabel({ name: null, shortId: 'abcdef' }, t)).toBe(
      'uhDriveFolderUnnamed:{"id":"abcdef"}',
    )
  })

  it('uses the short sidebar label only for unnamed folders', () => {
    expect(driveFolderShortLabel({ name: 'Báo giá', shortId: 'abcdef' }, t)).toBe('Báo giá')
    expect(driveFolderShortLabel({ name: null, shortId: 'abcdef' }, t)).toBe(
      'uhDriveFolderUnnamedShort:{"id":"abcdef"}',
    )
    expect(shortFolderId('abcdefghij')).toBe('abcdef')
  })

  it('picks the singular string for one file', () => {
    expect(driveFolderFileCount(1, t)).toBe('uhDriveFolderFilesOne:{"n":1}')
    expect(driveFolderFileCount(2, t)).toBe('uhDriveFolderFilesOther:{"n":2}')
  })
})

describe('filterDriveFilesByName', () => {
  const files = [
    file('a', null, 'Báo giá Q1'),
    file('b', null, 'Hợp đồng'),
    file('c', null, 'báo cáo'),
  ]

  it('matches a name part, ignoring case', () => {
    expect(filterDriveFilesByName(files, ' BÁO ').map((f) => f.id)).toEqual(['a', 'c'])
  })

  it('ignores accents and the d-stroke', () => {
    const vi = [
      file('x', null, 'Dự án Beta'),
      file('y', null, 'Đơn hàng'),
      file('z', null, 'Other'),
    ]
    expect(filterDriveFilesByName(vi, 'du an').map((f) => f.id)).toEqual(['x'])
    expect(filterDriveFilesByName(vi, 'don').map((f) => f.id)).toEqual(['y'])
    expect(filterDriveFilesByName(vi, 'ĐƠN').map((f) => f.id)).toEqual(['y'])
  })

  it('keeps every file for an empty query', () => {
    expect(filterDriveFilesByName(files, '  ')).toHaveLength(3)
  })
})

describe('fetchAllAccountFiles', () => {
  const page = (ids: string[], nextCursor: string | null) => ({
    ok: true as const,
    value: { files: ids.map((id) => file(id)), totalCount: 0, nextCursor },
  })

  it('walks every page of one account', async () => {
    const fetchPage = vi.fn<DriveFetchPage>(async (_acct, cursor) =>
      cursor ? page(['c', 'd'], null) : page(['a', 'b'], 'p2'),
    )
    const files = await fetchAllAccountFiles(fetchPage, 'dc-1')
    expect(files?.map((f) => f.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(fetchPage.mock.calls).toEqual([
      ['dc-1', undefined],
      ['dc-1', 'p2'],
    ])
  })

  it('gives up on the account when a page fails: a partial tree would lie about counts', async () => {
    const fetchPage = vi.fn<DriveFetchPage>(async (_acct, cursor) =>
      cursor ? { ok: false as const, error: 'network' as const } : page(['a'], 'p2'),
    )
    expect(await fetchAllAccountFiles(fetchPage, 'dc-1')).toBeNull()
  })

  it('gives up on a cursor chain longer than the cap instead of returning a partial list', async () => {
    const fetchPage = vi.fn<DriveFetchPage>(async () => page(['a'], 'again'))
    const files = await fetchAllAccountFiles(fetchPage, 'dc-1')
    expect(fetchPage).toHaveBeenCalledTimes(MAX_ACCOUNT_PAGES)
    expect(files).toBeNull()
  })

  it('drops the answer when the request went stale meanwhile', async () => {
    const fetchPage = vi.fn<DriveFetchPage>(async () => page(['a'], 'p2'))
    expect(await fetchAllAccountFiles(fetchPage, 'dc-1', () => true)).toBeNull()
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })
})
