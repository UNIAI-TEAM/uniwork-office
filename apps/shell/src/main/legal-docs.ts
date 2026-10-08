import { join } from 'node:path'
import type { LegalDoc } from '../shared/home-api'

/**
 * Legal files Settings > About opens with the system viewer. electron-builder
 * copies them into Resources/ (apps/shell/electron-builder.cjs extraResources);
 * in a source checkout they sit at the repo root, except the generated
 * third-party notice, which tools/gen-third-party-notices.mjs writes to
 * apps/shell/build/. Local files only: nothing here ever opens a URL.
 */
export const LEGAL_DOC_FILES: Record<LegalDoc, string> = {
  license: 'LICENSE',
  notice: 'NOTICE',
  modifications: 'MODIFICATIONS',
  thirdParty: 'THIRD-PARTY-NOTICES.txt',
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
  const name = LEGAL_DOC_FILES[doc]
  if (env.packaged) return join(env.resourcesPath, name)
  if (doc === 'thirdParty') return join(env.appPath, 'build', name)
  return join(env.appPath, '..', '..', name)
}
