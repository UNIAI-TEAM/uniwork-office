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

Capabilities: `installModuleBridge()` puts one mutable object on each global as `.capabilities` (web defaults
`MODULE_WEB_CAPABILITIES`: `ai`, `open`, `recents`, `autoSave`, `autoSaveToDisk` false; host grants assigned on `init`).
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
