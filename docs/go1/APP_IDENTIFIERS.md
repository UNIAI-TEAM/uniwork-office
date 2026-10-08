# GO-1 application identifiers

GO-1 changes **display and packaging** identifiers only. Internal npm names stay `@genoffice/*`.

## Changed

| Surface | Before | After | Migration |
| --- | --- | --- | --- |
| Shell `appId` | `com.genoffice.app` | `com.uniwork.office` | New product; no GenOffice install migration. Electron `userData` is a new directory (`UniWork Office` / `UniWork Office Dev`). |
| Docs leftover builder `appId` | `com.genoffice.docs` | `com.uniwork.docs` | Standalone docs packaging is not the shipped suite. |
| Slides leftover builder `appId` | `com.genoffice.slides` | `com.uniwork.slides` | Same. |
| Linux executable | `genoffice` | `uniwork-office` | New package name `uniwork-office` (deb/rpm). Not an upgrade of the upstream `genoffice` package. |
| Linux desktop file | `genoffice.desktop` | `uniwork-office.desktop` | Matches `desktopName`. |
| Default save folder | `Documents/GenOffice` | `Documents/UniWork Office` | Created on demand. |
| GitHub | `genspark-ai/genoffice` | `truongnt7/uniwork-office` | About / updater fallback / README. |
| HTTP User-Agent | `GenOffice` | `UniWorkOffice` | Optional AI requests only. |
| Artifact pattern | `genoffice_*` / default GenOffice | `UniWork-Office-${version}-${arch}.${ext}` | macOS/Windows/Linux packager output. |

Proposed but **not** introduced as separate packaged apps in GO-1 (the suite ships as one shell):

- `com.uniwork.sheets`
- `com.uniwork.pdf`

Sheets and PDF remain modules inside `com.uniwork.office`.

## Unchanged (on purpose)

| Identifier | Value | Why |
| --- | --- | --- |
| npm workspaces | `@genoffice/docs` etc. | imports, CI `-w` scripts |
| CLI | `genoffice` | skill, PATH, `~/.genoffice/launcher` |
| Auth file | `~/.genoffice/auth.json` | Genspark device-code flow |
| Renderer scheme | `genoffice-app://` | internal Electron protocol |
| Genspark provider id | `genspark` | `ai-settings.json` |
| Analytics metadata key | `genofficeAnalytics` | only if keys are injected at pack time (GO-1 does not inject them) |

## Deep links

There is no OS-level `genoffice://` or `uniwork://` handler. File associations remain standard Office/PDF/Markdown/HTML extensions.
