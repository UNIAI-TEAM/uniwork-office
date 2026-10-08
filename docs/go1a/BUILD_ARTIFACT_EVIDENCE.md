# GO-1A build artifact evidence

Local packaging evidence. The DMG is **not** committed (`apps/shell/release/` is gitignored).

| Field | Value |
| --- | --- |
| Artifact | `apps/shell/release/UniWork-Office-0.10.0-arm64.dmg` |
| Platform | macOS arm64 |
| Size | 179141006 bytes (171M) |
| Build date | 2026-09-14T15:46:02Z (local pack time) |
| Signed | **NO** (`CSC_IDENTITY_AUTO_DISCOVERY=false`) |
| Notarized | **NO** (no Apple credentials; notarize hook skipped) |
| SHA256 | `3a4ac06d087836b6c160248c2b2246bad1169befe4ae536a7de60a1cad15d25d` |
| Also produced | `UniWork-Office-0.10.0-arm64.zip` (not hashed here) |
| App bundle | `apps/shell/release/mac-arm64/UniWork Office.app` |

This SHA is for the GO-1 unsigned pack produced before GO-1A chrome edits (HTML titles, PDF author default, CLI help, onboarding copy). Re-running `npm run dist:mac` would produce a new digest. GO-1A did not require a second production package because editor engines were unchanged and packaging metadata was already UniWork (`productName`, `appId`, `artifactName`).

Windows / Linux packages: **not run** on this host.
