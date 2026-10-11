import { spawnSync } from 'node:child_process'
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, win32 } from 'node:path'
import { CLI_COMMAND, LAUNCHER_NAME, LEGACY_CLI_COMMANDS } from './cli-command'

export { CLI_COMMAND, LEGACY_CLI_COMMANDS }

/**
 * Making the command (`CLI_COMMAND`, `uniwork-office`) reachable from a terminal. The
 * launcher ships inside the app (Resources/cli/genoffice, or genoffice.cmd on Windows) and
 * keeps its upstream name; the link on the PATH carries the command's name. Nothing at install
 * time puts it on PATH for the dmg, so it is created when the user asks (Settings, or
 * `install-cli`). Best effort everywhere: no prompts, no elevation, never an error on the
 * app's startup path. `inspectCliLink` reports the same states without writing anything;
 * `cleanupCliLinks` is the launch-time housekeeping for links an earlier run created.
 */
export interface InstallOptions {
  /** absolute path of the launcher to expose */
  launcher: string
  platform?: NodeJS.Platform
  /** directories to try, first writable wins (defaults per platform) */
  candidateDirs?: string[]
  env?: NodeJS.ProcessEnv
  /** test seam for the Windows registry edit */
  runPowerShell?: (script: string) => { ok: boolean; stdout: string }
  /**
   * deb/rpm only: the package's own GUI executable (`/usr/bin/uniwork-office`). A link named
   * like the command must not sit before it on the PATH, or typing the name in a terminal would
   * start the command line instead of the app; see `shadowsGui`.
   */
  guiExecutable?: string
}

export type InstallStatus =
  'linked' | 'present' | 'missing' | 'unwritable' | 'occupied' | 'unsupported'

export interface InstallOutcome {
  status: InstallStatus
  /** where the link or PATH entry lives (or would live) */
  location?: string
  /** what a person can run to finish the job when the app could not */
  manual?: string
  /** the link landed in a directory the current shell does not search; this line adds it */
  pathHint?: string
  /** the name to type when it is not `CLI_COMMAND` (the package launcher on deb/rpm) */
  command?: string
}

/** What a person types: the outcome's own name, else the Windows launcher's (`genoffice`), else the command. */
export function commandName(outcome: { command?: string }, platform: NodeJS.Platform): string {
  return outcome.command ?? (platform === 'win32' ? LAUNCHER_NAME : CLI_COMMAND)
}

/**
 * `/usr/local/bin` is on every login shell's PATH and on the PATH GUI apps
 * inherit, so it is the target even when it does not exist yet: a missing
 * directory is reported as unwritable (creating it needs root), not skipped.
 * `/opt/homebrew/bin` is only a fallback because shells see it solely through
 * `brew shellenv`. When neither system dir is writable the user's own bin dir
 * takes the link, so a non-admin install still gets the command.
 */
export function defaultCandidateDirs(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === 'darwin') return ['/usr/local/bin', '/opt/homebrew/bin', ...userBinDirs(env)]
  if (platform === 'linux') return ['/usr/local/bin', ...userBinDirs(env)]
  return []
}

/** `$XDG_BIN_HOME`, then `~/.local/bin`: created on demand because a fresh account rarely has them. */
export function userBinDirs(env: NodeJS.ProcessEnv): string[] {
  const dirs: string[] = []
  if (env.XDG_BIN_HOME && isAbsolute(env.XDG_BIN_HOME)) dirs.push(env.XDG_BIN_HOME)
  if (env.HOME) dirs.push(join(env.HOME, '.local', 'bin'))
  return [...new Set(dirs)]
}

/** Shell line that puts `dir` on PATH, or undefined when the current environment already searches it. */
export function pathHint(dir: string, env: NodeJS.ProcessEnv): string | undefined {
  const entries = (env.PATH ?? '').split(':').map((p) => p.replace(/\/+$/, ''))
  if (entries.includes(dir.replace(/\/+$/, ''))) return undefined
  const home = env.HOME?.replace(/\/+$/, '')
  const shown = home && dir.startsWith(home + '/') ? '$HOME' + dir.slice(home.length) : dir
  return `export PATH="${shown}:$PATH"`
}

