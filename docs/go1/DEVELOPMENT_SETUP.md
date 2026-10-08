# GO-1 development setup

Validation environment: macOS 26.3.1 arm64, Node v22.23.2, npm 10.9.8, rustc 1.98.1.

## Prerequisites

```bash
# Node 22
nvm install 22
nvm use 22

# Rust (Sheets sidecar)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustup default stable
```

Platform notes:

- **macOS:** Xcode CLT (`xcode-select --install`) for the vision-ocr helper during `dist:mac`. `npm run dist:mac` also builds a universal Sheets sidecar, so install `rustup target add x86_64-apple-darwin` (and `aarch64-apple-darwin` if missing). Unsigned local packs: `CSC_IDENTITY_AUTO_DISCOVERY=false`.
- **Windows:** cargo target for the xlsx sidecar as described in `CONTRIBUTING.md`
- **Linux:** see `.github/workflows/ci.yml` (fonts, xmllint, xvfb for e2e)

## Install dependencies

```bash
npm install
npm run fixtures
```

## Run development app

```bash
npm run dev
```

Docs-only:

```bash
npm run dev:docs
```

## Run typecheck

```bash
npm run typecheck
```

## Run lint

```bash
npm run lint
```

## Run tests

```bash
npm test
```

Sheets compatibility gate:

```bash
npm run fixtures -w @genoffice/sheets
npm run compat -w @genoffice/sheets
```

## Build Docs

```bash
npm run build -w @genoffice/docs
```

## Build Sheets

```bash
npm run build -w @genoffice/sheets
```

## Build Slides

```bash
npm run build -w @genoffice/slides
```

## Build PDF

```bash
npm run build -w @genoffice/pdf
```

## Build production package

```bash
# macOS (this validation host)
npm run dist:mac
```

Do **not** export `GENOFFICE_GA4_MEASUREMENT_ID`, `GENOFFICE_GA4_API_SECRET`, or `GENOFFICE_UPDATE_URL` for UniWork GO-1.

Windows / Linux installers are not produced on the macOS validation host; use `npm run dist:win` / `npm run dist:linux` on those platforms.
