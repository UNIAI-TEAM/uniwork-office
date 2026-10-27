# Dev / beta installer releases

UniWork Office ships desktop installers on two channels, `dev` and `beta`, built by
`.github/workflows/release-installers.yml`. The mac dmgs are signed and notarized when mac
signing is on (see "Mac signing"); Windows and Linux builds are **unsigned**, and `stable` is
refused until every platform signs. Auto-update is off in these builds.

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

- **Release from the Actions tab (published):** run the workflow by hand on `main` with
  `channel` and `publish` on (the default). The run takes the next free `<n>` for the base
  version and channel (highest existing `v<base>-<channel>.<n>` tag + 1, or 1), builds every
  platform, and the `publish` job creates that tag on the run's commit with the pre-release
  below. A run with `publish` on from any other branch fails in `meta`.
- **Release by tag (published):** the release owner pushes a tag `v<version>`, e.g. `v0.11.0-dev.1` or
  `v0.11.0-beta.2`, on a commit that is on `main`. Nobody else pushes release tags. The
  workflow checks that the tag's base version equals `apps/shell/package.json`, that the
  channel is `dev` or `beta` and that the tagged commit is an ancestor of `main`, builds
  Windows, macOS and Linux, then creates a **pre-release** for the tag (never marked latest; not a
  draft, because the server downloads the installer without credentials) with the installers
  and their `SHA256SUMS-<platform>.txt`.
- **Test build (not published):** run the workflow by hand (`workflow_dispatch`, input
  `channel`) with `publish` off, from any branch. The version becomes `<base>-<channel>.<run number>`; the installers stay
  workflow artifacts for 14 days and no tag or release is created.

Bump `apps/shell/package.json` first when the base version changes; `<n>` counts builds of
one base version per channel.

### Who may publish

