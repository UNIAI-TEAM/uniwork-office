import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface VersionInfo {
  /** directory name under dist-web/docs/ and the URL segment: `<packageVersion>-<gitSha>[-dirty]` */
  version: string
  packageVersion: string
  gitSha: string
  /** tracked files differ from HEAD when the build ran */
  dirty: boolean
}

/** `0.1.0` + `4a70857` -> `0.1.0-4a70857`; a dirty tree is marked so a local build is never mistaken for the commit */
export function formatVersion(packageVersion: string, gitSha: string, dirty: boolean): string {
  return `${packageVersion}-${gitSha}${dirty ? '-dirty' : ''}`
}

/** the version becomes a path segment and a URL segment: refuse anything that could escape or need encoding */
export function assertSafeVersion(version: string): string {
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/.test(version) || version.includes('..')) {
    throw new Error(
      `unsafe web-docs version "${version}" (allowed: [0-9A-Za-z._-], max 64, no "..")`,
    )
  }
  return version
}

function git(repoRoot: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

/**
 * Package version comes from the root package.json. Overrides (CI / source tarballs without .git):
 *   WEB_DOCS_VERSION  full version string
 *   WEB_DOCS_GIT_SHA  short sha
 */
export function resolveVersion(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): VersionInfo {
  const packageVersion = (
    JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }
  ).version
  const gitSha =
    env.WEB_DOCS_GIT_SHA || git(repoRoot, ['rev-parse', '--short=7', 'HEAD']) || 'nogit'
  const dirty = env.WEB_DOCS_GIT_SHA
    ? false
    : (git(repoRoot, ['status', '--porcelain', '--untracked-files=no']) ?? '') !== ''
  const version = assertSafeVersion(
    env.WEB_DOCS_VERSION || formatVersion(packageVersion, gitSha, dirty),
  )
  return { version, packageVersion, gitSha, dirty }
}
