# GO-1 brand inventory

Search covered GenOffice / Genspark / genspark.ai / genoffice.ai / Mainfunc. Internal `@genoffice/*` names were **not** mass-renamed.

## Classification key

`USER_VISIBLE` · `INTERNAL_PACKAGE` · `THIRD_PARTY_ATTRIBUTION` · `LICENSE_REQUIRED` · `TECHNICAL_IDENTIFIER` · `SAFE_TO_RENAME` · `DO_NOT_RENAME`

## Changed in GO-1 (safe)

| Location | Was | Now | Class |
| --- | --- | --- | --- |
| Shell `productName` | GenOffice | UniWork Office | `USER_VISIBLE` `SAFE_TO_RENAME` |
| Docs / Sheets / Slides / PDF `productName` | GenOffice * | UniWork * | `USER_VISIBLE` `SAFE_TO_RENAME` |
| `apps/shell/electron-builder.cjs` `appId` | `com.genoffice.app` | `com.uniwork.office` | `TECHNICAL_IDENTIFIER` `SAFE_TO_RENAME` |
| Standalone leftover appIds | `com.genoffice.docs` / `.slides` | `com.uniwork.docs` / `.slides` | `TECHNICAL_IDENTIFIER` `SAFE_TO_RENAME` |
| Window / home tab titles | GenOffice | UniWork Office | `USER_VISIBLE` `SAFE_TO_RENAME` |
| Default save dir | `<Documents>/GenOffice` | `<Documents>/UniWork Office` | `USER_VISIBLE` `SAFE_TO_RENAME` |
| Packaged userData | GenOffice | UniWork Office | `TECHNICAL_IDENTIFIER` `SAFE_TO_RENAME` |
| GitHub About / star URL | genspark-ai/genoffice | truongnt7/uniwork-office | `USER_VISIBLE` `SAFE_TO_RENAME` |
| Linux executable / deb/rpm name | genoffice | uniwork-office | `USER_VISIBLE` `SAFE_TO_RENAME` |
| Artifact names | genoffice_* / GenOffice-* | UniWork-Office-* | `USER_VISIBLE` `SAFE_TO_RENAME` |
| Ribbon product chrome `Genspark` / `Genspark AI` | Genspark | AI | `USER_VISIBLE` `SAFE_TO_RENAME` |
| Home lockup SVG | GenOffice wordmark | UniWork placeholder | `USER_VISIBLE` `SAFE_TO_RENAME` |
| Ribbon AI badge SVG | Genspark sparkle trademark | Generic sparkle (`GensparkMark` name kept) | `USER_VISIBLE` `SAFE_TO_RENAME` |
| README | GenOffice marketing | UniWork Office GO-1 README | `USER_VISIBLE` `SAFE_TO_RENAME` |

## Intentionally not renamed

| Item | Class | Reason |
| --- | --- | --- |
| `@genoffice/*` workspace names and imports | `INTERNAL_PACKAGE` `DO_NOT_RENAME` | upstream mergeability |
| Root npm name `genoffice` | `INTERNAL_PACKAGE` `DO_NOT_RENAME` | lockfile / workspaces |
| CLI binary `genoffice`, `~/.genoffice/` | `TECHNICAL_IDENTIFIER` | agents/skills/PATH; documented limitation |
| Env `GENOFFICE_*` | `TECHNICAL_IDENTIFIER` `DO_NOT_RENAME` | tests/CI/upstream |
| Provider id `genspark`, `@genspark/cli`, `X-Agent-Type: genoffice` | `THIRD_PARTY_ATTRIBUTION` `DO_NOT_RENAME` | live Genspark backend |
| IPC channels `home:`, `tabs:` | `TECHNICAL_IDENTIFIER` `DO_NOT_RENAME` | already generic |
| `NOTICE` / `LICENSE` Mainfunc copyright | `LICENSE_REQUIRED` | Apache §4 |
| `ee/LICENSE` | `LICENSE_REQUIRED` `NOT_FOR_REUSE` | enterprise license |
| Upstream issue comments `genspark-ai/genoffice#…` | `TECHNICAL_IDENTIFIER` | merge hints |
| Genspark sign-in / credits / cloud projects copy | `THIRD_PARTY_ATTRIBUTION` | names the actual vendor |

## Remaining visible upstream branding

- Settings AI: “Sign in with Genspark”, credits, Genspark cloud tools (vendor, not product name)
- Cloud projects nav: Genspark Projects
- Locale onboarding strings other than English may still mention GenTeam / Genspark credits (English GO-1 copy replaced; offer CTA disabled)
- Translated `docs/i18n/README.*.md` still describe upstream GenOffice; each has a UniWork fork banner
- Skill file `skills/genoffice/SKILL.md` still teaches the `genoffice` CLI
- Ribbon/AI-panel `GensparkMark` **symbol name** remains; the SVG is a generic sparkle badge (Genspark trademark path removed)

## Icons

Official UniWork artwork was **not** in the repo. Placeholders are labelled `UNIWORK_BRAND_ASSET_REQUIRED` (see `apps/shell/src/renderer/src/assets/UNIWORK_BRAND_ASSET_REQUIRED.md`). Original GenOffice lockup SVG was replaced. Binary icns/ico from upstream were not in this checkout.