"Only the release owner pushes tags" is a convention until the repository enforces it.
Repository admins should add a tag ruleset for `v*-dev.*` and `v*-beta.*` (create / update /
delete restricted to the release owners), or a `release` environment with required reviewers
for the publish job. Anyone with write access can start the dispatch release; a tag ruleset
also binds the `publish` job's `GITHUB_TOKEN`, so add GitHub Actions to its bypass list or
use the environment instead. The workflow keeps the write token small either way: the build jobs and
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
platform: a mac signing run ships `UniWork-Office_<version>_darwin_arm64.dmg` /
`_darwin_x64.dmg` (see "Mac signing"). Release builds produce no mac zips (they only feed an
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

The helper refuses an installer without the `unsigned` label (only the mac dmgs may come
signed), a release mixing signed and unsigned dmgs, another channel's version, two installers
for one platform, mixed versions and a non-HTTPS base URL.

## Unsigned builds: first launch

- **Windows:** SmartScreen shows "Windows protected your PC". Choose **More info** >
  **Run anyway**. Machines with Smart App Control or an application allow-list may block the
  unsigned app or its helper processes outright; those need the signed builds.
- **macOS (signing off):** the app is ad-hoc signed (Apple Silicon refuses to run an app with no valid
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

With mac signing on, the dmg opens without a prompt: the release body then says so instead of
the steps above.

The mac job checks every app with `codesign --verify --deep --strict` and `codesign -dv`
(expects `Signature=adhoc` while unsigned) and checks each app's architecture with `lipo`. A
signing run instead expects the `Developer ID Application` authority and the hardened runtime
flag, and runs `xcrun stapler validate` and `spctl --assess` on every app and dmg.

## Which server the app connects to (deployment profile)

The installer is the same plain file for everyone; there is no per-server bundle. The app learns
its server (deploymentId, apiOrigin, clientId, channel) from, in this order:

1. `deployment-profile.json` in the user data folder: what the user or a web link chose. A
   web "Open UniWork Office" link carries the four values; the app asks once
   ("Connect UniWork Office to <origin>?") when the server is new or another deployment, moves
   silently when the same deployment id has a new origin, and refuses a link of another channel.
   The "Kết nối UniWork" screen (Settings > Account) writes the same file from a typed address.
2. The default baked into the build (below).
3. `UNIWORK_API_ORIGIN` in the environment (dev), then the legacy `uniworkApiOrigin` setting.

The default is optional. The workflow reads `default_api_origin` and `default_deployment_id`
(workflow_dispatch inputs; on a tag push the repository variables `UNIWORK_DEFAULT_API_ORIGIN`
and `UNIWORK_DEFAULT_DEPLOYMENT_ID`) and passes them to the build as env of the names
`UNIWORK_DEFAULT_API_ORIGIN` / `UNIWORK_DEFAULT_DEPLOYMENT_ID`. `apps/shell/build/deployment-defaults.cjs`
validates them (https only, http for localhost on dev, bare origin, both set or both empty); the
meta job runs it first, so an invalid value fails before any build. electron-builder then writes
`resources/deployment-defaults.json` (the channel and the default, if any), which is a package
file: an upgrade replaces it, an uninstall removes it, and the user's own choice in the user
data folder is untouched by both.

## Auto-update from the GitHub releases

Dev / beta builds update from the GitHub releases of this repository. The workflow sets
`UNIWORK_UPDATE_URL=https://github.com/<repository>`, which `apps/shell/electron-builder.cjs`
turns into the github publish provider on the release channel: the Windows and Linux apps get a
`resources/app-update.yml` for this repository, and electron-builder writes `<channel>.yml`
(Windows) and `<channel>-linux.yml` (AppImage) next to the installers. Packaging still runs
with `--publish never`; the collect steps add those two files to the uploads and the publish job
attaches them to the release with the installers.

The app pins its feed to its own channel and accepts pre-releases
(`apps/shell/src/main/updater.ts`): electron-updater reads the repository's release feed,
takes the newest release whose tag has the same pre-release id (`v<version>-dev.<n>` for a dev
build) and downloads the installer `<channel>.yml` names. A beta build never takes a dev release,
and the Settings stable / beta switch does not apply to these builds.

`check-build-brand.mjs --update-feed github:<repository>` fails when the Windows or Linux
`app-update.yml` is missing or names another feed, when the mac app carries any feed, and when a
channel file lists a file that is not in the output (the uploaded names must be the ones the
feed points at).

Not updated in place: the unsigned mac app (Squirrel.Mac installs updates only into a signed
app, so the mac build has no feed and a manual check opens https://uniworkos.com/office) and the
deb, which updates through apt: every Linux build ships the repository key, and a release deb built
with `UNIWORK_APT_SOURCE=true` also ships a deb822 source for its channel (`resources/apt/`). The flag
is off until the repository is live (the workflow sets it from the repository variable
`UNIWORK_APT_REPO_ENABLED`): a source for a repository that answers 404 would break `apt update` on
the user's machine, and a deb without the source file writes nothing. When the source ships, the postinst installs it with the keyring (`/usr/share/keyrings/uniwork-office-archive-keyring.gpg`,
`/etc/apt/sources.list.d/uniwork-office.sources`; `UNIWORK_OFFICE_APT_REPO=false` in
`/etc/default/uniwork-office` opts out, an admin's own source file is left alone, `apt purge`
removes both), and the manual check says `sudo apt update && sudo apt upgrade`.

`UNIWORK_UPDATE_URL=https://uniworkos.com/downloads/office/update` is the self-hosted generic feed:
`apps/shell/electron-builder.cjs` appends the channel directory (`update/dev`, `update/beta`,
`update/stable`, the last one reading the default `latest.yml`), and
`check-build-brand.mjs --update-feed generic:<that url>` requires exactly it in `app-update.yml`
(the mac app still carries no feed). Any other HTTPS `UNIWORK_UPDATE_URL` is a generic feed
prefix as given. The workflow still refuses stable.

## Mac signing

The repository variable `UNIWORK_MAC_SIGNING_ENABLED` (`'true'`) turns it on. The meta job
then sets `mac_signed` for runs of main only (a tag push, which it checks is on main, or a
`workflow_dispatch` from main); any other ref builds the ad-hoc signed app as before and says
so in a notice. Two mac jobs exist and exactly one runs: `macos` (no environment, ad-hoc
signed) when `mac_signed` is not `true`, `macos_signed` (GitHub environment `mac-signing`)
when it is. The `urls` and `publish` jobs wait for whichever ran.

- Secrets: `CSC_LINK` (the Developer ID Application `.p12`, base64), `CSC_KEY_PASSWORD`,
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. electron-builder signs with the
  hardened runtime and notarizes the app; `apps/shell/build/notarize-dmg.js` notarizes and
  staples the dmgs. A "Check the signing secrets" step fails early when one is empty. An "Import
  the signing certificate" step puts the `.p12` into a temporary keychain with a random
  password, lists the identities it holds (names only) and exports `CSC_KEYCHAIN` and
  `CSC_NAME` for electron-builder; the package step gets only the Apple credentials, and the
  keychain is deleted in a last step. (electron-builder 26.15's own `CSC_LINK` import fails on
  macOS 26 at `security set-key-partition-list`: it passes the `.p12` password where the
  keychain password belongs; fixed upstream in 26.18.) The verify steps
  refuse any signer other than team `XJAM488A6D` (`EXPECTED_TEAM_ID` in the job env).
- Keep the secrets **in the `mac-signing` environment, not in the repository list**. A
  repository secret is readable by any workflow on any branch; an environment secret only by a
  job the environment admits. The workflow expression that picks the signing job is a
  convenience, not a barrier (a branch can carry a workflow that names the environment itself);
  the environment's rules are the barrier.
- **Set it up in this order**, before the first signed run:
  1. Settings > Environments > New environment `mac-signing`. Deployment branches and tags:
     Selected, add `main` as a **branch** rule and `v*` as a **tag** rule (with only `v*`, a
     dispatch from main is refused at job start). Required reviewers: recommended (a person
     approves every signed run, including a dispatch, and a tag pushed by someone with write
     access cannot sign on its own); with "Prevent self-review" on, the person who started the
     run cannot approve it, so name a second reviewer. A workflow that names a missing
     environment creates it with no protection, so do not skip this step.
  2. Add the five secrets to that environment.
  3. Delete the same five from the repository-level list (an environment also sees the
     repository secrets, so a leftover copy defeats step 1).
  4. Settings > Rules > Rulesets > New tag ruleset: restrict creating and updating
     `v*-dev.*` / `v*-beta.*` tags to the maintainers. The workflow checks a release tag is on
     main, but that check lives in the tagged commit's own workflow file; the `v*` rule of the
     environment alone admits a tag on any commit.
  5. Only then set `UNIWORK_MAC_SIGNING_ENABLED` to `true` as a **repository variable**
     (Settings > Secrets and variables > Actions > Variables > Repository variables). The meta
     job reads it and has no environment, so a copy that lives only in the `mac-signing`
     environment is invisible to it: `mac_signed` stays false and an ad-hoc build runs, with a
     notice only when the ref is not main.
- With signing off no signing variable reaches electron-builder, not even an empty one (the
  unsigned mac step unsets them, and the release config drops empty `CSC_*` / `APPLE_*`
  values; `CSC_LINK=""` would otherwise be read as a certificate path and fail the build).
- Do not re-run a release tag after switching the variable: the publish job refuses to add
  dmgs of the other signing state to an existing release. Cut the next tag number instead.
- Still unsigned-shaped on the mac side: no zips and no update feed (Squirrel.Mac could now
  install updates; turning that on is its own change), so the app keeps the manual
  newer-release notice.

Troubleshooting the certificate: a `.p12` exported with OpenSSL 3 defaults (AES-256, PBKDF2)
can fail to import into the runner's keychain ("MAC verification failed ... wrong password?"),
and the file should carry the Developer ID intermediate. Re-export with
`openssl pkcs12 -export -legacy -inkey key.pem -in cert.pem -certfile intermediate.pem -out cert.p12`
(or `-keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1` instead of `-legacy`), then
base64 it again for `CSC_LINK`.

The certificate is the company's (UNICOM TECHNOLOGY SOLUTIONS COMPANY LIMITED, team
`XJAM488A6D`) and valid until 2027-11-21; renew it before then. Notarized builds keep running
after it expires.

## Windows signing hook

Gated by the repository variable `UNIWORK_SIGNING_ENABLED` (`'true'`) and off. Repository variable `GENOFFICE_WIN_SIGN_MODE` (`test` = self-signed PFX,
`production` = DigiCert KeyLocker). The config routes every binary electron-builder signs
through `scripts/win-sign.cjs`, and the workflow signs the helper binaries
(`xlsx-sidecar.exe`, `win-ocr.exe`) with it before packaging. A "Check the signing mode" step
fails early unless the mode is `test` or `production`. **That script does not exist
in this repository yet**: add it, then pass the secrets it reads (for KeyLocker typically
`SM_HOST`, `SM_API_KEY`, `SM_CLIENT_CERT_FILE_B64`, `SM_CLIENT_CERT_PASSWORD`,
`SM_CODE_SIGNING_CERT_SHA1_HASH`; for a PFX the file and its password) to the "Sign the
helper binaries" and "Package the installer" steps.

## Bundled legacy format converter (LibreOffice 26.8.2.2)

Every desktop installer bundles a trimmed LibreOffice 26.8.2.2 converter pack under
`Resources/libreoffice/` (`apps/shell/build/prepare-libreoffice.cjs` and
`apps/shell/build/libreoffice-manifest.json`), including a pre-initialised
`Resources/libreoffice/template-profile/` (`MacroSecurityLevel=3`, link updates disabled) and the
24 metric-compatible font files needed for headless `.doc -> .docx`, `.xls -> .xlsx` and
`.ppt -> .pptx` conversion. `beforePack` prepares and verifies the target's cached pack under
`apps/shell/build/.cache/libreoffice-26.8.2.2/<platform>-<arch>/libreoffice` before
`electron-builder` copies `extraResources`, and `.github/workflows/release-installers.yml` caches
that directory per runner OS keyed by the manifest and script hashes.

Code-signing backlog notes for a later signing card:

- **Windows (`win32-x64`, `win32-arm64`):** `electron-builder` does not sign `extraResources`
  files automatically. When `scripts/win-sign.cjs` and `UNIWORK_SIGNING_ENABLED` are enabled, the
  signing step must also sign `program/soffice.exe`, `program/soffice.bin`, and all 75 `.dll`
  files under `apps/shell/build/.cache/libreoffice-26.8.2.2/win32-<arch>/libreoffice/program/`
  before packaging (and re-save or exclude the signed binaries from raw-checksum invalidation) so
  Smart App Control / WDAC / AppLocker do not block `soffice.bin` child processes.
- **macOS (`darwin-arm64`, `darwin-x64`):** `@electron/osx-sign` walks `Contents/Resources/libreoffice/LibreOffice.app`
  and re-signs its 85 Mach-O binaries (`Contents/MacOS/soffice` and 84 `.dylib` files in
  `Contents/Frameworks/`) plus the nested `.app` bundle with the app's Developer ID Application
  identity and `entitlementsInherit` (`com.apple.security.cs.allow-jit`,
  `com.apple.security.cs.allow-unsigned-executable-memory`,
  `com.apple.security.cs.disable-library-validation`). A later macOS signing verification card
  should verify that notarization and `spctl --assess` succeed with the nested `LibreOffice.app`
  inside `Contents/Resources/libreoffice/`.
- **Linux (`linux-x64`, `linux-arm64`):** ELF binaries inside `.deb` and `.AppImage` are not
  individually code-signed; repository metadata stays GPG-signed by `apt-repo.sh`.

## Download server and apt repository

Every published release is also copied to `https://uniworkos.com/downloads/office/`: the edge
maps `/downloads/office/*` to a dedicated public-read bucket (object GET only, no listing; never
the `uniwork` user-data bucket). The `mirror` job runs after `publish` and calls
`tools/release/apt-repo.sh`, which uploads the installers, updates the signed apt repository and
the generic update feed, and writes `releases.json`. The run summary then shows a second
`OFFICE_INSTALLER_<CHANNEL>_URLS` value whose URLs point at this server; the server keeps the
GitHub value until the route answers.

- **Environment `release-publish`** (deployment refs: `main` and `v*`), secrets (names only):
  `OFFICE_S3_ENDPOINT`, `OFFICE_S3_BUCKET`, `OFFICE_S3_ACCESS_KEY_ID`,
  `OFFICE_S3_SECRET_ACCESS_KEY`, `APT_GPG_PRIVATE_KEY` (armored), `APT_GPG_PASSPHRASE`. Only the
  mirror step gets them. The optional repository variable `OFFICE_S3_REGION` defaults to `hn-2`.
  The job uses path-style addressing and the AWS CLI's `when_required` checksum mode (newer
  checksum headers break several S3-compatible providers).
