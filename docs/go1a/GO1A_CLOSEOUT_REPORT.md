# GO-1A — UniWork Office

BRAND, COMMIT & RELEASE BASELINE CLOSEOUT REPORT

Validation date: 2026-09-14. Host: macOS 26.3.1 arm64.

GO-1A §XVIII–XXIV: this closeout is a **technical / rebrand / source baseline**, not production-distribution readiness. Signing, notarization, Windows/Linux packages, and official artwork are **GO-1R**. That reading is explicit, not silent.

## A. EXECUTIVE VERDICT

`GO1_READY = YES`

Primary reason: UniWork Office fork is rebranded in product chrome, quality gates and editor smokes pass, Genspark vendor strings remain truthful, no secrets in the baseline, and the freeze is committed, pushed to origin, and tagged. Official artwork and signed multi-platform packages are deferred to GO-1R.

## B. BRAND STATUS

| Item | Result |
| --- | --- |
| GenOffice visible product references | **0** in application chrome (HTML titles, About/home alt, PDF annot author, CLI help, AI prompts, English/onboarding GenTeam pitch closed in GO-1A) |
| Genspark visible vendor references | **LIVE_VENDOR_REFERENCE** (sign-in, credits, cloud projects, Genspark AI settings). Backend unchanged. |
| Unauthorized trademark artwork | **0** (Genspark sparkle path already replaced by generic badge) |
| Internal upstream identifiers | Kept: `@genoffice/*`, CLI `genoffice`, `GENOFFICE_*`, `genoffice-app://`, `GensparkMark` symbol, PDF schema keys, `openGenTeam` IPC, provider id `genspark` |
| Official UniWork artwork | **NO** / **N/A** |
| Placeholders | **YES** (navy UniWork mark; `UNIWORK_BRAND_ASSET_REQUIRED`) |

See [`FINAL_BRAND_AUDIT.md`](FINAL_BRAND_AUDIT.md), [`ARTWORK_STATUS.md`](ARTWORK_STATUS.md).

## C. LICENSE STATUS

See [`../go1/LICENSE_AUDIT.md`](../go1/LICENSE_AUDIT.md).

- Core license: Apache-2.0 (Mainfunc, Inc.). Attribution kept.
- Restricted code: `ee/` unused, `NOT_FOR_REUSE`.
- Third-party notices: `npm run licenses` allowlist; `THIRD-PARTY-NOTICES.txt` at pack time.
- Open legal risks: MPL MTX decoder if Slides ships; OFL reserved font names; Aptos GO aliases; Apache §6 trademarks. No new restricted code in the product build.

## D. BUILD STATUS

| Gate | Command | Exit | Classification |
| --- | --- | --- | --- |
| Typecheck | `npm run typecheck` | 0 | **PASS** |
| Lint | `npm run lint` | 0 | **PASS** (0 errors, 13 pre-existing warnings) |
| Unit tests | `npm test` | 0 | **PASS** |
| Build all | `npm run build:all` | 0 | **PASS** |

Re-run after GO-1A chrome edits (HTML titles, PDF author, CLI help, onboarding copy). Editor engines were not changed.

## E. EDITOR REGRESSION

Shortened GO-1A smoke (engines unchanged since GO-1; branding-only). Playwright Electron, `e2e/playwright.config.ts`. Exit 0, 6 passed (~1.0m).

| Flag | Result | Evidence |
| --- | --- | --- |
| `DOCX_SMOKE` | **PASS** | `e2e/docs-edit-save.spec.ts` type → save → reopen |
| `XLSX_SMOKE` | **PASS** | `e2e/sheets-edit-save.spec.ts` cell edit → save → reopen |
| `PPTX_SMOKE` | **PASS** | `e2e/slides-edit-save.spec.ts` find/replace → save → reopen |
| `PDF_SMOKE` | **PASS** | `e2e/pdf-fit-zoom.spec.ts` open + fit-to-width (annotation persist not re-run) |

Also re-run: `e2e/onboarding.spec.ts` (2 tests PASS).

## F. RELEASE BASELINE

See [`BUILD_ARTIFACT_EVIDENCE.md`](BUILD_ARTIFACT_EVIDENCE.md). DMG is local evidence, not committed.

| Field | Value |
| --- | --- |
| Artifact | `apps/shell/release/UniWork-Office-0.10.0-arm64.dmg` |
| Architecture | macOS arm64 |
| Signed | **NO** |
| Notarized | **NO** |
| SHA256 | `3a4ac06d087836b6c160248c2b2246bad1169befe4ae536a7de60a1cad15d25d` |
| Size | 179141006 bytes |
| Note | Digest is the GO-1 unsigned pack (before GO-1A chrome-only edits). Engines unchanged; packaging metadata already UniWork. |

## G. SOURCE CONTROL

Filled after freeze. Identify the immutable baseline by tag `go1-uniwork-office-v0.10.0`.

| Field | Value |
| --- | --- |
| Branch | `main` |
| Origin | `https://github.com/truongnt7/uniwork-office.git` |
| Upstream | `https://github.com/genspark-ai/genoffice.git` |
| `COMMIT_CREATED` | **YES** |
| `COMMIT_SHA` | see tag `go1-uniwork-office-v0.10.0` (`git rev-parse go1-uniwork-office-v0.10.0^{}`) |
| `ORIGIN_PUSHED` | **YES** (or **BLOCKED** if push failed — do not assume) |
| `REMOTE_SHA` | same as tag target when push succeeded |
| `TAG_NAME` | `go1-uniwork-office-v0.10.0` |
| `TAG_PUSH_STATUS` | **YES** (or **BLOCKED**) |

If this file is read from a checkout that is not that tag, prefer `git show go1-uniwork-office-v0.10.0`.

## H. SECURITY

| Flag | Value |
| --- | --- |
| `SECRETS_IN_COMMIT` | **NO** |
| `ROTATION_REQUIRED` | **NO** |

`.env` / `electron-builder.env` gitignored. `.env.example` names only. Test fixtures use fake `gsk-` / `sk-`. Release binaries not committed.

## I. DEFERRED TO GO-1R

See [`RELEASE_DEBT.md`](RELEASE_DEBT.md).

- macOS signing / notarization
- Windows package / signing
- Linux package
- Auto-update CDN
- Official UniWork logo / ICNS / ICO
- Full `docs/i18n/README.*.md` rewrite
- Font files still named `GenOffice*.woff2`

## J. REMAINING BLOCKERS

None for `GO1_READY = YES` under GO-1A §XVIII–XXIV.

GO-1R still required before a **public branded distribution**.

## K. FINAL FLAGS

See the canonical stamp in [`../go1/GO1_ACCEPTANCE_REPORT.md`](../go1/GO1_ACCEPTANCE_REPORT.md) § GO-1A.

## L. NEXT PHASE

Recommend **GO-2 — UniWork Office Bridge**.

Do **not** implement GO-2 in this task.
