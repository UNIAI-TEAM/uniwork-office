# UniWork Office

Open document productivity runtime for the UniWork ecosystem.

This repository is currently a **desktop office runtime**. UniWork platform integration is not part of GO-1.

UniWork Office is an independently branded fork of [GenOffice](https://github.com/genspark-ai/genoffice) (Apache-2.0). The document engines are unchanged. There is no Supabase, UniWork authentication, Work Graph, cloud sync, or UniWork AI Gateway in this phase.

## Supported applications

| App | Package | Formats |
| --- | --- | --- |
| UniWork Docs | `@genoffice/docs` | `.docx` open / edit / save |
| UniWork Sheets | `@genoffice/sheets` | `.xlsx` (and `.xlsm`, `.xls`, `.csv` associations) |
| UniWork Slides | `@genoffice/slides` | `.pptx` open / edit / save |
| UniWork PDF | `@genoffice/pdf` | `.pdf` view / edit (content-stream rewrite where supported) |
| Markdown | `@genoffice/markdown` | `.md` |
| HTML | `@genoffice/html` | `.html` |
| UniWork Office Desktop | `@genoffice/shell` | suite shell hosting the editors |

Internal npm workspace names remain `@genoffice/*` so upstream merges stay possible.

## File formats

Native round-trip targets are **DOCX**, **XLSX**, **PPTX**, and **PDF**. See [`docs/go1/FILE_FORMAT_MATRIX.md`](docs/go1/FILE_FORMAT_MATRIX.md).

## Development prerequisites

- Node.js 22+ (`.nvmrc` is `22`)
- npm 10+
- Rust / Cargo (Sheets xlsx sidecar)
- macOS, Windows, or Linux desktop toolchain for Electron
- On macOS: Xcode command-line tools (OCR helper compile during packaging)

## Install dependencies

```bash
npm install
npm run fixtures
```

## Run development app

```bash
npm run dev          # all editors + shell
npm run dev:docs     # Docs only
```

## Quality gates

```bash
npm run typecheck
npm run lint
npm test
npm run licenses
```

## Build applications

```bash
npm run build                 # Docs
npm run build -w @genoffice/sheets
npm run build -w @genoffice/slides
npm run build -w @genoffice/pdf
npm run build:all             # Docs, Sheets, Slides, PDF, Markdown, HTML, CLI, shell
```

## Production package

Unsigned local packages (no Apple/Windows signing secrets required):

```bash
npm run dist:mac      # macOS dmg + zip
npm run dist:win      # Windows NSIS (from Windows or with a Windows sidecar)
npm run dist:linux    # AppImage / deb / rpm
```

Do not set `GENOFFICE_GA4_*` or `GENOFFICE_UPDATE_URL` for UniWork GO-1 packaging. Without those values, analytics and in-app updates stay disabled.

## GO-1 limitations

- No UniWork backend, auth, Work Graph, or AI Context Engine
- No cloud sync or collaboration
- No PWA / browser conversion
- No new AI providers beyond the inherited Genspark / BYOK configuration
- Official UniWork logo assets are not in this tree; packager icons are labelled `UNIWORK_BRAND_ASSET_REQUIRED`
- The `genoffice` CLI command and `@genoffice/*` package names are retained for upstream mergeability
- `ee/` is **not** Apache-2.0 (GenOffice Enterprise License). It is empty and must not be reused

## Upstream acknowledgement

This product is a fork of GenOffice by Mainfunc, Inc., licensed under Apache License 2.0. See [`LICENSE`](LICENSE), [`NOTICE`](NOTICE), and [`docs/upstream/UPSTREAM_SYNC.md`](docs/upstream/UPSTREAM_SYNC.md).

The GenOffice and Genspark names and logos are trademarks of Mainfunc, Inc. Apache-2.0 does not grant permission to use them.

## Licensing

Apache License 2.0 for the open-source core. Third-party notices are generated at pack time (`npm run notices`). Fonts and other bundled components are documented in [`docs/go1/LICENSE_AUDIT.md`](docs/go1/LICENSE_AUDIT.md).
