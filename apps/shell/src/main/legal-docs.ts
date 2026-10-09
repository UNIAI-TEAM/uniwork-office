import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import type { LegalDoc } from '../shared/home-api'

/**
 * Legal files Settings > About opens with the system viewer. electron-builder
 * copies them into Resources/ under a .txt name (apps/shell/electron-builder.cjs
 * extraResources), so the viewer opens them without an "Open with" prompt. In a
 * source checkout the originals sit extension-less at the repo root, except the
 * generated third-party notice, which tools/gen-third-party-notices.mjs writes
 * to apps/shell/build/. Local files only: nothing here ever opens a URL.
 */
export const LEGAL_DOC_FILES: Record<LegalDoc, { source: string; shipped: string }> = {
  license: { source: 'LICENSE', shipped: 'LICENSE.txt' },
  notice: { source: 'NOTICE', shipped: 'NOTICE.txt' },
  modifications: { source: 'MODIFICATIONS', shipped: 'MODIFICATIONS.txt' },
  thirdParty: { source: 'THIRD-PARTY-NOTICES.txt', shipped: 'THIRD-PARTY-NOTICES.txt' },
}

export function isLegalDoc(value: unknown): value is LegalDoc {
  return typeof value === 'string' && Object.hasOwn(LEGAL_DOC_FILES, value)
}

export interface LegalDocEnv {
  packaged: boolean
  /** process.resourcesPath */
  resourcesPath: string
  /** app.getAppPath(): apps/shell in a source checkout */
  appPath: string
}

/** Absolute path of a legal file, or null for anything that is not one of them. */
export function legalDocPath(doc: unknown, env: LegalDocEnv): string | null {
  if (!isLegalDoc(doc)) return null
  const { source, shipped } = LEGAL_DOC_FILES[doc]
  if (env.packaged) return join(env.resourcesPath, shipped)
  if (doc === 'thirdParty') return join(env.appPath, 'build', source)
  return join(env.appPath, '..', '..', source)
}

export interface LegalDocIo {
  /** shell.openPath: resolves to '' on success, an error message otherwise */
  openPath(path: string): Promise<string>
  exists?(path: string): boolean
  copyFile?(from: string, to: string): void
  tempDir?(): string
}

/**
 * Opens a legal file; true when the viewer accepted it. An extension-less dev
 * original the OS cannot open is copied to a temporary .txt and opened from there.
 */
export async function openLegalDoc(
  doc: unknown,
  env: LegalDocEnv,
  io: LegalDocIo,
): Promise<boolean> {
  const path = legalDocPath(doc, env)
  const exists = io.exists ?? existsSync
  if (!path || !exists(path)) return false
  if ((await io.openPath(path)) === '') return true
  if (extname(path) !== '') return false
  const dir = io.tempDir?.() ?? join(tmpdir(), 'uniwork-office-legal')
  const copy = join(dir, LEGAL_DOC_FILES[doc as LegalDoc].shipped)
  try {
    if (io.copyFile) io.copyFile(path, copy)
    else {
      mkdirSync(dir, { recursive: true })
      copyFileSync(path, copy)
    }
  } catch {
    return false
  }
  return (await io.openPath(copy)) === ''
}
