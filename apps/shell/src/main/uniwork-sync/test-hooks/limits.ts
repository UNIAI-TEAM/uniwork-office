/**
 * Test-only environment hooks for the UniWork durable save queue (G7-03a).
 *
 * Environment variables (test-only, off by default):
 * - `UNIWORK_SYNC_TRACE_FILE`: path to the JSONL file where intent state
 *   transitions are appended; also acts as the enable gate for the timer
 *   overrides below. Off (no file created, no runtime cost) when unset.
 * - `UNIWORK_SYNC_TEST_STUCK_AFTER_MS`: positive integer override for
 *   `QUEUE_LIMITS.stuckAfterMs` (default 3_600_000 ms). Honoured only when
 *   `UNIWORK_SYNC_TRACE_FILE` is set and the build is unpackaged.
 * - `UNIWORK_SYNC_TEST_RECHECK_MS`: positive integer override for
 *   `QUEUE_LIMITS.recheckMs` (default 900_000 ms). Honoured only when
 *   `UNIWORK_SYNC_TRACE_FILE` is set and the build is unpackaged.
 *
 * Packaged builds (`electron.app.isPackaged === true`) ignore all three
 * environment variables unconditionally.
 */

import * as electron from 'electron'

export type TestQueueLimitEnvVar =
  'UNIWORK_SYNC_TEST_STUCK_AFTER_MS' | 'UNIWORK_SYNC_TEST_RECHECK_MS'

export interface TestHookEnvOptions {
  env?: NodeJS.ProcessEnv
  isPackaged?: boolean
}

let packagedOverride: boolean | undefined

/**
 * Test seam for unit tests that run outside Electron and want to assert the
 * packaged-build guard without mocking the `electron` module.
 */
export function setTestPackagedOverride(value: boolean | undefined): void {
  packagedOverride = value
}

/**
 * True when running inside a packaged Electron build (`app.isPackaged === true`).
 * In unpackaged Electron runs or plain Node/Vitest processes, returns false
 * unless overridden via `options.isPackaged` or `setTestPackagedOverride`.
 */
export function isPackagedBuild(explicit?: boolean): boolean {
  if (typeof explicit === 'boolean') return explicit
  if (typeof packagedOverride === 'boolean') return packagedOverride
  try {
    const mod = electron as unknown as {
      app?: { isPackaged?: unknown }
      default?: { app?: { isPackaged?: unknown } }
    }
    return mod?.app?.isPackaged === true || mod?.default?.app?.isPackaged === true
  } catch {
    return false
  }
}

/**
 * Non-empty path from `UNIWORK_SYNC_TRACE_FILE` when the build is unpackaged,
 * or null when unset / blank / packaged.
 */
export function resolveSyncTraceFile(options: TestHookEnvOptions = {}): string | null {
  if (isPackagedBuild(options.isPackaged)) return null
  const env = options.env ?? process.env
  const raw = env.UNIWORK_SYNC_TRACE_FILE
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Parses a positive safe decimal integer (`1`, `500`, ...). Rejects `0`,
 * negative values, floats, scientific notation, non-digits and unsafe integers.
 */
export function parsePositiveIntEnv(raw: string | undefined): number | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return undefined
  return parsed
}

/**
 * Resolves a single queue timer limit: returns the positive-integer env
 * override only when `UNIWORK_SYNC_TRACE_FILE` is also set and the build is
 * unpackaged; otherwise returns `fallback`.
 */
export function readTestQueueLimit(
  envVar: TestQueueLimitEnvVar,
  fallback: number,
  options: TestHookEnvOptions = {},
): number {
  if (!resolveSyncTraceFile(options)) return fallback
  const env = options.env ?? process.env
  return parsePositiveIntEnv(env[envVar]) ?? fallback
}
