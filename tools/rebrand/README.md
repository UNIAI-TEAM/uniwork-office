# UniWork rebrand + upstream sync

UniWork Office is genoffice (`genspark-ai/genoffice`) with a UniWork brand and
teacher-edu features on top. There is no shared git history with upstream, so
upstream changes arrive as patches and the brand is re-applied by script.
Internal names stay upstream's on purpose (`@genoffice/*` packages, import
paths, code identifiers, `GENOFFICE_*` env vars, the `genoffice` CLI command,
font aliases) so patches keep applying.

| File                   | Role                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `UPSTREAM_BASE`        | Full SHA of the upstream commit this tree has absorbed (`b08e2ebf…`)                              |
| `table.mjs`            | Replacement table: rule id, why, file globs, regex pairs; shared identifier masks                 |
| `rebrand.mjs`          | Idempotent runner: applies the table, then copies `assets/` over their targets                    |
| `assets/`              | Artwork overlay, same repo-relative paths as the targets (every app icon, see "App icons")        |
| `onboarding-copy.mjs`  | First-run welcome copy (shell `onb*` keys) for every locale; the table re-applies it after a sync |
| `gen-brand-icons.mjs`  | Rebuilds every icon file in `assets/` from a master icon set (`rebrand.mjs --icons <dir>`)        |
| `brand-scan.mjs`       | Gate: GenOffice / Genspark, GitHub wording, analytics endpoints, internal codes in visible text   |
| `brand-allowlist.json` | Reasoned exemptions for the scan (`permanent` or `debt` with a tracker)                           |

## Sync with upstream

```sh
git fetch upstream
git diff --binary $(cat tools/rebrand/UPSTREAM_BASE) <new-upstream-sha> | git apply -3
# resolve conflicts: keep the UniWork brand and teacher-edu work, upstream wins elsewhere
node tools/rebrand/rebrand.mjs        # re-apply the brand to whatever upstream brought in
npm run format                        # rebrand.mjs does not run prettier; CI checks every changed file as a whole
npm run check:brand                   # must be clean; fix copy the table cannot, or allowlist with a reason
git rev-parse <new-upstream-sha> > tools/rebrand/UPSTREAM_BASE
```

Commit the patch, the rebrand run (`chore(rebrand): re-apply UniWork brand after upstream sync`)
and the new `UPSTREAM_BASE` so the history shows what upstream changed versus what the script changed.

## Commands

```sh
node tools/rebrand/rebrand.mjs               # apply (npm run rebrand)
node tools/rebrand/rebrand.mjs --check       # exit 1 if a run would change anything (npm run rebrand:check)
node tools/rebrand/rebrand.mjs --root <dir>  # operate on another checkout, e.g. a scratch worktree
node tools/rebrand/rebrand.mjs --icons <dir> # rebuild assets/ icons from a master icon set, then apply (see App icons)
npm run check:brand                          # brand scan; --list shows allowlisted hits, --json for tooling
npm run test:rebrand                         # unit tests for both tools (node:test, no extra deps)
```

`check:brand` and `test:rebrand` run in CI next to `check:theme-colors`.
`rebrand:check` is intentionally not in CI yet (see "Known gaps").

## App icons

