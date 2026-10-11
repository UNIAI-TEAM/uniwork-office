# Dev / beta installer releases

UniWork Office ships desktop installers on two channels, `dev` and `beta`, built by
`.github/workflows/release-installers.yml`. Builds are **unsigned** until the company has
code-signing certificates; `stable` is refused until then. Auto-update is off in these builds.

| File                     | Role                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `installer-urls.mjs`     | Builds the `OFFICE_INSTALLER_<CHANNEL>_URLS` value for the UniWork server               |
| `check-build-brand.mjs`  | Brand / update-feed gate on the packaged output (installer, exe, Info.plist, asar, deb) |
| `linux-install-check.sh` | Installs a deb, checks launcher, URL handlers, deployment profile, uninstall            |
| `*.test.mjs`             | Unit tests (`node --test tools/release/*.test.mjs`)                                     |

The packaging config itself is `apps/shell/electron-builder.cjs` (release block near the
end); `apps/shell/tests/release-config.test.ts` covers it.

## Cutting a build

The version is `<apps/shell/package.json version>-<channel>.<n>`, for example `0.11.0-dev.1`.

- **Release (published):** the release owner pushes a tag `v<version>`, e.g. `v0.11.0-dev.1` or
  `v0.11.0-beta.2`, on a commit that is on `main`. Nobody else pushes release tags. The
  workflow checks that the tag's base version equals `apps/shell/package.json`, that the
  channel is `dev` or `beta` and that the tagged commit is an ancestor of `main`, builds
  Windows, macOS and Linux, then creates a **pre-release** for the tag (never marked latest; not a
  draft, because the server downloads the installer without credentials) with the installers
  and their `SHA256SUMS-<platform>.txt`.
- **Test build (not published):** run the workflow by hand (`workflow_dispatch`, input
  `channel`). The version becomes `<base>-<channel>.<run number>`; the installers stay
  workflow artifacts for 14 days and no tag or release is created.

Bump `apps/shell/package.json` first when the base version changes; `<n>` counts builds of
one base version per channel.

### Who may publish

"Only the release owner pushes tags" is a convention until the repository enforces it.
Repository admins should add a tag ruleset for `v*-dev.*` and `v*-beta.*` (create / update /
delete restricted to the release owners), or a `release` environment with required reviewers
for the publish job. The workflow keeps the write token small either way: the build jobs and
the `urls` job (which runs `installer-urls.mjs`) are read-only, and the `publish` job checks
out no code; it only downloads the built files and runs `gh release create` / `upload`.

## Artifact names

Only release builds (`UNIWORK_RELEASE_CHANNEL` set by the workflow) use these names; a
plain local `npm run dist:win` / `dist:mac` keeps `UniWork-Office-<version>-<arch>.<ext>`
(Linux: `UniWork Office-<version>.AppImage`, `UniWork-Office_<version>_amd64.deb`, an rpm).

| Platform            | File                                                                            |
| ------------------- | ------------------------------------------------------------------------------- |
| Windows x64 (NSIS)  | `UniWork-Office_<version>_unsigned_win32_x64-setup.exe`                         |
| macOS Apple Silicon | `UniWork-Office_<version>_unsigned_darwin_arm64.dmg`                            |
| macOS Intel         | `UniWork-Office_<version>_unsigned_darwin_x64.dmg`                              |
| Linux x64 (deb)     | `UniWork-Office_<version>_unsigned_linux_x64.deb`                               |
| Linux x64 AppImage  | `UniWork-Office_<version>_unsigned_linux_x64.AppImage`                          |
| Checksums           | `SHA256SUMS-win32-x64.txt`, `SHA256SUMS-darwin.txt`, `SHA256SUMS-linux-x64.txt` |

The server reads the version from `_<version>_` and the `unsigned` flag from the name. The
`_unsigned` token disappears by itself once a signing identity is configured for that
platform (see "Signing hooks"). Release builds produce no mac zips (they only feed an
updater, which is off); plain local `dist:mac` still builds them.

