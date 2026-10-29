import { randomBytes, randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { lstat, open, rename, unlink, type FileHandle } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import type { ZipDownloadProgress, ZipDownloadStartResult } from '../../../shared/zip-download-api'
import type { ZipDownloadClient } from './client'
import { runZipDownload, zipErrorOf, ZipRunError, type ZipRunnerDeps, type ZipSink } from './runner'
import { isZipDocumentId, ZIP_MAX_IDS, ZIP_MIN_IDS } from './wire'

/**
 * UNI-2068: the zip download of the Documents bulk bar, over injected seams (the
 * save dialog, the forbidden-target check, the signed-in client) so it stays
 * Electron-free. `start` opens the save dialog FIRST - a canceled dialog creates
 * no job - then runs the download in the background, pushing progress to the
 * window that started it. The zip goes to a `.uw-dl-*.tmp` next to the target
 * and is renamed onto it only when it is whole; every other ending (error,
 * cancel, sign-out, quit) removes the temp file.
 */

export interface ZipDownloadServiceDeps {
  /** the native save dialog (remembered folder, else Downloads); null = canceled */
  pickPath(defaultName: string): Promise<string | null>
  /** the app's own working-copy root and links are never a target (same rule as downloadSource) */
  isForbiddenTarget(target: string): Promise<boolean>
  /** the client of the signed-in session; null when signed out */
  client(): ZipDownloadClient | null
  newRunId?(): string
  now?(): Date
  /** runs the background part after the start answer left (default: the next macrotask) */
  defer?(run: () => void): void
  /** test seams of the runner (poll interval, sleep, caps) */
  runner?: Partial<Omit<ZipRunnerDeps, 'client' | 'openSink'>>
}

export interface ZipDownloadService {
  start(input: unknown, push: (event: ZipDownloadProgress) => void): Promise<ZipDownloadStartResult>
  cancel(runId: unknown): void
  /** sign-out / account switch: every run ends, the renderer is told `signed_out` */
  abortAll(reason: 'signed_out' | 'quit'): void
  /** quit: aborts every run and removes the temp files synchronously */
  dispose(): void
  activeRuns(): number
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** documents-<local date-time>.zip, the name the dialog suggests */
export function defaultZipName(now: Date): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  return `documents-${stamp}T${pad(now.getHours())}${pad(now.getMinutes())}.zip`
}

/** the app's suggestion as a bare file name ending in .zip, or the default */
function suggestedName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const name = [...basename(raw.replace(/\\/g, '/'))]
    .map((char) => (char.charCodeAt(0) < 0x20 || '<>:"|?*'.includes(char) ? '_' : char))
    .join('')
    .trim()
  if (!name || name === '.' || name === '..') return fallback
  return extname(name).toLowerCase() === '.zip' ? name : `${name}.zip`
}

interface ParsedInput {
  workspaceId: string
  documentIds: string[]
  suggestedName?: string
}

function parseInput(raw: unknown): ParsedInput | null {
  if (typeof raw !== 'object' || raw === null) return null
  const input = raw as Record<string, unknown>
  const ids = input.documentIds
  if (typeof input.workspaceId !== 'string' || !input.workspaceId) return null
  if (
    !Array.isArray(ids) ||
    ids.length < ZIP_MIN_IDS ||
    ids.length > ZIP_MAX_IDS ||
    !ids.every(isZipDocumentId) ||
    new Set(ids).size !== ids.length
  ) {
    return null
  }
  return {
    workspaceId: input.workspaceId,
    documentIds: ids,
    ...(typeof input.suggestedName === 'string' ? { suggestedName: input.suggestedName } : {}),
  }
}

interface ActiveRun {
  controller: AbortController
  /** the temp file while one exists, for the synchronous cleanup at quit */
  tmp: string | null
}

