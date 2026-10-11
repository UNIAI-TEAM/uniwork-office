import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import {
  cleanupCliLinks,
  commandName,
  inspectCliLink,
  installCliLink,
  linkTarget,
  type InstallOptions,
  type InstallOutcome,
} from '@genoffice/cli/install'
import type { CliLinkState } from '../shared/home-api'
import { writeAppSetting } from './app-settings'
import { pruneStaleSchemeHandlers } from './uniwork-handler-entry'

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

/**
 * What the command's link points at and the GUI name it must not shadow: the package's stable
 * `/usr/bin` launcher on deb/rpm, the shipped launcher everywhere else (see `linkTarget`).
 */
function linkOptions(): Pick<InstallOptions, 'launcher' | 'guiExecutable'> {
  return linkTarget(launcherPath())
}

/** the CLI can be exposed only from a packaged, permanent install */
function cliLinkSupported(): boolean {
  return app.isPackaged && !isEphemeralInstall(process.resourcesPath, process.env)
}

/**
 * Every launch: record where the genoffice launcher lives so agents can find it
 * without a PATH (the `genoffice` skill reads `~/.genoffice/launcher`). That is
 * one line in the app's own ~/.genoffice folder and nothing else: the command on the
 * PATH (a symlink in a bin folder, a Windows PATH entry) is only created when the
 * user asks for it in Settings (installCliLinkOnRequest).
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

/**
 * Every launch, after the launcher record: housekeeping for what an earlier run left behind.
 * Removes command links this app created (known names, known bin dirs) whose target is gone,
 * repoints ones at an old install, migrates the pre-rename `genoffice` link, and on Linux
 * drops a `uniwork://` handler entry whose desktop file an uninstall removed. It never creates
 * a link the user did not ask for before (a migration only replaces one that already existed)
 * and never touches a link it did not create. From a temporary mount (AppImage, dmg) only
 * the dead-link removal runs. Silent and best effort.
 */
export function healCliLinks(): void {
  if (!app.isPackaged) return
  try {
    const report = cleanupCliLinks(cliLinkSupported() ? linkOptions() : {})
    for (const [what, links] of Object.entries(report)) {
      if (links.length > 0) console.log(`[genoffice] cli link ${what}: ${links.join(', ')}`)
    }
    if (process.platform === 'linux') {
      const dropped = pruneStaleSchemeHandlers()
      if (dropped.length > 0)
        console.log(`[genoffice] stale url handler dropped: ${dropped.join(', ')}`)
    }
  } catch (err) {
    console.warn('[genoffice] cli link cleanup failed:', err instanceof Error ? err.message : err)
  }
}

/** Settings row: where the command stands today; nothing is written */
export function cliLinkStatus(): CliLinkState {
  if (!cliLinkSupported()) return { state: 'unsupported' }
  try {
    return toCliLinkState(inspectCliLink(linkOptions()))
  } catch {
    return { state: 'unsupported' }
  }
}

/** Settings button: expose the command on the PATH now, then remember the outcome */
export function installCliLinkOnRequest(settingsPath: string): CliLinkState {
  if (!cliLinkSupported()) return { state: 'unsupported' }
  try {
    writeLauncherFile(launcherFilePath(process.env), launcherDir())
    const outcome = installCliLink(linkOptions())
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

export function toCliLinkState(
  outcome: InstallOutcome,
  platform: NodeJS.Platform = process.platform,
): CliLinkState {
  const detail = {
    command: commandName(outcome, platform),
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
