import { describe, expect, it } from 'vitest'
import type { DriveFile } from '../src/shared/home-api'
import {
  UNKNOWN_FOLDER_KEY,
  driveFolderGroupCount,
  driveFolderGroupLabel,
  groupDriveFilesByFolder,
  shortFolderId,
} from '../src/renderer/src/uniwork-home/drive-folder-groups'

function file(id: string, driveFolder?: DriveFile['driveFolder']): DriveFile {
  return { id, name: id, driveFolder } as DriveFile
}

const keys = (groups: ReturnType<typeof groupDriveFilesByFolder>) => groups?.map((g) => g.key)

describe('groupDriveFilesByFolder (UNI-2172 contract)', () => {
  it('orders named groups A-Z, then unnamed by short id, then the unknown group last', () => {
    const groups = groupDriveFilesByFolder(
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
    expect(keys(groups)).toEqual([
      'f_alpha',
      'f_beta',
      'aaaaaa-folder',
      'zzzzzz-folder',
      UNKNOWN_FOLDER_KEY,
    ])
    expect(groups?.map((g) => g.kind)).toEqual(['named', 'named', 'unnamed', 'unnamed', 'unknown'])
    // null and absent parents share the one last group
    expect(groups?.at(-1)?.files.map((f) => f.id)).toEqual(['a', 'f'])
  })

  it('compares names by the locale and keeps the incoming file order inside a group', () => {
    const files = [
      file('1', { id: 'f_z', name: 'Zebra' }),
      file('2', { id: 'f_a', name: 'Ärger' }),
      file('3', { id: 'f_z', name: 'Zebra' }),
      file('4', { id: 'f_a', name: 'Ärger' }),
    ]
    const groups = groupDriveFilesByFolder(files, 'de')
    expect(groups?.map((g) => g.name)).toEqual(['Ärger', 'Zebra'])
    expect(groups?.[0]?.files.map((f) => f.id)).toEqual(['2', '4'])
    expect(groups?.[1]?.files.map((f) => f.id)).toEqual(['1', '3'])
  })

  it('orders names with numbers naturally and unnamed ids by code unit, like the web', () => {
    const named = groupDriveFilesByFolder(
      [file('1', { id: 'f_10', name: 'Dự án 10' }), file('2', { id: 'f_2', name: 'Dự án 2' })],
      'vi',
    )
    expect(named?.map((g) => g.name)).toEqual(['Dự án 2', 'Dự án 10'])
    const unnamed = groupDriveFilesByFolder(
      [file('1', { id: 'abd000', name: null }), file('2', { id: 'Abc123', name: null })],
      'en',
    )
    expect(keys(unnamed)).toEqual(['Abc123', 'abd000'])
  })

  it('returns null (flat list) when every file is unknown, and for an empty list', () => {
    expect(groupDriveFilesByFolder([file('a'), file('b', null)], 'en')).toBeNull()
    expect(groupDriveFilesByFolder([], 'en')).toBeNull()
  })

  it('a single known folder still groups (the unknown files go to the last group)', () => {
    const groups = groupDriveFilesByFolder(
      [file('a', { id: 'f1', name: 'Hợp đồng' }), file('b')],
      'vi',
    )
    expect(keys(groups)).toEqual(['f1', UNKNOWN_FOLDER_KEY])
  })

  it('counts follow the files it is given, so a filtered set never shows an empty group', () => {
    const all = [
      file('1', { id: 'f_a', name: 'A' }),
      file('2', { id: 'f_b', name: 'B' }),
      file('3', { id: 'f_b', name: 'B' }),
    ]
    expect(groupDriveFilesByFolder(all, 'en')?.map((g) => g.files.length)).toEqual([1, 2])
    const filtered = groupDriveFilesByFolder(
      all.filter((f) => f.id !== '1'),
      'en',
    )
    expect(filtered?.map((g) => [g.key, g.files.length])).toEqual([['f_b', 2]])
  })

  it('a readable name wins when rows of one folder disagree, and a blank name reads as unnamed', () => {
    const groups = groupDriveFilesByFolder(
      [
        file('1', { id: 'f_x', name: null }),
        file('2', { id: 'f_x', name: 'Báo cáo' }),
        file('3', { id: 'f_y', name: '  ' }),
      ],
      'vi',
    )
    expect(groups?.map((g) => [g.key, g.kind, g.name])).toEqual([
      ['f_x', 'named', 'Báo cáo'],
      ['f_y', 'unnamed', null],
    ])
  })
})

describe('driveFolderGroupLabel / driveFolderGroupCount', () => {
  const t = (key: string, params?: Record<string, string | number>) =>
    `${key}:${JSON.stringify(params ?? {})}`
  it('names a group by its name, its first 6 id characters, or the unknown label', () => {
    expect(shortFolderId('1FoLdErIdAbCd')).toBe('1FoLdE')
    const [named, unnamed, unknown] = groupDriveFilesByFolder(
      [
        file('1', { id: '1FoLdErIdAbCd', name: null }),
        file('2', { id: 'f_n', name: 'Ra mắt' }),
        file('3'),
      ],
      'en',
    )!
    expect(driveFolderGroupLabel(named!, t as never)).toBe('Ra mắt')
    expect(driveFolderGroupLabel(unnamed!, t as never)).toBe('uhDriveGroupUnnamed:{"id":"1FoLdE"}')
    expect(driveFolderGroupLabel(unknown!, t as never)).toBe('uhDriveGroupUnknown:{}')
  })
  it('picks the singular or the plural count string', () => {
    expect(driveFolderGroupCount(1, t as never)).toBe('uhDriveGroupCountOne:{"n":1}')
    expect(driveFolderGroupCount(3, t as never)).toBe('uhDriveGroupCountOther:{"n":3}')
  })
})