- **Repository variable `UNIWORK_APT_REPO_ENABLED`** (`'true'`): the Linux build then ships the
  apt source in the deb. Leave it off until the repository answers on uniworkos.com.
- All mirror runs share one concurrency group: the apt indexes and `releases.json` are
  read-modify-write.

### Layout

| Key (below `downloads/office/`)          | Content                                                         |
| ---------------------------------------- | --------------------------------------------------------------- |
| `<channel>/<version>/`                   | every release file, plus a combined `SHA256SUMS`                |
| `apt/key.gpg`, `apt/key.asc`             | the signing key, binary (for `Signed-By`) and armored           |
| `apt/pool/main/u/uniwork-office/`        | `uniwork-office_<version>_amd64.deb`                            |
| `apt/dists/<channel>/`                   | `InRelease`, `Release`, `Release.gpg` (one suite per channel)   |
| `apt/dists/<channel>/main/binary-amd64/` | `Packages`, `.gz`, `.xz` and `by-hash/SHA256/<hash>` copies     |
| `apt/latest/`, `apt/latest/<channel>/`   | `uniwork-office_amd64.deb`, the newest deb under a stable name  |
| `install.sh`                             | the `curl \| sh` install script (`tools/release/install.sh`)    |
| `update/<channel>/`                      | generic electron-updater feed: the feed yml and the files named |
| `releases.json`                          | public manifest of every kept version (schema 1, below)         |

