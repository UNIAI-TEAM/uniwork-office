# Web modules (GO-B4/B5/B6, UNI-1014/1015/1016)

One directory per genoffice editor that runs on the web besides Docs (Docs stays in `web/docs/`):

| module     | renderer                 | preload globals installed            | issue    |
| ---------- | ------------------------ | ------------------------------------ | -------- |
| `pdf`      | `apps/pdf` renderer      | `pdfApi`, `projectApi`               | UNI-1014 |
| `markdown` | `apps/markdown` renderer | `markdownApi`, `projectApi`          | UNI-1014 |
| `html`     | `apps/html` renderer     | `htmlApi`, `projectApi`              | UNI-1014 |
| `slides`   | `apps/slides` renderer   | `slidesApi`, `desktop`, `projectApi` | UNI-1015 |
| `sheets`   | `apps/sheets` renderer   | `desktopApi`, `projectApi`           | UNI-1016 |

Each `<module>/` has:

- `index.html`: the Vite entry. Loads `./install.ts` first, then the app's renderer `main.tsx`. No `<meta>` CSP
  (the policy is a header, from `csp.json`).
- `install.ts`: calls `installModuleBridge()` (`web/docs/bridge/module-bridge.ts`) with the module name, what the frame
  supports, and the members of each preload global. The generic part (protocol client with `module` in `ready`, host
  theme/locale, `window.open` guard, capability object, safe no-op Proxy, in-memory `projectApi`) is shared; the module's
  file APIs (open/save/export over `api.*` requests) are added here by the module's worker.

Text modules (`markdown`, `html`): `shared/` holds their common bridge (UTF-8 codec keeping BOM/EOL, open/save/
conflict/view-only/print, pictures, static HTML copy for the sandboxed preview); see
`docs/web-modules/markdown-html.md`. Tests: `npx vitest run --root web/modules` (part of `npm run test:web`).

Capabilities: `installModuleBridge()` puts one mutable object on each global as `.capabilities` (web defaults
`MODULE_WEB_CAPABILITIES`: `ai`, `aiCredentials`, `open`, `recents`, `autoSave`, `autoSaveToDisk`, `saveStatus`,
`viewOnlyChip` false; host grants assigned on `init`). `saveStatus` / `viewOnlyChip` (GO-B8): the host header owns
the save state and one host banner owns "view only", so a renderer shows its own Unsaved / Saved / Save failed label
and its own "View only" chip only while `cap('saveStatus')` / `cap('viewOnlyChip')` is on (desktop: no object, on).
A failed save's text is the module's own network / timeout sentence or the shared one of its code / HTTP status
(`shared/save-failure.ts`), never the host's raw English status line.

Dialogs: every in-frame dialog (save conflict, discard unsaved changes, draft recovery, merge prompt, open failure) is
the one component `shared/frame-dialog.ts` (+ `frame-dialog.css`, theme tokens only), called by each module's notice file
(`shared/notice.ts`, `pdf/notice.ts`, `slides/dialogs.ts`, `sheets/notice.ts`, `web/docs/bridge/notice.ts`). Same look as the
UniWork host's leave dialog: centred card, stacked full-width actions ordered primary, neutral, destructive, then the way
out; the filled primary is the caller's `primary` (none given: the first neutral choice, e.g. Reload latest in a
conflict); `danger` marks Overwrite / Discard (soft red, never the first focus); the first focus is the safe primary
(the way out, Cancel, when the dialog has no primary); every choice dialog has a close X (same answer as Escape, the
cancel id) and a host-like scrim (`--color-dialog-scrim`, blurred); Tab stays inside (choices, then the X), focus
returns to where it was. Tested for contrast (>= 4.5:1 in light, dark and system-dark) in
`shared/frame-dialog-contrast.test.ts`.

AI (CONTRACT C16): `shared/ai/` is the `ai` web bridge of every frame (Docs too, through web/docs/bridge/install.ts).
`installModuleBridge()` wraps each global that has AI members (`withWebAi`): while the host grants `ai` they call the
frame-token AI routes (BYOK proxy for aiStream/aiChat with ai-provider's native wire format, UniWork cloud tools,
in-frame AI settings over the UniWork credentials, typed state card per error code); without the grant every member is
the module's own "unavailable" stub and every AI key stays false. Routes and grants: web/docs/protocol/README.md
"AI (web)". A failed chat turn (`aiStream`) is announced once: its typed, vendor-neutral text is the panel's inline error, no
floating card beside it (the card, `.ow-ai-state`, stays for the one-shot `aiChat` and the tool members, which have no
transcript); the model chip's "manage" row (`openAiModelSettings`) opens the AI settings in every panel.
Tests: `shared/ai/ai.test.ts`, e2e `web/e2e/ai-web.spec.ts` (Docs + Markdown), `web/e2e/sheets-ai.spec.ts`.
A renderer reads it with `createCapabilityReader()` from `@genoffice/ui/capabilities` (`cap(key)`: on unless explicitly
false, so desktop keeps everything). No autosave on the web (CONTRACT C10): the shared `getAutoSaveDefault` answers
"off" and the bridges never send `api.save` with `auto`.

Build: `npm run build:web -- --module <module>` -> `dist-web/<module>/<version>/` (see `web/docs/build/README.md`); the
registry `web/docs/build/modules.ts` holds the one entry per module (root, renderer config, globals, CSP additions).
Run in the test host: `/test-host/?module=<module>` (see `web/server/server.mjs`). Smoke e2e: `web/e2e/modules-smoke.spec.ts`.

## Scaffold sizes (manifest.json of `build:web:all` at 7f96156, MiB)

| module   | files | total raw / gzip | initial raw / gzip | deferred raw | notes                                                     |
| -------- | ----- | ---------------- | ------------------ | ------------ | --------------------------------------------------------- |
| docs     | 40    | 13.31 / 10.58    | 3.88 / 1.16        | 9.43         | unchanged vs the B2/B3 build (same files; `module` added) |
| pdf      | 205   | 6.05 / 2.80      | 1.46 / 0.44        | 4.59         | pdf.js worker + `pdfjs/` CMaps, standard fonts, wasm      |
| markdown | 85    | 5.37 / 1.78      | 2.11 / 0.67        | 3.25         | KaTeX WOFF2 only (plain renderer build: 122 files)        |
| html     | 6     | 1.48 / 0.48      | 1.47 / 0.48        | 0.00         | one chunk                                                 |
| slides   | 18    | 4.03 / 1.77      | 3.08 / 0.88        | 0.95         |                                                           |
| sheets   | 206   | 21.44 / 6.05     | 10.44 / 2.91       | 11.00        | Univer; the initial chunk is the largest of all modules   |

gzip = level 9 per file (what a gzip-serving host sends; WOFF2/wasm barely shrink).
