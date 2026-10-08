# GO-1A release metadata

| Surface | Value | Notes |
| --- | --- | --- |
| Shell `productName` | UniWork Office | `apps/shell/package.json` |
| `appId` | `com.uniwork.office` | already UniWork-controlled; no further migration |
| `artifactName` | `UniWork-Office-${version}-${arch}.${ext}` | mac zip/dmg |
| Deb/rpm artifact | `UniWork-Office_…` / `UniWork-Office-…` | `packageName` `uniwork-office` |
| Linux `executableName` | `uniwork-office` | `desktopName` `uniwork-office.desktop` |
| Author | UniWork Office | `apps/shell/package.json` |
| Homepage | `https://github.com/truongnt7/uniwork-office` | |
| DMG title | derived from `productName` | unsigned local pack |
| Version | `0.10.0` (shell) | matches artifact `UniWork-Office-0.10.0-arm64.dmg` |
| Root npm `name` | `genoffice` | **unchanged** (workspaces / lockfile) |
| CLI bin | `genoffice` | **unchanged** |
| Docs leftover `appId` | `com.uniwork.docs` | not the shipped suite |
| Slides leftover `appId` | `com.uniwork.slides` | not the shipped suite |

No breaking identifier migration was added in GO-1A.