The suites are `dev`, `beta` and `stable` (component `main`, architecture `amd64`, `Origin:
UniWork`, `Label: UniWork Office`, `Acquire-By-Hash: yes`, no `Valid-Until`).

### Installing from the apt repository

```sh
curl -fsSL https://uniworkos.com/downloads/office/apt/key.gpg \
  | sudo tee /usr/share/keyrings/uniwork-office-archive-keyring.gpg >/dev/null
sudo tee /etc/apt/sources.list.d/uniwork-office.sources >/dev/null <<'SOURCES'
Types: deb
URIs: https://uniworkos.com/downloads/office/apt
Suites: dev
Components: main
Architectures: amd64
Signed-By: /usr/share/keyrings/uniwork-office-archive-keyring.gpg
SOURCES
sudo apt update && sudo apt install uniwork-office
```

Use `Suites: beta` for the beta channel. Later builds arrive with `sudo apt update && sudo apt
upgrade`. Check the key before trusting it:
`gpg --show-keys /usr/share/keyrings/uniwork-office-archive-keyring.gpg` must print
`58A9 0232 2C8D 45C4 33B5  25F5 1198 D109 26F3 4831`.

### One-command install

Each channel's newest deb is also published under a stable name, so a fresh machine needs one
command (the deb's postinst adds the apt source, later builds arrive with `apt upgrade`):

| Channel  | URL (below `https://uniworkos.com/downloads/office/`) |
| -------- | ----------------------------------------------------- |
| `stable` | `apt/latest/uniwork-office_amd64.deb`                 |
| `beta`   | `apt/latest/beta/uniwork-office_amd64.deb`            |
| `dev`    | `apt/latest/dev/uniwork-office_amd64.deb`             |

```sh
wget -nv -O /tmp/uniwork-office.deb https://uniworkos.com/downloads/office/apt/latest/uniwork-office_amd64.deb \
  && sudo apt install /tmp/uniwork-office.deb
```

The stable channel has no channel segment; `releases.json` `channels.<channel>.latest_deb_url`
carries the same URL. The copy is published (and `latest_deb_url` written) only when the deb
contains `./opt/UniWork Office/resources/apt/uniwork-office.sources`, i.e. it was built with
`UNIWORK_APT_SOURCE=true`; a deb without the source would install without apt updates, so the
run logs one `::notice::` line and skips both. The apt repository, pool, indexes and installers
still publish, a deb with the source later starts the copy, and an older copy is left in place
(never deleted).

### Install script

The shortest way in on Debian and Ubuntu, one command for every channel (`stable` when no
argument is given):

```sh
curl -fsSL https://uniworkos.com/downloads/office/install.sh | sudo sh
curl -fsSL https://uniworkos.com/downloads/office/install.sh | sudo sh -s -- dev   # or beta, stable
```

`tools/release/install.sh` is POSIX sh (`set -eu`, `shellcheck -s sh` clean) and does all its work
inside one function called on the last line, so a cut-off download runs nothing. Before it
changes anything it refuses (non-zero exit, nothing written) when it is not root, when
`/etc/os-release` names neither `debian` nor `ubuntu`, when `dpkg --print-architecture` is not
`amd64`, when `dists/<channel>/InRelease` does not answer (the message names the channel and
suggests `sh -s -- dev`), and when the downloaded `apt/key.gpg` has a primary fingerprint other
than `58A902322C8D45C433B525F51198D10926F34831` (checked with `gpg --show-keys --with-colons`
in a throwaway `GNUPGHOME`; gpg is installed first through apt when it is missing). Then it
writes

- `/usr/share/keyrings/uniwork-office-archive-keyring.gpg` (0644) and
- `/etc/apt/sources.list.d/uniwork-office.sources` (0644, first line `# managed by uniwork-office`),

byte for byte what the deb's postinst writes (`aptSourcesText` in
`apps/shell/electron-builder.cjs`; `install-script.test.mjs` compares the two), only when the
content differs, so a second run changes nothing and a later `apt upgrade` or `apt purge` of the
deb treats both files as its own. A source file at that path without the first-line marker is
the admin's own: it stays untouched, the script prints one line and goes on. Last come
`apt-get update` and `apt-get install -y uniwork-office` (non-interactive, never reading stdin,
which is the pipe). The deb keeps its own opt-out: `UNIWORK_OFFICE_APT_REPO=false` in
`/etc/default/uniwork-office` stops the postinst from touching the source; the script is only
run on purpose, so it has no opt-out of its own.

