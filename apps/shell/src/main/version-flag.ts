/**
 * `<app binary> --version`: print the app version and exit before any window,
 * single-instance lock or tab restore. Without this an AppImage (or any
 * packaged build) launched with --version opens the whole app.
 */

/** argv[0] is the executable (and argv[1] the app path when unpackaged), so only flags after it count. */
export function isVersionRequest(argv: readonly string[]): boolean {
  return argv.slice(1).includes('--version')
}
