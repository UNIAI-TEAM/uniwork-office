#!/usr/bin/env bash
# G7-05 W1: Build Linux x86_64 desktop artifacts (AppImage + deb) for the checked-out SHA,
# verify both artifacts exist, and print paths, byte sizes, SHA-256 hashes, and version metadata.
#
# Usage:
#   bash tools/g7-05/build-linux.sh [--output-dir <dir>] [--skip-build]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="${G7_05_OUT_DIR:-$REPO_ROOT/apps/shell/release/g7-05}"
SKIP_BUILD="${G7_05_SKIP_BUILD:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      OUT_DIR="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

cd "$REPO_ROOT"
mkdir -p "$OUT_DIR"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "ERROR: build-linux.sh must run on a Linux host (got $(uname -s))." >&2
  exit 1
fi

# Ensure the Electron binary is downloaded if npm ci ran with --ignore-scripts.
if [[ ! -f "$REPO_ROOT/node_modules/electron/path.txt" ]]; then
  echo "[g7-05/build] Installing Electron binary via node_modules/electron/install.js..."
  node "$REPO_ROOT/node_modules/electron/install.js"
fi

# electron-builder's default Linux target list includes AppImage, deb, and rpm.
# Ensure rpmbuild (rpm package) and desktop/strace utilities are present on the VM.
if ! command -v rpmbuild >/dev/null 2>&1 || ! command -v strace >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    echo "[g7-05/build] Installing Linux packaging & verification prerequisites (rpm, strace, desktop-file-utils, xdg-utils)..."
    sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq rpm strace desktop-file-utils xdg-utils >/dev/null
  fi
fi

if [[ "$SKIP_BUILD" != "1" ]]; then
  echo "[g7-05/build] Running npm run dist:linux at $(git rev-parse --short=12 HEAD)..."
  CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:linux
else
  echo "[g7-05/build] Skipping npm run dist:linux (SKIP_BUILD=1)."
fi

node - "$REPO_ROOT" "$OUT_DIR" <<'EOF'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { collectBuildMetadata, findLinuxArtifacts } from './tools/g7-05/lib.mjs'

const repoRoot = resolve(process.argv[2])
const outDir = resolve(process.argv[3])

const metadata = collectBuildMetadata(repoRoot)
const artifacts = findLinuxArtifacts(join(repoRoot, 'apps/shell/release'))

if (!artifacts.appImage) {
  console.error('ERROR: No .AppImage artifact found in apps/shell/release')
  process.exit(1)
}
if (!artifacts.deb) {
  console.error('ERROR: No .deb artifact found in apps/shell/release')
  process.exit(1)
}

const report = {
  metadata,
  artifacts: {
    appImage: artifacts.appImage,
    deb: artifacts.deb,
    ...(artifacts.rpm ? { rpm: artifacts.rpm } : {}),
  },
}

const reportPath = join(outDir, 'build-artifacts.json')
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

console.log('=== G7-05 Linux Build Artifacts ===')
console.log(`Fork SHA:           ${metadata.forkSha}`)
console.log(`git describe:       ${metadata.gitDescribe}`)
console.log(`Latest release tag: ${metadata.latestReleaseTag}`)
console.log(`App version:        ${metadata.appVersion} (root package.json: ${metadata.rootPackageVersion})`)
console.log(`Server version:     ${metadata.serverVersion}`)
console.log(`AppImage:           ${artifacts.appImage.path}`)
console.log(`  bytes:            ${artifacts.appImage.bytes} (${artifacts.appImage.mib} MiB)`)
console.log(`  sha256:           ${artifacts.appImage.sha256}`)
console.log(`Deb:                ${artifacts.deb.path}`)
console.log(`  bytes:            ${artifacts.deb.bytes} (${artifacts.deb.mib} MiB)`)
console.log(`  sha256:           ${artifacts.deb.sha256}`)
if (artifacts.rpm) {
  console.log(`Rpm:                ${artifacts.rpm.path}`)
  console.log(`  bytes:            ${artifacts.rpm.bytes} (${artifacts.rpm.mib} MiB)`)
  console.log(`  sha256:           ${artifacts.rpm.sha256}`)
}
console.log(`Saved manifest:     ${reportPath}`)
console.log('G7_05_BUILD_ARTIFACTS_JSON_BEGIN')
console.log(JSON.stringify(report, null, 2))
console.log('G7_05_BUILD_ARTIFACTS_JSON_END')
EOF
