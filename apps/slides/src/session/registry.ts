/**
 * The session handler registry: every `slides:*` channel the session core serves,
 * keyed by its IPC channel name. A host adapter dispatches to it — Electron main with
 * `ipcMain.handle(channel, (e, ...args) => handler({ clientId: e.sender.id, host }, ...args))`,
 * the web frame from its slidesApi bridge with a single client id.
 */
import type { HandlerContext } from './host-io'
import { clipboardHandlers } from './handlers/clipboard'
import { documentHandlers } from './handlers/document'
import { elementHandlers } from './handlers/elements'
import { historySaveHandlers } from './handlers/history-save'
import { masterHandlers } from './handlers/master'
import { pictureMediaHandlers } from './handlers/pictures-media'
import { slideHandlers } from './handlers/slides'
import { tableChartHandlers } from './handlers/tables-charts'
import { textHandlers } from './handlers/text'

export type SessionHandler = (ctx: HandlerContext, ...args: any[]) => unknown

export const sessionHandlers = {
  ...textHandlers,
  ...elementHandlers,
  ...tableChartHandlers,
  ...pictureMediaHandlers,
  ...slideHandlers,
  ...clipboardHandlers,
  ...masterHandlers,
  ...documentHandlers,
  ...historySaveHandlers,
} satisfies Record<`slides:${string}`, SessionHandler>

export type SessionChannel = keyof typeof sessionHandlers

/** Call a session handler by channel with typed arguments and result. */
export function callSessionHandler<C extends SessionChannel>(
  channel: C,
  ctx: HandlerContext,
  ...args: Parameters<(typeof sessionHandlers)[C]> extends [HandlerContext, ...infer A] ? A : never
): ReturnType<(typeof sessionHandlers)[C]> {
  const handler = sessionHandlers[channel] as SessionHandler
  return handler(ctx, ...args) as ReturnType<(typeof sessionHandlers)[C]>
}