Linux packages are never signed, so their names always carry `_unsigned`, and the arch is
spelled `x64` (electron-builder's own `${arch}` would say `amd64` / `x86_64`). The deb's
`Package` is `uniwork-office`, its `Maintainer` / `Vendor` / `Homepage` come from
`apps/shell/src/shared/legal.json`. Release builds **do not build the rpm**: the download
server has no rpm platform key, and nothing on the release pipeline could test it. A local
`npm run dist:linux` still builds one.

## Putting the links on the server

The `urls` job prints a line like this in the run summary and uploads it as the
`installer-urls-<channel>` artifact:

```text
OFFICE_INSTALLER_DEV_URLS={"win32-x64":"https://github.com/UNIAI-TEAM/uniwork-office/releases/download/v0.11.0-dev.1/UniWork-Office_0.11.0-dev.1_unsigned_win32_x64-setup.exe","darwin-arm64":"https://github.com/UNIAI-TEAM/uniwork-office/releases/download/v0.11.0-dev.1/UniWork-Office_0.11.0-dev.1_unsigned_darwin_arm64.dmg","darwin-x64":"https://github.com/UNIAI-TEAM/uniwork-office/releases/download/v0.11.0-dev.1/UniWork-Office_0.11.0-dev.1_unsigned_darwin_x64.dmg"}
```

Everything after the `=` is the value: `dev` fills `OFFICE_INSTALLER_DEV_URLS`, `beta` fills
`OFFICE_INSTALLER_BETA_URLS`, `OFFICE_INSTALLER_STABLE_URLS` stays empty. The keys and their
order are the server's (`win32-x64`, `win32-x64-zip`, `darwin-arm64`, `darwin-x64`,
`linux-x64-deb`, `linux-x64-appimage`); this pipeline fills all of them except
`win32-x64-zip`.

Release download URLs answer with a redirect to the file host. If a server route refuses
redirects, mirror the files to a host that serves them directly and regenerate the value:

```sh
node tools/release/installer-urls.mjs --channel dev --base-url https://downloads.example/office/dev --dir <folder with the installers>
```

The helper refuses an installer without the `unsigned` label or with another channel's
version, two installers for one platform, mixed versions and a non-HTTPS base URL.

## Unsigned builds: first launch

- **Windows:** SmartScreen shows "Windows protected your PC". Choose **More info** >
  **Run anyway**. Machines with Smart App Control or an application allow-list may block the
  unsigned app or its helper processes outright; those need the signed builds.
- **macOS:** the app is ad-hoc signed (Apple Silicon refuses to run an app with no valid
  signature) but not notarized, so Gatekeeper blocks the first open. Right-click the app in
  Applications > **Open** > **Open**, or on macOS 15 and later open it once, then
  **System Settings** > **Privacy & Security** > **Open Anyway**. From a terminal:
  `xattr -dr com.apple.quarantine "/Applications/UniWork Office.app"`.
  A `.dmg` downloaded in a browser is rejected earlier, with "is damaged and can't be
  opened. You should move it to the Trash." (quarantine on an unsigned image; right-click
  Open does not help). Run `xattr -d com.apple.quarantine <path to the .dmg>` and open the
  image again. The release body (the `--notes` text in `release-installers.yml`) carries this
  note and the Open Anyway path; keep the two in step with this section.
- **Linux:** `sudo apt install ./UniWork-Office_<version>_unsigned_linux_x64.deb` (Debian,
  Ubuntu), or `chmod +x` the AppImage and run it (needs FUSE 2, `libfuse2` /
  `libfuse2t64` on Ubuntu). Nothing is signed on Linux, so no prompt appears. The deb
  installs an AppArmor profile on Ubuntu 24.04 and later, where the sandbox needs it.

The mac job checks every app with `codesign --verify --deep --strict` and `codesign -dv`
(expects `Signature=adhoc` while unsigned) and checks each app's architecture with `lipo`.

## Organization deployment profile

A server download bundle carries `deployment-profile.json` next to the installer. The NSIS
installer copies it to `<install dir>\resources\deployment-profile.json`
(`process.resourcesPath` at runtime) when present and a real uninstall removes it. An
over-install or update keeps the existing profile: the installer saves it before the old
version's files are removed and puts it back afterwards. A profile beside the new installer
always replaces the kept one. Interactive installs hide the details list and silent installs
write no log, so only a failure is visible: a failed save, copy or restore shows a message box
(answered with OK automatically in a silent install) that tells the user to extract the
bundle and run the installer again.

The kept copy is read from the install location registered for the install context being
installed into (per-machine or per-user), falling back to the per-user install when that
context has none. So a profile that exists only in the per-user install is dropped when a
per-machine install and a per-user install both exist and the per-machine one is updated; and
switching a per-user install to per-machine copies its profile from the user-writable
`%LOCALAPPDATA%` into `Program Files`. A bundle profile beside the installer avoids both.

Extract the downloaded bundle before running the installer. Opening the installer straight
from the zip in Explorer extracts only the installer to a temporary folder, so no profile is
found next to it.

### Linux

- **deb:** a package script cannot see the folder the deb was opened from, so the profile
  is copied by hand after the install:
  `sudo install -m 644 deployment-profile.json "/opt/UniWork Office/resources/"`. dpkg
  leaves that file alone on an upgrade (it is not a package file), and the package's
  post-remove script deletes it on a real uninstall, like the Windows uninstaller.
