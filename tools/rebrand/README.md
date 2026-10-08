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
| `sync-upstream.mjs`    | Upstream sync: patch on a new branch, rebrand, `UPSTREAM_BASE` bump, checks, report               |

## Sync with upstream

`sync-upstream.mjs` does the whole flow; the weekly workflow runs it and opens a pull request.

```sh
node tools/rebrand/sync-upstream.mjs --dry-run --report sync.md   # preview: changes nothing, writes sync.md + sync.json
node tools/rebrand/sync-upstream.mjs                              # real run on a new branch upstream-sync/<target7>
node tools/rebrand/sync-upstream.mjs --to <sha|ref>               # a full 40-hex SHA, or a branch, tag or refs/pull/<n>/head
node tools/rebrand/sync-upstream.mjs --continue                   # after resolving conflicts by hand
```

What a real run does (it refuses a dirty working tree):

1. Fetches the target (default: the upstream default branch head) and the base from `UPSTREAM_BASE` into
   `refs/upstream-sync/*` (the only refs a dry run touches), and stops with "up to date" when they are equal.
   Abbreviated SHAs are refused, and so is a target that does not descend from the base (rewritten or unrelated
   upstream history) unless `--force` is given. A local or `origin` branch `upstream-sync/<target7>` that already
   absorbs the target means "already prepared"; one that does not is an error (exit 1, never overwritten).
2. Creates `upstream-sync/<target7>` off the current `HEAD` and applies `git diff --binary <base> <target>` with
   `git -c core.autocrlf=false apply -3 --index` (bytes over stdin, so line endings and binaries survive). If git
   rejects the patch as a whole, it applies file by file and lists the files no 3-way merge could take as "failed".
3. Commits `chore(upstream): apply genoffice <base7>..<target7>`, runs `rebrand.mjs`, formats the files it touched
   with Prettier (when installed) and commits `chore(rebrand): re-apply UniWork brand after upstream sync`, then writes
   the target to `UPSTREAM_BASE`, runs `tools/legal/sync-legal.mjs` (when present) so the NOTICE / MODIFICATIONS
   headers name the new upstream commit, and commits both as
   `chore(rebrand): bump UPSTREAM_BASE to <target7> and refresh legal headers` (without the legal step the title is
   `chore(rebrand): bump UPSTREAM_BASE to <target7>`).
4. Runs the brand scan, the egress check (when `package.json` defines `check:egress`) and the rebrand tests, and
   records them, with the legal step, in the report.

The checks never run code from the patched tree: before applying, the script copies `tools/` and the Prettier config
and ignore file of the checkout it runs from to a temp dir, and runs the rebrand, the legal sync, the brand scan, the egress check,
the rebrand tests (a fixed file list) and Prettier (`--config` / `--ignore-path` from that copy) against the tree with
`--root`. If a real run fails with an error after creating its branch, it resets, switches back to the original branch
and deletes the new one.

