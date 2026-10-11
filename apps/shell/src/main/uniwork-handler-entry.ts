import {
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Linux: `app.setAsDefaultProtocolClient` records the app's URL schemes in the user's
 * `~/.config/mimeapps.list` (`x-scheme-handler/uniwork=uniwork-office.desktop`). The deb/rpm
 * after-remove script runs as root and cannot reach that per-user file, so an uninstall leaves
 * the entry naming a `.desktop` file that no longer exists. Every launch drops such an entry
 * (this app's desktop id only, and only when no applications dir has the file); the launch
 * registers the schemes again right after, so a working install ends up with a fresh entry.
 */
const SCHEMES = ['uniwork', 'uniwork-office', 'uniwork-office-dev']
/** package.json "desktopName": the id electron-builder gives the .desktop file */
const OWN_DESKTOP_IDS = ['uniwork-office.desktop']
const LISTED_GROUPS = ['Default Applications', 'Added Associations']

export interface HandlerEntryOptions {
  env?: NodeJS.ProcessEnv
  home?: string
  /** test seam: does this desktop file exist? (defaults to the XDG applications dirs) */
  desktopFileExists?: (id: string) => boolean
}

/** The `applications` dirs a desktop id is looked up in, in XDG order. */
export function applicationsDirs(env: NodeJS.ProcessEnv, home: string): string[] {
  const data = env.XDG_DATA_HOME || join(home, '.local', 'share')
  const dirs = (env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean)
  return [data, ...dirs].map((d) => join(d, 'applications'))
}

export function mimeappsPath(env: NodeJS.ProcessEnv, home: string): string {
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'mimeapps.list')
}

/**
 * Drops, from the schemes this app registers, the desktop ids of this app whose file is gone.
 * A line that names another program's desktop file, any other scheme, and every line outside
 * the two listed groups come back byte for byte. Returns the new text and the stale ids dropped.
 */
export function pruneMimeapps(
  text: string,
  isStale: (id: string) => boolean,
): { text: string; dropped: string[] } {
  const dropped: string[] = []
  let group = ''
  const out: string[] = []
  for (const line of text.split('\n')) {
    const header = /^\[(.+)\]\s*$/.exec(line)
    if (header) {
      group = header[1] ?? ''
      out.push(line)
      continue
    }
    const eq = line.indexOf('=')
    const key = eq > 0 ? line.slice(0, eq).trim() : ''
    const scheme = key.startsWith('x-scheme-handler/') ? key.slice('x-scheme-handler/'.length) : ''
    if (!LISTED_GROUPS.includes(group) || !SCHEMES.includes(scheme)) {
      out.push(line)
      continue
    }
    const ids = line
      .slice(eq + 1)
      .split(';')
      .map((id) => id.trim())
      .filter(Boolean)
    const kept = ids.filter((id) => !(OWN_DESKTOP_IDS.includes(id) && isStale(id)))
    if (kept.length === ids.length) {
      out.push(line)
      continue
    }
    dropped.push(...ids.filter((id) => !kept.includes(id)))
    // a CRLF list keeps its line ending on the rewritten line
    if (kept.length > 0) out.push(`${key}=${kept.join(';')};${line.endsWith('\r') ? '\r' : ''}`)
  }
  return { text: out.join('\n'), dropped }
}

/** Best effort and silent: returns the ids dropped, never throws. Linux only. */
export function pruneStaleSchemeHandlers(opts: HandlerEntryOptions = {}): string[] {
  const env = opts.env ?? process.env
  const home = opts.home ?? homedir()
  const file = mimeappsPath(env, home)
  try {
    const exists =
      opts.desktopFileExists ??
      ((id: string) => applicationsDirs(env, home).some((dir) => existsSync(join(dir, id))))
    const text = readFileSync(file, 'utf-8')
    const next = pruneMimeapps(text, (id) => !exists(id))
    if (next.dropped.length === 0) return []
    replaceFile(file, next.text)
    return next.dropped
  } catch {
    return []
  }
}

/**
 * Writes `text` to a temp file in the same dir and renames it over the target, so a crash or a
 * concurrent writer (another desktop tool) never sees a truncated list. A symlinked list (a
 * dotfiles setup) is replaced at its real location, and the file's mode is kept.
 */
function replaceFile(file: string, text: string): void {
  const real = realpathSync(file)
  const tmp = join(dirname(real), `.mimeapps.list.${process.pid}.${Date.now()}.tmp`)
  try {
    writeFileSync(tmp, text, { encoding: 'utf-8', mode: statSync(real).mode & 0o777 })
    renameSync(tmp, real)
  } catch (err) {
    try {
      unlinkSync(tmp)
    } catch {}
    throw err
  }
}
