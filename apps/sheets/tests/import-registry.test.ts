import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { csvToXlsxBufferForOpen } from '@genoffice/xlsx-gateway/gateway/csv-import-xlsx'

import { ImportRegistry } from '../src/main/import-registry'
import { cleanupImportTempDirectory } from '../src/main/temp-files'

/**
 * The cancel for a delimited import (a .csv/.tsv opened as a workbook) has to
 * travel from the renderer to the main process and reach the work it is
 * meant to stop. This registry is where the two meet, so it is where the
 * wiring is checked: a cancel that reaches nothing leaves the user waiting
 * on a 250 MB file with a button that does nothing.
 */
describe('the import registry', () => {
  it('gives the running import a controller the caller can watch', () => {
    const registry = new ImportRegistry()
    const controller = registry.start(7)
    expect(controller.signal.aborted).toBe(false)
    expect(registry.controllerFor(7)).toBe(controller)
  })

  it('cancels the import running for that owner', () => {
    const registry = new ImportRegistry()
    const controller = registry.start(7)
    expect(registry.cancel(7)).toBe(true)
    expect(controller.signal.aborted).toBe(true)
  })

  it('says nothing happened when there is no import to cancel', () => {
    const registry = new ImportRegistry()
    expect(registry.cancel(7)).toBe(false)
    expect(registry.controllerFor(7)).toBeUndefined()
  })

  it('cancels only the owner that asked', () => {
    const registry = new ImportRegistry()
    const mine = registry.start(1)
    const theirs = registry.start(2)
    registry.cancel(1)
    expect(mine.signal.aborted).toBe(true)
    expect(theirs.signal.aborted).toBe(false)
  })

  it('does not cancel a finished import', () => {
    const registry = new ImportRegistry()
    const controller = registry.start(7)
    registry.finish(7, controller)
    expect(registry.controllerFor(7)).toBeUndefined()
    expect(registry.cancel(7)).toBe(false)
    expect(controller.signal.aborted).toBe(false)
  })

  it('lets a second import replace the first', () => {
    const registry = new ImportRegistry()
    const first = registry.start(7)
    const second = registry.start(7)
    expect(registry.controllerFor(7)).toBe(second)
    // the first import's work is stale, but it must not be cancelled by a
    // cancel meant for the second one
    registry.cancel(7)
    expect(second.signal.aborted).toBe(true)
    expect(first.signal.aborted).toBe(false)
  })

  it('does not let a slow import clear the entry of the next one', () => {
    const registry = new ImportRegistry()
    const first = registry.start(7)
    const second = registry.start(7)
    // the first import finishes late, after the second one started
    registry.finish(7, first)
    expect(registry.controllerFor(7)).toBe(second)
    expect(registry.cancel(7)).toBe(true)
    expect(second.signal.aborted).toBe(true)
  })

  it('tells a cancelled import from one that failed on its own', () => {
    const registry = new ImportRegistry()
    const controller = registry.start(7)
    expect(registry.wasCancelled(controller)).toBe(false)
    registry.cancel(7)
    expect(registry.wasCancelled(controller)).toBe(true)
  })

  it('does not call a failed import cancelled', () => {
    // An import that failed on its own (a file too large, a broken archive)
    // has to report the reason; only the user's own cancel opens nothing and
    // says nothing.
    const registry = new ImportRegistry()
    const controller = registry.start(7)
    registry.finish(7, controller)
    expect(registry.wasCancelled(controller)).toBe(false)
  })

  it('a cancelled import leaves no written worksheet / temp file and opens no session', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'sheets-cancel-import-'))
    try {
      const registry = new ImportRegistry()
      const openWorkbookSession = vi.fn()
      const csvText = `col1,col2\n${'alpha,10\n'.repeat(200)}`

      // Case 1: Cancelled during conversion (write phase) before writeFile
      const dirMid = join(tempRoot, 'genoffice-imports', randomUUID())
      const openPathMid = join(dirMid, 'cancelled-mid.xlsx')
      await mkdir(dirMid, { recursive: true })
      const controllerMid = registry.start(42)
      let sessionMid: unknown = 'unset'
      try {
        try {
          const converted = await csvToXlsxBufferForOpen(csvText, 'Sheet1', ',', {
            signal: controllerMid.signal,
            onProgress: (progress) => {
              if (progress.phase === 'write') registry.cancel(42)
            },
          })
          controllerMid.signal.throwIfAborted()
          await writeFile(openPathMid, converted.buffer)
          controllerMid.signal.throwIfAborted()
        } catch (error) {
          await cleanupImportTempDirectory(tempRoot, dirMid)
          throw error
        }
        sessionMid = await openWorkbookSession(openPathMid)
      } catch (error) {
        if (registry.wasCancelled(controllerMid)) {
          sessionMid = null
        } else {
          throw error
        }
      } finally {
        registry.finish(42, controllerMid)
      }

      expect(sessionMid).toBeNull()
      expect(existsSync(openPathMid)).toBe(false)
      expect(existsSync(dirMid)).toBe(false)
      expect(openWorkbookSession).not.toHaveBeenCalled()

      // Case 2: Late cancel arriving while writeFile completes still removes the temp file and opens no session
      const dirLate = join(tempRoot, 'genoffice-imports', randomUUID())
      const openPathLate = join(dirLate, 'cancelled-late.xlsx')
      await mkdir(dirLate, { recursive: true })
      const controllerLate = registry.start(42)
      let sessionLate: unknown = 'unset'
      try {
        try {
          const converted = await csvToXlsxBufferForOpen(csvText, 'Sheet1', ',', {
            signal: controllerLate.signal,
          })
          controllerLate.signal.throwIfAborted()
          await writeFile(openPathLate, converted.buffer)
          registry.cancel(42)
          controllerLate.signal.throwIfAborted()
        } catch (error) {
          await cleanupImportTempDirectory(tempRoot, dirLate)
          throw error
        }
        sessionLate = await openWorkbookSession(openPathLate)
      } catch (error) {
        if (registry.wasCancelled(controllerLate)) {
          sessionLate = null
        } else {
          throw error
        }
      } finally {
        registry.finish(42, controllerLate)
      }

      expect(sessionLate).toBeNull()
      expect(existsSync(openPathLate)).toBe(false)
      expect(existsSync(dirLate)).toBe(false)
      expect(openWorkbookSession).not.toHaveBeenCalled()
      expect(registry.controllerFor(42)).toBeUndefined()
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