export function createZipDownloadService(deps: ZipDownloadServiceDeps): ZipDownloadService {
  const runs = new Map<string, ActiveRun>()
  const newRunId = deps.newRunId ?? randomUUID
  const defer = deps.defer ?? ((run: () => void) => void setTimeout(run, 0))

  /** the sink of one run: `.uw-dl-*.tmp` beside the target, renamed on commit */
  async function openFileSink(target: string, run: ActiveRun): Promise<ZipSink> {
    const resolvedTarget = resolve(target)
    const tmp = join(dirname(resolvedTarget), `.uw-dl-${randomBytes(8).toString('hex')}.tmp`)
    let handle: FileHandle
    try {
      const existing = await lstat(resolvedTarget).catch(() => null)
      const mode = existing?.isFile() ? existing.mode & 0o777 : 0o600
      run.tmp = tmp
      handle = await open(tmp, 'wx', 0o600)
      if (run.controller.signal.aborted) {
        await handle.close().catch(() => undefined)
        await unlink(tmp).catch(() => undefined)
        run.tmp = null
        throw new ZipRunError('write_failed')
      }
      return makeSink(handle, tmp, resolvedTarget, mode, target, run)
    } catch {
      run.tmp = null
      throw new ZipRunError('write_failed')
    }
  }

  function makeSink(
    handle: FileHandle,
    tmp: string,
    resolvedTarget: string,
    mode: number,
    target: string,
    run: ActiveRun,
  ): ZipSink {
    let closed = false
    const close = async () => {
      if (closed) return
      closed = true
      await handle.close().catch(() => undefined)
    }
    return {
      async write(chunk) {
        try {
          let offset = 0
          while (offset < chunk.byteLength) {
            const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset)
            offset += bytesWritten
          }
        } catch {
          throw new ZipRunError('write_failed')
        }
      },
      async commit() {
        try {
          await handle.chmod(mode)
          await handle.sync().catch(() => undefined)
        } catch {
          throw new ZipRunError('write_failed')
        } finally {
          await close()
        }
        // the target may have turned into a link, or the root, while the zip came down
        if (await deps.isForbiddenTarget(target)) throw new ZipRunError('forbidden_target')
        try {
          await rename(tmp, resolvedTarget)
        } catch {
          throw new ZipRunError('write_failed')
        }
        run.tmp = null
        return target
      },
      async abort() {
        await close()
        await unlink(tmp).catch(() => undefined)
        run.tmp = null
      },
    }
  }

  return {
    async start(raw, push) {
      const input = parseInput(raw)
      if (!input) return { ok: false, code: 'zip_failed' }
      const client = deps.client()
      if (!client) return { ok: false, code: 'signed_out' }
      const fallback = defaultZipName((deps.now ?? (() => new Date()))())
      const picked = await deps.pickPath(suggestedName(input.suggestedName, fallback))
      if (!picked) return { ok: false, code: 'dialog_canceled' }
      const target = extname(picked).toLowerCase() === '.zip' ? picked : `${picked}.zip`
      if (await deps.isForbiddenTarget(target)) return { ok: false, code: 'forbidden_target' }
      // the user may have signed out while the dialog was open
      const live = deps.client()
      if (!live) return { ok: false, code: 'signed_out' }

      const runId = newRunId()
      const run: ActiveRun = { controller: new AbortController(), tmp: null }
      runs.set(runId, run)
      const sender = (event: Omit<ZipDownloadProgress, 'runId'>) => {
        try {
          push({ runId, ...event })
        } catch {
          // a window that went away takes its progress with it; the run still ends cleanly
        }
      }
      // the answer leaves first so the renderer knows the run id before its first event
      defer(() => {
        void runZipDownload(
          { workspaceId: input.workspaceId, documentIds: input.documentIds },
          {
            ...deps.runner,
            client: live,
            openSink: () => openFileSink(target, run),
          },
          run.controller.signal,
          sender,
        )
          .catch((error: unknown) =>
            sender({
              phase: 'failed',
              bytes: 0,
              totalBytes: null,
              fileCount: null,
              skipped: [],
              path: null,
              error: zipErrorOf(error),
            }),
          )
          .finally(() => runs.delete(runId))
      })
      return { ok: true, runId }
    },

    cancel(runId) {
      if (typeof runId !== 'string') return
      runs.get(runId)?.controller.abort('canceled')
    },

    abortAll(reason) {
      for (const run of runs.values()) run.controller.abort(reason)
    },

    dispose() {
      for (const run of runs.values()) {
        run.controller.abort('quit')
        if (run.tmp) {
          try {
            unlinkSync(run.tmp)
          } catch {
            // already gone
          }
          run.tmp = null
        }
      }
    },

    activeRuns: () => runs.size,
  }
}
