# GO-1 — UniWork Office

FORK, BUILD & REBRAND ACCEPTANCE REPORT

Validation date: 2026-09-14. Host: macOS 26.3.1 arm64.

Canonical status after **GO-1A** closeout. Identify the immutable source baseline by annotated tag `go1-uniwork-office-v0.10.0`.

## Gates

| Gate | Result |
| --- | --- |
| `UPSTREAM_CONFIGURED` | **YES** |
| `BASELINE_CAPTURED` | **YES** |
| `LICENSE_AUDIT_COMPLETE` | **YES** |
| `RESTRICTED_CODE_EXCLUDED` | **YES** (`ee/` unused; still `NOT_FOR_REUSE`) |
| `VISIBLE_GENOFFICE_BRANDING_REMOVED` | **YES** (English product chrome; internals kept on purpose) |
| `VISIBLE_GENSPARK_BRANDING_REMOVED` | **N/A** — Genspark UI is `LIVE_VENDOR_REFERENCE` (backend unchanged); unauthorized trademark artwork **0** |
| `UNIWORK_OFFICE_BRANDING_ACTIVE` | **YES** (placeholder artwork; official art is GO-1R) |
| `DOCS_BUILD` | **PASS** |
| `SHEETS_BUILD` | **PASS** |
| `SLIDES_BUILD` | **PASS** |
| `PDF_BUILD` | **PASS** |
| `DOCX_OPEN_EDIT_SAVE` | **PASS** (`e2e/docs-edit-save.spec.ts`) |
| `XLSX_OPEN_EDIT_SAVE` | **PASS** (`e2e/sheets-edit-save.spec.ts`) |
| `PPTX_OPEN_EDIT_SAVE` | **PASS** (`e2e/slides-edit-save.spec.ts`) |
| `PDF_OPEN` | **PASS** (`e2e/pdf-fit-zoom.spec.ts`; view/zoom, not annotation persist) |
| `TYPECHECK` | **PASS** (`npm run typecheck`) |
| `LINT` | **PASS** (`npm run lint`; 0 errors, 13 pre-existing warnings) |
| `TESTS` | **PASS** (`npm test`; one Sheets Office-CloudFonts flake on first Montserrat run, passed on retry) |
| `PRODUCTION_BUILD` | **PASS** (unsigned, un-notarized macOS arm64 only) |
| `TELEMETRY_AUDITED` | **YES** |
| `NETWORK_DEPENDENCIES_AUDITED` | **YES** |
| `SECRETS_IN_REPO` | **NO** |
| `UPSTREAM_SYNC_DOCUMENTED` | **YES** |
| `GO1_READY` | **YES** |

## A. SOURCE

| Field | Value |
| --- | --- |
| Upstream repository | https://github.com/genspark-ai/genoffice.git |
| Origin repository | https://github.com/truongnt7/uniwork-office.git |
| Baseline SHA | `616a7acf5a9136ebb931abac6781a7ad5207faf1` (`v0.10.63-9-g616a7ac`) |
| Current SHA | GO-1A freeze: annotated tag `go1-uniwork-office-v0.10.0` on `main` |

Remotes: `origin` (UniWork fork), `upstream` (GenOffice). Default branch: `main`.

## B. TOOLCHAIN

| Field | Value |
| --- | --- |
| Node | v22.23.2 |
| Package manager | npm 10.9.8, `package-lock.json` |
| Rust | rustc / cargo 1.98.1 (`aarch64-apple-darwin` + `x86_64-apple-darwin` after `rustup target add`) |
| Electron | 43.3.0 |
| OS | macOS 26.3.1 (darwin 25.3.0), arm64 |

## C. LICENSING

See [`LICENSE_AUDIT.md`](LICENSE_AUDIT.md).

- **Core license:** Apache-2.0. Copyright Mainfunc, Inc. Attribution required (`LICENSE`, `NOTICE`).
- **Restricted directories:** `ee/` — GenOffice Enterprise License, `NOT_FOR_REUSE`. Empty except README + LICENSE. Not used by GO-1 builds.
- **Third-party attribution:** `npm run licenses` PASS (allowlist). `npm run notices` regenerates `THIRD-PARTY-NOTICES.txt` at pack time.
- **Brand/trademark risks:** GenOffice / Genspark names and logos are not licensed by Apache §6. Product chrome was renamed; vendor strings for the live Genspark backend remain.
- **Open legal questions:** MPL-2.0 MTX decoder if Slides ships; OFL reserved font names; “Aptos GO” aliases; `ee/` must stay unused.

## D. BRANDING

| Surface | Name |
| --- | --- |
| Application name | UniWork Office (`appId` `com.uniwork.office`) |
| Docs | UniWork Docs |
| Sheets | UniWork Sheets |
| Slides | UniWork Slides |
| PDF | UniWork PDF |

**Remaining visible upstream branding**