The app logo is the UniWork Office "Page" mark (two people forming a W on a blue-cyan gradient, a document-page tile with a
folded corner). Its source of truth is the vector `assets/_source/uniwork-office-logo.svg`; every icon slot below is rendered
from it at its real size (no bitmap scaling) by `gen-brand-icons.mjs`. Each slot is a file under `assets/` that `rebrand.mjs`
copies to the same repo-relative path (the `_source` folder is the one exception: it is never copied), so changing the logo
later is asset-only: replace the SVG (a `viewBox`, no fixed width / height; needs `@napi-rs/canvas`, already a dev dependency)
and run `node tools/rebrand/rebrand.mjs --icons` (or `--icons <other.svg>`). That rebuilds the files below (the macOS icns /
`icon-mac.png` with Apple's 824/1024 grid margin, the Linux hicolor copies, the Docs copies) and applies them.
`--check` stays green afterwards.

| Asset (under `tools/rebrand/assets/`)                                                    | Target slot                                                                                           |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps/shell/build/icon.png` (1024)                                                       | electron-builder app icon source; Linux fallback; dev window icon (`windowIconPath()` in `index.ts`)  |
| `apps/shell/build/icon.ico` (16, 24, 32, 48, 64, 128, 256)                               | Windows exe icon, NSIS installer and uninstaller icon (electron-builder defaults to `build/icon.ico`) |
| `apps/shell/build/icon.icns`                                                             | macOS app bundle icon (Dock, Finder, dmg)                                                             |
| `apps/shell/build/icon-mac.png` (1024, grid margin)                                      | macOS dev Dock icon (`app.dock.setIcon`)                                                              |
| `apps/shell/build/icons/<n>x<n>.png` and `<n>x<n>/apps/uniwork-office.png`, n = 16..1024 | Linux deb / rpm / AppImage icon set (`linux.icon: 'build/icons'`, hicolor theme names)                |
| `apps/shell/src/renderer/src/assets/app-icon.png` (512)                                  | welcome dialog, Settings > About, home sidebar mark, update window (`update.html`)                    |
| `apps/docs/build/icon.{png,ico,icns}`, `icon-mac.png`                                    | standalone UniWork Docs package (same files as the shell's)                                           |
| `apps/{docs,sheets,slides}/src/renderer/assets/app-icon.png` (256)                       | referenced by no source file; kept off upstream's mark                                                |

There is no tray icon and no favicon in the product (no `<link rel="icon">`, no `Tray`). The per-type document icons
(`apps/shell/build/{docx,xlsx,pptx,pdf,md,html}.{ico,icns}`) are file-type tiles, not the app mark, and stay as they are.
`tests` in `rebrand.test.mjs` assert the sizes, the ico entries and the icns slots.

## What the table covers

Derived from `git diff 616a7acf 11945d6d` (the hand rebrand) plus the brand
decisions that landed on main afterwards. The full old to new list with file
scopes is in `office-g3g4/reports/go-a1/rebrand-table.md`; in short:

- **Product names**: `GenOffice` to `UniWork Office`; module names `GenOffice Docs|Sheets|Slides|PDF|Markdown|HTML` to `UniWork <module>`
  in productName, window and tab titles, `<title>`, help menus, About, default PDF author, default save folder, userData dir
  (`UniWork Office Dev`), AI system prompts and CLI help.
- **Packaging**: `appId` (`com.uniwork.office`, `com.uniwork.<module>`), `artifactName` for dmg / nsis / AppImage / deb / rpm and the Docs app,
  linux `executableName`, deb / rpm `packageName`, maintainer / vendor, `desktopName`, `/opt/UniWork Office/...` in the post-install scripts,
  User-Agent token (`UniWorkOffice`).
- **Vendor wording**: `Genspark` to `UniWork` in every locale (including `vi`), `Genspark AI` to `AI`, AI panel title `uniAI`,
  credits top-up links to `uniwork.app`, generic AI badge instead of the Genspark sparkle (`GensparkMark` name kept for call sites).
- **Links**: only functional URLs remain (package homepage / repository, the updater download page, the PWA download links), all on
  `github.com/UNIAI-TEAM/uniwork-office`; the product UI shows no GitHub wording, repo link or star prompt. `drop-github-and-usage-strings`
  removes those string keys again after a sync, and the scan fails if they come back.
- **Settings > Integrations prose** (`integrations-prose`): the sentences name UniWork Office with the `genoffice` command in parentheses;
  the command, MCP keys and paths stay.
- **Shipped launchers and text**: `packages/cli/bin/genoffice[.cmd]` start `MacOS/UniWork Office`, `UniWork Office.exe` and the linux `uniwork-office`
  (kept in line with `productName` / `executableName` by `packages/cli/tests/launcher-names.test.ts`); the CLI README, the MCP stdio bridge log lines,
  `skills/genoffice/SKILL.md`, the slide guides and the `npx skills add` command in Settings > Integrations.
- **First-run copy**: the welcome dialog (subtitle, slide 2, footnote, all locales) comes from `onboarding-copy.mjs`; upstream's wording
  describes upstream's product, and nothing in it may talk about internal phases or tickets.
- **Docs**: the fork banner on every `docs/i18n/README.<lang>.md`.
- **Artwork**: everything under `assets/` (shell icons incl. `icons/<size>/apps/uniwork-office.png`, `app-icon.png`, home lockup).

Never touched: `LICENSE*`, `NOTICE`, `ee/`, `docs/` (except the banner), the rest of `skills/`, tests and fixtures, `e2e/`,
font families, document-engine packages and every stored-document marker (CLAUDE.md rule 4: document content is not
re-authored by branding). Whole-line comments are left alone, except in `electron-builder.cjs`, which is scanned in full.

## Brand scan scope

Scanned: i18n catalogs and string tables (values only, all locales), `package.json` metadata (`productName`, `description`,
`author`, `homepage`, `repository`, `build.*`; not `name` or dependency maps), `electron-builder` config and `*/build/` installer
scripts, string literals in `apps/*/src` and `packages/*/src` (comment lines skipped), `skills/**` (ships to users), the shipped CLI launchers
(`packages/cli/bin/**`), the package recipes in `packaging/**`, `packages/cli/README.md` (published to npm) and `scripts/mcp-stdio-bridge.js`.
Catalog values and source string literals are also checked for internal planning vocabulary: tracker ids (`GO-1`, `GO-A8`, `UNI-1002`),
`Work Graph`, phase talk (`this phase`, `Phase 1`, `plan v2`) and spec-speak (`office runtime`, `platform integration`, vi `giai đoạn này`).
The patterns are narrow (UNIAI, uniAI, Unicode, the Family `milestones` feature and a bare `phase` are fine); see `INTERNAL_COPY` in `brand-scan.mjs`.
Not scanned: LICENSE, NOTICE, `docs/`, the other READMEs, tests, `e2e/`, fixtures, `package-lock.json`.

GitHub (the word, `github.com`) in catalog values and string literals is a violation too, as are analytics endpoints and GA4
credentials in source or packaging config (`REPO_LINKS`, `TELEMETRY` in `brand-scan.mjs`); the allowlist carries only the functional
identifiers of the Markdown image host (provider id, API endpoint; never rendered), the name GitHub Copilot, vendored-library attribution and the updater's download URL, each with a reason.

`debt` allowlist entries mark real leftovers with a tracker; the scan warns when one stops matching so it gets deleted.

## Known gaps (also in the GO-A1 report)

- `rebrand:check` is not in CI yet; run it after every upstream sync. The strings the hand rebrand had missed (AI prompts,
  CLI help) were fixed by the first post-merge run and their allowlist entries are gone.
- `strings.ts` onboarding copy: the welcome keys (steps 1-3) are re-applied from `onboarding-copy.mjs`; the GenTeam, star and
  analytics-consent keys are dropped by `drop-github-and-usage-strings`. After a sync the code that used them (offer panel, star
  prompt, analytics tracker) comes back with upstream's files and must be removed again by hand (git conflict resolution).
- The tracker `apps/shell/src/main/analytics.ts` and every `analytics.track(...)` call were deleted, not guarded; the scan and
  `apps/shell/tests/privacy-doc.test.ts` fail if an analytics endpoint or credential reappears.
- Main-process `errNoApiKey` in `docs-main.ts`, `sheets-main.ts` and `slides/i18n-main.ts`: `en` and `vi` are ours (UniWork wording),
  the other locales keep upstream's text; the rules `en-no-api-key` and `vi-no-api-key` re-apply the `en` and `vi` values after a merge.
- `skills/genoffice/SKILL.md` is rebranded by `skills-product-name`; after a sync bump its `metadata.version` once more
  (`tools/check-skill-version.mjs` in CI), or the new text never reaches installed copies.
- `packaging/**` (flatpak, nix, docker) is in the scan scope but still names GenOffice, `com.genoffice.app` and fetches
  upstream release artifacts; the hits are `debt` entries (GO-A8 / GO-A4). The recipes are not rebranded because they unpack
  upstream-built packages (`/opt/GenOffice/genoffice`); redo them together with the first UniWork release feed.
- The app icon is the "Page" logo (user decision, variant v1); the per-type document icons are upstream's tile design in blue /
  green / orange, kept. The `apps/uniai-pwa/icons/icon-*.svg` PWA icons are a separate product surface and not part of this set.
  Replace `assets/_source/uniwork-office-logo.svg` and run `--icons` if a new logo is issued (GO-A8).
- The CLI command `genoffice`, the MCP server keys `genoffice` / `genoffice-editor` and the `~/.genoffice` paths keep upstream's name
  (functional ids that agent configs address); renaming them is a GO-A8 decision.
- Origin URLs point at `github.com/UNIAI-TEAM/uniwork-office`; switch the single regex in `table.mjs` (`origin-repo-urls`)
  when the canonical repo changes.
