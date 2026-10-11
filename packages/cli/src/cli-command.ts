/**
 * The name a person types in a terminal, on every OS. One constant, so renaming the command
 * is a one-line change here (plus the copy that quotes it). It is deliberately not
 * `uniwork-office`: on deb/rpm that is the desktop program (`/usr/bin/uniwork-office`).
 * The launcher file inside the app keeps its upstream name `genoffice` (docs/upstream/UPSTREAM_SYNC.md);
 * only the link or shim on the PATH carries this name. No imports: the renderer reads it too.
 */
export const CLI_COMMAND = 'uniwork-office-cli'

/**
 * Names earlier versions linked the command under; the launch-time cleanup migrates them.
 * `uniwork-office` is the desktop program's own name: a link by that name is touched only when it
 * is a symlink to one of our launchers (never the GUI binary itself).
 */
export const LEGACY_CLI_COMMANDS: readonly string[] = ['genoffice', 'uniwork-office']

/** The launcher file's own name (upstream name, unchanged). */
export const LAUNCHER_NAME = 'genoffice'
