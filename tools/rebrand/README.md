# UniWork rebrand + upstream sync

UniWork Office is genoffice (`genspark-ai/genoffice`) with a UniWork brand and
teacher-edu features on top. There is no shared git history with upstream, so
upstream changes arrive as patches and the brand is re-applied by script.
Internal names stay upstream's on purpose (`@genoffice/*` packages, import
paths, code identifiers, `GENOFFICE_*` env vars, the `genoffice` CLI command,
font aliases) so patches keep applying.

| File                   | Role                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `UPSTREAM_BASE`        | Full SHA of the upstream commit this tree has absorbed (`b08e2ebf…`)                |
| `table.mjs`            | Replacement table: rule id, why, file globs, regex pairs; shared identifier masks   |
| `rebrand.mjs`          | Idempotent runner: applies the table, then copies `assets/` over their targets      |
| `assets/`              | Artwork overlay, same repo-relative paths as the targets (shell icons, home lockup) |
| `brand-scan.mjs`       | Gate: fails on GenOffice / Genspark / genspark.ai in user-visible surfaces          |
| `brand-allowlist.json` | Reasoned exemptions for the scan (`permanent` or `debt` with a tracker)             |

## Sync with upstream

```sh
git fetch upstream
git diff --binary $(cat tools/rebrand/UPSTREAM_BASE) <new-upstream-sha> | git apply -3
# resolve conflicts: keep the UniWork brand and teacher-edu work, upstream wins elsewhere
node tools/rebrand/rebrand.mjs        # re-apply the brand to whatever upstream brought in
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
npm run check:brand                          # brand scan; --list shows allowlisted hits, --json for tooling
npm run test:rebrand                         # unit tests for both tools (node:test, no extra deps)
```

`check:brand` and `test:rebrand` run in CI next to `check:theme-colors`.
`rebrand:check` is intentionally not in CI yet (see "Known gaps").

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
- **Links**: homepage, repository, releases, issues and stars API to `github.com/UNIAI-TEAM/uniwork-office` (upstream and the old `truongnt7` fork both map there; only the files the hand rebrand touched plus the PWA download links).
- **Shipped launchers and text**: `packages/cli/bin/genoffice[.cmd]` start `MacOS/UniWork Office`, `UniWork Office.exe` and the linux `uniwork-office`
  (kept in line with `productName` / `executableName` by `packages/cli/tests/launcher-names.test.ts`); the CLI README, the MCP stdio bridge log lines,
  `skills/genoffice/SKILL.md`, the slide guides and the `npx skills add` command in Settings > Integrations.
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
Catalog values are also checked for internal tracker ids (`GO-1`, `GO-A8`, `UNI-1002`).
Not scanned: LICENSE, NOTICE, `docs/`, the other READMEs, tests, `e2e/`, fixtures, `package-lock.json`.

`debt` allowlist entries mark real leftovers with a tracker; the scan warns when one stops matching so it gets deleted.

## Known gaps (also in the GO-A1 report)

- `rebrand:check` is not in CI yet; run it after every upstream sync. The strings the hand rebrand had missed (AI prompts,
  CLI help) were fixed by the first post-merge run and their allowlist entries are gone.
- `strings.ts` onboarding copy (`GenTeam`, alpha / credits wording, the welcome page) was rewritten by hand; upstream copy for
  those keys must be re-resolved manually after a sync, and the scan will flag it (it also flags internal ticket ids such as `GO-1`).
- Main-process `errNoApiKey` in `docs-main.ts`, `sheets-main.ts` and `slides/i18n-main.ts`: `en` and `vi` are ours (UniWork wording),
  the other locales keep upstream's text; the rule `vi-no-api-key` re-applies the `vi` value after a merge.
- `skills/genoffice/SKILL.md` is rebranded by `skills-product-name`; after a sync bump its `metadata.version` once more
  (`tools/check-skill-version.mjs` in CI), or the new text never reaches installed copies.
- `packaging/**` (flatpak, nix, docker) is in the scan scope but still names GenOffice, `com.genoffice.app` and fetches
  upstream release artifacts; the hits are `debt` entries (GO-A8 / GO-A4). The recipes are not rebranded because they unpack
  upstream-built packages (`/opt/GenOffice/genoffice`); redo them together with the first UniWork release feed.
- `apps/shell/build/icon.icns`, `icon.ico`, `icon-mac.png` and the per-type document icons are still upstream artwork
  (the hand rebrand only replaced PNGs). Replace them with official UniWork artwork before release (GO-A8).
- Origin URLs point at `github.com/UNIAI-TEAM/uniwork-office`; switch the single regex in `table.mjs` (`origin-repo-urls`)
  when the canonical repo changes.
