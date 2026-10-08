# Upstream sync

UniWork Office is a long-lived fork of GenOffice with no shared git history: upstream changes arrive as a patch and the
UniWork brand is re-applied by script. Nothing is merged automatically; the weekly sync workflow only opens a pull request.

## Remotes

| Remote         | URL                                              | Role                          |
| -------------- | ------------------------------------------------ | ----------------------------- |
| `upstream`     | https://github.com/genspark-ai/genoffice.git     | Official GenOffice repository |
| `origin`       | https://github.com/UNIAI-TEAM/uniwork-office.git | UniWork-controlled fork       |
| Default branch | `main`                                           | Both remotes                  |

## One-time setup

```bash
git clone https://github.com/UNIAI-TEAM/uniwork-office.git
cd uniwork-office
git remote add upstream https://github.com/genspark-ai/genoffice.git   # already present on this clone
git fetch upstream
git branch -vv
```

## Sync procedure

Use `tools/rebrand/sync-upstream.mjs`; [`tools/rebrand/README.md`](../../tools/rebrand/README.md) ("Sync with upstream")
documents the commands, the dry run, the exit codes, the report and the weekly workflow.

```bash
node tools/rebrand/sync-upstream.mjs --dry-run   # preview against the upstream head
node tools/rebrand/sync-upstream.mjs             # branch upstream-sync/<sha>: patch, rebrand, UPSTREAM_BASE bump, checks
# resolve conflicts if it stops (exit 2), `git add`, then:
node tools/rebrand/sync-upstream.mjs --continue
npm run typecheck && npm run lint && npm test && npm run build:all
```

`git merge upstream/main` and `git cherry-pick` do not work here: the histories are unrelated. To absorb upstream only up to
a given commit (for example a release tag), run the script with `--to <sha|tag>`; the next sync starts from there.

## Conflict handling

Treat these as **expected conflict areas**. Prefer UniWork display strings and identifiers; prefer upstream engine/behavior:

- `README.md`, `docs/i18n/README.*.md`, `NOTICE`
- `apps/shell/package.json` `productName` / `homepage` / `desktopName`
- `apps/shell/electron-builder.cjs` (`appId`, `productName`, `artifactName`, maintainer)
- `apps/shell/src/renderer/src/strings.ts` (English product copy)
- `apps/shell/src/renderer/src/assets/`
- `packages/electron-utils/src/github-menu.ts`
- `docs/go1/**` (ours; keep)

## How to avoid overwriting UniWork branding

- Do not `git merge -X theirs upstream/main`
- After every sync, `npm run check:brand` must be clean (the script runs it and lists violations in its report)
- Keep `@genoffice/*` package names and `GENOFFICE_*` env vars unless a future phase has a migration plan
- Keep `docs/go1/` and `docs/upstream/` as UniWork-owned documentation
