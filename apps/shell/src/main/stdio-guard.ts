/**
 * electron-vite (and some launchers) close the parent stdio pipes while the
 * Electron main process is still alive. Node's ExperimentalWarning path then
 * console.error → stderr → write EPIPE → uncaughtException dialog.
 *
 * Side-effect import this module first from main/index.ts.
 */

function isPipeError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  return code === 'EPIPE' || code === 'EIO'
}

function isSqliteExperimentalWarning(warning: unknown, type?: unknown): boolean {
  const name =
    (typeof type === 'string' && type) ||
    (warning && typeof warning === 'object' && 'name' in warning
      ? String((warning as { name: unknown }).name)
      : '')
  const message =
    typeof warning === 'string'
      ? warning
      : warning && typeof warning === 'object' && 'message' in warning
        ? String((warning as { message: unknown }).message)
        : ''
  return /experimental/i.test(name || message) && /sqlite/i.test(message)
}

function guardWrite(stream: NodeJS.WriteStream | null | undefined): void {
  if (!stream || typeof stream.write !== 'function') return
  const orig = stream.write.bind(stream)
  stream.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
    try {
      return orig(chunk as never, encoding as never, cb as never)
    } catch (err) {
      if (isPipeError(err)) {
        if (typeof cb === 'function') (cb as (e?: Error | null) => void)(null)
        else if (typeof encoding === 'function') (encoding as (e?: Error | null) => void)(null)
        return true
      }
      throw err
    }
  }) as typeof stream.write

  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (isPipeError(err)) return
  })
}

export function installStdioGuard(): void {
  guardWrite(process.stdout)
  guardWrite(process.stderr)

  const originalEmitWarning = process.emitWarning.bind(process)
  process.emitWarning = ((warning: unknown, ...args: unknown[]) => {
    if (isSqliteExperimentalWarning(warning, args[0])) return
    return (originalEmitWarning as (...a: unknown[]) => void)(warning, ...args)
  }) as typeof process.emitWarning
}

installStdioGuard()