The mirror job uploads `install.sh` to the bucket root on every run (`Cache-Control: no-cache`,
`text/plain; charset=utf-8`, so a browser shows the text before anyone pipes it), after the
signed indexes and the latest deb and before the feed files and `releases.json`. The script is
the same for every channel.

Test hook: `UNIWORK_OFFICE_REPO_URL` replaces the download base URL
(`https://uniworkos.com/downloads/office`; the apt repository is `<base>/apt`, and the written
source points there). `apt-repo-minio-check.sh` sets it to its local MinIO; leave it unset.

### Signing key

RSA 4096, fingerprint `58A902322C8D45C433B525F51198D10926F34831`, uid
`UniWork Office Releases <contact@uniworkos.com>`, expires 2029-10-21; extend or rotate it
before then. The private key, its passphrase and the revocation certificate are in the company
vault, never in the repository. The script imports the key into a throwaway `GNUPGHOME`,
refuses any other fingerprint, and signs before it uploads anything.

### Upload order and retention

Stateless: the suite's current `Packages` is the manifest; the script replaces the stanza of
the same version and keeps the newest 5 versions (`--keep`, compared with
`dpkg --compare-versions`). Each step must succeed before the next, so a client never sees an
index naming a missing file: installers, pool deb, `by-hash` + `Packages*`, `Release` /
`Release.gpg` / `InRelease` (with `Cache-Control: no-cache`, like `Packages*`, the feed yml and
`releases.json`), the latest deb (when it has the apt source), `install.sh`, feed files, feed yml, `releases.json`, then prune. Prune keeps one run of
grace: a pool deb, a `by-hash` file, a feed file or a `<channel>/<version>/` directory is
deleted only when neither the new nor the previous index / Release / feed yml / manifest names
it. Re-running the same version is idempotent.

