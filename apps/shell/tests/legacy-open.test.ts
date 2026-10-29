import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { convertedDocumentFor } from '@genoffice/electron-utils'
import { LANGS } from '@genoffice/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LegacyConvertError, type ConvertLegacyResult } from '../src/main/legacy-converter'
import {
  createLegacyOpener,
  legacyErrorMessage,
  legacyProgressDetailKey,
  type LegacyOpenDeps,
} from '../src/main/legacy-open'
import { nameParts } from '../src/renderer/src/uniwork-folders/SaveDialog'
import { tLegacyOpen, type LegacyOpenStringKey } from '../src/main/legacy-open-strings'

const t: LegacyOpenDeps['t'] = (key: LegacyOpenStringKey, params) => tLegacyOpen('en', key, params)

let root: string
let importRoot: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'legacy-open-test-'))
  importRoot = join(root, 'genoffice-imports')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function converted(
  targetFormat: 'docx' | 'xlsx' | 'pptx',
  originalPath: string,
): ConvertLegacyResult {
  return {
    kind: 'converted',
    sourceFormat: targetFormat === 'docx' ? 'doc' : targetFormat === 'xlsx' ? 'xls' : 'ppt',
    targetFormat,
    bytes: new Uint8Array([80, 75, 3, 4]),
    suggestedSaveAsPath: originalPath.replace(/\.[^.]+$/, `.${targetFormat}`),
  }
}

interface Harness {
  deps: LegacyOpenDeps
  opened: ConvertedDocument[]
  notices: string[]
  recents: string[]
  progress: { begun: string[]; ended: number; cancel: (() => void) | null }
  openPaths: Set<string>
  xlsOpened: string[]
}

function harness(
  convert: LegacyOpenDeps['convert'],
  overrides: Partial<LegacyOpenDeps> = {},
): Harness {
  const h: Harness = {
    deps: undefined as never,
    opened: [],
    notices: [],
    recents: [],
    progress: { begun: [], ended: 0, cancel: null },
    openPaths: new Set(),
    xlsOpened: [],
  }
  h.deps = {
    convert,
    importRoot: () => importRoot,
    openConverted: (doc) => {
      h.opened.push(doc)
      h.openPaths.add(doc.tempPath)
    },
    activateConverted: (doc) => h.openPaths.has(doc.tempPath),
    isPathOpen: (path) => h.openPaths.has(path),
    openXlsValuesOnly: (path) => {
      h.xlsOpened.push(path)
      return true
    },
    recordRecent: (path) => h.recents.push(path),
    beginProgress: (name, cancel) => {
      h.progress.begun.push(name)
      h.progress.cancel = cancel
      return () => {
        h.progress.ended++
      }
    },
    notice: (message) => h.notices.push(message),
    t,
    ...overrides,
  }
  return h
}

/** the opener runs in the background; wait for it to settle */
async function settle(): Promise<void> {
  await vi.waitFor(() => expect(true).toBe(true))
  await new Promise((resolve) => setTimeout(resolve, 20))
}

