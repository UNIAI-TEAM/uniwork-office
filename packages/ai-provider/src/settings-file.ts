/**
 * Node-only: reads and writes ai-settings.json, which holds `gskToolsEnabled` and nothing else
 * (see `aiSettingsFileOf`). Kept out of the package index so renderer bundles never pull `node:fs`.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { aiSettingsFileOf } from './providers'

function readStored(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

function write(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, path)
}

/**
 * Rewrites a file left by an older build (provider keys, base URLs, media/search keys) down to the
 * opt-out. A missing, unreadable or corrupt file is left alone; never throws.
 */
export function scrubAiSettingsFile(path: string): void {
  try {
    const stored = readStored(path)
    if (stored === undefined) return
    const clean = aiSettingsFileOf(stored)
    if (JSON.stringify(stored) !== JSON.stringify(clean)) write(path, clean)
  } catch {
    /* startup must not fail on an unwritable settings file */
  }
}

/** Saves the cloud-tools opt-out into the file, dropping every other field of the old content. */
export function saveAiSettingsFile(path: string, incoming: unknown): void {
  const gsk = (incoming as { gskToolsEnabled?: unknown } | null | undefined)?.gskToolsEnabled
  const stored = readStored(path)
  write(
    path,
    aiSettingsFileOf({
      ...(typeof stored === 'object' && stored !== null ? stored : {}),
      ...(typeof gsk === 'boolean' ? { gskToolsEnabled: gsk } : {}),
    }),
  )
}
