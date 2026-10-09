# Dev / beta installer releases

UniWork Office ships desktop installers on two channels, `dev` and `beta`, built by
`.github/workflows/release-installers.yml`. Builds are **unsigned** until the company has
code-signing certificates; `stable` is refused until then. Auto-update is off in these builds.

| File                    | Role                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `installer-urls.mjs`    | Builds the `OFFICE_INSTALLER_<CHANNEL>_URLS` value for the UniWork server          |
| `check-build-brand.mjs` | Brand / update-feed gate on the packaged output (installer, exe, Info.plist, asar) |
| `*.test.mjs`            | Unit tests (`node --test tools/release/*.test.mjs`)                                |

The packaging config itself is `apps/shell/electron-builder.cjs` (release block near the
end); `apps/shell/tests/release-config.test.ts` covers it.

## Cutting a build

The version is `<apps/shell/package.json version>-<channel>.<n>`, for example `0.11.0-dev.1`.

- **Release (published):** the release owner pushes a tag `v<version>`, e.g. `v0.11.0-dev.1` or
  `v0.11.0-beta.2`. Nobody else pushes release tags. The workflow checks that the tag's base
  version equals `apps/shell/package.json` and that the channel is `dev` or `beta`, builds
  Windows and macOS, then creates a **pre-release** for the tag (never marked latest; not a
  draft, because the server downloads the installer without credentials) with the installers
  and their `SHA256SUMS-<platform>.txt`.
- **Test build (not published):** run the workflow by hand (`workflow_dispatch`, input
  `channel`). The version becomes `<base>-<channel>.<run number>`; the installers stay
  workflow artifacts for 14 days and no tag or release is created.

Bump `apps/shell/package.json` first when the base version changes; `<n>` counts builds of
one base version per channel.

## Artifact names

Only release builds (`UNIWORK_RELEASE_CHANNEL` set by the workflow) use these names; a
plain local `npm run dist:win` / `dist:mac` keeps `UniWork-Office-<version>-<arch>.<ext>`.

| Platform            | File                                                    |
| ------------------- | ------------------------------------------------------- |
| Windows x64 (NSIS)  | `UniWork-Office_<version>_unsigned_win32_x64-setup.exe` |
| macOS Apple Silicon | `UniWork-Office_<version>_unsigned_darwin_arm64.dmg`    |
| macOS Intel         | `UniWork-Office_<version>_unsigned_darwin_x64.dmg`      |
| Checksums           | `SHA256SUMS-win32-x64.txt`, `SHA256SUMS-darwin.txt`     |

The server reads the version from `_<version>_` and the `unsigned` flag from the name. The
`_unsigned` token disappears by itself once a signing identity is configured for that
platform (see "Signing hooks"). The mac zips are built too but not published (they only feed
an updater, which is off).

## Putting the links on the server

The publish job prints a line like this in the run summary and uploads it as the
`installer-urls-<channel>` artifact:

```text
OFFICE_INSTALLER_DEV_URLS={"win32-x64":"https://github.com/UNIAI-TEAM/uniwork-office/releases/download/v0.11.0-dev.1/UniWork-Office_0.11.0-dev.1_unsigned_win32_x64-setup.exe","darwin-arm64":"https://github.com/UNIAI-TEAM/uniwork-office/releases/download/v0.11.0-dev.1/UniWork-Office_0.11.0-dev.1_unsigned_darwin_arm64.dmg","darwin-x64":"https://github.com/UNIAI-TEAM/uniwork-office/releases/download/v0.11.0-dev.1/UniWork-Office_0.11.0-dev.1_unsigned_darwin_x64.dmg"}
```

Everything after the `=` is the value: `dev` fills `OFFICE_INSTALLER_DEV_URLS`, `beta` fills
`OFFICE_INSTALLER_BETA_URLS`, `OFFICE_INSTALLER_STABLE_URLS` stays empty. The keys and their
order are the server's (`win32-x64`, `win32-x64-zip`, `darwin-arm64`, `darwin-x64`,
`linux-x64-deb`, `linux-x64-appimage`); this pipeline fills the first, third and fourth.

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

The mac job checks every app with `codesign --verify --deep --strict` and `codesign -dv`
(expects `Signature=adhoc` while unsigned) and checks each app's architecture with `lipo`.

## Organization deployment profile

A server download bundle carries `deployment-profile.json` next to the installer. The NSIS
installer copies it to `<install dir>\resources\deployment-profile.json`
(`process.resourcesPath` at runtime) when present and the uninstaller removes it. An
over-install from a plain installer download (no profile beside it) leaves the app without
one, because the previous version's files are removed first.

## Auto-update is off

Dev / beta builds are pre-releases without an update feed: the workflow never sets
`GENOFFICE_UPDATE_URL` (the config refuses it together with a release channel), packages with
`--publish never`, and `check-build-brand.mjs` fails when an `app-update.yml` or `latest*.yml`
is in the output. Users install a newer build by downloading it again. Turning updates on
needs signed builds (Squirrel.Mac requires them) and a feed host, which are backlog.

## Signing hooks

All signing steps are gated by the repository variable `UNIWORK_SIGNING_ENABLED` (`'true'`
turns them on). With it unset nothing below runs and no signing secret reaches a job.

- **macOS:** secrets `CSC_LINK` (base64 Developer ID Application `.p12`), `CSC_KEY_PASSWORD`,
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. electron-builder signs with the
  hardened runtime and notarizes the app; `apps/shell/build/notarize-dmg.js` notarizes and
  staples the dmgs. A "Check the signing secrets" step fails early when one is empty.
- **Windows:** repository variable `GENOFFICE_WIN_SIGN_MODE` (`test` = self-signed PFX,
  `production` = DigiCert KeyLocker). The config routes every binary electron-builder signs
  through `scripts/win-sign.cjs`, and the workflow signs the helper binaries
  (`xlsx-sidecar.exe`, `win-ocr.exe`) with it before packaging. **That script does not exist
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
cd ../.. && node tools/release/check-build-brand.mjs --dir apps/shell/release-local
```

`GENOFFICE_WIN_SIDECAR_TARGET=x86_64-pc-windows-msvc` takes the sidecar from the MSVC build
(statically linked CRT via `native/xlsx-engine/.cargo/config.toml`) instead of the default
MinGW cross-compile path. macOS uses `npm run native:build:universal -w @genoffice/sheets`
and `GENOFFICE_MAC_X64=1 UNIWORK_RELEASE_CHANNEL=dev npx electron-builder --mac --publish never ...`.

## Not covered

- Linux packages: the `packaging/` recipes (flatpak, nix, docker) are untouched and still
  point at the upstream builds; Linux installers are backlog.
- Windows ARM64 and the Windows zip (`win32-x64-zip`).
- Signed / notarized builds and the stable channel.