describe('createLegacyOpener', () => {
  it('converts, writes the OOXML into its own temp dir and opens it with the Save As suggestion', async () => {
    const convert = vi.fn(async (path: string) => converted('docx', path))
    const h = harness(convert)
    const opener = createLegacyOpener(h.deps)

    expect(opener.open('/work/Report.doc')).toBe(true)
    await vi.waitFor(() => expect(h.opened).toHaveLength(1))

    const [doc] = h.opened
    expect(doc!.kind).toBe('docs')
    expect(doc!.originalPath).toBe('/work/Report.doc')
    expect(doc!.suggestSaveAs).toBe('/work/Report.docx')
    expect(doc!.tempPath).toBe(join(doc!.tempDir, 'Report.docx'))
    expect(doc!.tempDir.startsWith(importRoot)).toBe(true)
    expect([...readFileSync(doc!.tempPath)]).toEqual([80, 75, 3, 4])
    expect(h.recents).toEqual(['/work/Report.doc'])
    expect(h.notices).toEqual([])
    expect(h.progress.begun).toEqual(['Report.doc'])
    expect(h.progress.ended).toBe(1)
  })

  it.each([
    ['docx', '/a/x.doc', 'docs'],
    ['docx', '/a/x.odt', 'docs'],
    ['docx', '/a/x.ott', 'docs'],
    ['xlsx', '/a/x.xls', 'sheets'],
    ['xlsx', '/a/x.ods', 'sheets'],
    ['xlsx', '/a/x.ots', 'sheets'],
    ['pptx', '/a/x.ppt', 'slides'],
    ['pptx', '/a/x.odp', 'slides'],
    ['pptx', '/a/x.otp', 'slides'],
  ] as const)('routes a %s result of %s to %s', async (target, path, kind) => {
    const h = harness(async (p) => converted(target, p))
    createLegacyOpener(h.deps).open(path)
    await vi.waitFor(() => expect(h.opened).toHaveLength(1))
    expect(h.opened[0]!.kind).toBe(kind)
    expect(h.opened[0]!.suggestSaveAs).toBe(path.replace(/\.[^.]+$/, `.${target}`))
  })

  it('opens an OOXML file misnamed as legacy in the editor of its real format', async () => {
    const h = harness(async (path) => ({
      kind: 'ooxml_misnamed',
      sourceFormat: 'doc',
      targetFormat: 'xlsx',
      bytes: new Uint8Array([1]),
      suggestedSaveAsPath: path.replace(/\.[^.]+$/, '.xlsx'),
    }))
    createLegacyOpener(h.deps).open('/a/sheet.doc')
    await vi.waitFor(() => expect(h.opened).toHaveLength(1))
    expect(h.opened[0]!.kind).toBe('sheets')
    expect(h.opened[0]!.tempPath.endsWith('sheet.xlsx')).toBe(true)
  })

  it('refuses a path that is not a legacy format without converting', () => {
    const convert = vi.fn()
    const opener = createLegacyOpener(harness(convert).deps)
    expect(opener.open('/a/b.docx')).toBe(false)
    expect(convert).not.toHaveBeenCalled()
  })

  it('runs one conversion per path and activates the open tab on a repeat', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const convert = vi.fn(async (path: string) => {
      await gate
      return converted('docx', path)
    })
    const h = harness(convert)
    const opener = createLegacyOpener(h.deps)

    opener.open('/w/a.doc')
    opener.open('/w/a.doc')
    release()
    await vi.waitFor(() => expect(h.opened).toHaveLength(1))
    expect(convert).toHaveBeenCalledTimes(1)

    // the converted tab is open: a second open activates it instead of converting again
    expect(opener.open('/w/a.doc')).toBe(true)
    await settle()
    expect(convert).toHaveBeenCalledTimes(1)
    expect(h.opened).toHaveLength(1)
  })

  it('finds the converted document by the exact tab path, never by a name stem', async () => {
    const h = harness(async (path) => converted('xlsx', path))
    const opener = createLegacyOpener(h.deps)
    opener.open('/docs/budget.xls')
    await vi.waitFor(() => expect(h.opened).toHaveLength(1))
    const doc = h.opened[0]!

    expect(opener.documentForPath(doc.tempPath)).toBe(doc)
    // the same-stem siblings are other documents
    expect(opener.documentForPath('/docs/budget.xlsx')).toBeUndefined()
    expect(opener.documentForPath('/docs/budget.xls')).toBeUndefined()
    expect(opener.documentForPath('/docs/budget.docx')).toBeUndefined()
  })

  it('cancel aborts the conversion silently', async () => {
    const convert = vi.fn(
      (_path: string, options: { signal: AbortSignal }) =>
        new Promise<ConvertLegacyResult>((_resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(new LegacyConvertError('cancelled', 'cancelled')),
          )
        }),
    )
    const h = harness(convert)
    createLegacyOpener(h.deps).open('/w/slow.ppt')
    await vi.waitFor(() => expect(h.progress.cancel).not.toBeNull())
    h.progress.cancel!()
    await vi.waitFor(() => expect(h.progress.ended).toBe(1))
    await settle()
    expect(h.notices).toEqual([])
    expect(h.opened).toEqual([])
    expect(readDirCount(importRoot)).toBe(0)
  })

  it.each([
    ['encrypted', /password-protected/],
    ['corrupt', /damaged or isn’t a valid \.doc file/],
    ['timeout', /took too long/],
    ['failed', /couldn’t be converted/],
    ['unsupported', /couldn’t be converted/],
    ['converter_missing', /converter is missing/],
  ] as const)('shows a typed notice for %s and opens nothing', async (code, text) => {
    const h = harness(async () => {
      throw new LegacyConvertError(code, code)
    })
    createLegacyOpener(h.deps).open('/w/Locked.doc')
    await vi.waitFor(() => expect(h.notices).toHaveLength(1))
    expect(h.notices[0]).toMatch(text)
    expect(h.notices[0]).toContain('Locked.doc')
    expect(h.opened).toEqual([])
    expect(h.progress.ended).toBe(1)
  })

  it('falls back to the values-only reader for an .xls when the converter is missing, and says so', async () => {
    const h = harness(async () => {
      throw new LegacyConvertError('converter_missing', 'no converter')
    })
    createLegacyOpener(h.deps).open('/w/old.xls')
    await vi.waitFor(() => expect(h.notices).toHaveLength(1))
    expect(h.xlsOpened).toEqual(['/w/old.xls'])
    expect(h.notices[0]).toMatch(/values only.*Reinstall the app to restore them\./)
    expect(h.opened).toEqual([])
  })

  it.each(['/w/old.ppt', '/w/old.odt', '/w/old.ods', '/w/old.odp'])(
    'shows the converter-missing notice for %s when the converter is absent',
    async (path) => {
      const h = harness(async () => {
        throw new LegacyConvertError('converter_missing', 'no converter')
      })
      createLegacyOpener(h.deps).open(path)
      await vi.waitFor(() => expect(h.notices).toHaveLength(1))
      expect(h.xlsOpened).toEqual([])
      expect(h.notices[0]).toMatch(/converter is missing/)
    },
  )

  it('does not fall back for an .xls that is encrypted or corrupt', async () => {
    const h = harness(async () => {
      throw new LegacyConvertError('encrypted', 'locked')
    })
    createLegacyOpener(h.deps).open('/w/old.xls')
    await vi.waitFor(() => expect(h.notices).toHaveLength(1))
    expect(h.xlsOpened).toEqual([])
  })

  it('an unexpected error reads as a plain failure and cleans the temp dir', async () => {
    const h = harness(async () => {
      throw new Error('boom')
    })
    createLegacyOpener(h.deps).open('/w/x.doc')
    await vi.waitFor(() => expect(h.notices).toHaveLength(1))
    expect(h.notices[0]).toMatch(/couldn’t be converted/)
  })

  it('removes the temp dir and reports a failure when the editor cannot open it', async () => {
    const h = harness(async (p) => converted('docx', p), {
      openConverted: () => {
        throw new Error('no window')
      },
    })
    createLegacyOpener(h.deps).open('/w/x.doc')
    await vi.waitFor(() => expect(h.notices).toHaveLength(1))
    expect(readDirCount(importRoot)).toBe(0)
  })

  it('sweep removes the temp copy of a docs document once no tab shows it', async () => {
    const h = harness(async (p) => converted('docx', p), { sweepDelayMs: 10 })
    const opener = createLegacyOpener(h.deps)
    opener.open('/w/a.doc')
    await vi.waitFor(() => expect(h.opened).toHaveLength(1))
    const doc = h.opened[0]!

    opener.sweep()
    expect(existsSync(doc.tempPath)).toBe(true)

    h.openPaths.delete(doc.tempPath)
    opener.sweep()
    await vi.waitFor(() => expect(existsSync(doc.tempDir)).toBe(false))
    expect(opener.documentForPath(doc.tempPath)).toBeUndefined()
  })

  it('never removes the temp dir of a sheets session (the session owns it)', async () => {
    const h = harness(async (p) => converted('xlsx', p), { sweepDelayMs: 10 })
    const opener = createLegacyOpener(h.deps)
    opener.open('/w/a.xls')
    await vi.waitFor(() => expect(h.opened).toHaveLength(1))
    const doc = h.opened[0]!

    h.openPaths.delete(doc.tempPath)
    opener.sweep()
    await opener.dispose()
    expect(existsSync(doc.tempPath)).toBe(true)
    expect(opener.documentForPath(doc.tempPath)).toBeUndefined()
  })

  it('dispose removes every docs/slides temp copy', async () => {
    const h = harness(async (p) => converted(p.endsWith('.ppt') ? 'pptx' : 'docx', p))
    const opener = createLegacyOpener(h.deps)
    opener.open('/w/a.doc')
    opener.open('/w/b.ppt')
    await vi.waitFor(() => expect(h.opened).toHaveLength(2))
    await opener.dispose()
    expect(readDirCount(importRoot)).toBe(0)
  })
})

