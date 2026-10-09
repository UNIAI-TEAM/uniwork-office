# Slides on the web: the frame module (GO-B5 S2 + S4 + S5, UNI-1015)

The genoffice Slides renderer runs in the UniWork web frame (`web/modules/slides/`) with the document
engine inside the frame: the session core that S1 moved out of Electron main (`apps/slides/src/session`)
runs on the frame's main thread (B5 decision 8) behind a complete `window.slidesApi`.

## What runs where

| piece                | file                                                    | notes                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bridge entry         | `web/modules/slides/install.ts`                         | `installModuleBridge` (GF): `slidesApi`, `desktop` (Docs attachment subset), in-memory `projectApi`; capability defaults in `capabilities.ts`                                                                                                                 |
| `window.slidesApi`   | `web-slides-api.ts`                                     | all preload methods, typed as the full `SlidesApi` (a new preload method is a build error). Engine methods call the session handler registry with structured clones in and out (IPC semantics)                                                                |
| HostIO (web)         | `web-host-io.ts`                                        | file inputs, `createImageBitmap`, video poster frame on a canvas, in-frame confirm, clipboard markers, `api.recents` when granted, `init.user` as comment author, `api.save` with etag + conflict prompt, `api.saveAs`                                        |
| dialogs              | `dialogs.ts`                                            | the renderer's `.modal*` classes; strings in the new `web` i18n domain (`apps/slides/src/renderer/i18n/web/*`, zh defines the keys, all 21 shards)                                                                                                            |
| export / print       | `exports.ts`                                            | PNG zip (jszip), image-per-page PDF (JPEG pass-through, desktop page geometry 7.5in x ratio), print = desktop print document in a hidden `srcdoc` frame                                                                                                       |
| fonts / metrics (S4) | `fonts.ts`                                              | canvas `measureText` provider (measure == draw), Calibri -> bundled Carlito, embedded pptx fonts as `FontFace`s before the first layout; heuristic without a canvas                                                                                           |
| TIFF                 | `tiff.ts`                                               | UTIF + a small PNG encoder (desktop uses pngjs, which needs Node streams)                                                                                                                                                                                     |
| Node shims           | `shims/{buffer,crypto,zlib,node-fs}.ts` + `vite-web.ts` | `node:crypto` (sync SHA-256, randomUUID), `node:zlib` (deflate), `node:fs` (fails loudly), and a `Buffer` import injected into pptx-engine/ops/render only; wired by the new additive `webPlugins` field of the module registry (`web/docs/build/modules.ts`) |
| session seam         | `apps/slides/src/session/open.ts`                       | open from bytes + `deckOpened` platform hook (embedded fonts)                                                                                                                                                                                                 |

### Method classes (inventory-b5 1.2)

