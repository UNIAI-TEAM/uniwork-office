/**
 * Environment-neutral Slides document session core (GO-B5): the deck model, history,
 * transactions, RenderSlide building and the `slides:*` handler registry. Runs in
 * Electron main (desktop) and in the web frame; it imports no node:* module and no
 * electron. Host specifics come in through SessionPlatform (fonts, TIFF, scheduling,
 * events) and HostIO (pickers, dialogs, clipboard, save target).
 */
export * from './platform'
export * from './state'
export * from './render'
export * from './txn'
export * from './open'
export { applySessionTxn } from './apply-txn'
export * from './host-io'
export * from './app-clipboard'
export * from './bytes'
export { CHART_COLOR_SCHEMES, chartColorSchemes } from './chart-colors'
export { MemoryHostIO, type MemoryHostCall } from './memory-host-io'
export {
  sessionHandlers,
  callSessionHandler,
  type SessionChannel,
  type SessionHandler,
} from './registry'
