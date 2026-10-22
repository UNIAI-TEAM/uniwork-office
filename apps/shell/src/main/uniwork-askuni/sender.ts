import type { WebContents } from 'electron'

/**
 * The sender rule of every `uniwork:askuni:*` handler: only the shell's own
 * page (its webContents, main frame) may ask, never a frame inside it or an
 * editor window - the same check as uniwork-auth's `fromShell`. One call per
 * handler, so the UNI-2073 guard can replace it in one place each.
 */
export function createShellSenderCheck(
  shellContents: () => WebContents | null,
): (event: unknown) => boolean {
  return function isShellMainFrameSender(event) {
    if (!event || typeof event !== 'object') return false
    const { sender, senderFrame } = event as { sender?: WebContents; senderFrame?: unknown }
    const shell = shellContents()
    if (!shell || !sender || sender !== shell || shell.isDestroyed()) return false
    return Boolean(senderFrame) && senderFrame === shell.mainFrame
  }
}