describe('temp ownership of a converted copy (R1-5, R1-6, R1-9, R1-11, R1-12, F4)', () => {
  const open = async (
    h: Harness,
    opener: ReturnType<typeof createLegacyOpener>,
    path = '/w/a.doc',
  ) => {
    opener.open(path)
    await vi.waitFor(() => expect(h.opened).toHaveLength(1))
    return h.opened[0]!
  }

  it('a tab in transit between the strip and a detached window keeps its file (R1-5)', async () => {
    const h = harness(async (p) => converted('docx', p), { sweepDelayMs: 40 })
    const opener = createLegacyOpener(h.deps)
    const doc = await open(h, opener)

    // detach: the strip let go of the path, the detached window does not own it yet
    h.openPaths.delete(doc.tempPath)
    opener.sweep()
    opener.sweep()
    h.openPaths.add(doc.tempPath)
    await new Promise((resolve) => setTimeout(resolve, 120))

    expect(existsSync(doc.tempPath)).toBe(true)
    expect(opener.documentForPath(doc.tempPath)).toBeDefined()
    expect(convertedDocumentFor(doc.tempPath)).toBeDefined()
  })

  it('a path nobody owns once the transfer settled is still swept', async () => {
    const h = harness(async (p) => converted('docx', p), { sweepDelayMs: 20 })
    const opener = createLegacyOpener(h.deps)
    const doc = await open(h, opener)

    h.openPaths.delete(doc.tempPath)
    opener.sweep()
    await vi.waitFor(() => expect(existsSync(doc.tempDir)).toBe(false))
    expect(convertedDocumentFor(doc.tempPath)).toBeUndefined()
  })

  it('renaming the tab inside the staging dir keeps the file and the first-save routing (R1-6)', async () => {
    const h = harness(async (p) => converted('docx', p), { sweepDelayMs: 20 })
    const opener = createLegacyOpener(h.deps)
    const doc = await open(h, opener)
    const renamed = join(doc.tempDir, 'Renamed.docx')
    renameSync(doc.tempPath, renamed)

    expect(opener.fileMoved(doc.tempPath, renamed)).toBe(true)
    h.openPaths.delete(doc.tempPath)
    h.openPaths.add(renamed)
    opener.sweep()
    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(existsSync(renamed)).toBe(true)
    expect(opener.documentForPath(renamed)).toMatchObject({ tempPath: renamed, kind: 'docs' })
    expect(opener.documentForPath(doc.tempPath)).toBeUndefined()
    expect(convertedDocumentFor(doc.tempPath)).toBeUndefined()
    expect(convertedDocumentFor(renamed)).toMatchObject({
      originalPath: '/w/a.doc',
      suggestSaveAs: doc.suggestSaveAs,
    })
    // closing the renamed tab still cleans the dir
    h.openPaths.delete(renamed)
    opener.sweep()
    await vi.waitFor(() => expect(existsSync(doc.tempDir)).toBe(false))
  })

  it('a move out of the staging dir (the UniWork store, a Save As) ends the conversion entry only', async () => {
    const h = harness(async (p) => converted('docx', p), { sweepDelayMs: 20 })
    const opener = createLegacyOpener(h.deps)
    const doc = await open(h, opener)

    expect(opener.fileMoved(doc.tempPath, join(root, 'store', 'a.docx'))).toBe(true)

    expect(convertedDocumentFor(doc.tempPath)).toBeUndefined()
    // an unknown path is not a converted document
    expect(opener.fileMoved('/nowhere/x.docx', '/nowhere/y.docx')).toBe(false)
  })

  it.skipIf(process.platform === 'win32')(
    'stages the document privately even under a permissive umask (R1-9)',
    async () => {
      const before = process.umask(0o022)
      try {
        const h = harness(async (p) => converted('docx', p))
        const doc = await open(h, createLegacyOpener(h.deps))
        expect(statSync(doc.tempDir).mode & 0o777).toBe(0o700)
        expect(statSync(doc.tempPath).mode & 0o777).toBe(0o600)
      } finally {
        process.umask(before)
      }
    },
  )

  it('a cancel that lands while the result is being staged opens nothing and cleans up (R1-11)', async () => {
    let cancel: (() => void) | null = null
    const h = harness(async (p) => converted('docx', p), {
      beginProgress: (_name, c) => {
        cancel = c
        return () => undefined
      },
      // the staging root is resolved after conversion finished: cancel arrives right there
      importRoot: () => {
        cancel!()
        return importRoot
      },
    })
    createLegacyOpener(h.deps).open('/w/a.doc')
    await settle()

    expect(h.opened).toEqual([])
    expect(h.recents).toEqual([])
    expect(h.notices).toEqual([])
    expect(readDirCount(importRoot)).toBe(0)
  })

  it('dispose aborts a pending conversion and refuses new staging (R1-12)', async () => {
    let signal: AbortSignal | null = null
    let finish: (() => void) | null = null
    const convert = vi.fn(
      (path: string, options: { signal: AbortSignal }) =>
        new Promise<ConvertLegacyResult>((resolve) => {
          signal = options.signal
          finish = () => resolve(converted('docx', path))
        }),
    )
    const h = harness(convert)
    const opener = createLegacyOpener(h.deps)
    opener.open('/w/a.doc')
    await vi.waitFor(() => expect(signal).not.toBeNull())

    await opener.dispose()
    expect(signal!.aborted).toBe(true)
    // the converter finished anyway: the result is dropped, nothing is staged or opened
    finish!()
    await settle()
    expect(h.opened).toEqual([])
    expect(existsSync(importRoot)).toBe(false)

    // nothing starts after disposal
    expect(opener.open('/w/b.doc')).toBe(true)
    await settle()
    expect(convert).toHaveBeenCalledTimes(1)
  })

  it.each(['cancel', 'dispose'] as const)(
    'a %s that lands before converter_missing is delivered opens no fallback and shows no notice (R1-11/R1-12)',
    async (how) => {
      let fail: (() => void) | null = null
      const h = harness(
        () =>
          new Promise<ConvertLegacyResult>((_, reject) => {
            fail = () => reject(new LegacyConvertError('converter_missing', 'no converter'))
          }),
      )
      const opener = createLegacyOpener(h.deps)
      opener.open('/w/old.xls')
      await vi.waitFor(() => expect(fail).not.toBeNull())

      if (how === 'cancel') h.progress.cancel!()
      else await opener.dispose()
      fail!()
      await settle()

      expect(h.xlsOpened).toEqual([])
      expect(h.notices).toEqual([])
      expect(h.opened).toEqual([])
    },
  )

  it('a recents failure after the tab opened does not delete the open tab’s dir (F4)', async () => {
    const h = harness(async (p) => converted('docx', p), {
      recordRecent: () => {
        throw new Error('recent store is gone')
      },
    })
    const doc = await open(h, createLegacyOpener(h.deps))
    await settle()

    expect(existsSync(doc.tempPath)).toBe(true)
    expect(h.notices).toEqual([])
  })
})

