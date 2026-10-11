import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { inspectCliLink, installCliLink, type InstallOutcome } from '@genoffice/cli/install'
import type { CliLinkState } from '../shared/home-api'
import { writeAppSetting } from './app-settings'

const SETTING_KEY = 'cliLink'

interface CliLinkRecord {
  version: string
  status: string
  location?: string
}

function launcherDir(): string {
  return join(process.resourcesPath, 'cli')
}

function launcherPath(): string {
  return join(launcherDir(), process.platform === 'win32' ? 'genoffice.cmd' : 'genoffice')
}

/** the CLI can be exposed only from a packaged, permanent install */
function cliLinkSupported(): boolean {
  return app.isPackaged && !isEphemeralInstall(process.resourcesPath, process.env)
}

/**
 * Every launch: record where the genoffice launcher lives so agents can find it
 * without a PATH (the `genoffice` skill reads `~/.genoffice/launcher`). That is
 * one line in the app's own ~/.genoffice folder and nothing else: the `genoffice`
 * command on the PATH (a symlink in a bin folder, a Windows PATH entry) is only
 * created when the user asks for it in Settings (installCliLinkOnRequest).
 * Silent and best effort.
 */
export function recordCliLauncher(): void {
  if (!app.isPackaged) return
  try {
    if (!cliLinkSupported()) {
      // a DMG under /Volumes or an AppImage FUSE mount vanishes on exit; a path
      // into it would leave agents with a dead launcher, so wait for a real install
      console.log('[genoffice] cli launcher not recorded: app runs from a temporary mount')
      return
    }
    writeLauncherFile(launcherFilePath(process.env), launcherDir())
  } catch (err) {
    console.warn(
      '[genoffice] cli launcher record failed:',
      err instanceof Error ? err.message : err,
    )
  }
}

/** Settings row: where the `genoffice` command stands today; nothing is written */
export function cliLinkStatus(): CliLinkState {
  if (!cliLinkSupported()) return { state: 'unsupported' }
  try {
    return toCliLinkState(inspectCliLink({ launcher: launcherPath() }))
  } catch {
    return { state: 'unsupported' }
  }
}

/** Settings button: expose `genoffice` on the PATH now, then remember the outcome */
export function installCliLinkOnRequest(settingsPath: string): CliLinkState {
  if (!cliLinkSupported()) return { state: 'unsupported' }
  try {
    writeLauncherFile(launcherFilePath(process.env), launcherDir())
    const outcome = installCliLink({ launcher: launcherPath() })
    console.log(
      `[genoffice] cli link: ${outcome.status}${outcome.location ? ` (${outcome.location})` : ''}` +
        (outcome.pathHint ? `; not on PATH, add it with: ${outcome.pathHint}` : ''),
    )
    const record: CliLinkRecord = { version: app.getVersion(), status: outcome.status }
    if (outcome.location) record.location = outcome.location
    writeAppSetting(settingsPath, SETTING_KEY, record)
    return toCliLinkState(outcome)
  } catch (err) {
    console.warn('[genoffice] cli link failed:', err instanceof Error ? err.message : err)
    return { state: 'unsupported' }
  }
}

export function toCliLinkState(outcome: InstallOutcome): CliLinkState {
  const detail = {
    ...(outcome.location ? { location: outcome.location } : {}),
    ...(outcome.pathHint ? { pathHint: outcome.pathHint } : {}),
    ...(outcome.manual ? { manual: outcome.manual } : {}),
  }
  switch (outcome.status) {
    case 'linked':
    case 'present':
      return { state: 'present', ...detail }
    case 'missing':
      return { state: 'absent', ...detail }
    case 'unwritable':
    case 'occupied':
      return { state: 'blocked', ...detail }
    default:
      return { state: 'unsupported' }
  }
}

export function isEphemeralInstall(resourcesPath: string, env: NodeJS.ProcessEnv): boolean {
  if (env.APPIMAGE) return true
  return /^\/Volumes\//.test(resourcesPath) || /\/\.mount_[^/]+\//.test(resourcesPath)
}

/** Same directory the genoffice CLI uses for auth.json and its audit log. */
export function launcherFilePath(env: NodeJS.ProcessEnv): string {
  return join(env.GENOFFICE_AUTH_DIR || join(homedir(), '.genoffice'), 'launcher')
}

/** One line, the directory holding genoffice / genoffice.cmd; rewritten only when it changed. */
export function writeLauncherFile(file: string, launcherDir: string): boolean {
  const content = `${launcherDir}\n`
  try {
    if (readFileSync(file, 'utf-8') === content) return false
  } catch {}
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, content, 'utf-8')
  return true
}
