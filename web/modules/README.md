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

Build: `npm run build:web -- --module <module>` -> `dist-web/<module>/<version>/` (see `web/docs/build/README.md`); the
registry `web/docs/build/modules.ts` holds the one entry per module (root, renderer config, globals, CSP additions).
Run in the test host: `/test-host/?module=<module>` (see `web/server/server.mjs`). Smoke e2e: `web/e2e/modules-smoke.spec.ts`.
