#!/usr/bin/env bash
# G7-05 W2: Build the 3 Linux x86_64 desktop packages required for the T3/T4 upgrade & rollback matrix:
#   1. N+1 (synthetic unreleased test build at current branch HEAD with APP_STORE_LEVEL = 3, version 1.0.0-g705n1)
#   2. N'  (tag v1.0.0-beta.3, 4bdba928d1210df9b04bfdaf549bbcdd6419d206, APP_STORE_LEVEL = 2, version 1.0.0)
#   3. pre-N' (tag v0.11.0-dev.6, fcfcd29ddb989b1497993204486bc110e0ae8b04, before G5-04g store-level gate, version 0.11.0)
#
# The build-time patch for N+1 is applied only in the ephemeral working tree and immediately reverted so
# APP_STORE_LEVEL = 3 is NEVER committed to product code.
#
# Usage:
#   bash tools/g7-05/build-upgrade-matrix.sh [--output-dir <dir>]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUT_DIR="${G7_05_MATRIX_OUT_DIR:-$REPO_ROOT/apps/shell/release/g7-05-matrix}"

N_PRIME_SHA="4bdba928d1210df9b04bfdaf549bbcdd6419d206"
PRE_N_PRIME_SHA="fcfcd29ddb989b1497993204486bc110e0ae8b04"
N1_VERSION="1.0.0-g705n1"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      OUT_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

cd "$REPO_ROOT"
mkdir -p "$OUT_DIR/n1" "$OUT_DIR/n-prime" "$OUT_DIR/pre-n-prime"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "ERROR: build-upgrade-matrix.sh must run on a Linux host (got $(uname -s))." >&2
  exit 1
fi

# Ensure Electron binary is present if npm ci ran with --ignore-scripts.
if [[ ! -f "$REPO_ROOT/node_modules/electron/path.txt" ]]; then
  echo "[g7-05/matrix-build] Installing Electron binary via node_modules/electron/install.js..."
  node "$REPO_ROOT/node_modules/electron/install.js"
fi

# Ensure strace and desktop utilities are installed on the VM.
if ! command -v strace >/dev/null 2>&1 || ! command -v desktop-file-validate >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    echo "[g7-05/matrix-build] Installing strace, desktop-file-utils, xdg-utils..."
    sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq strace desktop-file-utils xdg-utils >/dev/null
  fi
fi

ORIG_HEAD_SHA="$(git rev-parse HEAD)"
ORIG_BRANCH="$(git symbolic-ref -q --short HEAD || true)"
STAGE_TOOLS_DIR="$(mktemp -d /tmp/g7-05-matrix-tools-XXXXXX)"
cp -a "$REPO_ROOT/tools/g7-05/." "$STAGE_TOOLS_DIR/"

restore_repo() {
  cd "$REPO_ROOT" || true
  rm -f "$REPO_ROOT/node_modules/@uniwork/edu-core" || true
  git checkout -- . >/dev/null 2>&1 || true
  git clean -fd apps/ packages/ >/dev/null 2>&1 || true
  if [[ -n "$ORIG_BRANCH" ]]; then
    git checkout -f "$ORIG_BRANCH" >/dev/null 2>&1 || git checkout -f "$ORIG_HEAD_SHA" >/dev/null 2>&1 || true
  else
    git checkout -f "$ORIG_HEAD_SHA" >/dev/null 2>&1 || true
  fi
  rm -rf "$STAGE_TOOLS_DIR" || true
}
trap restore_repo EXIT

