/**
 * Web bridge entry point (UNI-1011 spike).
 *
 * Imported from web/docs/index.html BEFORE the renderer entry so
 * `window.desktop` / `window.projectApi` exist by the time the renderer's
 * main.tsx reads them.
 *
 * Module ownership (each default-exports a partial DesktopApi):
 *   ./browser  W4  BROWSER class: print, download, file picker, clipboard,
 *                  theme, language.
 *   ./webapi   W3  WEB-API class: open/save/recents/export over the host
 *                  protocol (../protocol/client.ts) + in-memory projectApi.
 *   ./ai       W6  aiStream / webSearch / imageSearch / aiGenerateImage /
 *                  getAiSettings / aiChat / fetchImage stubs.
 *   ./hide     W6  HIDE class no-ops (Zotero, doc passwords, recovery copy,
 *                  tabs/menu, window chrome).
 *
 * Every key of DesktopApi that no module implements is filled with a safe
 * fallback so the renderer never throws on a missing method: `on*` subscribers
 * get a no-op disposer (they are called synchronously and their return value is
 * used as an unsubscribe function), everything else gets an async no-op.
 */
import browser from './browser'
import { createDocsFrameClient } from '../protocol/client'
import { createWebApi } from './webapi'
import ai from './ai'
import hide from './hide'

type Bridge = Record<string, unknown>

function fallbackFor(key: string): unknown {
  if (key.startsWith('on')) return () => () => {}
  return () => Promise.resolve(undefined)
}

/** same-origin iframe (lane decision): the only host the frame talks to */
const webapi = createWebApi(
  createDocsFrameClient({
    allowedOrigins: [location.origin],
    capabilities: {
      save: true,
      saveAs: true,
      recents: true,
      print: true,
      exportPdf: true,
      exportHtml: true,
    },
  }),
)

export function installBridge(): void {
  // later modules win: webapi's real fetchImage / convertAltChunkHtml / close
  // guard replace the ai.ts and hide.ts stubs
  const modules: Bridge[] = [hide, ai, webapi, browser]
  const desktop: Bridge = {}
  for (const mod of modules) for (const key of Object.keys(mod ?? {})) desktop[key] = mod[key]

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
