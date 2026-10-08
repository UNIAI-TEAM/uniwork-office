/**
 * Web bridge entry point (UNI-1013).
 *
 * Imported from web/docs/index.html BEFORE the renderer entry so
 * `window.desktop` / `window.projectApi` exist by the time the renderer's
 * main.tsx reads them.
 *
 * Modules (each provides a partial DesktopApi), merged in this order, later wins:
 *   ./hide     HIDE class no-ops (Zotero, doc passwords, recovery copy,
 *              tabs/menu, window chrome) + the capability source.
 *   ./ai       aiStream / webSearch / imageSearch / aiGenerateImage /
 *              getAiSettings / aiChat / fetchImage stubs (AI is hidden).
 *   ./webapi   WEB-API class: open/save/recents/export over the host
 *              protocol (../protocol/client.ts) + in-memory projectApi.
 *   ./browser  BROWSER class: print, download, file picker, clipboard,
 *              theme, language.
 * `capabilities` is then replaced by a copy of hide's that receives the host
 * grants from `init` (File > Open, recents).
 *
 * Every key of DesktopApi that no module implements is filled with a safe
 * fallback so the renderer never throws on a missing method: `on*` subscribers
 * get a no-op disposer (they are called synchronously and their return value is
 * used as an unsubscribe function), everything else gets an async no-op.
 */
import browser from './browser'
import { createDocsFrameClient } from '../protocol/client'
import { createWebApi } from './webapi'
import { bindHostAppearance } from './host-appearance'
import ai from './ai'
import hide, { hostGrants, webCapabilities } from './hide'
import type { DesktopCapabilities } from '../../../apps/docs/src/shared/ipc'

type Bridge = Record<string, unknown>

function fallbackFor(key: string): unknown {
  if (key.startsWith('on')) return () => () => {}
  return () => Promise.resolve(undefined)
}

/** same-origin iframe (lane decision): the only host the frame talks to */
const client = createDocsFrameClient({
  allowedOrigins: [location.origin],
  capabilities: {
    save: true,
    saveAs: true,
    recents: true,
    print: true,
    exportPdf: true,
    exportHtml: true,
    filePick: true,
  },
})
/** read by the renderer's cap(); boot waits (bounded) for init, so the grants land before the first render */
const capabilities: DesktopCapabilities = { ...webCapabilities }
client
  .whenInitialized()
  .then((session) => Object.assign(capabilities, hostGrants(session.capabilities)))
  .catch(() => {}) // a failed handshake is reported by webapi.ts
// theme + language come from the host (never localStorage) and must be in place before boot
bindHostAppearance(client)
const webapi = createWebApi(client)

export function installBridge(): void {
  // later modules win: webapi's real fetchImage / convertAltChunkHtml / close
  // guard replace the ai.ts and hide.ts stubs
  const modules: Bridge[] = [hide, ai, webapi, browser]
  const desktop: Bridge = {}
  for (const mod of modules) for (const key of Object.keys(mod ?? {})) desktop[key] = mod[key]
  desktop.capabilities = capabilities

  const proxied = new Proxy(desktop, {
    get(target, prop: string | symbol) {
      // symbols (String(desktop), devtools) and `then` (await desktop) must not get a fallback
      if (typeof prop !== 'string' || prop === 'then') return Reflect.get(target, prop)
      if (prop in target) return target[prop]
      const fallback = fallbackFor(prop)
      target[prop] = fallback
      return fallback
    },
  })

  const win = window as unknown as { desktop: Bridge; projectApi: Bridge; __docsWebBridge: boolean }
  win.desktop = proxied
  win.projectApi = (webapi.projectApi as Bridge) ?? {}
  win.__docsWebBridge = true
}

installBridge()
