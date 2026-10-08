# GO-1 CI matrix

Upstream workflow: `.github/workflows/ci.yml`.

| Job | Runner | What it runs | UniWork GO-1 |
| --- | --- | --- | --- |
| `test` | `ubuntu-latest` | `npm ci`, licenses, cargo-deny, format, theme colors, skill versions, public hygiene, English comments, lint, typecheck, fixtures, `npm test`, Sheets compat | Keep. Does not package installers. |
| `e2e` | `ubuntu-22.04` | `npm run build:all`, xvfb Playwright Electron | Keep. Native macOS/Windows GUIs are not exercised here. |

## Platform packaging (not in this CI)

| Platform | Command | This validation host |
| --- | --- | --- |
| macOS arm64 | `npm run dist:mac` | Supported (unsigned local) |
| macOS x64 | `GENOFFICE_MAC_X64=1 npm run dist:mac` | Opt-in; not run in GO-1 |
| Windows x64/arm64 | `npm run dist:win` | Not run (macOS host) |
| Linux x64 | `npm run dist:linux` | Not run (macOS host) |

UniWork did not add a second pipeline. Branding changes ride the existing gates. Do not duplicate CI.

Signing/notarization remains skipped without secrets — expected for contributor/fork builds (`CONTRIBUTING.md`).