export function installCliLink(opts: InstallOptions): InstallOutcome {
  const platform = opts.platform ?? process.platform
  if (platform === 'win32') return installWindowsPath(opts)
  if (platform !== 'darwin' && platform !== 'linux') return { status: 'unsupported' }
  const env = opts.env ?? process.env
  const dirs = opts.candidateDirs ?? defaultCandidateDirs(platform, env)
  const userDirs = new Set(userBinDirs(env))
  const manual = manualCommand(opts.launcher)
  let occupied: string | undefined
  let shadowed = false
  for (const dir of dirs) {
    if (shadowsGui(dir, opts.guiExecutable, env)) {
      shadowed = true
      continue
    }
    const link = join(dir, CLI_COMMAND)
    const state = linkState(link, opts.launcher)
    if (state === 'ours' && readlinkSync(link) === opts.launcher) {
      return withPathHint({ status: 'present', location: link }, dir, userDirs, env)
    }
    if (state === 'file' || state === 'foreign') {
      // somebody else's command (a file, or npm's symlink): never clobber it
      occupied = link
      continue
    }
    if (userDirs.has(dir) && !existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true })
      } catch {
        continue
      }
    }
    if (!writable(dir)) continue
    try {
      // ours from another install dir, or a dead link nobody can run
      if (state !== 'missing') unlinkSync(link)
      symlinkSync(opts.launcher, link)
      return withPathHint({ status: 'linked', location: link }, dir, userDirs, env)
    } catch {
      continue
    }
  }
  const system = shadowed ? packageLauncherOnPath(opts, env) : undefined
  if (system) return system
  if (occupied) return { status: 'occupied', location: occupied, manual }
  return { status: 'unwritable', location: join(dirs[0] ?? '/usr/local/bin', CLI_COMMAND), manual }
}

/** Read-only twin of `installCliLink`: what a fresh terminal would find, without changing anything. */
export function inspectCliLink(opts: InstallOptions): InstallOutcome {
  const platform = opts.platform ?? process.platform
  if (platform === 'win32') return inspectWindowsPath(opts)
  if (platform !== 'darwin' && platform !== 'linux') return { status: 'unsupported' }
  const env = opts.env ?? process.env
  const dirs = opts.candidateDirs ?? defaultCandidateDirs(platform, env)
  const userDirs = new Set(userBinDirs(env))
  const manual = manualCommand(opts.launcher)
  let occupied: string | undefined
  let shadowed = false
  // same walk installCliLink does: an occupied name is skipped, the first free writable dir wins
  for (const dir of dirs) {
    if (shadowsGui(dir, opts.guiExecutable, env)) {
      shadowed = true
      continue
    }
    const link = join(dir, CLI_COMMAND)
    const state = linkState(link, opts.launcher)
    if (state === 'ours' && readlinkSync(link) === opts.launcher) {
      return withPathHint({ status: 'present', location: link }, dir, userDirs, env)
    }
    if (state === 'file' || state === 'foreign') {
      occupied ??= link
      continue
    }
    if (writable(dir) || (userDirs.has(dir) && creatable(dir))) {
      return withPathHint({ status: 'missing', location: link, manual }, dir, userDirs, env)
    }
  }
  const system = shadowed ? packageLauncherOnPath(opts, env) : undefined
  if (system) return system
  if (occupied) return { status: 'occupied', location: occupied, manual }
  return { status: 'unwritable', location: join(dirs[0] ?? '/usr/local/bin', CLI_COMMAND), manual }
}

/** The deb/rpm after-install script links the app's launcher here (and the GUI as `uniwork-office`). */
export const PACKAGE_LAUNCHER = '/usr/bin/genoffice'
export const PACKAGE_GUI = '/usr/bin/uniwork-office'

export interface LinkTarget {
  launcher: string
  guiExecutable?: string
}

/**
 * What the command's link should point at. On a deb/rpm install the package's own `/usr/bin`
 * launcher is the stable name: a link at the versioned `/opt/<product>/resources/cli/genoffice`
 * or at an AppImage mount breaks with the install, while removing the package leaves at most a
 * dead link to a file the package owned. It counts as the package's launcher only when it
 * resolves to the very file the app ships (another program's `/usr/bin/genoffice` does not), and
 * never for an AppImage run. Elsewhere the shipped launcher is the target, as before.
 */