- **AppImage:** its resources are read-only, so the app reads `deployment-profile.json`
  from the folder holding the AppImage (after `resources/`, before the userData copy).
  Extracting the bundle zip and running the AppImage from there is enough.
- Either way, `~/.config/UniWork Office/deployment-profile.json` also works (the userData
  fallback every platform has).

## Auto-update is off

Dev / beta builds are pre-releases without an update feed: the workflow never sets
`GENOFFICE_UPDATE_URL` (the config refuses it together with a release channel), packages with
`--publish never`, and `check-build-brand.mjs` fails when an `app-update.yml` or `latest*.yml`
is in the output. Users install a newer build by downloading it again. Turning updates on
needs signed builds (Squirrel.Mac requires them) and a feed host, which are backlog.

## Signing hooks

All signing steps are gated by the repository variable `UNIWORK_SIGNING_ENABLED` (`'true'`
turns them on). With it unset nothing below runs and no signing variable reaches
electron-builder, not even an empty one (the unsigned mac step unsets them, and the release
config drops empty `CSC_*` / `APPLE_*` values; `CSC_LINK=""` would otherwise be read as a
certificate path and fail the build).

**Before flipping the variable**, move the signing steps (or the build jobs) behind a GitHub
environment whose deployment branches are restricted to the release tags, and keep the secrets
in that environment. Otherwise a `workflow_dispatch` run from any branch receives them.

- **macOS:** secrets `CSC_LINK` (base64 Developer ID Application `.p12`), `CSC_KEY_PASSWORD`,
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. electron-builder signs with the
  hardened runtime and notarizes the app; `apps/shell/build/notarize-dmg.js` notarizes and
  staples the dmgs. A "Check the signing secrets" step fails early when one is empty, and the
  signed package step is a separate step that alone receives the secrets.
- **Windows:** repository variable `GENOFFICE_WIN_SIGN_MODE` (`test` = self-signed PFX,
  `production` = DigiCert KeyLocker). The config routes every binary electron-builder signs
  through `scripts/win-sign.cjs`, and the workflow signs the helper binaries
  (`xlsx-sidecar.exe`, `win-ocr.exe`) with it before packaging. A "Check the signing mode" step
  fails early unless the mode is `test` or `production`. **That script does not exist
  in this repository yet**: add it, then pass the secrets it reads (for KeyLocker typically
  `SM_HOST`, `SM_API_KEY`, `SM_CLIENT_CERT_FILE_B64`, `SM_CLIENT_CERT_PASSWORD`,
  `SM_CODE_SIGNING_CERT_SHA1_HASH`; for a PFX the file and its password) to the "Sign the
  helper binaries" and "Package the installer" steps.

## Building locally

Windows (PowerShell or Git Bash, from the repository root):

```sh
npm run notices && npm run build:all
cd apps/sheets && cargo build --release --manifest-path native/xlsx-engine/Cargo.toml --config native/xlsx-engine/.cargo/config.toml --target x86_64-pc-windows-msvc && cd ../..
cd apps/shell
GENOFFICE_WIN_SIDECAR_TARGET=x86_64-pc-windows-msvc UNIWORK_RELEASE_CHANNEL=dev BUILD_DIR=release-local \
  npx electron-builder --win --x64 --publish never -c.extraMetadata.version=0.11.0-dev.0
cd ../.. && node tools/release/check-build-brand.mjs --dir apps/shell/release-local --expect win-unpacked
```

`GENOFFICE_WIN_SIDECAR_TARGET=x86_64-pc-windows-msvc` takes the sidecar from the MSVC build
(statically linked CRT via `native/xlsx-engine/.cargo/config.toml`) instead of the default
MinGW cross-compile path. macOS uses `npm run native:build:universal -w @genoffice/sheets`
and `GENOFFICE_MAC_X64=1 UNIWORK_RELEASE_CHANNEL=dev npx electron-builder --mac --publish never ...`.

Linux (x64 Debian / Ubuntu host; `npm run build:all` builds the sidecar natively):

```sh
npm run notices && npm run build:all
cd apps/shell && UNIWORK_RELEASE_CHANNEL=dev BUILD_DIR=release-local \n  npx electron-builder --linux --x64 --publish never -c.extraMetadata.version=0.11.0-dev.0
cd ../.. && node tools/release/check-build-brand.mjs --dir apps/shell/release-local --expect linux-unpacked
bash tools/release/linux-install-check.sh apps/shell/release-local/UniWork-Office_0.11.0-dev.0_unsigned_linux_x64.deb --smoke
```

## Not covered

- Linux: arm64 packages, the rpm, and the `packaging/` recipes (flatpak, nix, docker), which
  are untouched and still point at the upstream builds.
- Windows ARM64 and the Windows zip (`win32-x64-zip`).
- Signed / notarized builds and the stable channel.