- Settings / AI: “Sign in with Genspark”, credits, Genspark cloud tools (names the real vendor).
- Onboarding no longer pitches GenTeam (all locales). `showOffer` remains false. Genspark credits copy stays as live-vendor attribution.
- Translated `docs/i18n/README.*.md` still describe GenOffice; each has a UniWork fork banner.
- Packager / home icons are placeholders labelled `UNIWORK_BRAND_ASSET_REQUIRED`.
- Font files still named `GenOffice*.woff2` (OFL/engine assets).
- Ribbon `GensparkMark` export name remains; the drawn mark is a generic AI badge (Genspark sparkle path removed after the brand inventory).

**Remaining internal upstream identifiers (intentional)**

`@genoffice/*`, root npm name `genoffice`, CLI `genoffice`, `GENOFFICE_*` env, `~/.genoffice/`, renderer scheme `genoffice-app://`, Genspark provider id, `X-Agent-Type: genoffice`.

## E. BUILDS

| App | Result | Evidence |
| --- | --- | --- |
| Docs | PASS | `npm run build:all` → `@genoffice/docs` electron-vite |
| Sheets | PASS | host sidecar + `native:build:universal` (`xlsx-sidecar` lipo `x86_64 arm64`) |
| Slides | PASS | `npm run build:all` |
| PDF | PASS | `npm run build:all` |
| Markdown / HTML / CLI / shell | PASS | included in `build:all` |

First `npm run dist:mac` failed because `x86_64-apple-darwin` was not installed. After `rustup target add x86_64-apple-darwin`, packaging succeeded.

## F. FILE TESTS

| Format | Result | Evidence |
| --- | --- | --- |
| DOCX | PASS | Playwright Electron: open `fixtures/generated/simple.docx`, type `UNIWORK_DOCX_SMOKE`, `menu:command save`, unzip `word/document.xml`, reopen. CLI `genoffice create --type docx` also PASS. |
| XLSX | PASS | `e2e/sheets-edit-save.spec.ts` cell edit → save → reopen. |
| PPTX | PASS | `e2e/slides-edit-save.spec.ts` find/replace `UNIWORK_PPTX_SMOKE` → `slides:menu save` → unzip `ppt/slides/slide1.xml` → reopen. |
| PDF | PASS (open) | `e2e/pdf-fit-zoom.spec.ts` opens a generated PDF and checks fit-to-width. Annotation persist was **not** exercised. |

Additional GUI smoke (all PASS): `e2e/onboarding.spec.ts`, `e2e/new-file-tab.spec.ts` (Docs tab launch), `e2e/slides-font-manager.spec.ts` (open PPTX). `docs-visual.spec.ts` skipped on macOS (Linux CI baselines).

## G. QUALITY GATES

| Gate | Result |
| --- | --- |
| Typecheck | PASS |
| Lint | PASS (13 pre-existing warnings) |
| Unit tests | PASS (`npm test`) |
| Licenses | PASS (`npm run licenses`) |
| Production build | PASS — `apps/shell/release/UniWork-Office-0.10.0-arm64.dmg` (171M) and `.zip` (172M). App bundle `UniWork Office.app`. Signing skipped (`CSC_IDENTITY_AUTO_DISCOVERY=false`). Notarize skipped (no Apple credentials). `dist:win` / `dist:linux` **not run** (macOS host). No `GENOFFICE_GA4_*` / `GENOFFICE_UPDATE_URL` / `GENOFFICE_FONT_CDN_URL` injected. |

## H. TELEMETRY

See [`TELEMETRY_AUDIT.md`](TELEMETRY_AUDIT.md).

- External telemetry: GA4 Measurement Protocol exists in code; **no-op** without packaged keys.
- Disabled for this GO-1 pack: keys omitted.
- Remaining: Settings copy still describes GA4; `@univerjs/telemetry` is a transitive dependency with no direct app import found.

## I. NETWORK

See [`NETWORK_DEPENDENCIES.md`](NETWORK_DEPENDENCIES.md).

- Required to **build:** `registry.npmjs.org`.
- Required to **edit documents locally:** none.
- Optional: Genspark (`www.genspark.ai`), BYOK LLM/search hosts, GitHub About, update CDN, font CDN, GA4 — all off unless the user signs in, supplies keys, or pack-time env is set.

## J. SECURITY

- Secrets found: **none** in the working tree. Test fixtures use fake `gsk-` / `sk-` strings.
- `.env` handling: `.env.example` lists names only. `.gitignore` keeps `.env` ignored and allows `.env.example`; extra patterns for `*.pem` / `*.p12` / `*.pfx` / `*credentials*.json`.
- Credentials embedded: **no**. Do not inject `GENOFFICE_GA4_*` for UniWork GO-1.

## K. UPSTREAM COMPATIBILITY

See [`docs/upstream/UPSTREAM_SYNC.md`](../upstream/UPSTREAM_SYNC.md).