describe('names a converted tab consistently (R1-13)', () => {
  it.each([
    ['/w/Budget.xls', 'xlsx', 'Budget', '.xlsx'],
    ['/w/Budget.ods', 'xlsx', 'Budget', '.xlsx'],
    ['/w/Q3 report.v2.doc', 'docx', 'Q3 report.v2', '.docx'],
    ['/w/Q3 report.v2.odt', 'docx', 'Q3 report.v2', '.docx'],
    ['/w/Deck.ppt', 'pptx', 'Deck', '.pptx'],
    ['/w/Deck.odp', 'pptx', 'Deck', '.pptx'],
  ] as const)(
    '%s: the tab, the Save dialog name and the upload title all say the OOXML name',
    async (path, target, base, ext) => {
      const h = harness(async (p) => converted(target, p))
      createLegacyOpener(h.deps).open(path)
      await vi.waitFor(() => expect(h.opened).toHaveLength(1))
      const tempPath = h.opened[0]!.tempPath

      // the tab edits this file, so its name is what every title is derived from
      expect(basename(tempPath)).toBe(`${base}${ext}`)
      // the Save to UniWork dialog splits the same path: editable base + fixed OOXML extension
      expect(nameParts(tempPath)).toEqual({ base, ext })
      // and the Save As suggestion carries the same name next to the original
      expect(basename(h.opened[0]!.suggestSaveAs)).toBe(`${base}${ext}`)
    },
  )
})

