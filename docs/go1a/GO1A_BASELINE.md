# GO-1A baseline

Captured at the start of GO-1A closeout, before the closeout commit.

| Field | Value |
| --- | --- |
| `CURRENT_BRANCH` | `main` (tracks `origin/main`) |
| `CURRENT_HEAD_SHA` | `616a7acf5a9136ebb931abac6781a7ad5207faf1` |
| `WORKTREE_STATUS` | Dirty: GO-1 rebrand + GO-1A chrome closeout uncommitted |
| `UNTRACKED_FILES` | `.env.example`, `docs/go1/`, `docs/upstream/`, `docs/go1a/`, e2e docs/slides edit-save specs, Linux hicolor icon trees, `UNIWORK_BRAND_ASSET_REQUIRED.md` |
| `MODIFIED_FILES` | ~170 tracked files (product names, i18n, packaging, tests, placeholders) |
| `REMOTE_ORIGIN` | `https://github.com/truongnt7/uniwork-office.git` |
| `REMOTE_UPSTREAM` | `https://github.com/genspark-ai/genoffice.git` |
| `CURRENT_TAGS` | Upstream `v*` tags present locally; no `go1-uniwork-office-*` tag yet |
| `CURRENT_GO1_STATUS` | `GO1_READY = PARTIAL` at GO-1A start (`docs/go1/GO1_ACCEPTANCE_REPORT.md`) |

## Policy used for closeout

GO-1A §XVIII–XXIV treats GO-1 as a **technical / rebrand / source baseline**, not production-distribution readiness.

- macOS signing, notarization, Windows/Linux packages → **GO-1R**
- Official UniWork artwork (unavailable in this tree) → **GO-1R brand-release debt**
- Genspark sign-in / credits remain **LIVE_VENDOR_REFERENCE** (backend unchanged)

This interpretation is explicit, not silent.