- **engine**: every `slides:*` channel of the session registry (edits, queries, history, save, save-as, clipboard copy/paste, media data).
- **protocol**: `consumePendingOpen` (`init.open` else `api.open`), `onOpened` (host `open`), `openPptx` (`file.pick`), `openPptxPath` / `getRecentFiles` (`api.open` / `api.recents`), `onRenamed` (`file.renamed`); host `save` runs the renderer's close-save flow, host `saveAs` its Save As (`onMenuCommand('save-as')`, host name wins), host `print` its print dialog (answered when `printSlides` settles), `doc.closeCheck` = engine dirty state. Dirty goes to the host from the history events (no polling).
- **browser**: exports and print, clipboard (`navigator.clipboard`; `clipboardProbe` optimistic), fullscreen (`setShowFullScreen` uses the Fullscreen API, which also covers the macOS-browser gap where the renderer skips HTML fullscreen), media as `blob:` URLs (revoked on reopen), File shortcuts Ctrl+S / Ctrl+Shift+S / Ctrl+O mapped onto `onMenuCommand` (they are native-menu accelerators on the desktop).
- **presenter**: `presenterStart` / `presenterSync` / `presenterInk` / `presenterSwap` / `presenterEnd` / `onAudienceNav` plus the web-only `presenterOpenAudience` / `presenterCloseAudience` / `onPresenterAudience`: the audience window (see [Presenter view and audience window](#presenter-view-and-audience-window-sp1)).
- **hidden (typed stubs)**: 27 AI methods (same shapes as the Docs stubs), font catalog / download / local install, headless export, every autosave key (C10: `api.save` never carries `auto`).

Edge cases: a CFB container (legacy `.ppt`, encrypted `.pptx`) gets a fatal notice (`webLegacyPpt` / `webEncryptedPptx`) and every save is refused; a 0-byte file opens as a blank deck bound to that file; external linked media return no URL (poster only, B5 decision 5); a save whose outcome is unknown (timeout / network) adopts the head etag when the head looks like our own bytes, as Docs does.

## Presenter view and audience window (SP1)

CONTRACT C15(2), "like the desktop app" (`apps/slides/src/main/presenter-show.ts`). The presenter view (current + next slide,
notes, timer, pen / laser, black / white screen, film strip) runs in the frame tab as before; it now opens an **audience
window** next to it.

| desktop (Electron main)                                                   | web (`web/modules/slides/presenter-window.ts`, in the frame)                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `presenterStart` opens a fullscreen BrowserWindow on the external display | the top bar's **Audience Window** button (`presenterOpenAudience`): a browser opens windows only from a click. `window.open` of the frame's own `index.html?mode=audience&show=<id>` with an opener                                                                                                                         |
| audience shares the presenter's session                                   | audience asks read-only queries over a private `MessageChannel`: render slides, transition, animations, shape keys, media bytes (its own `blob:` URL), embedded font bytes (its own `FontFace`s), language, latest state. Nothing else is served (`AUDIENCE_METHODS`); edits, saves and the host protocol stay in the frame |
| `presenter-sync` / `presenter-ink` -> `show-sync` / `show-ink`            | `sync` / `ink` on the port: slide index, build steps (`played` / `playing`, which also drive media play state), page direction, black / white screen, end of show; `lastSync` answers a late `audienceReady`                                                                                                                |
| `audience-nav` back to the presenter                                      | `nav` on the port (audience clicks, arrows, Esc ends the show)                                                                                                                                                                                                                                                              |
| `presenter-swap` moves windows between displays                           | moves the audience window to the next screen (Window Management API)                                                                                                                                                                                                                                                        |
| `presenter-end` / presenter destroyed closes the audience                 | End Show, `presenterCloseAudience` and the frame's `pagehide` close it; the audience also closes itself when its presenter is gone or never answered (reloaded / opened by hand)                                                                                                                                            |
| audience window closed -> `audienceWin = null`                            | `bye` (or `closed` poll) -> `onPresenterAudience(false)`: the presenter view keeps running single-screen and can reopen the window                                                                                                                                                                                          |

- **Protocol** (`presenter-protocol.ts`): handshake on `window.postMessage` (namespace `uniwork.office.slides.audience`, `v: 1`,
  target origin = own origin, checked `source` + `origin` + random 128-bit show id) -> the presenter transfers a `MessagePort`
  -> the audience sets `window.opener = null` (the frame is same-origin with the UniWork page; nothing beyond the port is kept).
  Every message is validated on receipt; unknown methods, malformed states or ink, wrong namespace / version / show are dropped.
  The frame's external-link guard on `window.open` (`web/docs/bridge/browser.ts`) is unchanged: the presenter uses the browser's
  own `open`, captured before the guard installs (`native-open.ts`, first import of `install.ts`).
- **Placement** (`screens.ts`): inside the click the frame calls `getScreenDetails()` (permission `window-management`, prompts once)
  and `window.open`. Granted with a second screen: the window is moved and sized onto it (later windows open there directly),
  swap cycles through the other screens. Denied, unsupported or one screen: a 960x540 window the user drags to the projector;
  never asked again in the session. Fullscreen: browsers grant it only to a gesture in the window itself, so the audience shows
  "Click to show full screen" and its first click enters fullscreen on the screen it is on (that click does not advance).
- **Audience page** = the frame's own `index.html` in audience mode (`install.ts` branches on `?mode=audience&show=<id>`
  to `audience-bridge.ts`; the renderer entry already mounts `AudienceView` for `mode=audience`). Same bundle, same
  `headers.json` rule, same CSP header: **the CSP is unchanged** (a separate `audience.html` would have needed its own header
  rule and host route for no gain).
- Popup blocked: the hint in the top bar says to allow pop-ups for the site. `presenterWindow` is now **on** for the web.

## CSP (S5)

`csp.json` = the Docs policy + `media-src blob:` only (the GF scaffold had `'self' data: blob:`; narrowed to the B5 decision, reason next to it in `modules.ts`). No `wasm-unsafe-eval`, no `worker-src blob:`, no `connect-src` widening. The e2e asserts the header and 0 `securitypolicyviolation` events through open, edit, save, conflict, export, show, print and media playback.

## Size (S5)

`npm run build:web -- --module slides` (dist-web/slides/0.1.0-4e5cdaa): **18 files, 5.00 MiB (gzip 2.08); initial 4.05 MiB (gzip 1.20), deferred 0.95 MiB** (the four Carlito WOFF2 faces, 0.77 MiB, are lazy by `@font-face`). The initial JS chunk is 4.11 MB raw / 1.25 MB gzip: the renderer-only plain build was 3.06 MB / 0.90 MB (inventory-b5 section 4), so the engine + bridge add about 1.0 MB raw / 0.34 MB gzip, as the inventory estimated. Composition: see "Size composition" below.

### Size composition

Share of the initial chunk's sources (unminified bytes from the sourcemap of a `WEB_DOCS_SOURCEMAP=1` build; a proxy for the minified share):

| part                                                                                                    | share |
| ------------------------------------------------------------------------------------------------------- | ----- |
| Slides renderer i18n (21 locales x 4 domains)                                                           | 17.2% |
| Slides renderer (UI, canvas, actions)                                                                   | 16.4% |
| pptx-engine                                                                                             | 10.8% |
| Slides renderer AI panel + skills (`renderer/ai/`)                                                      | 7.9%  |
| react-dom + react-reconciler                                                                            | 11.8% |
| konva                                                                                                   | 5.2%  |
| pptx-render + pptx-ops                                                                                  | 6.6%  |
| frame protocol client + bridge + this module                                                            | 2.9%  |
| acorn (layout script interpreter), pako (jszip), docx-engine (metafiles), utif2, jszip, fast-xml-parser | 10.6% |
| session core + main leaf modules (strings, sniffers)                                                    | 3.5%  |

The cheap wins are renderer-side: lazy-load `AiPanel` behind `cap('ai')` (about 8%) and load i18n locales on demand
(Docs measured the same 17% on its own chunk); both are renderer changes (S3 or a later size pass), not bridge work.

AI tree-shaking is not cheap from the bridge: `App.tsx` imports `AiPanel` (and with it `agent-core` / `ai-provider`) statically, so dropping it needs a renderer change (a lazy `AiPanel` behind `cap('ai')`), which belongs to S3.

## Fidelity (S4)

`web/e2e/slides-fidelity.spec.ts` compares the frame's canvas layout with the engine in Node using OpentypeMetrics over Carlito (the desktop's Calibri twin) on both fixture decks; the table is in [slides-fidelity.md](./slides-fidelity.md). Calibri deck: identical line breaks, mean run width drift about 1% (max 3%, max run x drift 3.6 px at 1280 px). The CJK/emoji deck drifts more (mean 4.7%) because the reference has no font file for those runs (heuristic) while the browser draws with real system faces; the frame itself is consistent, since it measures and draws with the same canvas font. Liberation / Caladea twins are not bundled (B5 decision 7); add them only if the visual pass shows Arial/Times decks drifting.

