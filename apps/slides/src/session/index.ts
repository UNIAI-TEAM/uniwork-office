/**
 * Environment-neutral Slides document session core (GO-B5): the deck model, history,
 * transactions and RenderSlide building. Runs in Electron main (desktop) and in the
 * web frame; it imports no node:* module and no electron. Host specifics come in
 * through SessionPlatform (fonts, TIFF, scheduling, events).
 */
export * from './platform'
export * from './state'
export * from './render'
export * from './txn'
export * from './bytes'
