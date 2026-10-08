# GO-1A final brand audit

Search: `GenOffice` / `GENOFFICE` / `genoffice` / `Genspark` / `GENSPARK` / `genspark` across source (excluding `node_modules`, `out/`, `release/`, lockfiles).

~909 files still mention genoffice (mostly `@genoffice/*`, env, CLI bin, tests). ~275 mention genspark (vendor backend + i18n).

Every remaining class of hit is classified below. `REMOVE_BEFORE_GO1_CLOSE` items found in GO-1A were fixed in this closeout (HTML titles, image alts, PDF note author, CLI help, AI system prompts, onboarding GenTeam pitch).

## Required table (representative; one row per remaining class)

| PATH | LINE / ASSET | TERM | USER_VISIBLE | CLASSIFICATION | ACTION | STATUS |
| --- | --- | --- | --- | --- | --- | --- |
| `NOTICE`, `LICENSE` | copyright / trademark | GenOffice | yes (legal) | `LEGAL_REQUIRED` | keep Apache attribution | KEEP |
| `ee/LICENSE` | entire file | GenOffice Enterprise | docs only | `LEGAL_REQUIRED` | unused in product build | KEEP |
| `apps/shell/.../strings.ts` `loginGenspark` / `accountGenspark` / `onbCredits` / `navCloud` | many locales | Genspark | yes | `LIVE_VENDOR_REFERENCE` | keep; backend is Genspark | KEEP |
| `www.genspark.ai` credit-usage / auth | main process | Genspark | yes (browser) | `LIVE_VENDOR_REFERENCE` | keep | KEEP |
| `packages/ai-provider/src/providers.ts` | provider id | `genspark` | no | `INTERNAL_IDENTIFIER` | do not rename | KEEP |
| `X-Agent-Type: genoffice` | HTTP | genoffice | no | `INTERNAL_IDENTIFIER` | billing tag | KEEP |
| workspace `"name": "@genoffice/*"` | all packages | genoffice | no | `INTERNAL_IDENTIFIER` | mergeability | KEEP |
| CLI bin `genoffice`, `GENOFFICE_*` | PATH / env | genoffice | CLI name yes | `INTERNAL_IDENTIFIER` | keep command | KEEP |
| `genoffice-app://` | renderer scheme | genoffice | no | `INTERNAL_IDENTIFIER` | keep | KEEP |
| `GensparkMark` | ribbon/AI panel | name only | no (name) | `INTERNAL_IDENTIFIER` | generic sparkle SVG | KEEP name |
| `HOME_CHANNELS.openGenTeam` | IPC | GenTeam | no (CTA off) | `INTERNAL_IDENTIFIER` | unused onboarding offer | KEEP |
| `GenOfficeFormField` / `GenOfficeStaticFormFills` / `VISUAL_SIGNATURE_CONTENT_PREFIX` | PDF schema | GenOffice | no | `INTERNAL_IDENTIFIER` | round-trip markers | KEEP |
| `fonts/GenOffice*.woff2` | bundled fonts | GenOffice | filename | `INTERNAL_IDENTIFIER` | OFL; GO-1R rename | KEEP |
| `docs/i18n/README.*.md` | body | GenOffice | docs | `UPSTREAM_MAINTENANCE_REFERENCE` | UniWork banner present; full rewrite GO-1R | KEEP |
| `CONTRIBUTING.md` upstream section | heading | GenOffice | contrib | `UPSTREAM_MAINTENANCE_REFERENCE` | keep inherited guide | KEEP |
| `e2e/helpers.ts` tmp `genoffice-e2e-` | tests | genoffice | no | `TEST_FIXTURE` | keep | KEEP |
| `packages/ai-search/tests/genoffice-auth.test.ts` | fake `gsk-` | genspark | no | `TEST_FIXTURE` | keep | KEEP |
| `apps/shell/.../genoffice-logo.svg` | home lockup | filename | yes (image) | `REVIEW_REQUIRED` → placeholder | official art GO-1R | PLACEHOLDER |
| `apps/shell/src/renderer/index.html` `<title>` | title | UniWork Office | yes | (closed GO-1A) | was GenOffice | DONE |
| `apps/pdf/src/main/save-pdf.ts` `/T` author | annot | UniWork Office | yes | (closed GO-1A) | was GenOffice | DONE |

`REMOVE_BEFORE_GO1_CLOSE` remaining in **application chrome**: **0**.

`VISIBLE_UNAUTHORIZED_GENSPARK_TRADEMARK_ARTWORK`: **0** (sparkle path removed in GO-1; confirmed GO-1A).