- Merge strategy: fetch upstream, review, merge on a working branch, re-apply UniWork display strings, run typecheck/lint/test/`build:all`.
- Known conflict areas: README, NOTICE, `productName` / `appId` / artifact names, English strings, icons, GitHub About URL, `docs/go1/**`.

## L. KNOWN LIMITATIONS

1. Genspark remains the inherited optional AI backend (sign-in, credits, `~/.genoffice/auth.json`, provider id `genspark`).
2. Official UniWork logo/ICO/ICNS are not in the repo; placeholders must be replaced before a public release.
3. Internal `@genoffice/*` names, CLI `genoffice`, and `GENOFFICE_*` env vars were not renamed.
4. Production package on this host is **unsigned and un-notarized** macOS arm64 only. Gatekeeper will warn. Windows/Linux installers were not built.
5. PDF smoke did not prove annotation save. XLSM macros are not a UniWork claim.
6. Non-English UI strings were not fully rewritten.
7. `ee/` must not be copied or implemented against.
8. GO-1 did not add UniWork auth, Supabase, Work Graph, cloud sync, PWA, or a UniWork AI Gateway.
9. First `dist:mac` on a fresh Rust install needs `rustup target add x86_64-apple-darwin`.
10. GO-1A closed remaining product-chrome GenOffice titles, PDF annot author, CLI help, AI prompts, and GenTeam onboarding pitch. Source freeze is the annotated tag `go1-uniwork-office-v0.10.0`.

## M. FINAL VERDICT

`GO1_READY = YES`

GO-1A §XVIII–XXIV treats this as a **technical / rebrand / source baseline**, not production-distribution readiness. Visible GenOffice product branding in application chrome is 0. Genspark sign-in/credits remain truthful live-vendor references. Official artwork, macOS signing/notarization, and Windows/Linux packages are **GO-1R**, not GO-1 blockers.

## N. NEXT PHASE

Recommend **GO-2 — UniWork Office Bridge**.

Do not implement GO-2 in this task.

## O. GO-1A CLOSEOUT

Full narrative: [`docs/go1a/GO1A_CLOSEOUT_REPORT.md`](../go1a/GO1A_CLOSEOUT_REPORT.md).

| Flag | Value |
| --- | --- |
| `UPSTREAM_CONFIGURED` | **YES** |
| `LICENSE_AUDIT_COMPLETE` | **YES** |
| `FINAL_BRAND_AUDIT_COMPLETE` | **YES** |
| `VISIBLE_GENOFFICE_PRODUCT_BRANDING` | **0** |
| `VISIBLE_UNAUTHORIZED_GENSPARK_TRADEMARK_ARTWORK` | **0** |
| `LIVE_GENSPARK_VENDOR_REFERENCES` | **14** (string/host families: sign-in, credits, cloud, Genspark AI settings, auth/credit URLs) |
| `LIVE_VENDOR_REFERENCES_TRUTHFUL` | **YES** |
| `INTERNAL_UPSTREAM_IDENTIFIERS_REMAINING` | **10** (package scope, CLI, env, scheme, `GensparkMark`, PDF schema, `openGenTeam`, provider id, `X-Agent-Type`, font filenames) |
| `OFFICIAL_ARTWORK_AVAILABLE` | **NO** |
| `OFFICIAL_ARTWORK_INTEGRATED` | **N/A** |
| `PLACEHOLDER_ARTWORK_REMAINING` | **YES** |
| `SECRETS_IN_COMMIT` | **NO** |
| `ROTATION_REQUIRED` | **NO** |
| `TYPECHECK` | **PASS** |
| `LINT` | **PASS** |
| `TESTS` | **PASS** |
| `BUILD_ALL` | **PASS** |
| `DOCX_SMOKE` | **PASS** |
| `XLSX_SMOKE` | **PASS** |
| `PPTX_SMOKE` | **PASS** |
| `PDF_SMOKE` | **PASS** |
| `MACOS_ARM64_PACKAGE` | **PASS** (unsigned local DMG; not committed) |
| `MACOS_SIGNED` | **NO** |
| `MACOS_NOTARIZED` | **NO** |
| `WINDOWS_PACKAGE` | **NOT_RUN** |
| `LINUX_PACKAGE` | **NOT_RUN** |
| `UNRELATED_CHANGES` | **0** |
| `COMMIT_CREATED` | **YES** |
| `COMMIT_SHA` | tag `go1-uniwork-office-v0.10.0` |
| `ORIGIN_PUSHED` | **YES** |
| `REMOTE_SHA` | tag target |
| `BASELINE_TAG_CREATED` | **YES** |
| `TAG_NAME` | `go1-uniwork-office-v0.10.0` |
| `TAG_SHA` | tag object / commit target |
| `BASELINE_TAG_PUSHED` | **YES** |
| `RELEASE_ENGINEERING_DEFERRED` | **YES** |
| `GO1_READY` | **YES** |

If origin push or tag push is blocked, treat `ORIGIN_PUSHED` / `BASELINE_TAG_PUSHED` as **BLOCKED** and do not claim a published freeze.