describe('legacyErrorMessage', () => {
  it('names the file and the legacy extension, in the user language', () => {
    const err = new LegacyConvertError('corrupt', 'x')
    expect(legacyErrorMessage(err, 'Old.xls', t)).toBe(
      '“Old.xls” is damaged or isn’t a valid .xls file, so it can’t be opened. Try the original file or a backup copy.',
    )
    expect(legacyErrorMessage(err, 'Old.xls', (k, p) => tLegacyOpen('vi', k, p))).toBe(
      '“Old.xls” bị hỏng hoặc không phải tệp .xls hợp lệ nên không thể mở. Hãy thử tệp gốc hoặc một bản sao lưu.',
    )
  })

  it('the values-only notice says what is lost and how to restore it, in en and vi', () => {
    expect(t('legacyXlsValuesOnly', { name: 'Old.xls' })).toMatch(
      /because the converter is missing\. Reinstall the app to restore them\.$/,
    )
    expect(tLegacyOpen('vi', 'legacyXlsValuesOnly', { name: 'Old.xls' })).toMatch(
      /vì thiếu bộ chuyển đổi\. Hãy cài đặt lại ứng dụng để khôi phục chúng\.$/,
    )
  })

  it('uses legacyOdfDetail for the six OpenDocument extensions and legacyConvertingDetail for .doc/.xls/.ppt across all 21 locales', () => {
    for (const name of [
      'Report.odt',
      'Letter.OTT',
      'Budget.ods',
      'Sheet.ots',
      'Deck.odp',
      'Slide.OTP',
    ]) {
      expect(legacyProgressDetailKey(name)).toBe('legacyOdfDetail')
    }
    for (const name of ['Report.doc', 'Budget.xls', 'Deck.ppt']) {
      expect(legacyProgressDetailKey(name)).toBe('legacyConvertingDetail')
    }
    expect(tLegacyOpen('en', 'legacyOdfDetail')).toBe(
      'The OpenDocument file is being converted so you can edit it here. The original file is not changed.',
    )
    expect(tLegacyOpen('vi', 'legacyOdfDetail')).toBe(
      'Tệp OpenDocument đang được chuyển đổi để bạn chỉnh sửa tại đây. Tệp gốc không bị thay đổi.',
    )
    for (const lang of LANGS) {
      expect(tLegacyOpen(lang, 'legacyOdfDetail').length).toBeGreaterThan(10)
      expect(tLegacyOpen(lang, 'legacyOdfDetail')).toContain('OpenDocument')
    }
  })
})

function readDirCount(dir: string): number {
  try {
    return readdirSync(dir).length
  } catch {
    return 0
  }
}
