import { describe, expect, it, vi } from 'vitest'
import type { DriveFile } from '../src/shared/home-api'
import {
  deriveDriveFolders,
  driveFolderFileCount,
  driveFolderLabel,
  filterDriveFilesByName,
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

describe('labels and counts', () => {
  const t = ((key: string, params?: Record<string, string | number>) =>
    `${key}:${params ? JSON.stringify(params) : ''}`) as Parameters<typeof driveFolderLabel>[1]

  it('a named folder reads its name, an unnamed one the short id', () => {
    expect(driveFolderLabel({ name: 'Báo giá', shortId: 'abcdef' }, t)).toBe('Báo giá')
    expect(driveFolderLabel({ name: null, shortId: 'abcdef' }, t)).toBe(
      'uhDriveFolderUnnamed:{"id":"abcdef"}',
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

  it('stops following a cursor chain that never ends', async () => {
    const fetchPage = vi.fn<DriveFetchPage>(async () => page(['a'], 'again'))
    const files = await fetchAllAccountFiles(fetchPage, 'dc-1')
    expect(fetchPage).toHaveBeenCalledTimes(MAX_ACCOUNT_PAGES)
    expect(files).toHaveLength(MAX_ACCOUNT_PAGES)
  })

  it('drops the answer when the request went stale meanwhile', async () => {
    const fetchPage = vi.fn<DriveFetchPage>(async () => page(['a'], 'p2'))
    expect(await fetchAllAccountFiles(fetchPage, 'dc-1', () => true)).toBeNull()
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })
})
