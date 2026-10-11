/**
 * The name a person types in a terminal. One constant, so renaming the command
 * is a one-line change here (plus the copy that quotes it). The launcher file
 * inside the app keeps its upstream name `genoffice` (docs/upstream/UPSTREAM_SYNC.md);
 * only the link on the PATH carries this name. No imports: the renderer reads it too.
 */
export const CLI_COMMAND = 'uniwork-office'

/** Names earlier versions linked the command under; the launch-time cleanup migrates them. */
export const LEGACY_CLI_COMMANDS: readonly string[] = ['genoffice']

/** The launcher file's own name (upstream name, unchanged). */
export const LAUNCHER_NAME = 'genoffice'