echo "=================================================================="
echo "[g7-05/matrix-build] 1/3 Building N+1 (${N1_VERSION}, APP_STORE_LEVEL=3) from HEAD (${ORIG_HEAD_SHA})"
echo "=================================================================="
node "$STAGE_TOOLS_DIR/apply-n1-patch.mjs" --repo-root "$REPO_ROOT" --version "$N1_VERSION" --store-level 3
npm run notices
npm run build:all
(
  cd "$REPO_ROOT/apps/shell"
  rm -rf "$OUT_DIR/n1"/*
  BUILD_DIR="$OUT_DIR/n1" CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --linux deb AppImage
)
git checkout -- .

echo "=================================================================="
echo "[g7-05/matrix-build] 2/3 Building N' (v1.0.0-beta.3, ${N_PRIME_SHA}, APP_STORE_LEVEL=2)"
echo "=================================================================="
git checkout -f "$N_PRIME_SHA"
npm run notices
npm run build:all
(
  cd "$REPO_ROOT/apps/shell"
  rm -rf "$OUT_DIR/n-prime"/*
  BUILD_DIR="$OUT_DIR/n-prime" CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --linux deb AppImage
)

echo "=================================================================="
echo "[g7-05/matrix-build] 3/3 Building pre-N' (v0.11.0-dev.6, ${PRE_N_PRIME_SHA}, pre-G5-04g)"
echo "=================================================================="
git checkout -f "$PRE_N_PRIME_SHA"
# pre-N' (0.11.0) imports @uniwork/edu-core from packages/edu-core, which was removed before 1.0.0.
if [[ -d "$REPO_ROOT/packages/edu-core" ]]; then
  ln -sfn ../../packages/edu-core "$REPO_ROOT/node_modules/@uniwork/edu-core"
fi
npm run notices
npm run build:all
(
  cd "$REPO_ROOT/apps/shell"
  rm -rf "$OUT_DIR/pre-n-prime"/*
  BUILD_DIR="$OUT_DIR/pre-n-prime" CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --linux deb
)
rm -f "$REPO_ROOT/node_modules/@uniwork/edu-core"

# Restore checkout to original branch/HEAD before running manifest inspection.
if [[ -n "$ORIG_BRANCH" ]]; then
  git checkout -f "$ORIG_BRANCH"
else
  git checkout -f "$ORIG_HEAD_SHA"
fi

node - "$REPO_ROOT" "$OUT_DIR" "$ORIG_HEAD_SHA" "$N_PRIME_SHA" "$PRE_N_PRIME_SHA" "$N1_VERSION" <<'EOF'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { collectBuildMetadata, findLinuxArtifacts } from './tools/g7-05/lib.mjs'

const [repoRoot, outDir, n1Sha, nPrimeSha, preNPrimeSha, n1Version] = process.argv.slice(2).map((v, idx) =>
  idx < 2 ? resolve(v) : v,
)

const baseMeta = collectBuildMetadata(repoRoot)
const nPrimeArtifacts = findLinuxArtifacts(join(outDir, 'n-prime'))
const n1Artifacts = findLinuxArtifacts(join(outDir, 'n1'))
const preNPrimeArtifacts = findLinuxArtifacts(join(outDir, 'pre-n-prime'))

if (!nPrimeArtifacts.deb || !nPrimeArtifacts.appImage) {
  console.error('ERROR: Missing N-prime .deb or .AppImage in', join(outDir, 'n-prime'))
  process.exit(1)
}
if (!n1Artifacts.deb || !n1Artifacts.appImage) {
  console.error('ERROR: Missing N+1 .deb or .AppImage in', join(outDir, 'n1'))
  process.exit(1)
}
if (!preNPrimeArtifacts.deb) {
  console.error('ERROR: Missing pre-N-prime .deb in', join(outDir, 'pre-n-prime'))
  process.exit(1)
}

const manifest = {
  collectedAt: new Date().toISOString(),
  serverVersion: baseMeta.serverVersion,
  builds: {
    nPrime: {
      role: "N' (v1.0.0-beta.3)",
      forkSha: nPrimeSha,
      tag: 'v1.0.0-beta.3',
      appVersion: '1.0.0',
      storeSchema: 2,
      appStoreLevel: 2,
      deb: nPrimeArtifacts.deb,
      appImage: nPrimeArtifacts.appImage,
    },
    n1: {
      role: 'N+1 (synthetic store-level 3 test build)',
      forkSha: n1Sha,
      baseCommitSha: n1Sha,
      patchScript: 'tools/g7-05/apply-n1-patch.mjs',
      appVersion: n1Version,
      storeSchema: 2,
      appStoreLevel: 3,
      deb: n1Artifacts.deb,
      appImage: n1Artifacts.appImage,
    },
    preNPrime: {
      role: "pre-N' (pre-G5-04g store-level guard)",
      forkSha: preNPrimeSha,
      tag: 'v0.11.0-dev.6',
      appVersion: '0.11.0',
      storeSchema: 1,
      appStoreLevel: null,
      deb: preNPrimeArtifacts.deb,
      appImage: preNPrimeArtifacts.appImage,
    },
  },
}

const manifestPath = join(outDir, 'upgrade-matrix-artifacts.json')
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log('=== G7-05 Upgrade/Rollback Matrix Build Manifest ===')
console.log(`Manifest path: ${manifestPath}`)
console.log('G7_05_UPGRADE_MATRIX_BUILD_JSON_BEGIN')
console.log(JSON.stringify(manifest, null, 2))
console.log('G7_05_UPGRADE_MATRIX_BUILD_JSON_END')
console.log('G7_05_UPGRADE_MATRIX_BUILD_EXIT=0')
EOF