### releases.json

`release-manifest.mjs` writes it (schema 1; field names never change within the schema, new
optional fields may appear). `channels.<channel>` holds `latest`, `apt_suite`, `latest_deb_url` (optional) and `releases`
(newest first, the kept versions only); each release has `version`, `channel`, `tag`,
`published_at`, `git_sha`, `notes_markdown` (the GitHub release body, untrusted markdown),
`notes_url` (null for now), `signed` (`windows` / `macos` / `linux`), `apt` and `assets` (one row
per installer and checksum file: `platform`, `arch`, `kind`, `file`, absolute `url`, `size`,
`sha256`, `signed`). A run replaces only its own channel's entry.

### Checking it locally

- `node --test tools/release/apt-repo.test.mjs` runs the script against a directory instead of
  S3 (`APT_REPO_TARGET_DIR`) with a throwaway key (`APT_REPO_EXPECT_FPR`, refused on GitHub
  Actions). It needs `apt-ftparchive` (apt-utils), `dpkg-deb`, `gpg`, `gpgv` and skips without.
- `node --test tools/release/install-script.test.mjs` runs `install.sh` with stubbed system
  commands: the source it writes equals `aptSourcesText` for each channel, and every refusal
  leaves nothing written.
- `bash tools/release/apt-repo-minio-check.sh` is the end-to-end check: a throwaway MinIO
  (`bitnamilegacy/minio`), two published versions, and Ubuntu 24.04 and 22.04 containers that
  add the deb822 source, install the first version, upgrade to the second and refuse a tampered
  `InRelease` and `Packages`. A second set of clean amd64 clients (curl only, no gpg) runs the
  published `install.sh` through `curl | sh`: refusals (not root, unpublished channel, wrong
  key), the install, a second run that changes nothing, an admin-owned source left alone and the
  upgrade to the second version. It needs docker and removes everything it started.
- `--dry-run` prints the uploads and deletions without the key or any write.

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
- Signed Windows builds, mac auto-update (zips + feed for Squirrel.Mac) and the stable channel.