## Tests

| test                                                                                     | what                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/modules/slides/web-slides-api.test.ts` (jsdom)                                      | every key of the Electron preload `api` object exists; open / CFB refusal / host open; save with etag and no `auto`; conflict Overwrite / Reload latest / Cancel; host save / saveAs / print / closeCheck; accelerators; recents grant; comment author; picture insert from a file input; blob: media; clipboard markers; zip export; print document; stubs                                                                                                                                   |
| `web/modules/slides/shims.test.ts`                                                       | SHA-256 / randomUUID / deflate / Buffer subset pinned against Node; build plugin; PNG / PDF / zip writers (caught a missing `Buffer#write` that broke media insert)                                                                                                                                                                                                                                                                                                                           |
| `web/modules/slides/session-in-frame.test.ts` + `apps/slides/tests/frame-parity.test.ts` | one editing scenario saved by the desktop core in Node (`savePptxToFile`) and by the frame's `slidesApi` on the shims (`api.save`): identical package entries (`web/modules/slides/__snapshots__/frame-parity.json`); the zip container differs by design (streamed data descriptors)                                                                                                                                                                                                         |
| `web/e2e/slides-web.spec.ts`                                                             | production build under its CSP header in the test host: canvas text edit, undo/redo, Ctrl+S to the host, conflict + Overwrite, PNG zip + PDF downloads, fullscreen show, print, blob: audio; 0 console errors, 0 CSP violations; screenshots in `screenshots/slides/`                                                                                                                                                                                                                         |
| `web/modules/slides/presenter-window.test.ts` (jsdom)                                    | SP1 sync protocol: message validation (states, ink, read-only method allowlist, nav, handshake), the open + port handshake, sync of index / builds / media state / black / white / end, ink + deck forwarding, late audience, read-only queries + media bytes, nav back, both close paths, foreign hellos ignored, orphan audience closes; Window Management granted / 3 screens swap / denied / unsupported                                                                                  |
| `web/e2e/slides-presenter.spec.ts`                                                       | SP1 on the production build: presenter view -> Audience Window (frame page in audience mode, no opener, same CSP) -> next / builds / previous / black / white in sync -> audience click = fullscreen, then navigation -> user closes the audience, presenter keeps working -> reopen -> End Show closes it; WM granted (moved onto screen 2) and denied (960x540, swap no-op, Esc in the audience ends the show); 0 console errors, 0 CSP violations; screenshots `presenter-*`, `audience-*` |
| `web/e2e/slides-fidelity.spec.ts`                                                        | S4 drift table                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `web/e2e/modules-smoke.spec.ts` (GF)                                                     | slides boots in the test host                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Renderer capability gating (S3)