export function linkTarget(
  launcher: string,
  opts: {
    platform?: NodeJS.Platform
    env?: NodeJS.ProcessEnv
    packageLauncher?: string
    packageGui?: string
  } = {},
): LinkTarget {
  const platform = opts.platform ?? process.platform
  const env = opts.env ?? process.env
  const packageLauncher = opts.packageLauncher ?? PACKAGE_LAUNCHER
  if (platform !== 'linux' || env.APPIMAGE) return { launcher }
  try {
    if (realpathSync(packageLauncher) !== realpathSync(launcher)) return { launcher }
  } catch {
    return { launcher }
  }
  const gui = opts.packageGui ?? PACKAGE_GUI
  return lstatSync(gui, { throwIfNoEntry: false })
    ? { launcher: packageLauncher, guiExecutable: gui }
    : { launcher: packageLauncher }
}

export interface CleanupOptions {
  /**
   * The launcher this run would link to. Absent when the app runs from a temporary mount (an
   * AppImage, a dmg): it then only removes links whose target is gone and creates nothing.
   */
  launcher?: string
  platform?: NodeJS.Platform
  /** directories to sweep (defaults per platform, the same list the install walks) */
  candidateDirs?: string[]
  env?: NodeJS.ProcessEnv
  /** see `InstallOptions.guiExecutable` */
  guiExecutable?: string
}

export interface CleanupReport {
  /** links deleted: the target is gone, or a legacy name that only the package launcher replaces */
  removed: string[]
  /** legacy-name links replaced by a `CLI_COMMAND` link at the current launcher */
  migrated: string[]
  /** `CLI_COMMAND` links that pointed somewhere else of ours, now at the current launcher */
  relinked: string[]
}

/**
 * Launch-time housekeeping for links an earlier run created, in the known bin dirs only.
 * A link is ours when it carries one of our names (`CLI_COMMAND` or a legacy name), is a
 * symlink, and its target is a launcher of ours: it resolves to one (`isOurLauncher`), or, when
 * the target is gone, its path has the shape the app installs (`looksLikeAppLauncher`).
 * Anything else (a regular file, npm's link, another vendor's launcher) is never touched.
 *
 *   - dangling target: removed (an uninstalled package, a vanished AppImage mount);
 *   - ours but not at `launcher` (an old install, or a versioned path where the stable package
 *     launcher is now known): repointed at `launcher`;
 *   - a legacy name: replaced by a `CLI_COMMAND` link at `launcher`. Where the new name would
 *     shadow the GUI executable (`shadowsGui`) the legacy link is only dropped, because the
 *     package launcher already answers to its own name.
 *
 * macOS and Linux only: the Windows PATH entry is a registry value, not a link.
 */
export function cleanupCliLinks(opts: CleanupOptions = {}): CleanupReport {
  const report: CleanupReport = { removed: [], migrated: [], relinked: [] }
  const platform = opts.platform ?? process.platform
  if (platform !== 'darwin' && platform !== 'linux') return report
  const env = opts.env ?? process.env
  const dirs = opts.candidateDirs ?? defaultCandidateDirs(platform, env)
  const launcher = opts.launcher
  for (const dir of dirs) {
    for (const name of [CLI_COMMAND, ...LEGACY_CLI_COMMANDS]) {
      const link = join(dir, name)
      let target: string
      try {
        if (!lstatSync(link).isSymbolicLink()) continue
        target = readlinkSync(link)
      } catch {
        continue
      }
      const resolved = isAbsolute(target) ? target : resolve(dirname(link), target)
      const legacy = name !== CLI_COMMAND
      if (!existsSync(resolved)) {
        if (looksLikeAppLauncher(resolved) && tryUnlink(link)) report.removed.push(link)
        continue
      }
      if (!launcher || !isOurLauncher(resolved, launcher)) continue
      if (!legacy && target === launcher) continue
      if (shadowsGui(dir, opts.guiExecutable, env)) {
        if (tryUnlink(link)) report.removed.push(link)
        continue
      }
      if (!legacy) {
        if (replaceLink(link, launcher)) report.relinked.push(link)
        continue
      }
      const dest = join(dir, CLI_COMMAND)
      const state = linkState(dest, launcher)
      if (state === 'file' || state === 'foreign') continue
      const destReady =
        (state === 'ours' && readlinkSync(dest) === launcher) || replaceLink(dest, launcher)
      if (destReady && tryUnlink(link)) report.migrated.push(link)
    }
  }
  return report
}

