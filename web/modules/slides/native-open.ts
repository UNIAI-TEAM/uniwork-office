/**
 * The browser's own `window.open`, captured before web/docs/bridge/browser.ts replaces it with
 * the external-link guard (http(s) only, never an opener). The presenter view needs the one
 * window the guard must refuse: its own same-origin audience page, with an opener for the
 * MessagePort handshake (./presenter-window.ts). ./install.ts imports this module FIRST
 * (ES modules evaluate in import order).
 */
type WindowOpen = typeof window.open

export const nativeOpen: WindowOpen | null =
  typeof window !== 'undefined' && typeof window.open === 'function'
    ? window.open.bind(window)
    : null
