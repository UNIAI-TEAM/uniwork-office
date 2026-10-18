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
 *              getAiSettings / aiChat / fetchImage stubs (AI hidden).
 * The merged object then gets the web AI bridge (web/modules/shared/ai,
 * CONTRACT C16): while the host grants `ai` its members replace the stubs
 * (frame-token AI routes); without the grant the stubs answer as before.
 *   ./webapi   WEB-API class: open/save/recents/export over the host
 *              protocol (../protocol/client.ts) + in-memory projectApi.
 *   ./browser  BROWSER class: print, download, file picker, clipboard,
 *              theme, language.
 * `capabilities` is then replaced by a copy of hide's that receives the host
 * grants from `init` (File > Open, recents).
 *
 * Headless entry (./headless.ts): a TOP-LEVEL page loaded with
 * `?headless=1&open=<same-origin path>` gets no frame client at all; a
 * synthesized port opens that one document read-only, light theme, and its
 * overrides (headless export target, readiness signal, no saves) win last.
 * A framed page never takes this path, whatever its URL says.
 *
 * Every key of DesktopApi that no module implements is filled with a safe
 * fallback so the renderer never throws on a missing method: `on*` subscribers
 * get a no-op disposer (they are called synchronously and their return value is
 * used as an unsubscribe function), everything else gets an async no-op.
 *
 * The generic pieces (frame client bootstrap, capability object, safe no-op
 * Proxy) live in ./frame-boot, ./capability-object and ./safe-api so the other
 * genoffice modules (web/modules/<module>/) reuse them; see ./module-bridge.
 */
import browser from './browser'
import { createWebApi } from './webapi'
import { bindHostAppearance, createFrameClient } from './frame-boot'
import { createCapabilityObject } from './capability-object'
import { frameAiRun } from '../../modules/shared/ai-run'
import { rememberRemoteVersion } from '../../modules/shared/conflict-dialog'
import { mergeModules, safeApi, type BridgeObject } from './safe-api'
import ai from './ai'
import { createAppOpen } from './app-open'
import hide, { hostGrants, webCapabilities } from './hide'
import { createHeadless, isTopLevel, parseHeadlessEntry } from './headless'
import { installFocusReturn } from './focus-return'
import { installEscapeForwarder } from './escape-forwarder'
import { aiHostGrants, createWebAi, withWebAi } from '../../modules/shared/ai/web-ai'
import { FRAME_BASE_CAPABILITIES } from './module-bridge'
import { frameCommentsClaim } from '../../modules/shared/discussion/claim'
import { mountFrameDiscussion } from '../../modules/shared/discussion/mount'
import { installFrameComments } from '../../modules/shared/comments'
import type { DesktopCapabilities } from '../../../apps/docs/src/shared/ipc'

/**
 * The frame Discussion panel (S13) + the `comments` claim (lane G8-11 D4, invariant 8). On since
 * G8-12: the editor serves the anchored comments (S12) through `window.uniworkComments`, so the
 * frame panels are the page's only comments surfaces.
 */
const frameComments = true

const headlessEntry = parseHeadlessEntry(location.href, isTopLevel(window))
const headless = headlessEntry ? createHeadless(headlessEntry) : null

/** same-origin iframe (lane decision): the only host the frame talks to */
const client =
  headless?.port ??
  createFrameClient({
    capabilities: {
      // the AI keys, desktopOpen (A7) and download (X-02); each effective only with the host grant
      ...FRAME_BASE_CAPABILITIES,
      save: true,
      saveAs: true,
      saveCopy: true,
      recents: true,
      print: true,
      exportPdf: true,
      exportHtml: true,
      filePick: true,
      ...frameCommentsClaim(frameComments),
    },
  })
/** read by the renderer's cap(); boot waits (bounded) for init, so the grants land before the first render */
const capabilities: DesktopCapabilities = createCapabilityObject<DesktopCapabilities>(
  webCapabilities,
  client,
  (granted) => ({ ...aiHostGrants(granted), ...hostGrants(granted) }),
)
// theme + language come from the host (never localStorage) and must be in place before boot
bindHostAppearance(client)
// the conflict table learns who saved a revision from doc.remoteVersion
client.onRemoteVersion?.(rememberRemoteVersion)
// the AI turns of this frame: the host hears `aiRun`, the new-version bar waits for idle
frameAiRun.bind((payload) => client.reportAiRun?.(payload))
const webapi = createWebApi(client)

export function installBridge(): void {
  // later modules win: webapi's real fetchImage / convertAltChunkHtml / close
  // guard replace the ai.ts and hide.ts stubs
  const modules: BridgeObject[] = [
    hide,
    ai,
    webapi,
    browser,
    // the "use the app" action (A7): one host request, only with the `desktopOpen` grant
    { openInApp: createAppOpen(client, capabilities as Record<string, unknown>) },
  ]
  if (headless) modules.push(headless.desktopFor(webapi))
  // the headless entry has no frame token: AI stays off there
  const desktop = withWebAi(
    mergeModules(modules),
    createWebAi({
      port: client,
      capabilities: capabilities as Record<string, unknown>,
      aiRun: frameAiRun,
    }),
  )
  desktop.capabilities = capabilities

  const win = window as unknown as {
    desktop: BridgeObject
    projectApi: BridgeObject
    __docsWebBridge: boolean
  }
  win.desktop = safeApi(desktop)
  win.projectApi = (webapi.projectApi as BridgeObject) ?? {}
  win.__docsWebBridge = true
  // the host leave dialog hands the focus back to the frame window: put it in the editor again
  if (!headless) {
    installFocusReturn()
    installEscapeForwarder(window, (reason) => client.reportCloseRequested?.(reason))
  }
  if (!headless && frameComments) {
    // the editor's S12 panel reads window.uniworkComments once init says `comments` is effective;
    // it awaits this promise first, since the install itself waits for init
    ;(window as unknown as { uniworkCommentsReady?: Promise<unknown> }).uniworkCommentsReady =
      installFrameComments(client)
    // the editor panel owns anchored ids and shows its own S15 line on a miss
    void mountFrameDiscussion(client, { revealMissing: 'silent' })
  }
}

installBridge()