/**
 * The shape of a launcher path this app installs: `<...>/resources/cli/genoffice` (Linux,
 * Windows, an AppImage mount, macOS' `Contents/Resources/cli/genoffice`) or the package's
 * `/usr/bin/genoffice`. It is the only evidence of ownership left for a link whose target is
 * gone; a vendor's `/opt/vendor/cli/genoffice` does not match.
 */
export function looksLikeAppLauncher(target: string): boolean {
  const p = target.replace(/\\/g, '/')
  return p === '/usr/bin/genoffice' || /(^|\/)resources\/cli\/genoffice$/i.test(p)
}

function tryUnlink(path: string): boolean {
  try {
    unlinkSync(path)
    return true
  } catch {
    return false
  }
}

/** Points `link` at `launcher`, replacing a symlink (never a file); false when the dir refuses. */
function replaceLink(link: string, launcher: string): boolean {
  try {
    if (lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(link)
    symlinkSync(launcher, link)
    return true
  } catch {
    return false
  }
}

function manualCommand(launcher: string): string {
  return `sudo mkdir -p /usr/local/bin && sudo ln -sf "${launcher}" /usr/local/bin/${CLI_COMMAND}`
}

function trimSlash(p: string): string {
  return p.replace(/\/+$/, '')
}

function pathEntries(env: NodeJS.ProcessEnv): string[] {
  return (env.PATH ?? '').split(':').map(trimSlash).filter(Boolean)
}

/**
 * Would a `CLI_COMMAND` link in `dir` win over the app's GUI executable of the same name when
 * a terminal looks the name up? Only a dir that comes strictly after the GUI's dir on the PATH is
 * safe. A dir that is not on the PATH at all counts as shadowing too: the PATH hint we print puts
 * it in front. With no GUI executable (every platform but deb/rpm) nothing shadows.
 */
export function shadowsGui(
  dir: string,
  guiExecutable: string | undefined,
  env: NodeJS.ProcessEnv,
): boolean {
  if (!guiExecutable) return false
  const entries = pathEntries(env)
  const guiAt = entries.indexOf(trimSlash(dirname(guiExecutable)))
  if (guiAt < 0) return false
  const at = entries.indexOf(trimSlash(dir))
  return at < 0 || at <= guiAt
}

/**
 * deb/rpm when every user-reachable dir would shadow the GUI: the package's own launcher
 * (`/usr/bin/genoffice`) is already on the PATH, so the command is ready under that name and
 * no link is made.
 */
function packageLauncherOnPath(
  opts: InstallOptions,
  env: NodeJS.ProcessEnv,
): InstallOutcome | undefined {
  if (!opts.guiExecutable) return undefined
  if (!pathEntries(env).includes(trimSlash(dirname(opts.launcher)))) return undefined
  if (!existsSync(opts.launcher)) return undefined
  return { status: 'present', location: opts.launcher, command: basename(opts.launcher) }
}

function linkState(
  path: string,
  launcher: string,
): 'missing' | 'ours' | 'dangling' | 'file' | 'foreign' {
  try {
    const st = lstatSync(path)
    if (!st.isSymbolicLink()) return 'file'
    const target = readlinkSync(path)
    if (target === launcher) return 'ours'
    const resolved = isAbsolute(target) ? target : resolve(dirname(path), target)
    if (!existsSync(resolved)) return 'dangling'
    return isOurLauncher(resolved, launcher) ? 'ours' : 'foreign'
  } catch {
    return 'missing'
  }
}

/**
 * A link is ours when it resolves to the launcher we are installing, or to a
 * `genoffice` launcher shipped by another copy of the app (an earlier version,
 * a second install dir): one that has our CLI bundle or the Windows twin beside
 * it. A path that merely ends in `/cli/genoffice` belongs to whoever put it there.
 */
export function isOurLauncher(target: string, launcher: string): boolean {
  let real: string
  try {
    real = realpathSync(target)
  } catch {
    return false
  }
  try {
    if (real === realpathSync(launcher)) return true
  } catch {}
  if (basename(real) !== LAUNCHER_NAME) return false
  const dir = dirname(real)
  return existsSync(join(dir, 'genoffice.cjs')) || existsSync(join(dir, 'genoffice.cmd'))
}

function writable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** A missing dir that `mkdir -p` could create: its nearest existing ancestor is writable. */
function creatable(dir: string): boolean {
  let probe = dir
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) return false
    probe = parent
  }
  return writable(probe)
}

