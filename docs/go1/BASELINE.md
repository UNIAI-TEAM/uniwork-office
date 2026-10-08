# GO-1 baseline

Captured before UniWork branding work on the fork at commit `616a7acf5a9136ebb931abac6781a7ad5207faf1`.

| Field | Value |
| --- | --- |
| `BASELINE_COMMIT` | `616a7acf5a9136ebb931abac6781a7ad5207faf1` |
| Upstream | https://github.com/genspark-ai/genoffice (`main`) |
| Origin | https://github.com/truongnt7/uniwork-office |
| Tag describe | `v0.10.63-9-g616a7ac` |
| `NODE_VERSION` | Node.js v22.23.2 (required: `>=22.12.0`, `.nvmrc` = `22`) |
| `PACKAGE_MANAGER` | npm 10.9.8 (required: `>=10`) |
| Lockfile | `package-lock.json` |
| `RUST_VERSION` | rustc 1.98.1 (48a229cea 2026-09-01); cargo 1.98.1 |
| `ELECTRON_VERSION` | 43.3.0 (`apps/*/package.json` and `electron-builder` resolve from the installed `electron` package) |
| OS used for validation | macOS 26.3.1 (darwin 25.3.0), arm64 |

## `SUPPORTED_APPS`

- `apps/docs` — UniWork Docs (workspace `@genoffice/docs`)
- `apps/sheets` — UniWork Sheets (`@genoffice/sheets`)
- `apps/slides` — UniWork Slides (`@genoffice/slides`)
- `apps/pdf` — UniWork PDF (`@genoffice/pdf`)
- `apps/markdown` — Markdown module
- `apps/html` — HTML module
- `apps/shell` — UniWork Office Desktop suite shell

## `BUILD_COMMANDS`

```bash
npm install
npm run fixtures
npm run build                 # Docs
npm run build -w @genoffice/sheets
npm run build -w @genoffice/slides
npm run build -w @genoffice/pdf
npm run build:all
npm run dist:mac              # production package on macOS
```

## `TEST_COMMANDS`

```bash
npm run typecheck
npm run lint
npm test
npm run licenses
npm run test:e2e              # Playwright/Electron; Linux CI uses xvfb
npm run fixtures -w @genoffice/sheets && npm run compat -w @genoffice/sheets
```
