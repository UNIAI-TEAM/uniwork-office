# Upstream sync

UniWork Office is a long-lived fork of GenOffice. Do not automate blind upstream merges.

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

1. `git fetch upstream`
2. `git checkout main`
3. Review `git log --oneline HEAD..upstream/main`
4. Merge or rebase the **reviewed** upstream commits onto a working branch — never onto origin/main blindly
5. Resolve branding conflicts explicitly (product names, `appId`, README, icons, About URLs)
6. Run validation: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:all`
7. Merge to `origin` only after PASS

Recommended:

```bash
git fetch upstream
git checkout main
git checkout -b sync/upstream-$(date +%Y%m%d)
git merge upstream/main
# resolve conflicts, especially branding files listed below
npm run typecheck && npm run lint && npm test && npm run build:all
git checkout main
git merge --ff-only sync/upstream-YYYYMMDD
git push origin main
```

## Conflict handling

Treat these as **expected conflict areas**. Prefer UniWork display strings and identifiers; prefer upstream engine/behavior:

- `README.md`, `docs/i18n/README.*.md`, `NOTICE`
- `apps/shell/package.json` `productName` / `homepage` / `desktopName`
- `apps/shell/electron-builder.cjs` (`appId`, `productName`, `artifactName`, maintainer)
- `apps/shell/src/renderer/src/strings.ts` (English product copy)
- `apps/shell/src/renderer/src/assets/`
- `packages/electron-utils/src/github-menu.ts`
- `docs/go1/**` (ours; keep)

## Cherry-pick upstream fixes

```bash
git fetch upstream
git log upstream/main --oneline
git cherry-pick <sha>
# run the same validation gates
```

Cherry-pick engine/package commits first. Avoid cherry-picking upstream README/icon/productName commits unless you re-apply UniWork branding afterwards.

## Merge upstream releases

1. Identify the upstream tag (`git tag -l 'v*' --sort=-v:refname`)
2. `git merge <tag>` on a review branch
3. Re-apply UniWork branding if the tag rewrote product names
4. Run full test/build gates
5. Tag the UniWork build separately if you ship artifacts (`UniWork-Office-…`)

## How to avoid overwriting UniWork branding

- Do not `git merge -X theirs upstream/main`
- After every sync, grep `GenOffice` in user-visible files (`apps/shell/src/renderer`, `apps/*/package.json` `productName`, `electron-builder.cjs`)
- Keep `@genoffice/*` package names and `GENOFFICE_*` env vars unless a future phase has a migration plan
- Keep `docs/go1/` and `docs/upstream/` as UniWork-owned documentation
