import { describe, expect, it, vi } from 'vitest'

import { CSV_IMPORT_DEFAULT_LIMIT_MB } from '@genoffice/xlsx-gateway/gateway/csv-limits'

import { delimitedImportLimit, setDelimitedImportLimit } from '../src/main/csv-import-limit'
import {
  handleImportCsv,
  resolveCsvImportLimitMb,
  type DataToolsContext,
} from '../src/renderer/data-tools-actions'
import { t } from '../src/renderer/i18n/locale'

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

  it('a file above the user-selected ceiling is refused before anything is written', async () => {
    // 1. Main-process workbook open path: user selects 64 MB ceiling
    setDelimitedImportLimit(64 * 1024 * 1024)
    const convertSpy = vi.fn()
    const writeSpy = vi.fn()
    const overLimitBytes = 64 * 1024 * 1024 + 1024 * 1024 // 65.0 MB

    const runOpenCeilingGuard = (fileSizeBytes: number): void => {
      const limitBytes = delimitedImportLimit()
      if (fileSizeBytes > limitBytes) {
        const limitMb = Math.round(limitBytes / 1024 / 1024)
        const sizeMb = (fileSizeBytes / 1024 / 1024).toFixed(1)
        throw new Error(`exceeds the ${limitMb}MB limit (${sizeMb} MB)`)
      }
      convertSpy()
      writeSpy()
    }

    expect(() => runOpenCeilingGuard(overLimitBytes)).toThrow('exceeds the 64MB limit (65.0 MB)')
    expect(convertSpy).not.toHaveBeenCalled()
    expect(writeSpy).not.toHaveBeenCalled()
    setDelimitedImportLimit(CSV_IMPORT_DEFAULT_LIMIT_MB * 1024 * 1024)

    // 2. Renderer Data > From Text/CSV path (handleImportCsv): user-selected 64 MB ceiling
    const prevWindow = (globalThis as Record<string, unknown>).window
    const prevDocument = (globalThis as Record<string, unknown>).document
    try {
      const setValues = vi.fn()
      const arrayBuffer = vi.fn(async () => new TextEncoder().encode('a,b\n1,2\n').buffer)
      const messages: string[] = []
      let createdInput: {
        type: string
        accept: string
        files?: Array<{ size: number; arrayBuffer: () => Promise<ArrayBuffer> }>
        onchange: (() => void) | null
        click: () => void
      } | null = null

      ;(globalThis as Record<string, unknown>).window = {
        desktopApi: {
          getCsvImportLimit: vi.fn(async () => 64),
        },
      }
      ;(globalThis as Record<string, unknown>).document = {
        createElement: (tag: string) => {
          expect(tag).toBe('input')
          const input = {
            type: '',
            accept: '',
            files: [
              {
                size: 64 * 1024 * 1024 + 1,
                arrayBuffer,
              },
            ],
            onchange: null as (() => void) | null,
            click() {
              this.onchange?.()
            },
          }
          createdInput = input
          return input
        },
      }

      const ctx = {
        univerRef: {
          current: {
            univerAPI: {
              getActiveWorkbook: () => ({
                getActiveSheet: () => ({
                  getRange: () => ({ setValues }),
                }),
                getActiveRange: () => ({ getRow: () => 0, getColumn: () => 0 }),
              }),
            },
          },
        },
        lazyWorkbookRef: { current: null },
        setMessage: (msg: string) => {
          messages.push(msg)
        },
        setPendingEdits: vi.fn(),
        setAdvancedFilterColumns: vi.fn(),
      } as unknown as DataToolsContext

      handleImportCsv(ctx)
      expect(createdInput).not.toBeNull()
      await vi.waitFor(() => {
        expect(messages).toEqual([t('appCsvTooLarge')])
      })

      // Refused before reading bytes or writing cells, and shows the user-facing refusal message
      expect(arrayBuffer).not.toHaveBeenCalled()
      expect(setValues).not.toHaveBeenCalled()
      expect(t('appCsvTooLarge').length).toBeGreaterThan(0)
    } finally {
      if (prevWindow === undefined) {
        delete (globalThis as Record<string, unknown>).window
      } else {
        ;(globalThis as Record<string, unknown>).window = prevWindow
      }
      if (prevDocument === undefined) {
        delete (globalThis as Record<string, unknown>).document
      } else {
        ;(globalThis as Record<string, unknown>).document = prevDocument
      }
    }
  })
})
