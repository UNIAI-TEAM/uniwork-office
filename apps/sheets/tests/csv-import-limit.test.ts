import { describe, expect, it } from 'vitest'

import { CSV_IMPORT_DEFAULT_LIMIT_MB } from '@genoffice/xlsx-gateway/gateway/csv-limits'

import { delimitedImportLimit, setDelimitedImportLimit } from '../src/main/csv-import-limit'
import { resolveCsvImportLimitMb } from '../src/renderer/data-tools-actions'

/**
 * The ceiling a delimited import may reach (a .csv/.tsv opened as a
 * workbook). The shell owns the setting and pushes the user's choice here.
 */

describe('the delimited import ceiling', () => {
  it('starts at the core default', () => {
    expect(delimitedImportLimit()).toBe(CSV_IMPORT_DEFAULT_LIMIT_MB * 1024 * 1024)
  })

  it('takes the ceiling the shell pushes', () => {
    setDelimitedImportLimit(512 * 1024 * 1024)
    expect(delimitedImportLimit()).toBe(512 * 1024 * 1024)
    setDelimitedImportLimit(CSV_IMPORT_DEFAULT_LIMIT_MB * 1024 * 1024)
  })

  it('refuses a ceiling that is not a whole number of bytes', () => {
    const before = delimitedImportLimit()
    setDelimitedImportLimit(0)
    expect(delimitedImportLimit()).toBe(before)
    setDelimitedImportLimit(-1)
    expect(delimitedImportLimit()).toBe(before)
    setDelimitedImportLimit(1.5)
    expect(delimitedImportLimit()).toBe(before)
  })
})

describe('resolveCsvImportLimitMb (handleImportCsv ceiling)', () => {
  it('clamps undefined, 0, non-finite, and rejected IPC results to CSV_IMPORT_DEFAULT_LIMIT_MB', async () => {
    await expect(resolveCsvImportLimitMb(undefined)).resolves.toBe(CSV_IMPORT_DEFAULT_LIMIT_MB)
    await expect(resolveCsvImportLimitMb(() => Promise.resolve(undefined))).resolves.toBe(
      CSV_IMPORT_DEFAULT_LIMIT_MB,
    )
    await expect(resolveCsvImportLimitMb(() => Promise.resolve(0))).resolves.toBe(
      CSV_IMPORT_DEFAULT_LIMIT_MB,
    )
    await expect(resolveCsvImportLimitMb(() => Promise.resolve(-64))).resolves.toBe(
      CSV_IMPORT_DEFAULT_LIMIT_MB,
    )
    await expect(resolveCsvImportLimitMb(() => Promise.resolve(Number.NaN))).resolves.toBe(
      CSV_IMPORT_DEFAULT_LIMIT_MB,
    )
    await expect(
      resolveCsvImportLimitMb(() => Promise.resolve(Number.POSITIVE_INFINITY)),
    ).resolves.toBe(CSV_IMPORT_DEFAULT_LIMIT_MB)
    await expect(
      resolveCsvImportLimitMb(() => Promise.reject(new Error('ipc unavailable'))),
    ).resolves.toBe(CSV_IMPORT_DEFAULT_LIMIT_MB)
  })

  it('honours a valid positive finite limit from the desktop bridge', async () => {
    await expect(resolveCsvImportLimitMb(() => Promise.resolve(64))).resolves.toBe(64)
    await expect(resolveCsvImportLimitMb(() => Promise.resolve(128))).resolves.toBe(128)
  })
})