On conflicts it stops after step 2 (exit 2) with the conflicted files in the working tree. Resolve them (keep the
UniWork brand and teacher-edu work, upstream wins elsewhere), `git add` them and run `--continue`, which commits the
patch and finishes steps 3 and 4. `--commit-conflicts` instead commits the files with their markers so a pull request
shows them, and still finishes the remaining steps; `--ci` (the workflow's mode) is `--commit-conflicts` plus a
failure when Prettier is missing. Files that did not apply are listed loudly at the top of the report:
`UPSTREAM_BASE` is bumped anyway, so such a sync must not merge until they are ported by hand.

| Exit code | Meaning                                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 0         | up to date, already prepared (the branch exists and absorbs the target), or clean with every check green                                 |
| 1         | usage or runtime error: bad arguments, dirty tree, fetch failure, non-descendant target, existing unfinished sync branch                 |
| 2         | needs a human: conflicts, files that did not apply, a failing check (rebrand, formatting, legal sync, brand scan, egress, rebrand tests) |

Re-running is safe: a dry run leaves branches, `HEAD`, the index and the worktree list as they were (it works in a
throwaway `git worktree` under the OS temp dir), and a second real run for the same target reports "already prepared"
and changes nothing. Delete the `upstream-sync/<target7>` branch to prepare a sync again.

The report (`--report <file.md>`, plus a `.json` sibling; the markdown is also printed without `--json`) lists base,
target, commits behind, the upstream commits, the files changed, clean / conflicted / failed files, the files the
rebrand changed, the check results, a watch list and the next steps. Upstream text (commit subjects, git errors) sits in
code spans, so it renders no mentions or references, and the report holds no local paths. `--pr-body <file.md>` writes
the same report cut below 60000 characters for a pull request body. Other flags: `--remote`, `--root`, `--branch`,
`--base`, `--exclude <glob>`, `--prettier <prettier.cjs>`, `--no-fetch`, `--skip-checks`, `--json` (see the header of
`sync-upstream.mjs`).

### Weekly workflow

`.github/workflows/upstream-sync.yml` runs every Monday (03:17 UTC) and on demand (`workflow_dispatch`, optional
`upstream_ref`). It needs no `npm ci` (the tools are dependency-free Node); it installs only Prettier at the lockfile
version. Two jobs keep the upstream patch away from the write token:

- `prepare` has a read-only token and no persisted credentials. It runs the script with `--ci` and uploads the report,
  the JSON summary, the pull request body and a git bundle of the sync branch as the `upstream-sync-report` artifact.
- `publish` (write token) runs nothing from the tree: it fetches the bundle, pushes the branch (never forced), opens a
  pull request against the default branch (a draft when the exit code is 2), closes older open `upstream-sync/*` pull
  requests with a pointer to the new one (their branches are kept) and dispatches CI.

It does nothing when upstream has nothing new, when the branch for that target already absorbs it, or when an open
pull request for it exists. Nothing is merged automatically.

- It uses `GITHUB_TOKEN` only. Pushes and pull requests made with that token do not trigger other workflows, so the
  `pull_request` run of `ci.yml` never starts for the sync PR. The workflow therefore dispatches `ci.yml` on the branch
  (`gh workflow run`); those checks attach to the PR head commit, and the changed-file gates diff against the default
  branch. Any later push by a person triggers the normal run.
- `GITHUB_TOKEN` may not push changes under `.github/workflows/`, so upstream workflow files are left out of the patch
  (`--exclude`); the report lists them for a human to port.
- `ci.yml` fails while any file holds committed conflict markers, so a sync PR with conflicts stays red until resolved.

### What a human still checks

- Every conflicted or failed file, and the commits in order (patch, rebrand, base bump).
- The watch list and "Known gaps" below: upstream brings back analytics / star prompt / offer panel code that the fork
  removed, a changed `skills/*/SKILL.md` needs its `metadata.version` bumped, packaging recipes stay upstream-branded.
- If upstream changed its own NOTICE header (year, wording), copy the new text into `upstream.notice` in
  `apps/shell/src/shared/legal.json` (the upstream NOTICE kept verbatim) and run `npm run legal`; the script's legal
  step only re-renders the headers from that file.
- `npm run format` when the run had no Prettier (CI checks every changed file as a whole), then `npm run check:brand`,
  `npm run rebrand:check` and the app tests. Fix copy the table cannot, or allowlist it with a reason.

## Commands

```sh
node tools/rebrand/rebrand.mjs               # apply (npm run rebrand)
node tools/rebrand/rebrand.mjs --check       # exit 1 if a run would change anything (npm run rebrand:check)
node tools/rebrand/rebrand.mjs --root <dir>  # operate on another checkout, e.g. a scratch worktree
node tools/rebrand/rebrand.mjs --icons <dir> # rebuild assets/ icons from a master icon set, then apply (see App icons)
npm run check:brand                          # brand scan; --list shows allowlisted hits, --json for tooling
npm run test:rebrand                         # unit tests for the rebrand, scan and sync tools (node:test, no extra deps)
node tools/rebrand/sync-upstream.mjs --dry-run   # preview the next upstream sync (see Sync with upstream)
```

`check:brand` and `test:rebrand` run in CI next to `check:theme-colors`.
`rebrand:check` is intentionally not in CI yet (see "Known gaps").

## App icons

The app logo is the UniWork Office "Page" mark (two people forming a W on a blue-cyan gradient, a document-page tile with a
folded corner). Its source of truth is the vector `assets/_source/uniwork-office-logo.svg`; every icon slot below is rendered
from it at its real size (no bitmap scaling) by `gen-brand-icons.mjs`. Each slot is a file under `assets/` that `rebrand.mjs`
copies to the same repo-relative path (the `_source` folder is the one exception: it is never copied), so changing the logo
later is asset-only: replace the SVG (a `viewBox`, no fixed width / height; needs the transitive, optional `@napi-rs/canvas`; it is not a declared dependency, so the generator stops with a clear message when it is missing, and the generated icons are committed, so it is only needed when the logo changes)
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

Never touched: `LICENSE*`, `NOTICE`, `apps/shell/src/shared/legal.json` (upstream attribution), `ee/`, `docs/` (except the banner), the rest of `skills/`, tests and fixtures, `e2e/`,
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

## Legal identity and attribution

`apps/shell/src/shared/legal.json` is the one place for the product's legal identity (company, contact email, homepage,
copyright year) and the upstream attribution (name, copyright, license, the upstream NOTICE verbatim, the trademark sentence).
Company, email and homepage are placeholders until the legal entity exists; change them there and run `npm run legal`.
Readers: `electron-builder.cjs` (copyright, linux maintainer / vendor, packaged author / homepage), Settings > About
(copyright and attribution line, buttons that open the shipped LICENSE, NOTICE and THIRD-PARTY-NOTICES.txt locally, inline error if one fails),
`tools/gen-third-party-notices.mjs` (header) and `tools/legal/sync-legal.mjs` (`npm run legal`, `legal:check` in CI), which
rewrites the NOTICE header, the MODIFICATIONS header (Apache-2.0 4(b) statement with the `UPSTREAM_BASE` commit) and the
`apps/*/package.json` author / homepage / Docs `build.copyright`. LICENSE, NOTICE and MODIFICATIONS ship as `.txt` copies (with LICENSE-UNICODE.txt)
in Resources/ of the shell and the standalone Docs package. Upstream names may appear in the UI only in that About attribution.

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