/** System dirs are on PATH by construction; only a per-user dir may need the shell told about it. */
function withPathHint(
  outcome: InstallOutcome,
  dir: string,
  userDirs: Set<string>,
  env: NodeJS.ProcessEnv,
): InstallOutcome {
  const hint = userDirs.has(dir) ? pathHint(dir, env) : undefined
  return hint ? { ...outcome, pathHint: hint } : outcome
}

/**
 * Windows keeps the launcher's directory on the user PATH. The registry value
 * is read and written unexpanded (REG_EXPAND_SZ) so entries like
 * `%USERPROFILE%\bin` survive, unlike `[Environment]::SetEnvironmentVariable`,
 * which writes back the expanded text. Running processes keep their copy of
 * the environment; the WM_SETTINGCHANGE broadcast makes Explorer reload so
 * terminals opened afterwards see the new PATH.
 */
const WIN_PATH_READ =
  "$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true); " +
  "$p = [string]$key.GetValue('Path', '', 'DoNotExpandEnvironmentNames'); "

// best effort: a locked-down PowerShell may refuse Add-Type, the PATH edit still stands
const WIN_BROADCAST =
  'try { ' +
  'Add-Type -Namespace GenOfficePath -Name Native -MemberDefinition \'[DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Auto)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);\'; ' +
  '$r = [UIntPtr]::Zero; ' +
  "[void][GenOfficePath.Native]::SendMessageTimeout([IntPtr]0xffff, 0x1A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$r) " +
  '} catch {}; '

function psQuote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`
}

function installWindowsPath(opts: InstallOptions): InstallOutcome {
  const dir = win32.dirname(opts.launcher)
  const manual = `[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';${dir}', 'User')`
  const script =
    `$dir = ${psQuote(dir)}; ` +
    WIN_PATH_READ +
    "if (($p -split ';') -contains $dir) { 'present'; exit 0 }; " +
    "$next = (@($p, $dir) | Where-Object { $_ }) -join ';'; " +
    "$key.SetValue('Path', $next, [Microsoft.Win32.RegistryValueKind]::ExpandString); " +
    WIN_BROADCAST +
    "'linked'"
  const run = opts.runPowerShell ?? runPowerShell
  const r = run(script)
  if (!r.ok) return { status: 'unwritable', location: dir, manual }
  return { status: r.stdout.trim() === 'present' ? 'present' : 'linked', location: dir }
}

function inspectWindowsPath(opts: InstallOptions): InstallOutcome {
  const dir = win32.dirname(opts.launcher)
  const manual = `[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ';${dir}', 'User')`
  const script =
    `$dir = ${psQuote(dir)}; ` +
    "$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment'); " +
    "$p = [string]$key.GetValue('Path', '', 'DoNotExpandEnvironmentNames'); " +
    "if (($p -split ';') -contains $dir) { 'present' } else { 'missing' }"
  const run = opts.runPowerShell ?? runPowerShell
  const r = run(script)
  if (!r.ok) return { status: 'unwritable', location: dir, manual }
  return { status: r.stdout.trim() === 'present' ? 'present' : 'missing', location: dir, manual }
}

function runPowerShell(script: string): { ok: boolean; stdout: string } {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf-8',
    windowsHide: true,
    timeout: 15_000,
  })
  return { ok: r.status === 0, stdout: r.stdout ?? '' }
}
