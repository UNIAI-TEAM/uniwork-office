import { describe, expect, it } from 'vitest'
import { format } from '@genoffice/i18n'
import { uniworkHomeStrings } from '../src/renderer/src/i18n/strings-uniwork-home'
import type { StringKey, TFunc } from '../src/renderer/src/locale'
import {
  failureReasonMessage,
  formatRunSize,
  groupSkipped,
  hasRetryable,
  pluralKey,
  refusalMessage,
  skipReasonLabel,
} from '../src/renderer/src/uniwork-folder-upload/copy'

const MIB = 1024 * 1024
const GIB = 1024 * MIB

const table =
  (lang: 'vi' | 'en'): TFunc =>
  (key: StringKey, params) =>
    format((uniworkHomeStrings[lang] as Record<string, string>)[key]!, params)
const vi = table('vi')
const en = table('en')

describe('folder-upload copy', () => {
  describe('sizes', () => {
    it('reads a tree of a few KB in KB, never "0 MB"', () => {
      expect(formatRunSize(2900, 'en-US')).toBe('2.8 KB')
      expect(formatRunSize(0, 'en-US')).toBe('0 B')
    })

    it('reads megabytes with the locale decimal mark and gigabytes in GB', () => {
      expect(formatRunSize(125.3 * MIB, 'vi-VN')).toBe('125,3 MB')
      expect(formatRunSize(30 * MIB, 'en-US')).toBe('30 MB')
      expect(formatRunSize(2 * GIB, 'en-US')).toBe('2 GB')
    })
  })

  it('picks the One key at exactly 1', () => {
    expect(pluralKey('fuDlgSummary', 1)).toBe('fuDlgSummaryOne')
    expect(pluralKey('fuDlgSummary', 0)).toBe('fuDlgSummary')
    expect(pluralKey('fuDlgSummary', 12)).toBe('fuDlgSummary')
  })

  describe('skipped files', () => {
    it('groups by reason in a fixed order and keeps each path', () => {
      const groups = groupSkipped([
        { path: 'a/.DS_Store', reason: 'hidden' },
        { path: 'a/x.dat', reason: 'unsupported_format' },
        { path: 'a/link', reason: 'link' },
        { path: 'a/.env', reason: 'hidden' },
        { path: 'a/huge.pdf', reason: 'too_large' },
      ])
      expect(groups).toEqual([
        { reason: 'hidden', paths: ['a/.DS_Store', 'a/.env'] },
        { reason: 'unsupported_format', paths: ['a/x.dat'] },
        { reason: 'too_large', paths: ['a/huge.pdf'] },
        { reason: 'link', paths: ['a/link'] },
      ])
    })

    it('folds a reason this build has no sentence for into "invalid path"', () => {
      expect(groupSkipped([{ path: 'a/z', reason: 'mystery' }])).toEqual([
        { reason: 'invalid_path', paths: ['a/z'] },
      ])
      expect(skipReasonLabel(en, 'mystery')).toBe('Invalid path')
    })

    it('has a sentence for the three reasons only the app can see', () => {
      expect(skipReasonLabel(en, 'link')).toBe('Shortcut or link (not followed)')
      expect(skipReasonLabel(en, 'unreadable')).toBe('Couldn’t be read')
      expect(skipReasonLabel(en, 'not_a_file')).toBe('Not a regular file')
      expect(skipReasonLabel(vi, 'hidden')).toBe('Tệp ẩn hoặc tệp hệ thống')
    })
  })

  describe('refusal sentences carry the numbers', () => {
    it('files and folders: "612 tệp — tối đa 500"', () => {
      expect(
        refusalMessage(vi, { code: 'too_many_files', limit: 500, actual: 612 }, 'folder', 'vi-VN'),
      ).toBe('612 tệp — tối đa 500')
      expect(
        refusalMessage(
          en,
          { code: 'too_many_folders', limit: 500, actual: 1200 },
          'folder',
          'en-US',
        ),
      ).toBe('1,200 folders — 500 at most')
    })

    it('total size rounds the actual up so it never reads equal to its limit', () => {
      expect(
        refusalMessage(
          en,
          { code: 'too_large_total', limit: 2 * GIB, actual: 2 * GIB + 1 },
          'folder',
          'en-US',
        ),
      ).toBe('2.1 GB — 2 GB at most')
      expect(
        refusalMessage(
          vi,
          { code: 'too_large_total', limit: 500 * MIB, actual: 500 * MIB + 1 },
          'folder',
          'vi-VN',
        ),
      ).toBe('500,1 MB — tối đa 500 MB')
    })

    it('depth reads differently in files mode', () => {
      expect(
        refusalMessage(en, { code: 'too_deep', limit: 20, actual: 22 }, 'folder', 'en-US'),
      ).toBe('22 levels deep — 20 at most')
      expect(
        refusalMessage(en, { code: 'too_deep', limit: 20, actual: 21 }, 'files', 'en-US'),
      ).toBe('The files would sit 21 levels deep — 20 at most')
    })

    it('says folder or files for "nothing to upload", and has a generic sentence for a new code', () => {
      expect(refusalMessage(en, { code: 'nothing_to_upload' }, 'folder', 'en-US')).toBe(
        'This folder has no files that can be uploaded.',
      )
      expect(refusalMessage(en, { code: 'nothing_to_upload' }, 'files', 'en-US')).toBe(
        'None of these files can be uploaded.',
      )
      expect(refusalMessage(en, { code: 'future_code' }, 'folder', 'en-US')).toBe(
        'This folder is over the upload limits.',
      )
      expect(refusalMessage(en, { code: 'future_code' }, 'files', 'en-US')).toBe(
        'These files are over the upload limits.',
      )
    })
  })

  describe('failure reasons', () => {
    it('one sentence per code, any http_5nn is the server-down sentence', () => {
      expect(failureReasonMessage(en, 'network')).toBe(
        'The connection dropped while uploading this file.',
      )
      expect(failureReasonMessage(en, 'http_503')).toBe('The server isn’t responding right now.')
      expect(failureReasonMessage(en, 'unreadable')).toContain('Couldn’t read this file')
      expect(failureReasonMessage(vi, 'storage_quota_exceeded')).toContain('Đã hết dung lượng')
    })

    it('a code this build does not know reads as the plain sentence', () => {
      expect(failureReasonMessage(en, 'something_new')).toBe('This file couldn’t be uploaded.')
    })

    it('offers a retry only when a failure is retryable', () => {
      expect(hasRetryable([{ path: 'a', code: 'network', retryable: true }])).toBe(true)
      expect(
        hasRetryable([
          { path: 'a', code: 'unsupported_media', retryable: false },
          { path: 'b', code: 'storage_quota_exceeded', retryable: false },
        ]),
      ).toBe(false)
      expect(hasRetryable([])).toBe(false)
    })
  })
})