`apps/slides/src/renderer/capabilities.ts` (`cap()` over `@genoffice/ui` `createCapabilityReader`) reads the object the bridge
installs on `window.slidesApi.capabilities`; Electron sets none, so the desktop keeps every entry. On the web:

| key                                | gated                                                                                                                                                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `autoSave`                         | AutoSave toggle hidden and its 30 s / blur timer never armed, whatever a stored preference says (C10; the e2e edits, idles 65 s with blurs and checks that no `saved` event reached the host)                                                             |
| `ai`                               | AI dock / rail, stage AI bar, Home AI group, Review proofing + translate presets, ask-AI trigger, popover and Ctrl+K, AI settings / presets; `AiPanel` is a lazy chunk the frame never loads                                                              |
| `open`, `recents`                  | File > Open (Ctrl+O), recent files; on with the host's `filePick` / `recents` grants                                                                                                                                                                      |
| `save`, `saveAs`                   | QAT save, File > Save / Save As; on with the host's grants. Without `save` the frame is view-only: File, Slide Show and View tabs only, no format context tabs, `file-actions.save/saveAs` refuse, and the bridge serves only read channels of the engine |
| `fontDownload`, `fontInstallLocal` | catalog download, missing-font banner, install local font                                                                                                                                                                                                 |
| `model3d`                          | Insert > 3D Models                                                                                                                                                                                                                                        |
| `presenterWindow`                  | presenter view swap-screens and Audience Window buttons; **on** on the web since SP1 (the audience window works in the browser)                                                                                                                           |
| `platform: 'web'`                  | no native window chrome (traffic-light / caption padding, vibrancy), the File tab on every OS, HTML fullscreen for the show and the presenter view in a macOS browser                                                                                     |

Size after the AI split (`build:web --module slides`, same commit range): initial **4.05 MiB -> 3.73 MiB** (gzip 1.20 -> 1.09);
the main chunk 4,108.8 kB -> 3,768.4 kB (gzip 1,246.2 -> 1,127.5 kB); `AiPanel-*.js` 342.2 kB (gzip 120.1 kB) moved to the deferred
set and is never requested by the frame. On-demand i18n was not done: the renderer's translator is synchronous over one object merged
from every locale shard (`i18n/strings.ts`), so loading locales lazily means an async locale switch in `LocaleProvider` plus
loader-style aggregators in all four domains; not cheap, and the size win (about 17% of the chunk's sources) is left for a size pass.

## Open items

- Read-only documents: the host falls back to G3 for `writable:false` (B5 decision 1); the frame has no read-only mode.
- No draft recovery on the web (B5 decision 3), no autosave (C10).
- External linked media playback (hidden), server-side print-quality PDF (not needed in v1).
- Audience fullscreen needs one click in the audience window (browser rule); a Chrome "fullscreen popup" (window-management +
  one gesture) could remove it once it ships by default.
- Clipboard read needs a user gesture and permission in the browser; `clipboardExternal` degrades to text / none.
